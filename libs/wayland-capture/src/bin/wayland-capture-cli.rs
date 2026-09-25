use anyhow::{Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use wayland_capture::{request_screencast, start_recording, FrameKind, VideoFrameMeta};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorTelemetrySample {
    time_ms: u64,
    cx: f64,
    cy: f64,
    interaction_type: &'static str,
    cursor_type: &'static str,
}

#[derive(Serialize)]
struct CursorTelemetry {
    version: u32,
    samples: Vec<CursorTelemetrySample>,
}

fn output_path() -> Result<PathBuf> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--output" {
            let value = args.next().context("missing --output path")?;
            return Ok(PathBuf::from(value));
        }
    }
    anyhow::bail!("missing --output path")
}

fn telemetry_path(output_path: &Path) -> PathBuf {
    let mut path = output_path.as_os_str().to_os_string();
    path.push(".cursor.json");
    PathBuf::from(path)
}

fn push_cursor_sample(
    samples: &mut Vec<CursorTelemetrySample>,
    meta: &VideoFrameMeta,
    started_at: Instant,
) {
    let Some(cursor) = meta.cursor else {
        return;
    };
    let width = meta.width.max(1) as f64;
    let height = meta.height.max(1) as f64;
    samples.push(CursorTelemetrySample {
        time_ms: started_at.elapsed().as_millis() as u64,
        cx: (cursor.x as f64 / width).clamp(0.0, 1.0),
        cy: (cursor.y as f64 / height).clamp(0.0, 1.0),
        interaction_type: "move",
        cursor_type: "arrow",
    });
}

async fn write_cursor_telemetry(
    output_path: &Path,
    samples: Vec<CursorTelemetrySample>,
) -> Result<()> {
    let path = telemetry_path(output_path);
    if samples.is_empty() {
        tokio::fs::remove_file(path).await.ok();
        return Ok(());
    }
    let telemetry = CursorTelemetry {
        version: 2,
        samples,
    };
    let json = serde_json::to_vec_pretty(&telemetry).context("serialize cursor telemetry")?;
    tokio::fs::write(path, json)
        .await
        .context("write cursor telemetry")?;
    Ok(())
}

