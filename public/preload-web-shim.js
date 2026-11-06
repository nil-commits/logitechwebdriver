/**
 * Logitech G HUB — Browser Preload Polyfill & Zero-Internet Firewall Shim
 *
 * Replaces Electron's preload.bundle.js (contextBridge) so the original G HUB
 * renderer (app.min.js) runs natively in any standard web browser with:
 *   - 100% local hardware communication via lghub_agent.exe (ws://127.0.0.1:9010)
 *   - 0 internet calls (Sentry, Logitech Cloud, Marketplace, and Updater blocked)
 *   - Built-in Floating Hardware Status Pill & Quick RPC Control Drawer (Alt+G)
 */

(function () {
  "use strict";

  const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", location.hostname]);
  let blockedBrowserRequests = 0;

  // ==========================================================================
  // 1. URL Rewriter & Zero-Internet Fetch/XHR Firewall
  // ==========================================================================

  function rewriteAssetUrl(rawUrl) {
    if (typeof rawUrl !== "string") return rawUrl;
    if (rawUrl.startsWith("http://127.0.0.1:9180/")) {
      return "/__agent_asset__/" + rawUrl.slice("http://127.0.0.1:9180/".length);
    }
    if (rawUrl.startsWith("http://localhost:9180/")) {
      return "/__agent_asset__/" + rawUrl.slice("http://localhost:9180/".length);
    }
    if (rawUrl.startsWith("file:///")) {
      const filePart = decodeURIComponent(rawUrl.slice("file:///".length));
      return "/__local_file__?path=" + encodeURIComponent(filePart);
    }
    return rawUrl;
  }

  function isExternalInternetUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) return false;
    if (
      rawUrl.startsWith("/") ||
      rawUrl.startsWith("./") ||
      rawUrl.startsWith("../") ||
      rawUrl.startsWith("data:") ||
      rawUrl.startsWith("blob:") ||
      rawUrl.startsWith("file:")
    ) {
      return false;
    }
    try {
      const parsed = new URL(rawUrl, location.origin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "ws:" || parsed.protocol === "wss:") {
        return !LOCAL_HOSTS.has(parsed.hostname);
      }
      return false;
    } catch {
      return false;
    }
  }

  const nativeFetch = window.fetch.bind(window);

  function notifyFirewallBlocked(kind, target, detail) {
    blockedBrowserRequests++;
    updateHudBadge();
    nativeFetch("/api/firewall/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, target, detail }),
    }).catch(() => {});
  }

  window.fetch = function (input, init) {
    const rawUrl = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    const rewritten = rewriteAssetUrl(rawUrl);
    if (isExternalInternetUrl(rewritten)) {
      notifyFirewallBlocked("browser-fetch", rewritten);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, blockedByLocalDriver: true, recommendation: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    if (rewritten !== rawUrl && typeof input === "string") {
      return nativeFetch(rewritten, init);
    }
    return nativeFetch(input, init);
  };

  // Patch XMLHttpRequest to block external telemetry (e.g. Sentry envelope/store)
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const rewritten = rewriteAssetUrl(String(url));
    this.__blockedExternalUrl = isExternalInternetUrl(rewritten) ? rewritten : null;
    if (this.__blockedExternalUrl) {
      notifyFirewallBlocked("browser-xhr", this.__blockedExternalUrl);
      return origXhrOpen.call(this, method, "data:application/json,%7B%7D", ...rest);
    }
    return origXhrOpen.call(this, method, rewritten, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__blockedExternalUrl) {
      return origXhrSend.call(this, null);
    }
    return origXhrSend.call(this, body);
  };

  if (navigator.sendBeacon) {
    navigator.sendBeacon = function (url) {
      notifyFirewallBlocked("sendBeacon", String(url));
      return true;
    };
  }

  // Patch Image.src & Element.setAttribute for file:/// and 127.0.0.1:9180 URLs
  const imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (imgSrcDesc && imgSrcDesc.set) {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      get: imgSrcDesc.get,
      set(val) {
        imgSrcDesc.set.call(this, rewriteAssetUrl(val));
      },
      configurable: true,
      enumerable: true,
    });
  }

  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if ((name === "src" || name === "href") && typeof value === "string") {
      return origSetAttribute.call(this, name, rewriteAssetUrl(value));
    }
    return origSetAttribute.call(this, name, value);
  };

  // ==========================================================================
  // 2. IPC Helper & WebSocket Bridge to Server (/__ghub_ws__)
  // ==========================================================================

  async function invokeIpc(channel, ...args) {
    try {
      const res = await nativeFetch("/api/ipc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, args }),
      });
      const data = await res.json();
      return data.result;
    } catch {
      return null;
    }
  }

  const ghubListeners = {
    open: [],
    close: [],
    error: [],
    message: [],
  };

  const glListeners = {
    open: [],
    close: [],
    error: [],
    message: [],
  };

  let wsClient = null;
  let socketState = "opening";
  let agentConnected = false;
  const outboundWsQueue = [];

  function ensureBrowserWs() {
    if (wsClient && (wsClient.readyState === WebSocket.OPEN || wsClient.readyState === WebSocket.CONNECTING)) {
      return wsClient;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}/__ghub_ws__`;
    wsClient = new WebSocket(wsUrl);

    wsClient.addEventListener("open", () => {
      while (outboundWsQueue.length > 0 && wsClient.readyState === WebSocket.OPEN) {
        wsClient.send(outboundWsQueue.shift());
      }
    });

    wsClient.addEventListener("message", (ev) => {
      try {
        const packet = JSON.parse(String(ev.data));
        if (packet.type === "SOCKET_OPEN") {
          socketState = "open";
          agentConnected = true;
          updateHudBadge();
          for (const cb of ghubListeners.open) {
            try { cb(packet.data || { message: "ready" }); } catch (e) { console.error(e); }
          }
        } else if (packet.type === "SOCKET_ON_MESSAGE") {
          for (const cb of ghubListeners.message) {
            try { cb(packet.data); } catch (e) { console.error(e); }
          }
        } else if (packet.type === "SOCKET_CLOSE") {
          socketState = "closed";
          agentConnected = false;
          updateHudBadge();
          for (const cb of ghubListeners.close) {
            try { cb(packet.data); } catch (e) { console.error(e); }
          }
        } else if (packet.type === "SOCKET_ERROR") {
          for (const cb of ghubListeners.error) {
            try { cb(packet.data); } catch (e) { console.error(e); }
          }
        }
      } catch (err) {
        console.error("[G HUB Web Shim] WS parse error:", err);
      }
    });

    wsClient.addEventListener("close", () => {
      socketState = "closed";
      agentConnected = false;
      updateHudBadge();
      setTimeout(ensureBrowserWs, 1500);
    });

    return wsClient;
  }

  function sendWsCommand(cmdObj) {
    const raw = JSON.stringify(cmdObj);
    const ws = ensureBrowserWs();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    } else {
      outboundWsQueue.push(raw);
    }
  }

  // Open browser WS immediately
  ensureBrowserWs();

  // ==========================================================================
  // 3. Expose Electron ContextBridge Globals on window
  // ==========================================================================

  // 3.1 window.env
  window.env = {
    isDebug: false,
    platform: "win32",
  };

  // 3.2 window.electronStore
  let cachedStore = {
    activeDisplaySizeKey: {
      activeDisplayId: 4039739678,
      scaleFactor: window.devicePixelRatio || 1,
      width: window.screen.width || 2560,
      height: window.screen.height || 1440,
    },
    activeLanguage: "de-DE",
  };

  const storePromise = nativeFetch("/api/store")
    .then((r) => r.json())
    .then((data) => {
      if (data && typeof data === "object") {
        cachedStore = Object.assign({}, cachedStore, data);
      }
      return cachedStore;
    })
    .catch(() => cachedStore);

  window.electronStore = {
    getStorage: () => storePromise.then(() => ({ ...cachedStore })),
    setStore: (key, val) => {
      if (typeof key === "string") {
        cachedStore[key] = val;
      }
      nativeFetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: val }),
      }).catch(() => {});
    },
    openInEditor: () => {},
  };

  // 3.3 window.electronNet (Primary G HUB Agent Bridge)
  window.electronNet = {
    createConnection: () => {
      sendWsCommand({ cmd: "CREATE_CONNECTION" });
    },
    connect: () => {
      sendWsCommand({ cmd: "CONNECT_AGENT" });
    },
    disconnect: () => {},
    getSocketState: () => Promise.resolve(socketState),
    onOpen: (cb) => {
      if (typeof cb === "function") {
        ghubListeners.open.push(cb);
        if (socketState === "open") {
          queueMicrotask(() => cb({ message: "ready" }));
        }
      }
    },
    onClose: (cb) => {
      if (typeof cb === "function") ghubListeners.close.push(cb);
    },
    onError: (cb) => {
      if (typeof cb === "function") ghubListeners.error.push(cb);
    },
    onMessage: (cb) => {
      if (typeof cb === "function") ghubListeners.message.push(cb);
    },
    removeAllListeners: () => {
      ghubListeners.open.length = 0;
      ghubListeners.close.length = 0;
      ghubListeners.error.length = 0;
      ghubListeners.message.length = 0;
    },
    send: (jsonStr) => {
      sendWsCommand({ cmd: "SOCKET_SEND", payload: jsonStr });
    },
  };

  // 3.4 window.electronGLNet (Game Launcher Stub — De-bloated)
  window.electronGLNet = {
    createConnection: () => {},
    connect: () => {},
    disconnect: () => {},
    getSocketState: () => Promise.resolve("closed"),
    onOpen: (cb) => {
      if (typeof cb === "function") glListeners.open.push(cb);
    },
    onClose: (cb) => {
      if (typeof cb === "function") glListeners.close.push(cb);
    },
    onError: (cb) => {
      if (typeof cb === "function") glListeners.error.push(cb);
    },
    onMessage: (cb) => {
      if (typeof cb === "function") glListeners.message.push(cb);
    },
    removeAllListeners: () => {
      glListeners.open.length = 0;
      glListeners.close.length = 0;
      glListeners.error.length = 0;
      glListeners.message.length = 0;
    },
    send: () => {},
  };

  // 3.5 window.lps (Marketplace Stub — De-bloated)
  window.lps = {
    onInstalledAssets: () => {},
    onMarketplaceWindowEvent: () => {},
    openMarketplace: (url) => {
      notifyFirewallBlocked("marketplace", String(url || "OPEN_MARKETPLACE"));
    },
    sendInstalledAssets: () => {},
    sendUninstalledAsset: () => {},
    startInstallation: () => {},
    startUninstallationAsset: () => {},
  };

  // 3.6 window.utils
  window.utils = {
    getInitialDeepLinkUri: () => Promise.resolve(undefined),
    onDeepLinkReceived: () => {},
    openExternal: (url) => {
      notifyFirewallBlocked("openExternal", String(url || ""));
    },
    openFolder: (folderPath) => invokeIpc("OPEN_FOLDER", folderPath),
    setBackendConnectionStatus: () => {},
  };

  // 3.7 window.electron
  const focusListeners = [];
  const blurListeners = [];
  window.addEventListener("focus", () => focusListeners.forEach((cb) => cb()));
  window.addEventListener("blur", () => blurListeners.forEach((cb) => cb()));

  window.electron = {
    activateWindow: () => window.focus(),
    checkEssentialFiles: () => Promise.resolve([]),
    closeDevTools: () => {},
    closeWindow: () => {},
    confirmAppClose: () => {},
    deviceRecommendation: (url) => {
      notifyFirewallBlocked("deviceRecommendation", String(url || ""));
      return Promise.resolve({ recommendation: false });
    },
    focus: () => window.focus(),
    forceRelaunch: () => {
      location.reload();
      return Promise.resolve();
    },
    getApplicationImagePath: (url) => invokeIpc("GET_APPLICATION_IMAGE_PATH", url),
    getBlockedDlls: () => Promise.resolve(null),
    getHmac: (paths) => invokeIpc("GET_HMAC", paths),
    getInformationAboutOS: () => invokeIpc("GET_OS_INFO"),
    getSnapshotFolderPath: () => Promise.resolve({ error: null, path: "C:\\Users\\Public\\Pictures" }),
    isDevToolsOpened: () => Promise.resolve(false),
    logToFile: () => {},
    maximizeWindow: () => {},
    minimizeWindow: () => {},
    noDiskSpaceError: () => () => {},
    onAppClosing: () => {},
    onAppLoaded: () => invokeIpc("ON_APP_LOADED"),
    onBack: (cb) => {
      window.addEventListener("popstate", () => cb && cb());
    },
    onBlur: (cb) => {
      if (typeof cb === "function") blurListeners.push(cb);
    },
    onCloseDevTools: () => {},
    onCloseWindow: () => () => {},
    onFocus: (cb) => {
      if (typeof cb === "function") focusListeners.push(cb);
    },
    onJumpListLaunch: () => () => {},
    onLoginAccount: (url) => {
      notifyFirewallBlocked("onLoginAccount", String(url || ""));
      return Promise.resolve();
    },
    onLogoutAccount: (url) => {
      notifyFirewallBlocked("onLogoutAccount", String(url || ""));
      return Promise.resolve();
    },
    onMaximizeWindow: () => () => {},
    onMinimizeWindow: () => () => {},
    onOpenDevTools: () => {},
    onSetActiveDisplay: () => {},
    onSuspend: () => {},
    openDevTools: () => {},
    openDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    openSnapshotFolder: () => Promise.resolve({ error: null, path: "" }),
    readDeviceSalt: () => Promise.resolve(true),
    readFile: () => Promise.resolve(null),
    relaunch: () => location.reload(),
    repairInstallation: () => Promise.resolve(),
    saveDialog: (opts) => {
      if (opts && opts.content) {
        const blob = new Blob([opts.content], { type: "application/octet-stream" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = opts.defaultPath || "ghub-export.json";
        a.click();
      }
    },
    saveSnapshot: () => Promise.resolve({ error: null, path: "" }),
    screenCapture: () => Promise.resolve([]),
    screenRotate: () => () => {},
    setActiveAudioDevice: () => {},
    setDockMenu: () => {},
    setTrayTooltip: () => {},
    setWindowTitle: (title) => {
      if (title) document.title = `${title} — Local Web Driver`;
    },
    updateJumpList: () => {},
  };

  // ==========================================================================
  // 4. Floating Local Web Driver HUD Pill & Quick Control Drawer
  // ==========================================================================

  let pillEl = null;
  let drawerEl = null;
  let lastStatusData = null;

  function updateHudBadge() {
    if (!pillEl) return;
    const dot = pillEl.querySelector(".status-dot");
    const label = pillEl.querySelector(".status-text");
    const shield = pillEl.querySelector(".badge-shield");
    if (dot) {
      dot.className = "status-dot" + (agentConnected ? "" : " offline");
    }
    if (label) {
      const devName = lastStatusData?.hardware?.devices?.[0]?.displayName || "Local Web Driver";
      label.textContent = agentConnected ? `${devName} · Local` : "Agent Connecting...";
    }
    if (shield) {
      const totalBlocked =
        (lastStatusData?.firewall?.blockedRpcCount || 0) +
        (lastStatusData?.firewall?.blockedHttpCount || 0) +
        blockedBrowserRequests;
      shield.textContent = `🛡️ ${totalBlocked} Blocked`;
    }
  }

  async function refreshDriverStatus() {
    try {
      const res = await nativeFetch("/api/status");
      lastStatusData = await res.json();
      updateHudBadge();
      renderDrawerStats();
    } catch {
      // ignore
    }
  }

  function renderDrawerStats() {
    if (!drawerEl || !lastStatusData) return;
    const hwBox = drawerEl.querySelector("#drv-hw-summary");
    const fwBox = drawerEl.querySelector("#drv-fw-summary");
    if (hwBox) {
      const dev = lastStatusData.hardware?.devices?.[0];
      const bat = lastStatusData.hardware?.battery;
      const mouse = lastStatusData.hardware?.mouseInfo;
      if (dev) {
        const fwVer = dev.fwInfo?.[0]?.firmwareVersion || "N/A";
        const dpiRange = mouse?.dpiInfo?.range
          ? `${mouse.dpiInfo.range.min} – ${mouse.dpiInfo.range.max} DPI`
          : "Supported";
        const maxRate = mouse?.reportRates?.wirelessRates
          ? `${Math.max(...mouse.reportRates.wirelessRates)} Hz`
          : "1000 Hz";
        hwBox.innerHTML = `
          <div class="kv-row"><span>Device</span><strong>${dev.displayName} (${dev.id})</strong></div>
          <div class="kv-row"><span>Connection</span><strong>${dev.displayConnectionType || dev.connectionType} (${dev.state})</strong></div>
          <div class="kv-row"><span>Battery</span><strong>${bat ? `${bat.percentage}% (${bat.charging ? "Charging" : "Discharging"})` : "N/A"}</strong></div>
          <div class="kv-row"><span>Firmware</span><strong>${fwVer} (PID 0x${Number(dev.pid || 0).toString(16).toUpperCase()})</strong></div>
          <div class="kv-row"><span>Sensor / Max Polling</span><strong>${dpiRange} · ${maxRate}</strong></div>
          <div class="kv-row"><span>Onboard Memory Mode</span><strong>${dev.onboardMode ? "ENABLED (Hardware)" : "Software Mode"}</strong></div>
        `;
      } else {
        hwBox.innerHTML = `<div class="kv-row"><span>Status</span><strong>No active device or agent starting</strong></div>`;
      }
    }

    if (fwBox) {
      const f = lastStatusData.firewall || {};
      const p = lastStatusData.processes || {};
      fwBox.innerHTML = `
        <div class="kv-row"><span>Hardware Daemon (lghub_agent.exe)</span><strong style="color:${p.lghub_agent ? "#00e676" : "#ff5252"}">${p.lghub_agent ? "ONLINE (Local)" : "OFFLINE"}</strong></div>
        <div class="kv-row"><span>Electron Bloat (lghub.exe)</span><strong style="color:${p.lghub_electron_bloat ? "#ffab00" : "#00e676"}">${p.lghub_electron_bloat ? "RUNNING" : "TERMINATED (0 MB RAM)"}</strong></div>
        <div class="kv-row"><span>Blocked Telemetry / Cloud RPCs</span><strong>${f.blockedRpcCount || 0}</strong></div>
        <div class="kv-row"><span>Blocked External HTTP / Sentry</span><strong>${(f.blockedHttpCount || 0) + blockedBrowserRequests}</strong></div>
        <div class="kv-row"><span>Sanitized Config Payloads</span><strong>${f.sanitizedConfigCount || 0}</strong></div>
      `;
    }
  }

  function mountDriverHud() {
    if (document.getElementById("lghub-local-driver-pill")) return;

    pillEl = document.createElement("div");
    pillEl.id = "lghub-local-driver-pill";
    pillEl.title = "Open Local Web Driver Controls & Live Agent RPC Inspector (Alt+G)";
    pillEl.innerHTML = `
      <span class="status-dot"></span>
      <span class="status-text">Local Web Driver</span>
      <span class="badge-shield">🛡️ 0 Blocked</span>
    `;

    drawerEl = document.createElement("div");
    drawerEl.id = "lghub-local-driver-drawer";
    drawerEl.innerHTML = `
      <div class="drawer-header">
        <div class="drawer-title">⚡ G HUB Local Web Driver (Zero-Bloat)</div>
        <button class="drawer-close" id="drv-close-btn">Close (Alt+G)</button>
      </div>
      <div class="drawer-body">
        <div class="card">
          <div class="card-title">Connected Logitech Gear (Live from lghub_agent.exe)</div>
          <div id="drv-hw-summary">Loading hardware state...</div>
          <div class="btn-row">
            <button class="drv-btn primary" id="drv-toggle-onboard">Toggle Onboard Memory Mode</button>
            <button class="drv-btn" id="drv-refresh-btn">Refresh Telemetry</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Zero-Internet & De-Bloat Firewall</div>
          <div id="drv-fw-summary">Loading firewall telemetry...</div>
          <div class="btn-row">
            <button class="drv-btn" id="drv-kill-bloat">Kill Electron/Tray Bloat</button>
            <button class="drv-btn" id="drv-restart-agent">Restart Hardware Agent</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Live Agent RPC Console (ws://127.0.0.1:9010)</div>
          <div class="rpc-inputs">
            <select id="drv-rpc-verb">
              <option value="GET">GET</option>
              <option value="SET">SET</option>
              <option value="SUBSCRIBE">SUBSCRIBE</option>
            </select>
            <input id="drv-rpc-path" type="text" value="/devices/list" style="flex:1" placeholder="/devices/list" />
            <button class="drv-btn primary" id="drv-rpc-send">Send</button>
          </div>
          <div class="btn-row" style="margin-top:0;margin-bottom:6px">
            <button class="drv-btn" data-preset="/devices/list">Devices</button>
            <button class="drv-btn" data-preset="/battery/dev00000000/state">Battery</button>
            <button class="drv-btn" data-preset="/mouse/dev00000000/info">Mouse Info</button>
            <button class="drv-btn" data-preset="/profiles">Profiles</button>
            <button class="drv-btn" data-preset="/configuration">Config</button>
          </div>
          <textarea id="drv-rpc-payload" rows="2" style="width:100%;box-sizing:border-box" placeholder="Optional JSON payload (for SET/GET)"></textarea>
          <pre id="drv-rpc-output">Click "Send" or a preset button to query lghub_agent.exe directly.</pre>
        </div>
      </div>
    `;

    document.body.appendChild(pillEl);
    document.body.appendChild(drawerEl);

    const toggleDrawer = () => {
      drawerEl.classList.toggle("open");
      if (drawerEl.classList.contains("open")) {
        refreshDriverStatus();
      }
    };

    pillEl.addEventListener("click", toggleDrawer);
    drawerEl.querySelector("#drv-close-btn").addEventListener("click", toggleDrawer);

    window.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        toggleDrawer();
      }
    });

    drawerEl.querySelector("#drv-refresh-btn").addEventListener("click", refreshDriverStatus);

    drawerEl.querySelector("#drv-kill-bloat").addEventListener("click", async () => {
      await nativeFetch("/api/bloat/kill", { method: "POST" });
      refreshDriverStatus();
    });

    drawerEl.querySelector("#drv-restart-agent").addEventListener("click", async () => {
      const out = drawerEl.querySelector("#drv-rpc-output");
      out.textContent = "Restarting lghub_agent.exe...";
      await nativeFetch("/api/agent/restart", { method: "POST" });
      await refreshDriverStatus();
      out.textContent = "lghub_agent.exe restarted.";
    });

    drawerEl.querySelector("#drv-toggle-onboard").addEventListener("click", async () => {
      const dev = lastStatusData?.hardware?.devices?.[0];
      if (!dev) return;
      const nextMode = !dev.onboardMode;
      const res = await nativeFetch("/api/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verb: "SET",
          path: `/onboard_profiles/${dev.id}/onboard_mode`,
          payload: { onboardMode: nextMode },
        }),
      });
      const data = await res.json();
      drawerEl.querySelector("#drv-rpc-output").textContent = JSON.stringify(data, null, 2);
      setTimeout(refreshDriverStatus, 400);
    });

    drawerEl.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        drawerEl.querySelector("#drv-rpc-verb").value = "GET";
        drawerEl.querySelector("#drv-rpc-path").value = btn.getAttribute("data-preset");
        drawerEl.querySelector("#drv-rpc-payload").value = "";
        drawerEl.querySelector("#drv-rpc-send").click();
      });
    });

    drawerEl.querySelector("#drv-rpc-send").addEventListener("click", async () => {
      const verb = drawerEl.querySelector("#drv-rpc-verb").value;
      const rpcPath = drawerEl.querySelector("#drv-rpc-path").value.trim();
      const rawPayload = drawerEl.querySelector("#drv-rpc-payload").value.trim();
      const out = drawerEl.querySelector("#drv-rpc-output");
      let payload = undefined;
      if (rawPayload) {
        try {
          payload = JSON.parse(rawPayload);
        } catch (err) {
          out.textContent = "Invalid JSON payload: " + err.message;
          return;
        }
      }
      out.textContent = `Sending ${verb} ${rpcPath}...`;
      try {
        const res = await nativeFetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verb, path: rpcPath, payload }),
        });
        const data = await res.json();
        out.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        out.textContent = "RPC Error: " + err.message;
      }
    });

    refreshDriverStatus();
    setInterval(refreshDriverStatus, 6000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountDriverHud);
  } else {
    mountDriverHud();
  }
})();
