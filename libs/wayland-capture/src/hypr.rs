//! Out-of-band cursor sampling for Hyprland.
//!
//! xdg-desktop-portal-hyprland only advertises `Hidden|Embedded` cursor modes,
//! so it never emits `VideoRegionOfInterestMeta` cursor telemetry. Without
//! telemetry the editor cannot draw a synthetic cursor (or its click/zoom
//! overlays) and cannot hide the cursor after the fact. Instead we capture a
//! cursor-free plate (CursorMode::Hidden) and reconstruct cursor telemetry by
//! polling the Hyprland IPC socket while recording.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

/// Logical geometry of the captured monitor, used to normalise the globally
/// positioned cursor into 0..1 frame coordinates.
#[derive(Debug, Clone, Copy)]
pub struct MonitorMap {
    pub logical_x: f64,
    pub logical_y: f64,
    pub logical_w: f64,
    pub logical_h: f64,
}

impl MonitorMap {
    pub fn normalise(&self, global_x: f64, global_y: f64) -> (f64, f64) {
        let cx = ((global_x - self.logical_x) / self.logical_w.max(1.0)).clamp(0.0, 1.0);
        let cy = ((global_y - self.logical_y) / self.logical_h.max(1.0)).clamp(0.0, 1.0);
        (cx, cy)
    }
}

/// Resolve the running compositor's IPC socket, if this is a Hyprland session.
pub fn socket_path() -> Option<PathBuf> {
    let his = std::env::var("HYPRLAND_INSTANCE_SIGNATURE").ok()?;
    let runtime = std::env::var("XDG_RUNTIME_DIR").ok()?;
    let path = PathBuf::from(runtime)
        .join("hypr")
        .join(his)
        .join(".socket.sock");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// Send a single command over the Hyprland IPC socket and return its response.
/// The compositor answers once the write half is closed, so we shut it down
/// before reading to avoid blocking.
pub async fn query(socket: &Path, command: &str) -> Result<String> {
    let mut stream = UnixStream::connect(socket)
        .await
        .context("connect Hyprland IPC socket")?;
    stream
        .write_all(command.as_bytes())
        .await
        .context("write Hyprland IPC command")?;
    stream.flush().await.ok();
    stream.shutdown().await.ok();
    let mut buf = String::new();
    stream
        .read_to_string(&mut buf)
        .await
        .context("read Hyprland IPC response")?;
    Ok(buf)
}

/// Parse the `cursorpos` reply (e.g. "563, 576") into logical coordinates.
pub fn parse_cursorpos(raw: &str) -> Option<(f64, f64)> {
    let (x, y) = raw.trim().split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

/// Confirm the session is Hyprland and its socket is answering, returning the
/// monitor layout (`j/monitors` JSON) needed to normalise cursor positions.
pub async fn detect() -> Option<(PathBuf, String)> {
    let socket = socket_path()?;
    let monitors = query(&socket, "j/monitors").await.ok()?;
    Some((socket, monitors))
}

/// Pick the captured monitor from `j/monitors` JSON and build its logical map.
/// Prefers a monitor whose pixel size matches the captured frame, then the
/// focused monitor, then the first one.
pub fn monitor_for_frame(monitors_json: &str, frame_w: u32, frame_h: u32) -> Option<MonitorMap> {
    let monitors: serde_json::Value = serde_json::from_str(monitors_json).ok()?;
    let list = monitors.as_array()?;
    let map_from = |m: &serde_json::Value| -> Option<MonitorMap> {
        let scale = m.get("scale").and_then(|v| v.as_f64()).unwrap_or(1.0).max(0.1);
        let width = m.get("width").and_then(|v| v.as_f64())?;
        let height = m.get("height").and_then(|v| v.as_f64())?;
        Some(MonitorMap {
            logical_x: m.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0),
            logical_y: m.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0),
            logical_w: width / scale,
            logical_h: height / scale,
        })
    };
    let by_size = list.iter().find(|m| {
        m.get("width").and_then(|v| v.as_u64()) == Some(frame_w as u64)
            && m.get("height").and_then(|v| v.as_u64()) == Some(frame_h as u64)
    });
    let focused = list
        .iter()
        .find(|m| m.get("focused").and_then(|v| v.as_bool()).unwrap_or(false));
    by_size
        .or(focused)
        .or_else(|| list.first())
        .and_then(map_from)
}
