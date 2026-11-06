# Logitech G HUB — Local Web Driver (Zero-Internet / Zero-Bloat Edition)

A 100% local, cross-browser web driver for Logitech G peripherals reverse-engineered from **Logitech G HUB (`C:\Program Files\LGHUB`, v2026.7.1011216)** using the REA MCP reverse-engineering suite, featuring an instrument-grade UI inspired by **OpenMouse**, **Wooting Wootility**, **MCHOSE Hub**, and **Corsair Web Hub**.

Unlike WebHID-only web drivers that only work in Chromium browsers, this driver works in **any web browser** (Firefox, Safari, Chrome, Brave, Edge) at **`http://127.0.0.1:1133`** (`1133 = 0x046D`, Logitech's USB Vendor ID) via a zero-dependency local Node.js bridge to `lghub_agent.exe`, while terminating the bloated Electron shell (`lghub.exe`), System Tray app (`lghub_system_tray.exe`), SSO handler (`lghub_sso_handler.exe`), Marketplace, Game Launcher, Sentry crash reporting, and all external internet dependencies.

---

## Key Features & UI Polish

- **Works in Any Browser (Zero WebHID Lock-In)**: Communicates over standard local HTTP/WebSocket (`http://127.0.0.1:1133` -> `ws://127.0.0.1:9010`) so Firefox, Safari, and Chromium browsers all have full hardware read/write access.
- **Instrument-Grade Design System**:
  - **12 Switchable Themes**: `Ice` (Logitech Cyan), `Emerald`, `Matt`, `Violet`, `Ember`, `Mono`, `Miku`, `Catppuccin Mocha`, `Catppuccin Macchiato`, `Catppuccin Frappé`, `NieR: Automata`, and `Light` — with live self-styled preview tiles and deterministic top-right ASCII noise glow (` .:-=+*#%@`).
  - **100% Local Assets**: Bundled variable `DM Sans` font (`/fonts/DMSans-Variable.ttf`) and local studio device renders (`/devices/pro_x_2_wireless_mouse.png` + `/__agent_asset__/` proxy) with strict `127.0.0.1`-only Content-Security-Policy.
- **Overview & Polling-Rate-Aware Battery Sparkline**:
  - Live 4-figure setup summary (`Sensitivity`, `Polling rate`, `Battery`, `Control mode`) with one-click DPI stage chips.
  - Real-time battery history sparkline (`localStorage` checkpoints) and remaining-hours estimator dynamically scaled by wireless polling rate mW draw (`95h @ 1000 Hz` down to `24h @ 8000 Hz`).
- **Performance Tuning (`HERO 2 44K` & `8000 Hz LIGHTSPEED`)**:
  - **5-Stage & Single-View DPI Editor**: Enable/disable stages, hardware LED stage color swatches, independent **X/Y axis lock/unlock**, and per-stage Lift-Off Distance (`Low` / `Medium` / `High`).
  - **Bar-Tower Polling Rate Selector**: Visual 7-step bar-height selector (`125`, `250`, `500`, `1000`, `2000`, `4000`, `8000 Hz`) for Wireless (`LIGHTSPEED`) and Wired (`USB`) with live battery runtime estimates on every step.
  - **Gaming Surface Mode & BHOP Filter**: `Auto` / `On (Tuned)` / `Off` surface mode + scroll wheel BHOP debounce filter (`100`–`1000 ms`).
- **Interactive Top-Down Button Map**:
  - Numbered callouts (`1`–`5`) with leader lines on the top-down mouse render, `Standard` and `G-Shift` layers, searchable categorized command picker (all 281 hardware cards), **Keystroke Recorder**, and duplicate-binding conflict warnings.
  - **LIGHTFORCE Switch Mode**: Toggle between `Hybrid (Power save)` and `Optical only (Low latency)`.
- **Automated & Interactive Hardware Test Suite**:
  - 5-stage diagnostic runner verifying local `lghub_agent` RPC latency, firmware/receiver identity, sensor/battery telemetry, a 3.5-second live coalesced pointer polling rate sampler (`Peak Hz`, `Avg Hz`, sample count), and downloadable JSON test reports.
- **Instant Apply vs. Staged Pending Bar & Portable Profile Keys**:
  - Write changes immediately on click, or queue changes in a floating bottom apply bar (`Save to mouse` / `Revert`).
  - Share or back up your setup as a compact `lgwd1:...` Base64 profile key or full JSON file.

---

## Quick Start

### Option 1: Double-click `start-driver.bat` (or run from PowerShell)
```powershell
cd c:\Users\Nick\Downloads\rea-main\lghub-web-driver
.\start-driver.bat
```

### Option 2: Run directly with Node.js
```powershell
node c:\Users\Nick\Downloads\rea-main\lghub-web-driver\server.js
```
Then open **`http://127.0.0.1:1133`** in any browser (Firefox, Chrome, Edge, Brave, Safari).

---

## Project Structure
- [`server.js`](./server.js): Zero-dependency Node.js HTTP + RFC 6455 WebSocket server (`127.0.0.1:1133`). Auto-starts `lghub_agent.exe`, terminates Electron bloat processes (`lghub.exe`, `lghub_system_tray.exe`, `lghub_sso_handler.exe`), proxies `/__ghub_ws__` to `ws://127.0.0.1:9010`, proxies `/__agent_asset__/*` to `http://127.0.0.1:9180/*`, and blocks all cloud/telemetry RPCs.
- [`ghub-proto-bridge.cjs`](./ghub-proto-bridge.cjs): Standalone `@bufbuild/protobuf` + `@logi/common-core-shared-protos` schema registry extracted from `main.js` (661 routes).
- [`public/index.html`](./public/index.html), [`public/styles.css`](./public/styles.css), [`public/app.js`](./public/app.js): The OpenMouse-inspired cross-browser web driver frontend.
- [`public/legacy-ghub.html`](./public/legacy-ghub.html): Optional fallback to the original extracted G HUB React bundle with debloat shim.
