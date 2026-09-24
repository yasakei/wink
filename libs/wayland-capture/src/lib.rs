use anyhow::{Context, Result};
use std::os::fd::{AsRawFd, OwnedFd};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    DmaBuf,
    Mem,
}

#[derive(Debug, Clone, Copy)]
pub struct VideoFrameMeta {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub fps: u32,
    pub kind: FrameKind,
    pub cursor: Option<CursorPosition>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CursorPosition {
    pub x: u32,
    pub y: u32,
}

pub async fn request_screencast() -> Result<(u32, OwnedFd)> {
    use ashpd::desktop::{
        screencast::{CursorMode, Screencast, SourceType},
        PersistMode,
    };

    let proxy = Screencast::new()
        .await
        .context("connect to org.freedesktop.portal.ScreenCast")?;
    let session = proxy
        .create_session()
        .await
        .context("create ScreenCast session")?;
    proxy
        .select_sources(
            &session,
            CursorMode::Metadata,
            (SourceType::Monitor | SourceType::Window).into(),
            false,
            None,
            PersistMode::DoNot,
        )
        .await
        .context("select ScreenCast sources")?;
    let streams = proxy
        .start(&session, None)
        .await
        .context("start ScreenCast stream")?
        .response()?;
    let node_id = streams
        .streams()
        .first()
        .context("ScreenCast returned no streams")?
        .pipe_wire_node_id();
    let fd = proxy
        .open_pipe_wire_remote(&session)
        .await
        .context("open PipeWire remote")?;
    Ok((node_id, fd))
}

pub fn pump_stream(
    fd: OwnedFd,
    node_id: u32,
    tx: mpsc::Sender<(VideoFrameMeta, Vec<u8>)>,
) -> Result<tokio::task::JoinHandle<()>> {
    Ok(tokio::task::spawn_blocking(move || {
        if let Err(error) = run_pipeline(fd, node_id, tx) {
            eprintln!("capture pipeline failed: {error}");
        }
    }))
}

fn pack_bgrx_frame(mapped: &[u8], width: u32, height: u32, stride: u32) -> Vec<u8> {
    let packed_stride = width as usize * 4;
    let height = height as usize;
    if stride as usize == packed_stride {
        return mapped.to_vec();
    }
    let stride = (stride as usize).max(packed_stride);
    let mut packed = Vec::with_capacity(packed_stride * height);
    for row in 0..height {
        let start = row * stride;
        let end = start + packed_stride;
        if end <= mapped.len() {
            packed.extend_from_slice(&mapped[start..end]);
        }
    }
    packed
}

fn run_pipeline(
    fd: OwnedFd,
    node_id: u32,
    tx: mpsc::Sender<(VideoFrameMeta, Vec<u8>)>,
) -> Result<()> {
    use gstreamer as gst;
    use gstreamer::prelude::*;
    use gstreamer_video::{VideoInfo, VideoRegionOfInterestMeta};

    gst::init().context("initialize GStreamer")?;
    let owned_dup = fd.try_clone().context("duplicate PipeWire fd")?;
    drop(fd);
    let raw_fd = owned_dup.as_raw_fd();
    std::mem::forget(owned_dup);
    let launch = format!(
        "pipewiresrc name=src fd={raw_fd} path={node_id} always-copy=true use-bufferpool=false ! videoconvert ! video/x-raw,format=BGRx ! appsink name=sink emit-signals=false max-buffers=2 drop=true sync=false"
    );
    let pipeline = gst::parse::launch(&launch).context("parse capture pipeline")?;
    let bin = pipeline
        .downcast::<gst::Bin>()
        .map_err(|_| anyhow::anyhow!("capture pipeline is not a bin"))?;
    let appsink = bin
        .by_name("sink")
        .context("capture appsink is missing")?
        .downcast::<gstreamer_app::AppSink>()
        .map_err(|_| anyhow::anyhow!("capture sink is not an AppSink"))?;
    let bus = bin.bus().context("capture pipeline bus is missing")?;
    bin.set_state(gst::State::Playing)
        .context("start capture pipeline")?;

    loop {
        if tx.is_closed() {
            break;
        }
        while let Some(message) = bus.timed_pop(gst::ClockTime::ZERO) {
            use gstreamer::MessageView;
            if let MessageView::Error(error) = message.view() {
                anyhow::bail!("GStreamer error: {} ({:?})", error.error(), error.debug());
            }
        }
        let Some(sample) = appsink.try_pull_sample(gst::ClockTime::from_mseconds(200)) else {
            continue;
        };
        let caps = sample.caps().context("sample has no caps")?;
        let info = VideoInfo::from_caps(caps).context("invalid video caps")?;
        let width = info.width();
        let height = info.height();
        let stride = info.stride().first().copied().unwrap_or(0).max(0) as u32;
        let fps_fraction = info.fps();
        let fps = if fps_fraction.denom() > 0 {
            ((fps_fraction.numer() as f32 / fps_fraction.denom() as f32).round() as u32)
                .clamp(1, 240)
        } else {
            60
        };
        let buffer = sample.buffer().context("sample has no buffer")?;
        let cursor = buffer.meta::<VideoRegionOfInterestMeta>().and_then(|meta| {
            if meta.roi_type() != "cursor" {
                return None;
            }
            let (x, y, _, _) = meta.rect();
            Some(CursorPosition { x, y })
        });
        let (kind, bytes) = match buffer.map_readable() {
            Ok(mapped) => (
                FrameKind::Mem,
                pack_bgrx_frame(mapped.as_slice(), width, height, stride),
            ),
            Err(_) => (FrameKind::DmaBuf, Vec::new()),
        };
        let meta = VideoFrameMeta {
            width,
            height,
            stride,
            fps,
            kind,
            cursor,
        };
        if tx.blocking_send((meta, bytes)).is_err() {
            break;
        }
    }
    bin.set_state(gst::State::Null).ok();
    Ok(())
}

pub struct EncoderSession {
    child: Child,
    stdin: Option<ChildStdin>,
    stderr_task: Option<tokio::task::JoinHandle<String>>,
    pub output_path: PathBuf,
}

pub async fn start_recording(
    width: u32,
    height: u32,
    fps: u32,
    output_path: &Path,
) -> Result<EncoderSession> {
    if let Some(parent) = output_path.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }
    let size = format!("{width}x{height}");
    let mut child = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgra",
            "-s",
            &size,
            "-r",
            &fps.max(1).to_string(),
            "-i",
            "-",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-movflags",
            "+faststart",
            &output_path.to_string_lossy(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("spawn ffmpeg")?;
    let stdin = child.stdin.take().context("ffmpeg stdin is unavailable")?;
    let mut stderr = child
        .stderr
        .take()
        .context("ffmpeg stderr is unavailable")?;
    let stderr_task = tokio::spawn(async move {
        let mut detail = String::new();
        let _ = stderr.read_to_string(&mut detail).await;
        detail
    });
    Ok(EncoderSession {
        child,
        stdin: Some(stdin),
        stderr_task: Some(stderr_task),
        output_path: output_path.to_path_buf(),
    })
}

impl EncoderSession {
    pub async fn push_frame(&mut self, frame: &[u8]) -> Result<()> {
        self.stdin
            .as_mut()
            .context("ffmpeg stdin is closed")?
            .write_all(frame)
            .await
            .context("write frame to ffmpeg")
    }

    async fn stderr_detail(&mut self) -> String {
        let Some(task) = self.stderr_task.take() else {
            return String::new();
        };
        tokio::time::timeout(std::time::Duration::from_secs(2), task)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or_default()
    }

    pub async fn finish(mut self) -> Result<PathBuf> {
        drop(self.stdin.take());
        let status = tokio::time::timeout(std::time::Duration::from_secs(30), self.child.wait())
            .await
            .context("timeout waiting for ffmpeg")?
            .context("wait for ffmpeg")?;
        let detail = self.stderr_detail().await;
        if !status.success() {
            anyhow::bail!("ffmpeg exited with {status}: {detail}");
        }
        Ok(self.output_path)
    }
}
