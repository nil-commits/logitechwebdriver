/**
 * Logitech G HUB Local Web Driver — Zero-Internet / Zero-Bloat Server
 *
 * Reverse-engineered from Logitech G HUB (C:\Program Files\LGHUB) using REA MCP:
 *   - Desktop Packaging & Inventory: ev_b13e0c12a2587b06ab8f4d2065f9d5a8e870002e77478302550dd76e6e809125
 *   - Electron Fuses (lghub.exe):    ev_d79326afca48106dec0ad212afcb5a6bd7b4aa8bdff899296cfe06dc396c2593
 *   - ASAR JS & IPC Architecture:    ev_8cbc10c3d68dc7fe0597f01077e2c5de5ba26eee08a3a0528ca5f6fe203d6e47
 *   - IPC Channel Handler Mapping:   ev_2f53e635c33fe62e6763a293d9afa643db56b75f34e737e454bb8da2f291e79c
 *   - Extracted app.asar Bundle:     ev_bc70c4e828dcca2e59c4e0d5d3d57724fdc53dbc0232f3af48acc0177d883f1e
 *
 * Architecture:
 *   - Serves the extracted G HUB web application (public/index.html, app.min.js, app.min.css)
 *     in any standard web browser on http://127.0.0.1:1133 (1133 = 0x046D Logitech USB Vendor ID).
 *   - Injects public/preload-web-shim.js and public/debloat.css to polyfill all 7 Electron
 *     contextBridge globals (window.electron, window.electronNet, window.electronGLNet,
 *     window.electronStore, window.lps, window.utils, window.env).
 *   - Bridges browser WebSocket connections (/__ghub_ws__) to the local hardware daemon
 *     lghub_agent.exe (ws://127.0.0.1:9010, subprotocol "json") and proxies device assets
 *     from http://127.0.0.1:9180.
 *   - Strips all cloud, SSO, Marketplace, Game Launcher, Sentry crash reporting, and telemetry bloat.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const ProtoBridge = require("./ghub-proto-bridge.cjs");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 1133); // 0x046D = 1133 (Logitech Vendor ID)

const PROGRAM_FILES = process.env.ProgramFiles || "C:\\Program Files";
const PROGRAM_DATA = process.env.ProgramData || "C:\\ProgramData";
const APPDATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

const LGHUB_INSTALL_DIR = path.join(PROGRAM_FILES, "LGHUB");
const LGHUB_AGENT_EXE = path.join(LGHUB_INSTALL_DIR, "lghub_agent.exe");
const LGHUB_PROGRAM_DATA = path.join(PROGRAM_DATA, "LGHUB");
const LGHUB_CACHED_IMAGES = path.join(PROGRAM_DATA, "LGHUBData", "applications", "CachedImages");
const LGHUB_ROAMING_DIR = path.join(APPDATA, "lghub");
const FRONTEND_STORE_PATH = path.join(LGHUB_ROAMING_DIR, "frontend-store.json");
const LOCAL_STORE_FALLBACK = path.join(__dirname, "local-frontend-store.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const AGENT_WS_URL = "ws://127.0.0.1:9010";
const AGENT_ASSET_PORT = 9180;

const bootTimestamp = Date.now();
let deviceSalt = "lghub-local-web-driver-salt-046d";

// Try reading existing Chromium device_id_salt if present
try {
  const prefPath = path.join(LGHUB_ROAMING_DIR, "Preferences");
  if (fs.existsSync(prefPath)) {
    const prefs = JSON.parse(fs.readFileSync(prefPath, "utf8"));
    const salt = prefs?.electron?.media?.device_id_salt;
    if (salt) deviceSalt = salt;
  }
} catch {
  // Use deterministic local fallback salt
}

// ============================================================================
// Telemetry & Bloat Firewall
// ============================================================================

const firewallStats = {
  startedAt: new Date().toISOString(),
  blockedRpcCount: 0,
  blockedHttpCount: 0,
  sanitizedConfigCount: 0,
  recentBlocked: [],
};

function recordBlocked(kind, target, detail = "") {
  if (kind === "rpc") firewallStats.blockedRpcCount++;
  else firewallStats.blockedHttpCount++;
  firewallStats.recentBlocked.unshift({
    time: new Date().toISOString(),
    kind,
    target,
    detail,
  });
  if (firewallStats.recentBlocked.length > 60) {
    firewallStats.recentBlocked.length = 60;
  }
}

const BLOCKED_RPC_PATTERNS = [
  /^\/crash_reporting\//,
  /^\/analytics\b/,
  /^\/accounts\/(login_websso|logout_websso|create|refresh_account|subscribe_marketing_emails|cn_idaas_status)/,
  /^\/community\/(publish|upvote|delete|change_visibility)/,
  /^\/updates\/(check_now|download|install|periodic_check|remote)/,
  /^\/logging\/(ghub_backend|gl_backend)\/trigger/,
  /^\/event_tracing\//,
  /^\/lps\/(install_plugin_from_marketplace|install_plugins_from_marketplace|process_url)/,
];

function shouldBlockOutgoingRpc(msg) {
  if (!msg || typeof msg.path !== "string") return false;
  const p = msg.path;
  // Allow GET /crash_reporting/status but return synthetic disabled status
  if (p === "/crash_reporting/status" && msg.verb === "GET") return true;
  if (p === "/accounts/get_account" && msg.verb === "GET") return true;
  return BLOCKED_RPC_PATTERNS.some((re) => re.test(p));
}

function buildSyntheticBlockedResponse(msg) {
  let payload = {};
  if (msg.path === "/crash_reporting/status") {
    payload = { enabled: false };
  } else if (msg.path === "/accounts/get_account") {
    payload = {};
  }
  return {
    msgId: msg.msgId || "",
    verb: msg.verb || "GET",
    path: msg.path || "",
    origin: "backend",
    result: { code: "SUCCESS", what: "" },
    payload,
  };
}

// ============================================================================
// Payload Normalization & De-Bloat Sanitizer
// ============================================================================

function transformIncomingValue(val) {
  if (typeof val === "string") {
    if (val.startsWith("http://127.0.0.1:9180/")) {
      return "/__agent_asset__/" + val.slice("http://127.0.0.1:9180/".length);
    }
    if (val.startsWith("http://localhost:9180/")) {
      return "/__agent_asset__/" + val.slice("http://localhost:9180/".length);
    }
    return val;
  }
  if (!val || typeof val !== "object") return val;
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      val[i] = transformIncomingValue(val[i]);
    }
    return val;
  }
  if ("@type" in val) {
    delete val["@type"];
  }
  for (const k of Object.keys(val)) {
    val[k] = transformIncomingValue(val[k]);
  }
  return val;
}

function sanitizeIncomingMessage(msg) {
  if (!msg || typeof msg !== "object") return msg;
  if (msg.payload && typeof msg.payload === "object") {
    transformIncomingValue(msg.payload);

    // Ensure default empty arrays exist for protobuf routes in fq
    const route = ProtoBridge.lookupRoute(msg.path, "receive");
    if (route && route.proto && typeof route.proto.create === "function") {
      const defaults = route.proto.create();
      if (defaults && typeof defaults === "object") {
        for (const [k, v] of Object.entries(defaults)) {
          if (!(k in msg.payload) && Array.isArray(v)) {
            msg.payload[k] = [];
          }
        }
      }
    }

    // De-bloat /configuration responses
    if (msg.path === "/configuration") {
      firewallStats.sanitizedConfigCount++;
      msg.payload.glEnabled = false;
      msg.payload.glVisible = false;
      msg.payload.glTabVisible = false;
      msg.payload.deviceRecommendation = false;
      msg.payload.gameAppsUpdaterCdnUrl = "";
      msg.payload.onboardingShown = true;
      msg.payload.marketingEmailsOptinShown = true;
      msg.payload.profileSetupPopupShown = true;
    }

    // Force crash reporting disabled
    if (msg.path === "/crash_reporting/status") {
      msg.payload.enabled = false;
    }
  }
  return msg;
}

// ============================================================================
// Frontend Store (frontend-store.json)
// ============================================================================

function readFrontendStore() {
  for (const candidate of [FRONTEND_STORE_PATH, LOCAL_STORE_FALLBACK]) {
    try {
      if (fs.existsSync(candidate)) {
        const data = JSON.parse(fs.readFileSync(candidate, "utf8"));
        return data && typeof data === "object" ? data : {};
      }
    } catch {
      // continue
    }
  }
  return {
    activeDisplaySizeKey: {
      activeDisplayId: 1,
      scaleFactor: 1,
      width: 1920,
      height: 1080,
    },
    activeLanguage: "en-US",
  };
}

function writeFrontendStore(key, value) {
  const store = readFrontendStore();
  if (typeof key === "string" && key.length > 0) {
    store[key] = value;
  } else if (key && typeof key === "object") {
    Object.assign(store, key);
  }
  for (const target of [FRONTEND_STORE_PATH, LOCAL_STORE_FALLBACK]) {
    try {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, JSON.stringify(store, null, "\t"), "utf8");
      return store;
    } catch {
      // try next path
    }
  }
  return store;
}

// ============================================================================
// Process Management (lghub_agent.exe & Bloat Cleanup)
// ============================================================================

function isProcessRunning(exeName) {
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/FI", `IMAGENAME eq ${exeName}`],
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(false);
        resolve(stdout.toLowerCase().includes(exeName.toLowerCase()));
      }
    );
  });
}

async function ensureAgentRunning() {
  const running = await isProcessRunning("lghub_agent.exe");
  if (running) return { started: false, running: true };
  if (!fs.existsSync(LGHUB_AGENT_EXE)) {
    return { started: false, running: false, error: `Missing ${LGHUB_AGENT_EXE}` };
  }
  try {
    const child = spawn(LGHUB_AGENT_EXE, [], {
      cwd: LGHUB_INSTALL_DIR,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
    // Wait up to 3.5s for ws://127.0.0.1:9010 to come online
    for (let i = 0; i < 7; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isProcessRunning("lghub_agent.exe")) {
        return { started: true, running: true };
      }
    }
    return { started: true, running: false };
  } catch (err) {
    return { started: false, running: false, error: err.message };
  }
}

function killProcessByName(exeName) {
  return new Promise((resolve) => {
    execFile(
      "taskkill",
      ["/F", "/IM", exeName],
      { windowsHide: true, timeout: 4000 },
      (err) => resolve(!err)
    );
  });
}

async function killBloatProcesses() {
  const targets = ["lghub.exe", "lghub_system_tray.exe", "lghub_sso_handler.exe", "lghub_software_manager.exe"];
  const killed = [];
  for (const t of targets) {
    if (await isProcessRunning(t)) {
      await killProcessByName(t);
      killed.push(t);
    }
  }
  return killed;
}

function checkEssentialFiles() {
  // Always return [] so the UI never blocks on lghub_updater or missing cloud caches
  return [];
}

// ============================================================================
// One-Shot RPC Helper (for /api/rpc and /api/status)
// ============================================================================

function sendOneShotRpc(pathStr, verb = "GET", payload = undefined, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(AGENT_WS_URL, "json");
    const msgId = String(Math.floor(Math.random() * 900000) + 100000);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch {}
        reject(new Error(`RPC timeout for ${verb} ${pathStr}`));
      }
    }, timeoutMs);

    ws.addEventListener("open", () => {
      const packet = { msgId, verb, path: pathStr };
      if (payload !== undefined) packet.payload = payload;
      ws.send(JSON.stringify(packet));
    });

    ws.addEventListener("message", (ev) => {
      try {
        const data = JSON.parse(String(ev.data));
        if (data.msgId === msgId) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve(sanitizeIncomingMessage(data));
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.addEventListener("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err?.error || new Error("WebSocket connection failed"));
      }
    });
  });
}

// ============================================================================
// Pure Node.js RFC 6455 WebSocket Server (/__ghub_ws__)
// ============================================================================

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeWsFrame(textOrBuf, opcode = 0x01) {
  const payload = Buffer.isBuffer(textOrBuf) ? textOrBuf : Buffer.from(String(textOrBuf), "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

class BrowserWsClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.upstream = null;
    this.upstreamReady = false;
    this.pendingQueue = [];

    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("close", () => this.cleanup());
    socket.on("error", () => this.cleanup());
  }

  sendJson(obj) {
    if (this.closed || this.socket.destroyed) return;
    try {
      const frame = encodeWsFrame(JSON.stringify(obj), 0x01);
      this.socket.write(frame);
    } catch {
      // ignore write errors
    }
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      if (this.buffer.length < offset + maskLen + payloadLen) return;

      let maskKey = null;
      if (isMasked) {
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLen));
      this.buffer = this.buffer.subarray(offset + payloadLen);

      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i & 3];
        }
      }

      if (opcode === 0x08) {
        // Close frame
        this.cleanup();
        return;
      } else if (opcode === 0x09) {
        // Ping -> Pong
        if (!this.socket.destroyed) {
          this.socket.write(encodeWsFrame(payload, 0x0a));
        }
      } else if (opcode === 0x01 || opcode === 0x02) {
        this.handleBrowserMessage(payload.toString("utf8"));
      }
    }
  }

  async connectUpstream() {
    if (this.upstream) {
      if (this.upstreamReady) {
        this.sendJson({ type: "SOCKET_OPEN", data: { message: "ready" } });
      }
      return;
    }

    await ensureAgentRunning();

    try {
      const ws = new WebSocket(AGENT_WS_URL, "json");
      this.upstream = ws;

      ws.addEventListener("open", () => {
        // Wait for OPTIONS / readiness packet or trigger ready within 300ms
      });

      ws.addEventListener("message", (ev) => {
        try {
          const rawStr = String(ev.data);
          const parsed = JSON.parse(rawStr);

          if (parsed.verb === "OPTIONS" && parsed.path === "/") {
            this.upstreamReady = true;
            this.sendJson({ type: "SOCKET_OPEN", data: { message: "ready" } });
            this.flushPending();
          }

          const sanitized = sanitizeIncomingMessage(parsed);
          this.sendJson({ type: "SOCKET_ON_MESSAGE", data: sanitized });
        } catch (err) {
          console.error("[WS Bridge] Parse error from lghub_agent:", err.message);
        }
      });

      ws.addEventListener("close", () => {
        this.upstream = null;
        this.upstreamReady = false;
        if (!this.closed) {
          this.sendJson({ type: "SOCKET_CLOSE", data: null });
        }
      });

      ws.addEventListener("error", (err) => {
        this.sendJson({ type: "SOCKET_ERROR", data: err?.message || "Agent socket error" });
      });
    } catch (err) {
      this.sendJson({ type: "SOCKET_ERROR", data: err.message });
    }
  }

  flushPending() {
    while (this.pendingQueue.length > 0 && this.upstream && this.upstream.readyState === WebSocket.OPEN) {
      const raw = this.pendingQueue.shift();
      this.upstream.send(raw);
    }
  }

  handleBrowserMessage(rawText) {
    try {
      const envelope = JSON.parse(rawText);
      if (envelope.cmd === "CREATE_CONNECTION" || envelope.cmd === "CONNECT_AGENT") {
        this.connectUpstream();
        return;
      }
      if (envelope.cmd === "GL_CREATE_CONNECTION" || envelope.cmd === "GL_CONNECT_AGENT") {
        // GL (Game Launcher) is de-bloated/disabled; keep quiet
        return;
      }
      if (envelope.cmd === "SOCKET_SEND" && typeof envelope.payload === "string") {
        let parsedMsg = null;
        try {
          parsedMsg = JSON.parse(envelope.payload);
        } catch {}

        if (parsedMsg && shouldBlockOutgoingRpc(parsedMsg)) {
          recordBlocked("rpc", `${parsedMsg.verb} ${parsedMsg.path}`);
          const synthetic = buildSyntheticBlockedResponse(parsedMsg);
          this.sendJson({ type: "SOCKET_ON_MESSAGE", data: synthetic });
          return;
        }

        if (this.upstream && this.upstream.readyState === WebSocket.OPEN && this.upstreamReady) {
          this.upstream.send(envelope.payload);
        } else {
          this.pendingQueue.push(envelope.payload);
          this.connectUpstream();
        }
      }
    } catch (err) {
      console.error("[WS Bridge] Browser message error:", err.message);
    }
  }

  cleanup() {
    this.closed = true;
    if (this.upstream) {
      try { this.upstream.close(); } catch {}
      this.upstream = null;
    }
    if (!this.socket.destroyed) {
      try { this.socket.destroy(); } catch {}
    }
  }
}

const activeClients = new Set();

// ============================================================================
// HTTP Server & Static / Proxy Routes
// ============================================================================

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJsonResponse(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function proxyToAgentAssetServer(req, res, targetPath) {
  const options = {
    hostname: "127.0.0.1",
    port: AGENT_ASSET_PORT,
    path: targetPath,
    method: req.method,
    headers: { Accept: req.headers.accept || "*/*" },
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, {
      "Content-Type": proxyRes.headers["content-type"] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    });
    proxyRes.pipe(res);
  });
  proxyReq.on("error", () => {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Agent asset not found");
  });
  proxyReq.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    // 1. Proxy /__agent_asset__/* and /core_assets/* to lghub_agent.exe HTTP server (127.0.0.1:9180)
    if (pathname.startsWith("/__agent_asset__/")) {
      const subPath = "/" + pathname.slice("/__agent_asset__/".length) + parsedUrl.search;
      return proxyToAgentAssetServer(req, res, subPath);
    }
    if (pathname.startsWith("/core_assets/")) {
      return proxyToAgentAssetServer(req, res, pathname + parsedUrl.search);
    }

    // 2. Local file proxy (/__local_file__?path=...) for local device/application images
    if (pathname === "/__local_file__") {
      const rawFilePath = parsedUrl.searchParams.get("path") || "";
      const cleaned = rawFilePath.replace(/^file:\/\/\/?/i, "").replace(/\//g, path.sep);
      const resolved = path.resolve(cleaned);
      const ext = path.extname(resolved).toLowerCase();
      const allowedExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".ico", ".bmp", ".json", ".yaml"]);
      if (allowedExts.has(ext) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
          "Cache-Control": "public, max-age=3600",
        });
        return fs.createReadStream(resolved).pipe(res);
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("File not found");
    }

    // 3. API: Frontend Store (/api/store)
    if (pathname === "/api/store") {
      if (req.method === "GET") {
        return sendJsonResponse(res, 200, readFrontendStore());
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const updated = writeFrontendStore(body.key, body.value);
        return sendJsonResponse(res, 200, updated);
      }
    }

    // 4. API: Electron IPC Invoke Bridge (/api/ipc)
    if (pathname === "/api/ipc" && req.method === "POST") {
      const { channel, args = [] } = await readJsonBody(req);
      switch (channel) {
        case "GET_STORAGE":
          return sendJsonResponse(res, 200, { result: readFrontendStore() });
        case "SET_STORE":
          writeFrontendStore(args[0], args[1]);
          return sendJsonResponse(res, 200, { result: true });
        case "GET_OS_INFO":
          return sendJsonResponse(res, 200, {
            result: { osRelease: os.release(), osPlatform: os.platform() },
          });
        case "CHECK_ESSENTIAL_FILES":
          return sendJsonResponse(res, 200, { result: checkEssentialFiles() });
        case "GET_BLOCKED_DLLS":
          return sendJsonResponse(res, 200, { result: null });
        case "READ_DEVICE_SALT":
          return sendJsonResponse(res, 200, { result: true });
        case "GET_HMAC": {
          const list = Array.isArray(args[0]) ? args[0] : [];
          const map = {};
          for (const item of list) {
            map[item] = crypto
              .createHmac("sha256", "file://")
              .update(String(item) + deviceSalt)
              .digest("hex")
              .toLowerCase();
          }
          return sendJsonResponse(res, 200, { result: map });
        }
        case "ON_APP_LOADED":
          return sendJsonResponse(res, 200, {
            result: Math.max(1, Math.ceil((Date.now() - bootTimestamp) / 1000)),
          });
        case "IS_DEV_TOOLS_OPENED":
          return sendJsonResponse(res, 200, { result: false });
        case "DEVICE_RECOMMENDATION":
          recordBlocked("http", "DEVICE_RECOMMENDATION", String(args[0] || ""));
          return sendJsonResponse(res, 200, { result: { recommendation: false } });
        case "ACCOUNT_LOGIN":
        case "ACCOUNT_LOGOUT":
          recordBlocked("http", channel, String(args[0] || ""));
          return sendJsonResponse(res, 200, { result: null });
        case "GET_APPLICATION_IMAGE_PATH": {
          const urlStr = String(args[0] || "");
          const base = path.basename(urlStr);
          const candidate = path.join(LGHUB_CACHED_IMAGES, base);
          if (base && fs.existsSync(candidate)) {
            return sendJsonResponse(res, 200, { result: candidate });
          }
          recordBlocked("http", "GET_APPLICATION_IMAGE_PATH", urlStr);
          return sendJsonResponse(res, 200, { result: "" });
        }
        default:
          return sendJsonResponse(res, 200, { result: null });
      }
    }

    // 5. API: Direct Hardware Status & Firewall Summary (/api/status)
    if (pathname === "/api/status" && req.method === "GET") {
      const agentRunning = await isProcessRunning("lghub_agent.exe");
      const electronRunning = await isProcessRunning("lghub.exe");
      const trayRunning = await isProcessRunning("lghub_system_tray.exe");
      const updaterRunning = await isProcessRunning("lghub_updater.exe");

      let devices = [];
      let knownDevices = [];
      let battery = null;
      let mouseInfo = null;
      if (agentRunning) {
        try {
          const devListRes = await sendOneShotRpc("/devices/list", "GET");
          devices = devListRes?.payload?.deviceInfos || [];
          const knownRes = await sendOneShotRpc("/devices/list/known", "GET");
          knownDevices = knownRes?.payload?.knownList || [];
          const activeDev = devices[0];
          if (activeDev?.id) {
            try {
              const batRes = await sendOneShotRpc(`/battery/${activeDev.id}/state`, "GET", undefined, 1500);
              battery = batRes?.payload || null;
            } catch {}
            if (activeDev.deviceType === "MOUSE") {
              try {
                const mRes = await sendOneShotRpc(`/mouse/${activeDev.id}/info`, "GET", undefined, 1500);
                mouseInfo = mRes?.payload || null;
              } catch {}
            }
          }
        } catch {}
      }

      return sendJsonResponse(res, 200, {
        ok: true,
        server: {
          host: HOST,
          port: PORT,
          uptimeSec: Math.floor(process.uptime()),
          connectedBrowserTabs: activeClients.size,
          protobufRoutesLoaded: Object.keys(ProtoBridge.routeTable).length,
        },
        processes: {
          lghub_agent: agentRunning,
          lghub_electron_bloat: electronRunning,
          lghub_system_tray_bloat: trayRunning,
          lghub_updater: updaterRunning,
        },
        hardware: {
          devices,
          knownDevices,
          battery,
          mouseInfo,
        },
        firewall: firewallStats,
      });
    }

    // 6. API: Direct RPC Console (/api/rpc)
    if (pathname === "/api/rpc" && req.method === "POST") {
      const { path: rpcPath, verb = "GET", payload } = await readJsonBody(req);
      if (!rpcPath) return sendJsonResponse(res, 400, { error: "Missing path" });
      await ensureAgentRunning();
      const response = await sendOneShotRpc(rpcPath, verb, payload, 5000);
      return sendJsonResponse(res, 200, response);
    }

    // 7. API: Record Browser-Blocked Bloat Call (/api/firewall/record)
    if (pathname === "/api/firewall/record" && req.method === "POST") {
      const { kind = "http", target = "", detail = "" } = await readJsonBody(req);
      recordBlocked(kind, target, detail);
      return sendJsonResponse(res, 200, { ok: true, firewall: firewallStats });
    }

    // 8. API: Restart Agent (/api/agent/restart)
    if (pathname === "/api/agent/restart" && req.method === "POST") {
      await killProcessByName("lghub_agent.exe");
      await new Promise((r) => setTimeout(r, 600));
      const status = await ensureAgentRunning();
      return sendJsonResponse(res, 200, { ok: true, status });
    }

    // 9. API: Kill Bloat Processes (/api/bloat/kill)
    if (pathname === "/api/bloat/kill" && req.method === "POST") {
      const killed = await killBloatProcesses();
      return sendJsonResponse(res, 200, { ok: true, killed });
    }

    // 10. Static Files from public/
    const relPath = pathname === "/" ? "/index.html" : pathname;
    const safePath = path.normalize(path.join(PUBLIC_DIR, relPath));
    if (!safePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      return res.end("Forbidden");
    }

    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": ext === ".html" || safePath.endsWith("preload-web-shim.js") || safePath.endsWith("debloat.css")
          ? "no-store"
          : "public, max-age=3600",
      });
      return fs.createReadStream(safePath).pipe(res);
    }

    // SPA Fallback to index.html for React Router routes
    const indexHtml = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return fs.createReadStream(indexHtml).pipe(res);
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  } catch (err) {
    sendJsonResponse(res, 500, { error: err.message });
  }
});

// Handle WebSocket Upgrade on /__ghub_ws__
server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash("sha1").update(key + WS_MAGIC).digest("base64");
  const headers = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ];
  socket.write(headers.join("\r\n"));

  const client = new BrowserWsClient(socket);
  activeClients.add(client);
  socket.on("close", () => activeClients.delete(client));
});

// Start Server & Ensure Hardware Agent Daemon is Running
server.listen(PORT, HOST, async () => {
  console.log("==================================================================");
  console.log(" Logitech G HUB Local Web Driver (Zero-Internet / Zero-Bloat)");
  console.log("==================================================================");
  console.log(` -> Local Web UI:        http://${HOST}:${PORT}`);
  console.log(` -> Protobuf Schemas:    ${Object.keys(ProtoBridge.routeTable).length} native routes loaded`);
  const killed = await killBloatProcesses();
  if (killed.length > 0) {
    console.log(` -> Terminated Bloat:    ${killed.join(", ")}`);
  }
  const agentStatus = await ensureAgentRunning();
  console.log(` -> Hardware Agent:      ${agentStatus.running ? "ONLINE (ws://127.0.0.1:9010)" : "STARTING..."}`);
  console.log("==================================================================");
});
