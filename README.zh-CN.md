语言: [English](README.md) | [简体中文](README.zh-CN.md)

<p align="center">
  <img width="180" alt="Wink 标志" src="public/app-icons/recordly-mark.svg" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-111827?style=for-the-badge" alt="macOS Windows Linux" />
  <img src="https://img.shields.io/badge/license-AGPL3.0-8B5CF6?style=for-the-badge" alt="AGPL 3.0 license" />
</p>

# Wink

Wink 是一款跨平台桌面屏幕录制与视频编辑工具，适合制作操作讲解、产品演示、教程，以及需要比原始录屏更精致的快速演示视频。

录制显示器或应用窗口，在时间线上添加动效和重点强调，修饰画面，并导出适合分享的 MP4 或 GIF，不需要把原始素材交给另一套动效工作流。

> **项目身份：** Wink 是当前的产品名称。本仓库是 Recordly 的下游重品牌，而 Recordly 最初源自 OpenScreen。`recordly` 包名、`.recordly` 项目文件、`recordly://` 回调和已有应用 ID 仍保留，用于兼容性。

## 截图与演示

以下媒体文件都保存在仓库中，不依赖旧项目的外部截图。

### 编辑器与时间线

<p align="center">
  <img src="./docs/media/feature3.png" width="900" alt="Wink 编辑器中的摄像头叠加和多轨时间线" />
</p>

### 光标与缩放动效

<p align="center">
  <img src="./docs/media/feature1.gif" width="640" alt="Wink 光标与缩放动效演示" />
</p>

### 摄像头叠加

<p align="center">
  <img src="./docs/media/feature2.gif" width="640" alt="Wink 摄像头叠加演示" />
</p>

### 录制悬浮控制条

| 空闲状态 | 录制状态 |
| --- | --- |
| <img src="./docs/pr/project-browser/idle-hud.png" width="420" alt="Wink 空闲录制悬浮控制条" /> | <img src="./docs/pr/project-browser/recording-hud.png" width="420" alt="Wink 录制中的悬浮控制条" /> |

## 功能

### 录制

- 录制整个显示器或单个应用窗口。
- 录制结束后直接进入编辑器。
- 在当前平台后端支持时录制麦克风音频。
- macOS 使用原生 ScreenCaptureKit 捕获。
- 支持的 Windows 系统使用 Windows Graphics Capture。
- Linux Wayland 使用 XDG Desktop Portal 和 PipeWire。
- 在后台完成素材处理时，编辑器可以继续打开并预览源视频。

### 时间线编辑

- 使用拖放时间线排列视频、音频、摄像头和注释区域。
- 裁剪不需要的片段并调整播放速度。
- 添加手动缩放区域，或根据光标活动生成缩放建议。
- 添加文字、图片和图形注释。
- 在时间线上添加额外音频区域并裁切源画面。
- 保存编辑状态并重新打开 `.recordly` 项目文件。

### 光标表现

- 显示或隐藏渲染后的光标叠加层。
- 调整光标大小、平滑、运动模糊、点击弹跳和摆动效果。
- 使用光标循环模式制作更自然的循环片段。
- 在 Linux Wayland 上通过 Portal 光标元数据驱动编辑器叠加层，而不是把系统光标直接写入视频。

### 摄像头叠加

- 添加、替换、镜像和移除摄像头素材。
- 使用预设位置或自定义坐标。
- 调整尺寸、边距、圆角和阴影。
- 可选择让摄像头随缩放区域一起变化。

### 画面样式

- 使用内置壁纸、纯色、渐变和自定义上传背景。
- 调整留白、宽高比、圆角、模糊和投影。
- 从应用的 wallpapers 目录发现更多背景资源。

### 导出

- 导出 MP4 视频和动态 GIF。
- 选择输出质量、尺寸、GIF 帧率、GIF 大小和循环方式。
- 在系统文件管理器中定位导出的文件。
- 在输出配置支持时使用 WebCodecs 或平台原生导出路径。

### 工作流

- 自定义键盘快捷键并查看应用内快捷键说明。
- 打开已有录像和项目文件。
- 在不同会话之间保留编辑器偏好和项目状态。
- 从编辑器直接打开反馈和问题链接。

## 平台支持

| 平台 | 捕获方式 | 说明 |
| --- | --- | --- |
| macOS 14+ | ScreenCaptureKit 辅助程序 | 支持的系统可使用原生屏幕和麦克风捕获路径。 |
| Windows 10 Build 19041+ | Windows Graphics Capture 辅助程序 | 较旧系统使用 Electron 回退路径，真实光标可能仍会出现在视频中。 |
| Linux Wayland | XDG Desktop Portal + PipeWire 辅助程序 | Wink 原生捕获视频，并向编辑器提供光标元数据。 |
| Linux X11 | Electron 桌面捕获 | 不使用 Wayland 辅助程序，改用浏览器捕获路径。 |

Linux Wayland 原生路径目前不提供系统音频捕获。需要时麦克风可以使用浏览器回退路径。这个限制与视频和光标流程无关。

## 快速开始

### 环境要求

- Node.js 和 npm。
- macOS：Xcode Command Line Tools。
- Windows：Visual Studio 2022 或包含 C++ 工作负载与 CMake 的 Build Tools。
- Linux：带有所需桌面捕获后端的桌面会话。
- Linux Wayland 辅助程序开发环境：Rust、Cargo，以及发行版所需的 GStreamer/PipeWire 运行时依赖。

### 从源码运行

```bash
git clone https://github.com/yasakei/wink.git
cd wink
npm install
npm run dev
```

### 构建应用

```bash
npm run build
```

也可以使用平台专用命令：

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

在 Linux 上可以单独构建 Wayland 辅助程序：

```bash
npm run build:wayland-helper
```

### macOS 隔离提示

macOS Gatekeeper 可能会阻止本地构建的应用。必要时可以对构建出的应用移除隔离标记：

```bash
xattr -rd com.apple.quarantine /Applications/Wink.app
```

## 使用方法

1. 启动 Wink，选择显示器或应用窗口。
2. 根据当前平台选择可用的麦克风和系统音频选项。
3. 开始录制，完成后停止录制。
4. 在编辑器中添加缩放、裁剪、变速、注释、音频和摄像头素材。
5. 修饰画面并预览光标叠加效果。
6. 导出为 MP4 或 GIF。

项目文件继续使用 `.recordly` 扩展名，以兼容之前的 Recordly 项目格式。

## 项目结构

- `src/`：React 渲染进程、编辑器界面、时间线逻辑和导出代码。
- `electron/`：Electron 主进程、IPC、窗口和平台集成。
- `libs/wayland-capture/`：独立的 Linux Wayland 捕获辅助程序。
- `docs/media/`：README 使用的本地截图和演示。
- `docs/pr/project-browser/`：本地录制悬浮控制条截图。
- `services/recordly-share/`：可选的自托管分享服务。

## 致谢与许可证

Wink 是 [Recordly](https://github.com/webadderallorg/Recordly) 的下游重品牌，而 Recordly 最初源自 [OpenScreen](https://github.com/siddharthvaddem/openscreen)。

本项目基于 GNU Affero General Public License v3.0 发布。适用声明和归属要求请参阅 [`LICENSE.md`](LICENSE.md) 与 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 贡献

欢迎贡献代码和文档。请保持改动聚焦，并在适用时附上录制、编辑、导出或文档检查结果。项目指南请参阅 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
