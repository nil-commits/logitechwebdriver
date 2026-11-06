# Logitech G HUB — Local Web Driver (Zero-Internet / Zero-Bloat Edition)

A 100% local, browser-based driver for Logitech G peripherals reverse-engineered from **Logitech G HUB (`C:\Program Files\LGHUB`, v2026.7.1011216)** using the REA MCP reverse-engineering suite.

It runs the complete G HUB hardware configuration UI (DPI Editor, Advanced DPI, 8000 Hz LIGHTSPEED Report Rate, Onboard Memory Manager, Macros, Assignments, LIGHTSYNC RGB, Acoustics, Surface Tuning, Battery & Power Telemetry) directly inside **any standard web browser** at **`http://127.0.0.1:1133`** (`1133 = 0x046D`, Logitech's USB Vendor ID) while eliminating the bloated Electron shell (`lghub.exe`), System Tray app (`lghub_system_tray.exe`), SSO handler (`lghub_sso_handler.exe`), Marketplace, Game Launcher, Sentry crash reporting, and all external internet dependencies.

---

## Architectural Findings (REA MCP Evidence)

1. **Desktop Packaging & Binary Layout** (`ev_b13e0c12a2587b06ab8f4d2065f9d5a8e870002e77478302550dd76e6e809125`, `ev_d79326afca48106dec0ad212afcb5a6bd7b4aa8bdff899296cfe06dc396c2593`):
   - `lghub.exe` is an Electron 39.1.2 shell (with `RunAsNode: disabled` and `EnableEmbeddedAsarIntegrityValidation: enabled`) that loads `resources/app.asar`.
   - Actual USB/LIGHTSPEED hardware communication is handled by a lightweight native C++ daemon, `C:\Program Files\LGHUB\lghub_agent.exe`.
2. **Electron ASAR & IPC Bridge (`main.js` + `preload.bundle.js`)** (`ev_8cbc10c3d68dc7fe0597f01077e2c5de5ba26eee08a3a0528ca5f6fe203d6e47`, `ev_2f53e635c33fe62e6763a293d9afa643db56b75f34e737e454bb8da2f291e79c`, `ev_bc70c4e828dcca2e59c4e0d5d3d57724fdc53dbc0232f3af48acc0177d883f1e`):
   - `preload.bundle.js` exposes 7 `contextBridge` globals onto `window`: `electron`, `electronNet`, `electronGLNet`, `electronStore`, `lps`, `utils`, and `env`.
   - While `main.js` connects `electronNet` to the Windows Named Pipe `\\.\pipe\e0c10619-60c9-5414-a4e8-5d9e19d4dedc` (which enforces an Authenticode process check on the connecting client), `lghub_agent.exe` simultaneously hosts:
     - **`ws://127.0.0.1:9010` (WebSocket subprotocol `"json"`)**: Serves the exact same RPC message router (`GET`, `SET`, `SUBSCRIBE`, `UNSUBSCRIBE`, `BROADCAST`) in native JSON (with `google.protobuf.Any` `"@type"` annotations that `main.js` strips via `delete payload["@type"]`).
     - **`http://127.0.0.1:9180`**: Serves local device thumbnails, SVGs, and lighting assets (`/core_assets/...`).
3. **Managed Update/Bootstrap & Native Audio DSP** (`ev_a2c584dfa79f3a60c36147863ad24a4a61dfeba08a3a0528ca5f6fe203d6e47`, `ev_dd8030345549c0d75c6486fec0026666e071f067766cac34146aa95aa1fd959e`):
   - `lghub_software_manager.exe` (.NET WPF updater) and `lghub_sso_handler.exe` are only needed for cloud updates and OAuth login, and can be bypassed completely.

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
Then open **`http://127.0.0.1:1133`** in any browser (Chrome, Edge, Firefox, Brave).

Press **`Alt+G`** (or click the floating **`Local Web Driver`** pill in the bottom-right corner) at any time to open the **Quick Controls, Firewall Telemetry & Live Agent RPC Drawer**.

---

## Project Structure
- [`server.js`](./server.js): Zero-dependency Node.js HTTP + RFC 6455 WebSocket server (`127.0.0.1:1133`). Auto-starts `lghub_agent.exe` (`cwd: C:\Program Files\LGHUB`), kills Electron bloat processes (`lghub.exe`, `lghub_system_tray.exe`, `lghub_sso_handler.exe`), proxies `/__ghub_ws__` to `ws://127.0.0.1:9010`, proxies `/__agent_asset__/*` to `http://127.0.0.1:9180/*`, and filters out telemetry/cloud/update RPCs.
- [`ghub-proto-bridge.cjs`](./ghub-proto-bridge.cjs): Standalone `@bufbuild/protobuf` + `@logi/common-core-shared-protos` schema registry extracted from `main.js` (13 route schemas).
- [`public/preload-web-shim.js`](./public/preload-web-shim.js): Browser-side Electron `contextBridge` polyfill, `fetch`/`XHR` zero-internet firewall, `file:///` and `127.0.0.1:9180` asset URL rewriter, and floating Quick Control & RPC Drawer.
- [`public/debloat.css`](./public/debloat.css): Hides Electron window controls, cloud login, Marketplace, and Game Launcher UI bloat, and styles the floating HUD pill and drawer.
- [`public/index.html`](./public/index.html) & `public/app.min.js`: Extracted G HUB web UI with strict localhost-only Content-Security-Policy.
