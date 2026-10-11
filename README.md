# Captor

<p align="center"><img width="160" alt="Captor" src="branding/source-assets/Captor.svg" /></p>

Captor is an open-source desktop screen recorder and video editor for polished demos, tutorials, and product walkthroughs. Record, edit, and export locally, without an account or cloud upload.

Captor is a fork of [Recordly](https://github.com/webadderallorg/Recordly), based on the complete 1.4.0 source snapshot. Recordly originated as a fork of OpenScreen. Original copyright and license notices are preserved in [LICENSE.md](LICENSE.md).

English | [简体中文](README.zh-CN.md)

## Features

- Screen and window recording, microphone/system audio, webcam overlays, and recording countdowns.
- Automatic zooms, cursor smoothing and effects, backgrounds, frames, cropping, shadows, and annotations.
- Timeline editing with clips, trims, playback speed changes, additional audio, undo/redo, and saved `.captor` projects.
- Local captions using whisper.cpp, with caption editing and subtitle sidecar export.
- Local MP4 and GIF export, quality/frame-rate controls, export cancellation, and retrying a canceled save without rendering again.
- Project folders, a raw recordings library, light/dark themes, and keyboard shortcuts.

The inherited extension installation/marketplace placeholder remains disabled. Its status is independent of recording, editing, and export.

## Install on macOS

Download the Apple Silicon (`arm64`) or Intel (`x64`) DMG from [Captor Releases](https://github.com/LeeHongji/Captor/releases). Requires macOS 14 or newer. Drag Captor into Applications.

The current manual-installation build is ad-hoc signed and not notarized. After a blocked first launch, open System Settings → Privacy & Security → Open Anyway for Captor. Managed Macs may restrict this option. Captor checks for new releases; save your work and quit before replacing the app with a newer installer. Automatic installation will be enabled for future Developer ID signed releases.

## Run from source

Use Node.js 22.12 or newer. Platform build requirements:

| Platform | Requirements |
| --- | --- |
| macOS | macOS 14+, Xcode Command Line Tools, CMake |
| Windows | Windows 10 build 19041+, Visual Studio C++ Build Tools, CMake |
| Linux | Native build dependencies, including X11/XTest/XRandR development libraries and CMake |

```bash
git clone https://github.com/LeeHongji/Captor.git
cd Captor
npm ci
npm run dev
```

On macOS, you can also double-click `Captor Dev.command` after installing dependencies. `npm ci` installs the Electron runtime and builds native helpers. The first recording may require screen-recording, accessibility, microphone, or camera permissions for the features you use.

Development data is stored separately under the platform's `Captor-dev` application-data directory. No service keys or `.env` file are needed.

## Build and verify

```bash
npm run typecheck
npm run lint
npm test
npm run i18n:check
npm run test:ui
npm run build
```

Browser tests require `npx playwright install chromium`. Platform-specific packaging commands are `npm run build:mac`, `npm run build:win`, and `npm run build:linux`. macOS distribution signing/notarization requires the credentials described in [RELEASING.md](RELEASING.md).

## Local data and feedback

Recordings, project files, and exports stay on your computer. Captor has no login, cloud video library, upload destination, or feedback backend.

Feedback opens your system email app with a prepared draft to **2020124002@email.szu.edu.cn**. You review and send the email yourself, and can add attachments there. If the email app cannot open, copy the feedback from the dialog. Export-error reports include only previewable, allowlisted technical details, without recordings, paths, or console logs.

## Updates and announcements

Packaged builds use [Captor GitHub Releases](https://github.com/LeeHongji/Captor/releases) for updates. Development builds do not auto-update. Announcements come from this repository's [announcements.json](announcements.json); authoring instructions are in [docs/announcements.md](docs/announcements.md).

For development/testing, existing overrides are `CAPTOR_DISABLE_AUTO_UPDATES=1`, `CAPTOR_UPDATE_FEED_URL`, and `CAPTOR_ANNOUNCEMENTS_URL` (`off` disables remote announcements). Caption models can be downloaded when requested or selected from local files; caption processing runs locally.

## Contributing and license

Report problems through Feedback or [GitHub Issues](https://github.com/LeeHongji/Captor/issues). See [CONTRIBUTING.md](CONTRIBUTING.md), [LICENSE.md](LICENSE.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
