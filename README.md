Language: [English](README.md) | [简体中文](README.zh-CN.md)

<p align="center">
  <img width="180" alt="Wink logo" src="public/app-icons/recordly-mark.svg" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-111827?style=for-the-badge" alt="macOS Windows Linux" />
  <img src="https://img.shields.io/badge/license-AGPL3.0-8B5CF6?style=for-the-badge" alt="AGPL 3.0 license" />
</p>

# Wink

Wink is a cross-platform desktop screen recorder and video editor for walkthroughs, product demos, tutorials, and quick recordings that need more polish than a raw screen capture.

Record a display or window, add motion and emphasis on the timeline, style the frame, and export a shareable MP4 or GIF without sending the footage through a separate motion-design workflow.

> **Project identity:** Wink is the current product name. This repository is a downstream rebrand of Recordly, and Recordly began as a fork of OpenScreen. Legacy identifiers such as the `recordly` package name, `.recordly` project files, `recordly://` callbacks, and existing app IDs are retained for compatibility.

## Screenshots and demos

The media below is stored in this repository so the README does not depend on old external product screenshots.

### Editor and timeline

<p align="center">
  <img src="./docs/media/feature3.png" width="900" alt="Wink editor showing a webcam overlay and a multi-track timeline" />
</p>

### Cursor and zoom motion

<p align="center">
  <img src="./docs/media/feature1.gif" width="640" alt="Wink cursor and zoom motion demonstration" />
</p>

### Webcam overlay

<p align="center">
  <img src="./docs/media/feature2.gif" width="640" alt="Wink webcam overlay demonstration" />
</p>

### Capture HUD

| Idle HUD | Recording HUD |
| --- | --- |
| <img src="./docs/pr/project-browser/idle-hud.png" width="420" alt="Wink idle capture HUD" /> | <img src="./docs/pr/project-browser/recording-hud.png" width="420" alt="Wink recording capture HUD" /> |

## Features

### Recording

- Record a full display or an individual application window.
- Continue directly into the editor after recording.
- Capture microphone audio where the active platform backend supports it.
- Use native ScreenCaptureKit capture on macOS.
- Use Windows Graphics Capture on supported Windows builds.
- Use the XDG Desktop Portal and PipeWire on Linux Wayland.
- Keep the editor open on the source recording while assets are finalized.

### Timeline editing

- Arrange video, audio, webcam, and annotation regions on a drag-and-drop timeline.
- Trim unwanted sections and change playback speed.
- Add manual zoom regions or use cursor-activity-based zoom suggestions.
- Add text, image, and figure annotations.
- Add extra audio regions and crop the source frame.
- Save editor state and reopen `.recordly` project files.

### Cursor presentation

- Show or hide the rendered cursor overlay.
- Adjust cursor size, smoothing, motion blur, click bounce, and sway.
- Use cursor loop mode for cleaner looping exports.
- On Linux Wayland, use portal cursor metadata for the editable overlay instead of baking the system cursor into the video.

### Webcam overlay

- Add, replace, mirror, and remove webcam footage.
- Choose a preset position or custom coordinates.
- Control size, margins, roundness, and shadow.
- Optionally scale the webcam with zoom regions.

### Frame styling

- Use built-in wallpapers, colors, gradients, and custom uploaded backgrounds.
- Adjust padding, aspect ratio, corner radius, blur, and drop shadows.
- Discover additional wallpapers from the application wallpapers directory.

### Export

- Export MP4 video and animated GIFs.
- Choose output quality, dimensions, GIF frame rate, GIF size, and loop behavior.
- Reveal completed exports in the system file manager.
- Use WebCodecs or platform-native export paths when the selected output profile is supported.

### Workflow

- Customize keyboard shortcuts and view the in-app shortcut reference.
- Open existing recordings and project files.
- Keep editor preferences and project state across sessions.
- Use the feedback and issue links from the editor.

## Platform support

| Platform | Capture path | Notes |
| --- | --- | --- |
| macOS 14+ | ScreenCaptureKit helper | Native screen and microphone capture paths are available on supported systems. |
| Windows 10 Build 19041+ | Windows Graphics Capture helper | Older systems use the Electron fallback, where the real cursor may remain visible. |
| Linux Wayland | XDG Desktop Portal + PipeWire helper | Video capture is native to Wink; the helper requests cursor metadata for the editor overlay. |
| Linux X11 | Electron desktop capture | Browser capture is used instead of the Wayland helper. |

The native Linux Wayland path currently does not provide system-audio capture. Microphone capture can use the browser fallback when needed. This limitation is separate from the video and cursor pipeline.

## Getting started

### Requirements

- Node.js and npm.
- macOS: Xcode Command Line Tools.
- Windows: Visual Studio 2022 or Build Tools with the C++ workload and CMake.
- Linux: a desktop session with the required display-capture backend.
- Linux development for the Wayland helper: Rust, Cargo, and the GStreamer/PipeWire runtime dependencies required by your distribution.

### Run from source

```bash
git clone https://github.com/yasakei/wink.git
cd wink
npm install
npm run dev
```

### Build a package

```bash
npm run build
```

Platform-specific commands are also available:

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

On Linux, the Wayland helper can be built independently with:

```bash
npm run build:wayland-helper
```

### macOS quarantine notice

Locally built applications may be blocked by macOS Gatekeeper. If necessary, remove the quarantine flag from the built application:

```bash
xattr -rd com.apple.quarantine /Applications/Wink.app
```

## Usage

1. Launch Wink and select a display or application window.
2. Choose the available microphone and system-audio options for the selected platform.
3. Start recording and stop it when the walkthrough is complete.
4. Add zooms, trims, speed changes, annotations, audio, and webcam footage in the editor.
5. Style the frame and preview the cursor overlay.
6. Export as MP4 or GIF.

Project files use the `.recordly` extension for compatibility with the previous Recordly project format.

## Project structure

- `src/` — React renderer, editor UI, timeline logic, and export code.
- `electron/` — Electron main process, IPC handlers, windows, and platform integration.
- `libs/wayland-capture/` — standalone Linux Wayland capture helper.
- `docs/media/` — local README screenshots and demonstrations.
- `docs/pr/project-browser/` — local capture HUD screenshots.
- `services/recordly-share/` — optional self-hosted sharing service.

## Attribution and license

Wink is a downstream rebrand of [Recordly](https://github.com/webadderallorg/Recordly). Recordly began as a fork of [OpenScreen](https://github.com/siddharthvaddem/openscreen).

This project is licensed under the GNU Affero General Public License v3.0. See [`LICENSE.md`](LICENSE.md) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the applicable notices and attribution requirements.

## Contributing

Contributions are welcome. Please keep changes focused and include relevant recording, editing, export, or documentation checks when applicable. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the project guidelines.
