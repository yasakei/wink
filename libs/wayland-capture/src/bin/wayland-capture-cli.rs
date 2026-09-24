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

#[tokio::main]
async fn main() -> Result<()> {
    let output_path = output_path()?;
    let (node_id, fd) = request_screencast().await?;
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
    push_cursor_sample(&mut cursor_samples, &first_meta, started_at);

    let mut recorder = start_recording(
        first_meta.width,
        first_meta.height,
        first_meta.fps,
        &output_path,
    )
    .await?;
    recorder.push_frame(&first_frame).await?;
    println!("READY:{}", output_path.display());
    use std::io::Write;
    std::io::stdout().flush()?;

    let mut input = BufReader::new(tokio::io::stdin()).lines();
    let stop_input = input.next_line();
    tokio::pin!(stop_input);
    loop {
        tokio::select! {
            line = &mut stop_input => {
                match line {
                    Ok(Some(value)) if value.trim() == "stop" => break,
                    Ok(Some(_)) => {}
                    Ok(None) | Err(_) => break,
                }
            }
            frame = frame_rx.recv() => {
                let Some((meta, bytes)) = frame else {
                    anyhow::bail!("capture stream ended before recording stopped")
                };
                if meta.kind == FrameKind::Mem && !bytes.is_empty() {
                    push_cursor_sample(&mut cursor_samples, &meta, started_at);
                    recorder.push_frame(&bytes).await?;
                }
            }
        }
    }

    let path = recorder.finish().await?;
    write_cursor_telemetry(&path, cursor_samples).await?;
    println!("STOPPED:{}", path.display());
    std::io::stdout().flush()?;
    Ok(())
}