/// Poll the Hyprland IPC socket for the cursor position and emit normalised
/// telemetry samples. Used when the portal can't provide cursor metadata.
fn spawn_cursor_sampler(
    socket: std::path::PathBuf,
    monitor: wayland_capture::hypr::MonitorMap,
    started_at: Instant,
    tx: tokio::sync::mpsc::Sender<CursorTelemetrySample>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        // ~30Hz: matches the capture frame rate without hammering the socket.
        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(33));
        loop {
            ticker.tick().await;
            let Ok(raw) = wayland_capture::hypr::query(&socket, "cursorpos").await else {
                continue;
            };
            let Some((gx, gy)) = wayland_capture::hypr::parse_cursorpos(&raw) else {
                continue;
            };
            let (cx, cy) = monitor.normalise(gx, gy);
            let sample = CursorTelemetrySample {
                time_ms: started_at.elapsed().as_millis() as u64,
                cx,
                cy,
                interaction_type: "move",
                cursor_type: "arrow",
            };
            if tx.send(sample).await.is_err() {
                break;
            }
        }
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    let output_path = output_path()?;
    let hide_cursor_requested = std::env::args().skip(1).any(|arg| arg == "--hide-cursor");
    // On Hyprland the portal only advertises Hidden|Embedded cursor modes, so
    // it never emits cursor telemetry. Detect the session and, when present,
    // capture a cursor-free plate while reconstructing the cursor from the
    // Hyprland IPC socket. This lets the editor both hide the cursor and draw
    // its synthetic cursor/click overlays.
    let hypr = wayland_capture::hypr::detect().await;
    // Capture without a burned-in cursor whenever we can supply telemetry
    // ourselves, or when the user explicitly asked to hide the cursor.
    let force_hidden_cursor = hypr.is_some() || hide_cursor_requested;
    let (node_id, fd) = request_screencast(force_hidden_cursor).await?;
    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::channel(4);
    let _pump = wayland_capture::pump_stream(fd, node_id, frame_tx)?;

    let (first_meta, first_frame) = loop {
        let Some((meta, bytes)) = frame_rx.recv().await else {
            anyhow::bail!("capture stream ended before the first frame")
        };
        if meta.kind == FrameKind::Mem && !bytes.is_empty() {
            break (meta, bytes);
        }
    };

    let started_at = Instant::now();
    let mut cursor_samples = Vec::new();
    // When true, cursor telemetry comes from the Hyprland sampler rather than
    // the portal's ROI metadata (which Hyprland never sends). Skipped when the
    // user explicitly hid the cursor, so the recording stays cursor-free.
    let synthesize_cursor = hypr.is_some() && !hide_cursor_requested;
    let (cursor_tx, mut cursor_rx) = tokio::sync::mpsc::channel::<CursorTelemetrySample>(256);
    let mut sampler: Option<tokio::task::JoinHandle<()>> = None;
    if synthesize_cursor {
        if let Some((socket, monitors_json)) = hypr {
            match wayland_capture::hypr::monitor_for_frame(
                &monitors_json,
                first_meta.width,
                first_meta.height,
            ) {
                Some(monitor) => {
                    sampler = Some(spawn_cursor_sampler(
                        socket,
                        monitor,
                        started_at,
                        cursor_tx.clone(),
                    ));
                }
                None => {
                    eprintln!("Hyprland monitor geometry unavailable; cursor overlay disabled");
                }
            }
        }
    } else {
        push_cursor_sample(&mut cursor_samples, &first_meta, started_at);
    }
    drop(cursor_tx);

    // The GStreamer pipeline (`videorate`) already enforces a steady 30fps
    // stream, so every frame is pushed exactly once: stop stays instant no
    // matter how static the screen was.
    const TARGET_FPS: u32 = 30;
    let mut recorder = start_recording(
        first_meta.width,
        first_meta.height,
        TARGET_FPS,
        &output_path,
    )
    .await?;
    recorder.push_frame(&first_frame).await?;
    let mut frames_written: u64 = 1;
    println!("READY:{}", output_path.display());
    use std::io::Write;
    std::io::stdout().flush()?;

    let mut input = BufReader::new(tokio::io::stdin()).lines();
    loop {
        tokio::select! {
            line = input.next_line() => {
                match line {
                    Ok(Some(value)) if value.trim() == "stop" => break,
                    Ok(Some(_)) => {}
                    Ok(None) | Err(_) => break,
                }
            }
            sample = cursor_rx.recv() => {
                if let Some(sample) = sample {
                    cursor_samples.push(sample);
                }
            }
            frame = frame_rx.recv() => {
                let Some((meta, bytes)) = frame else {
                    anyhow::bail!("capture stream ended before recording stopped")
                };
                if meta.kind == FrameKind::Mem && !bytes.is_empty() {
                    if !synthesize_cursor {
                        push_cursor_sample(&mut cursor_samples, &meta, started_at);
                    }
                    recorder.push_frame(&bytes).await?;
                    frames_written += 1;
                }
            }
        }
    }

    if let Some(sampler) = sampler.take() {
        sampler.abort();
    }
    // Drain cursor samples produced but not yet consumed before finalising.
    while let Ok(sample) = cursor_rx.try_recv() {
        cursor_samples.push(sample);
    }

    eprintln!(
        "stop after {:.2}s: frames_written={frames_written}",
        started_at.elapsed().as_secs_f64()
    );

    let path = recorder.finish().await?;
    write_cursor_telemetry(&path, cursor_samples).await?;
    println!("STOPPED:{}", path.display());
    std::io::stdout().flush()?;
    Ok(())
}
