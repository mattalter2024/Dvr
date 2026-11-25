# AirVault — Whole-House OTA DVR & Smart TV System

A complete, self-hosted **Whole-House Over-the-Air (OTA) DVR** built with **Node.js + TypeScript + SQLite + FFmpeg + Comskip**, featuring a **10-foot Smart TV Web App** and a **native Android TV / Google TV / Fire TV Kotlin app** powered by **Jetpack Compose + Media3 ExoPlayer**.

---

## Key Features

- **OTA Tuner Capture & Multi-Room Sharing**
  - Native **HDHomeRun** auto-discovery (UDP broadcast port `65001` + HTTP `/discover.json` & `/lineup.json`) and manual IP registration.
  - Whole-house **Tuner Pool** that shares a single tuner slot & HLS stream when multiple TVs watch the same channel.
  - Built-in **Virtual OTA Tuner Simulator** (8 ATSC test channels with synthetic black-frame/silence ad breaks) so you can test Live TV, recording, and commercial skipping immediately with zero hardware.
- **TV Guide (EPG) Engine**
  - Full **XMLTV importer** (`.xml` and `.xml.gz` from HTTP URLs or local paths, `xmltv_ns` episode parsing, scheduled refresh).
  - **48-hour Sample Guide Generator** for immediate testing.
  - Horizontal time-axis EPG Grid with live red "now" indicator, favorites, search, and one-click recording.
- **DVR Recording & Series Passes**
  - Schedule single episodes, instant ad-hoc recordings, or **Series Passes** (new episodes only or all, start/end padding, keep-at-most N episodes).
  - Automatic **tuner conflict detection** when overlapping recordings exceed available tuners.
  - **Chase-Play**: watch recordings while they are still being captured via fragmented MP4 HTTP Range streaming.
- **Automatic Commercial Detection & Skipping**
  - Primary: **Comskip** CLI integration with ATSC-tuned `server/comskip.ini` + standard `.edl` import/export.
  - Built-in Zero-Comskip Fallback: **FFmpeg `blackdetect` + `silencedetect`** analyzer that automatically identifies ad pods and writes `.edl` markers.
  - Both the **10-foot Web Player** and the **Native Android TV ExoPlayer** highlight commercial breaks in amber on the timeline, auto-skip commercials seamlessly, and show an **Undo Skip** toast (`Left Arrow` / D-pad Left to jump back).
- **Whole-House Smart TV Apps**
  - **Native Android TV / Google TV / Fire TV App (`android-tv/`)**: Kotlin + Jetpack Compose + Media3 ExoPlayer + UDP LAN Server Auto-Discovery (`UDP 41234`), full D-pad & media-key remote support, and whole-house resume position sync.
  - **10-Foot Smart TV Web UI (`web/`)**: React + Vite + HLS.js with spatial D-pad keyboard navigation (`Arrow` keys, `Enter`, `Back`, `Channel +/-`) that works in any Smart TV browser, desktop, tablet, or phone.

---

## Quick Start

### Option A: Docker (Recommended — bundles Node.js, FFmpeg, and Comskip!)

```bash
docker compose up --build -d
```

Open **`http://localhost:8096`** (or `http://<your-server-lan-ip>:8096` from any device in the house).

### Option B: Run Natively with Node.js 22+

1. Install **Node.js 22 LTS** (and optionally **FFmpeg** + **Comskip** in your `PATH`):
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Gyan.FFmpeg
   ```
2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
3. Start the Whole-House DVR Server:
   ```bash
   npm start
   ```
   Or run backend + web dev server with hot reload in two terminals:
   ```bash
   npm run dev:server
   npm run dev:web
   ```

---

## Building & Installing the Android TV / Google TV / Fire TV App

1. Open the **`android-tv/`** folder in **Android Studio** (or build via Gradle with Android SDK 35 + JDK 17):
   ```bash
   cd android-tv
   ./gradlew assembleDebug
   ```
2. Sideload onto your Android TV / Google TV / Amazon Fire TV via ADB:
   ```bash
   adb connect <tv-ip>:5555
   adb install app/build/outputs/apk/debug/app-debug.apk
   ```
3. Launch **AirVault DVR** from your TV home screen — it automatically discovers your home DVR server over Wi-Fi/Ethernet via UDP broadcast (or lets you enter `http://<server-ip>:8096`).

---

## Project Layout

```text
├── server/          # Node.js + TypeScript DVR backend (HDHomeRun, XMLTV, SQLite, FFmpeg, Comskip, HLS, UDP discovery)
├── web/             # React + TypeScript 10-foot Smart TV & Whole-House Web UI (HLS.js + Auto Commercial Skip)
├── android-tv/      # Native Android TV / Google TV / Fire TV Kotlin app (Compose + Media3 ExoPlayer + Auto-Skip)
├── Dockerfile       # Multi-stage image compiling Comskip + bundling FFmpeg & Node 22
└── docker-compose.yml
```
