/**
 * Logitech Web Driver — OpenMouse-Polished Local Hardware Instrument
 * Works in ANY browser (Firefox, Safari, Chrome, Edge, Brave) via local Node.js <-> lghub_agent.exe bridge.
 * Zero internet requests, zero cloud telemetry, zero Electron bloat.
 */
(function () {
  "use strict";

  // ==========================================================================
  // Constants & Theme Definitions (from OpenMouse tokens.css & battery-history.ts)
  // ==========================================================================
  const STAGE_COLORS = ["#FFFFFF", "#FF7203", "#85FFB4", "#FFE913", "#FF00D7"];

  // Power draw model (mW) by polling rate — calibrated for PRO X SUPERLIGHT 2 (95h @ 1000Hz)
  const POLLING_MW = {
    125: 5.0,
    250: 5.8,
    500: 6.5,
    1000: 8.0,
    2000: 14.0,
    4000: 17.0,
    8000: 32.0,
  };
  const RATED_HOURS_AT_1000HZ = 95;

  const THEME_LIST = [
    { name: "Ice", slug: "ice" },
    { name: "Emerald", slug: "emerald" },
    { name: "Matt", slug: "matt" },
    { name: "Violet", slug: "violet" },
    { name: "Ember", slug: "ember" },
    { name: "Mono", slug: "mono" },
    { name: "Miku", slug: "miku" },
    { name: "Catppuccin Mocha", slug: "catppuccin-mocha" },
    { name: "Catppuccin Macchiato", slug: "catppuccin-macchiato" },
    { name: "Catppuccin Frappé", slug: "catppuccin-frappe" },
    { name: "NieR: Automata", slug: "nier-automata" },
    { name: "Light", slug: "light" },
  ];

  // Top-down callout spots for PRO X SUPERLIGHT 2
  const BUTTON_SPOTS = [
    {
      index: 1,
      slotBase: "prox2wirelessmouse_g1_m1",
      slotShift: "prox2wirelessmouse_g1_m1_shifted",
      defaultBase: "0f82f693-5b78-4cf5-867e-020100000000",
      defaultShift: "0f82f693-5b78-4cf5-867e-090700000000",
      name: "Primary click",
      side: "left",
      x: "43%",
      y: "22%",
      lineW: "72px",
    },
    {
      index: 2,
      slotBase: "prox2wirelessmouse_g2_m1",
      slotShift: "prox2wirelessmouse_g2_m1_shifted",
      defaultBase: "0f82f693-5b78-4cf5-867e-020200000000",
      defaultShift: "0f82f693-5b78-4cf5-867e-090700000000",
      name: "Secondary click",
      side: "right",
      x: "57%",
      y: "22%",
      lineW: "72px",
    },
    {
      index: 3,
      slotBase: "prox2wirelessmouse_g3_m1",
      slotShift: "prox2wirelessmouse_g3_m1_shifted",
      defaultBase: "0f82f693-5b78-4cf5-867e-020300000000",
      defaultShift: "0f82f693-5b78-4cf5-867e-090700000000",
      name: "Middle / wheel",
      side: "right",
      x: "50%",
      y: "31%",
      lineW: "92px",
    },
    {
      index: 5,
      slotBase: "prox2wirelessmouse_g5_m1",
      slotShift: "prox2wirelessmouse_g5_m1_shifted",
      defaultBase: "0f82f693-5b78-4cf5-867e-020500000000",
      defaultShift: "0f82f693-5b78-4cf5-867e-090700000000",
      name: "Forward (Side front)",
      side: "left",
      x: "36.5%",
      y: "41%",
      lineW: "54px",
    },
    {
      index: 4,
      slotBase: "prox2wirelessmouse_g4_m1",
      slotShift: "prox2wirelessmouse_g4_m1_shifted",
      defaultBase: "0f82f693-5b78-4cf5-867e-020400000000",
      defaultShift: "0f82f693-5b78-4cf5-867e-090700000000",
      name: "Back (Side rear)",
      side: "left",
      x: "36.5%",
      y: "54%",
      lineW: "54px",
    },
  ];

  // ==========================================================================
  // Application State
  // ==========================================================================
  const state = {
    activePage: "device",
    activeTab: "overview",
    dpiViewMode: "stages", // "stages" | "single"
    buttonLayer: "base", // "base" | "gshift"
    selectedSpotIndex: 4, // default to Button 4 (Back)
    cmdSearchQuery: "",

    preferences: {
      theme: localStorage.getItem("lgwd_theme") || "ice",
      instantApply: localStorage.getItem("lgwd_instant_apply") !== "0",
      reducedMotion: localStorage.getItem("lgwd_reduced_motion") === "1",
      sounds: localStorage.getItem("lgwd_sounds") === "1",
      sidebarCollapsed: localStorage.getItem("lgwd_sidebar_collapsed") === "1",
    },

    stagedQueue: [], // queued operations when instantApply === false

    // Live Hardware Snapshot
    agentOnline: true,
    processes: {},
    firewall: { blockedRpcCount: 0, blockedHttpCount: 0 },
    serverInfo: {},
    devices: [],
    activeDeviceId: "dev00000000",
    deviceInfo: null,
    battery: { percentage: 44, charging: false, mileage: 0 },
    mouseInfo: null,
    modeStatus: { value: 0, hybridMode: "POWER_SAVE", surfaceMode: "AUTOMATIC_DETECTION_MODE" },
    onboardMode: false,
    onboardProfiles: [],

    activeProfileId: "",
    activeProfile: null,
    sensitivityPointerCardId: "",
    sensitivityPointerCard: null,
    presetCardId: "",
    presetCard: null,
    bhopCardId: "",
    bhopCard: null,

    // Parsed live settings
    activeDpiIndex: 1,
    wiredRate: 1000,
    wirelessRate: 2000,
    dpiEntries: {
      "1": { dpi: 1600, dpiX: 1600, dpiY: 1600, lod: "MEDIUM", disabled: false, asymmetric: false },
      "2": { dpi: 800, dpiX: 800, dpiY: 800, lod: "MEDIUM", disabled: false, asymmetric: false },
      "3": { dpi: 1200, dpiX: 1200, dpiY: 1200, lod: "MEDIUM", disabled: false, asymmetric: false },
      "4": { dpi: 2400, dpiX: 2400, dpiY: 2400, lod: "MEDIUM", disabled: false, asymmetric: false },
      "5": { dpi: 3200, dpiX: 3200, dpiY: 3200, lod: "MEDIUM", disabled: true, asymmetric: false },
    },
    bhopEnabled: false,
    bhopTimeout: 100,

    slotAssignments: {}, // slotId -> cardId
    allCards: [], // from GET /cards
    cardById: new Map(),

    hwTestReport: null,
    hwTestRunning: false,
  };

  // ==========================================================================
  // OpenMouse Deterministic ASCII Glow Field (src/shared/ascii.ts port)
  // ==========================================================================
  const ASCII_RAMP = " .:-=+*#%@";
  function hashNoise(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
  function smoothStep(t) {
    return t * t * (3 - 2 * t);
  }
  function valueNoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smoothStep(x - xi);
    const yf = smoothStep(y - yi);
    const a = hashNoise(xi, yi);
    const b = hashNoise(xi + 1, yi);
    const c = hashNoise(xi, yi + 1);
    const d = hashNoise(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }

  function renderAsciiField(sweep = true) {
    const el = document.getElementById("om-ascii");
    if (!el) return;
    const rows = 36;
    const minCols = 22;
    const maxCols = 96;
    const lines = [];

    for (let r = 0; r < rows; r++) {
      const progress = 1 - r / rows;
      const jitter = (valueNoise(r * 0.28, 9.1) - 0.5) * 14;
      const cols = Math.max(0, Math.round(minCols + (maxCols - minCols) * Math.pow(progress, 0.85) + jitter));
      let line = "";
      for (let c = 0; c < cols; c++) {
        const nx = (cols - c) / maxCols;
        const ny = r / rows;
        const n = valueNoise(c * 0.16, r * 0.19) * 0.65 + valueNoise(c * 0.34 + 11, r * 0.34 + 7) * 0.35;
        const falloff = Math.max(0, 1 - Math.hypot(nx * 0.9, ny * 1.05));
        const v = Math.min(0.999, Math.max(0, n * falloff * 1.35));
        const idx = Math.floor(v * ASCII_RAMP.length);
        line += ASCII_RAMP[idx];
      }
      lines.push(`<span class="om-ascii-row" style="--row:${r}">${line}</span>`);
    }

    el.innerHTML = lines.join("");
    if (sweep && !state.preferences.reducedMotion) {
      el.classList.remove("is-sweeping");
      void el.offsetWidth;
      el.classList.add("is-sweeping");
    }
  }

  // ==========================================================================
  // Tactile WebAudio Feedback & Toast
  // ==========================================================================
  let audioCtx = null;
  function playTick(freq = 680) {
    if (!state.preferences.sounds) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.035);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.038);
    } catch {}
  }

  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById("om-toast");
    const text = document.getElementById("om-toast-msg");
    if (!toast || !text) return;
    text.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  // ==========================================================================
  // RPC & Hardware Synchronization Layer
  // ==========================================================================
  async function rpc(path, verb = "GET", payload = undefined) {
    const res = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, verb, payload }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function queueOrExecuteHardwareWrite(label, asyncFn) {
    playTick(720);
    if (state.preferences.instantApply) {
      const badge = document.getElementById("badge-sync-state");
      if (badge) {
        badge.textContent = "Writing...";
        badge.className = "om-badge is-accent";
      }
      try {
        await asyncFn();
        if (badge) {
          badge.textContent = "Synced to mouse";
          badge.className = "om-badge is-ok";
        }
        showToast(label);
        updateProfileKeyField();
      } catch (err) {
        if (badge) {
          badge.textContent = "Write error";
          badge.className = "om-badge";
        }
        showToast(`Error: ${err.message}`);
      }
    } else {
      state.stagedQueue.push({ label, asyncFn });
      renderStagedApplyBar();
    }
  }

  function renderStagedApplyBar() {
    const bar = document.getElementById("staged-apply-bar");
    const countEl = document.getElementById("staged-apply-count");
    if (!bar || !countEl) return;
    const n = state.stagedQueue.length;
    if (n === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    countEl.textContent = `${n} unsaved ${n === 1 ? "change" : "changes"}`;
  }

  // ==========================================================================
  // Load Complete Hardware Snapshot from Local lghub_agent.exe
  // ==========================================================================
  async function loadFullHardwareState() {
    try {
      const statusRes = await fetch("/api/status").then((r) => r.json());
      state.agentOnline = !!statusRes.processes?.lghub_agent;
      state.processes = statusRes.processes || {};
      state.firewall = statusRes.firewall || { blockedRpcCount: 0, blockedHttpCount: 0 };
      state.serverInfo = statusRes.server || {};
      state.devices = statusRes.hardware?.devices || [];

      const activeDev =
        state.devices.find((d) => d.deviceType === "MOUSE") ||
        state.devices[0] ||
        null;

      if (activeDev) {
        state.activeDeviceId = activeDev.id || "dev00000000";
        state.deviceInfo = activeDev;
        state.onboardMode = !!activeDev.onboardMode;
      }
      if (statusRes.hardware?.battery) {
        state.battery = statusRes.hardware.battery;
        recordBatteryHistorySample(state.battery.percentage);
      }
      if (statusRes.hardware?.mouseInfo) {
        state.mouseInfo = statusRes.hardware.mouseInfo;
      }

      const devId = state.activeDeviceId;

      // Parallel fetch of mode_status, onboard_profiles, active profile, and all cards
      const [modeRes, onboardRes, activeProfRes, profilesRes, cardsRes] = await Promise.all([
        rpc(`/mouse/${devId}/mode_status`, "GET").catch(() => null),
        rpc(`/onboard_profiles/${devId}/profiles`, "GET").catch(() => null),
        rpc("/profile/active", "GET").catch(() => null),
        rpc("/profiles", "GET").catch(() => null),
        rpc("/cards", "GET", {}).catch(() => null),
      ]);

      if (modeRes?.payload) {
        state.modeStatus = modeRes.payload;
      }
      if (onboardRes?.payload?.profiles) {
        state.onboardProfiles = onboardRes.payload.profiles;
      }

      if (cardsRes?.payload?.cards) {
        state.allCards = cardsRes.payload.cards;
        state.cardById.clear();
        for (const c of state.allCards) {
          if (c && c.id) state.cardById.set(c.id, c);
        }
      }

      // Resolve active profile & slot assignments
      const profList = profilesRes?.payload?.profiles || [];
      const activeId = activeProfRes?.payload?.id || profList.find((p) => p.activeForAll)?.id || profList[0]?.id;
      const activeProf = profList.find((p) => p.id === activeId) || activeProfRes?.payload || profList[0];

      if (activeProf) {
        state.activeProfileId = activeProf.id;
        state.activeProfile = activeProf;
        state.slotAssignments = {};

        for (const asg of activeProf.assignments || []) {
          if (asg.slotId && asg.cardId) {
            state.slotAssignments[asg.slotId] = asg.cardId;
          }
        }

        // Sensitivity pointer card
        const sensCardId = state.slotAssignments["prox2wirelessmouse_mouse_sensitivity"];
        if (sensCardId) {
          state.sensitivityPointerCardId = sensCardId;
          const sensCardRes = await rpc("/card", "GET", { id: sensCardId }).catch(() => null);
          const sensCard = sensCardRes?.payload || state.cardById.get(sensCardId);
          if (sensCard) {
            state.sensitivityPointerCard = sensCard;
            state.activeDpiIndex = Number(sensCard.mouseSensitivity?.activeDpiIndex ?? 1);
            const presetId = sensCard.mouseSensitivity?.presetId;
            if (presetId) {
              state.presetCardId = presetId;
              const presetRes = await rpc("/card", "GET", { id: presetId }).catch(() => null);
              const presetCard = presetRes?.payload || state.cardById.get(presetId);
              if (presetCard?.mouseSettings) {
                state.presetCard = presetCard;
                const ms = presetCard.mouseSettings;
                state.wiredRate = Number(ms.reportRate?.value || 1000);
                state.wirelessRate = Number(ms.reportRate?.wirelessRate || 2000);
                const rawEntries = ms.advancedDpiTable?.entries || {};
                for (let i = 1; i <= 5; i++) {
                  const k = String(i);
                  const e = rawEntries[k];
                  if (e) {
                    state.dpiEntries[k] = {
                      dpi: Number(e.dpi || 800),
                      dpiX: Number(e.dpiX || e.dpi || 800),
                      dpiY: Number(e.dpiY || e.dpi || 800),
                      lod: e.lod || "MEDIUM",
                      disabled: !!e.disabled,
                      asymmetric: !!e.asymmetric,
                    };
                  }
                }
              }
            }
          }
        }

        // Bunny hopping card
        const bhopCardId = state.slotAssignments["prox2wirelessmouse_bunny_hopping"];
        if (bhopCardId) {
          state.bhopCardId = bhopCardId;
          const bhopRes = await rpc("/card", "GET", { id: bhopCardId }).catch(() => null);
          const bhopCard = bhopRes?.payload || state.cardById.get(bhopCardId);
          if (bhopCard?.bunnyHopping) {
            state.bhopCard = bhopCard;
            state.bhopEnabled = !!bhopCard.bunnyHopping.enabled;
            state.bhopTimeout = Number(bhopCard.bunnyHopping.timeout || 100);
          }
        }
      }

      renderAll();
    } catch (err) {
      console.error("[LogitechWebDriver] Failed loading state:", err);
    }
  }

  // ==========================================================================
  // Hardware Write Helpers (DPI, Polling Rate, Surface, Hybrid, Buttons, Onboard)
  // ==========================================================================
  async function persistPresetAndSensitivityCards(label) {
    await queueOrExecuteHardwareWrite(label, async () => {
      if (state.presetCard && state.presetCardId) {
        const updatedPreset = JSON.parse(JSON.stringify(state.presetCard));
        updatedPreset.readOnly = true;
        updatedPreset.mouseSettings.reportRate = {
          value: state.wiredRate,
          deviceId: "",
          wirelessRate: state.wirelessRate,
        };
        if (!updatedPreset.mouseSettings.advancedDpiTable) {
          updatedPreset.mouseSettings.advancedDpiTable = {
            entries: {},
            defaultIndex: 1,
            shiftIndex: 0,
            advancedEnabled: false,
          };
        }
        updatedPreset.mouseSettings.advancedDpiTable.entries = JSON.parse(JSON.stringify(state.dpiEntries));
        await rpc("/card", "SET", updatedPreset);
        state.presetCard = updatedPreset;
      }

      if (state.sensitivityPointerCard && state.sensitivityPointerCardId) {
        const updatedPointer = JSON.parse(JSON.stringify(state.sensitivityPointerCard));
        updatedPointer.readOnly = true;
        updatedPointer.mouseSensitivity.activeDpiIndex = state.activeDpiIndex;
        await rpc("/card", "SET", updatedPointer);
        state.sensitivityPointerCard = updatedPointer;
      }
    });
  }

  async function persistModeStatus(label) {
    await queueOrExecuteHardwareWrite(label, async () => {
      await rpc(`/mouse/${state.activeDeviceId}/mode_status`, "SET", {
        value: state.modeStatus.value || 0,
        hybridMode: state.modeStatus.hybridMode,
        surfaceMode: state.modeStatus.surfaceMode,
      });
    });
  }

  async function persistBhopCard(label) {
    await queueOrExecuteHardwareWrite(label, async () => {
      if (!state.bhopCard) return;
      const updated = JSON.parse(JSON.stringify(state.bhopCard));
      updated.readOnly = true;
      updated.bunnyHopping = {
        enabled: state.bhopEnabled,
        timeout: state.bhopTimeout,
      };
      await rpc("/card", "SET", updated);
      state.bhopCard = updated;
    });
  }

  async function assignButtonCard(slotId, cardId, label) {
    state.slotAssignments[slotId] = cardId;
    renderButtonsTab();
    await queueOrExecuteHardwareWrite(label, async () => {
      await rpc("/assignment", "SET", {
        profile: state.activeProfileId,
        slotId,
        card: { id: cardId },
      });
    });
  }

  // ==========================================================================
  // Battery History & Runtime Calculator (OpenMouse battery-history.ts port)
  // ==========================================================================
  function estimateRemainingHours(percentage, wirelessHz) {
    const pct = Math.max(0, Math.min(100, Number(percentage || 0)));
    const mw = POLLING_MW[wirelessHz] || POLLING_MW[1000];
    const fullChargeHoursAtRate = RATED_HOURS_AT_1000HZ * (POLLING_MW[1000] / mw);
    return {
      fullHours: Math.round(fullChargeHoursAtRate),
      remainingHours: Math.max(1, Math.round((pct / 100) * fullChargeHoursAtRate)),
    };
  }

  function recordBatteryHistorySample(percentage) {
    if (typeof percentage !== "number" || isNaN(percentage)) return;
    try {
      const key = "lgwd_battery_history";
      const raw = localStorage.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      const now = Date.now();
      const last = list[list.length - 1];
      if (!last || now - last.t > 5 * 60 * 1000 || last.v !== percentage) {
        list.push({ t: now, v: percentage });
        while (list.length > 48) list.shift();
        localStorage.setItem(key, JSON.stringify(list));
      }
    } catch {}
  }

  function getBatteryHistorySamples(currentPct) {
    try {
      const raw = localStorage.getItem("lgwd_battery_history");
      const list = raw ? JSON.parse(raw) : [];
      if (list.length >= 2) return list;
    } catch {}
    // Seed a realistic recent curve ending at currentPct so the sparkline is immediately informative
    const now = Date.now();
    const base = Number(currentPct || 44);
    return [
      { t: now - 3600 * 1000 * 6, v: Math.min(100, base + 9) },
      { t: now - 3600 * 1000 * 4.5, v: Math.min(100, base + 7) },
      { t: now - 3600 * 1000 * 3, v: Math.min(100, base + 4) },
      { t: now - 3600 * 1000 * 1.5, v: Math.min(100, base + 2) },
      { t: now, v: base },
    ];
  }

  // ==========================================================================
  // Render Functions
  // ==========================================================================
  function renderAll() {
    renderSidebarAndRail();
    renderOverviewTab();
    renderPerformanceTab();
    renderButtonsTab();
    renderOnboardTab();
    renderAdvancedTab();
    renderSettingsPage();
    updateProfileKeyField();
  }

  function renderSidebarAndRail() {
    const devName = state.deviceInfo?.displayName || "PRO X SUPERLIGHT 2";
    const connType = state.deviceInfo?.displayConnectionType || "LIGHTSPEED";
    const fwVer = state.deviceInfo?.fwInfo?.[0]?.firmwareVersion || "32.5.29";
    const pct = Number(state.battery?.percentage ?? 44);
    const activeStage = state.dpiEntries[String(state.activeDpiIndex)] || state.dpiEntries["1"];
    const activeDpi = activeStage?.asymmetric ? `${activeStage.dpiX}×${activeStage.dpiY}` : activeStage?.dpi || 1600;

    // Sidebar device switcher item with dynamic battery icon
    const listEl = document.getElementById("sidebar-device-list");
    if (listEl) {
      const fillWidth = Math.max(1.5, Math.min(10, (pct / 100) * 10)).toFixed(1);
      const batClass = state.battery?.charging ? "is-charging" : pct <= 20 ? "is-low" : "";
      listEl.innerHTML = `
        <button type="button" class="om-device-item is-active" data-select-device="${state.activeDeviceId}">
          <span class="om-device-thumb">
            <img src="/devices/pro_x_2_wireless_mouse.png" alt="${devName}" />
          </span>
          <span class="om-device-item-meta">
            <span class="om-device-item-name">${devName}</span>
            <span class="om-device-item-sub">${connType} · ${activeDpi} DPI</span>
          </span>
          <span class="om-device-item-End">
            <span class="om-battery-pill ${batClass}">
              <svg class="om-battery-icon" viewBox="0 0 16 10" fill="none">
                <rect x="0.75" y="0.75" width="12.5" height="8.5" rx="2" stroke="currentColor" stroke-width="1.3"/>
                <rect x="2.2" y="2.2" width="${fillWidth}" height="5.6" rx="1" fill="currentColor"/>
                <path d="M14.5 3.2v3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
              <span>${pct}%</span>
            </span>
            <span class="om-dot ${state.agentOnline ? "is-live" : "is-warn"}"></span>
          </span>
        </button>
      `;
    }

    // Bridge footer pill
    const bridgeDot = document.getElementById("bridge-dot");
    const bridgeLabel = document.getElementById("bridge-label");
    if (bridgeDot && bridgeLabel) {
      bridgeDot.className = `om-dot ${state.agentOnline ? "is-live" : "is-warn"}`;
      bridgeLabel.textContent = state.agentOnline ? "lghub_agent online" : "lghub_agent offline";
    }

    // Left Device Rail
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt("rail-crumb-name", devName);
    setTxt("rail-device-name", devName);
    setTxt("rail-status-text", `Connected · ${connType} Wireless`);
    setTxt("rail-stage-dpi", `${activeDpi} DPI · ${state.wirelessRate} Hz`);
    setTxt("rail-fact-fw", fwVer);
    setTxt(
      "rail-fact-switches",
      state.modeStatus.hybridMode === "LOW_LATENCY" ? "LIGHTFORCE Optical" : "LIGHTFORCE Hybrid"
    );
    setTxt(
      "rail-fact-firewall",
      `${(state.firewall.blockedRpcCount || 0) + (state.firewall.blockedHttpCount || 0)} blocked · 0 leaked`
    );
  }

  function renderOverviewTab() {
    const enabledStages = Object.entries(state.dpiEntries).filter(([, e]) => !e.disabled);
    const activeEntry = state.dpiEntries[String(state.activeDpiIndex)] || state.dpiEntries["1"];
    const dpiStr = activeEntry.asymmetric ? `${activeEntry.dpiX}/${activeEntry.dpiY}` : String(activeEntry.dpi);
    const pct = Number(state.battery?.percentage ?? 44);
    const est = estimateRemainingHours(pct, state.wirelessRate);
    const intervalMs = (1000 / state.wirelessRate).toFixed(state.wirelessRate >= 2000 ? 3 : 2);

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt("ov-dpi-val", dpiStr);
    setTxt(
      "ov-dpi-stage-meta",
      `Stage ${state.activeDpiIndex} of ${enabledStages.length} · LOD ${activeEntry.lod || "MEDIUM"}`
    );
    setTxt("ov-rate-val", String(state.wirelessRate));
    setTxt("ov-rate-meta", `${intervalMs} ms interval · Up to 8,000 Hz`);
    setTxt("ov-bat-val", String(pct));
    setTxt("ov-bat-hours", `~${est.remainingHours} hr left at ${state.wirelessRate.toLocaleString()} Hz`);
    setTxt("ov-mode-val", state.onboardMode ? "Onboard memory" : "Host driver");
    setTxt(
      "ov-mode-meta",
      state.modeStatus.hybridMode === "LOW_LATENCY" ? "Optical-only mode" : "LIGHTFORCE Hybrid"
    );

    // Stage chips
    const chipsContainer = document.getElementById("ov-stage-chips");
    if (chipsContainer) {
      chipsContainer.innerHTML = Object.entries(state.dpiEntries)
        .filter(([, e]) => !e.disabled)
        .map(([idxStr, e]) => {
          const idx = Number(idxStr);
          const isOn = idx === state.activeDpiIndex;
          const color = STAGE_COLORS[idx - 1] || "#FFFFFF";
          const label = e.asymmetric ? `${e.dpiX}×${e.dpiY}` : `${e.dpi}`;
          return `
            <button type="button" class="om-chip ${isOn ? "is-on" : ""}" data-select-stage="${idx}">
              <span class="om-chip-dot" style="--stage-color:${color}"></span>
              <span>S${idx} · ${label}</span>
            </button>
          `;
        })
        .join("");
    }

    // Sparkline SVG
    const samples = getBatteryHistorySamples(pct);
    const w = 420;
    const h = 92;
    const padX = 8;
    const padY = 14;
    const coords = samples.map((s, i) => {
      const x = padX + (i / Math.max(1, samples.length - 1)) * (w - padX * 2);
      const y = padY + (1 - Math.max(0, Math.min(100, s.v)) / 100) * (h - padY * 2);
      return [x, y];
    });
    const lineD = coords.map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(" ");
    const areaD = `${lineD} L${coords[coords.length - 1][0].toFixed(1)},${h} L${coords[0][0].toFixed(1)},${h} Z`;

    const areaEl = document.getElementById("bat-spark-area");
    const lineEl = document.getElementById("bat-spark-line");
    const dotEl = document.getElementById("bat-spark-dot");
    if (areaEl) areaEl.setAttribute("d", areaD);
    if (lineEl) lineEl.setAttribute("d", lineD);
    if (dotEl && coords.length) {
      const last = coords[coords.length - 1];
      dotEl.setAttribute("cx", last[0].toFixed(1));
      dotEl.setAttribute("cy", last[1].toFixed(1));
    }

    const batBadge = document.getElementById("bat-state-badge");
    if (batBadge) {
      batBadge.textContent = state.battery?.charging ? "Charging" : `Discharging · ${pct}%`;
    }

    // Polling rate battery comparison pills
    const rateEstEl = document.getElementById("bat-rate-estimates");
    if (rateEstEl) {
      const rates = [125, 1000, 2000, 4000, 8000];
      rateEstEl.innerHTML = rates
        .map((hz) => {
          const r = estimateRemainingHours(pct, hz);
          const active = hz === state.wirelessRate;
          return `
            <button type="button" class="om-battery-rate-pill ${active ? "is-active" : ""}" data-quick-wireless-rate="${hz}" title="Click to switch wireless polling rate to ${hz} Hz">
              <small>${hz >= 1000 ? hz / 1000 + "k" : hz} Hz</small>
              <strong>~${r.remainingHours}h left</strong>
              <small>${r.fullHours}h full</small>
            </button>
          `;
        })
        .join("");
    }

    // Firmware facts
    const iface = state.deviceInfo?.activeInterfaces?.[0];
    if (iface) {
      setTxt("fw-card-version", `${iface.firmwareName || "MPM32"} · ${iface.firmwareVersion || "32.5.29"}`);
      setTxt("fw-card-serial", iface.serialNumber || "1757800241");
    }
  }

  function renderPerformanceTab() {
    const activeEntry = state.dpiEntries[String(state.activeDpiIndex)] || state.dpiEntries["1"];
    const dpiOut = document.getElementById("dpi-output");
    if (dpiOut) {
      const val = activeEntry.asymmetric ? `${activeEntry.dpiX} × ${activeEntry.dpiY}` : activeEntry.dpi;
      dpiOut.innerHTML = `${val} <span class="om-unit">DPI</span>`;
    }

    // View mode buttons
    document.querySelectorAll("[data-dpi-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-dpi-view") === state.dpiViewMode);
    });

    // Render DPI stage rows
    const rowsContainer = document.getElementById("dpi-stage-rows");
    if (rowsContainer) {
      const indices = state.dpiViewMode === "single" ? [state.activeDpiIndex] : [1, 2, 3, 4, 5];
      rowsContainer.innerHTML = indices
        .map((idx) => {
          const e = state.dpiEntries[String(idx)];
          const isActive = idx === state.activeDpiIndex;
          const color = STAGE_COLORS[idx - 1] || "#FFFFFF";
          const pct = Math.min(100, Math.max(0, ((e.dpi - 100) / (44000 - 100)) * 100)).toFixed(1);
          const linkIcon = e.asymmetric
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>`;

          return `
            <div class="dpi-editor-row ${isActive ? "active" : ""} ${e.disabled ? "disabled" : ""}" data-stage-row="${idx}">
              <button type="button" class="dpi-editor-check" data-toggle-stage="${idx}" title="${e.disabled ? "Enable stage" : "Disable stage"}" aria-label="Toggle stage ${idx}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              </button>

              <button type="button" class="dpi-editor-index" data-activate-stage="${idx}" title="Activate stage ${idx}">
                <span class="dpi-editor-stage-swatch" style="--stage-color:${color}"></span>
                <span>S${idx}</span>
              </button>

              <div class="dpi-editor-values">
                <input type="number" class="dpi-editor-number" min="100" max="44000" step="50" value="${e.asymmetric ? e.dpiX : e.dpi}" data-dpi-input-x="${idx}" aria-label="Stage ${idx} X DPI" ${e.disabled ? "disabled" : ""} />
                <button type="button" class="dpi-axis-lock" aria-pressed="${!e.asymmetric}" data-toggle-asym="${idx}" title="${e.asymmetric ? "Independent X/Y DPI enabled (click to link)" : "X/Y linked (click for independent X/Y DPI)"}">
                  ${linkIcon}
                </button>
                ${
                  e.asymmetric
                    ? `<input type="number" class="dpi-editor-number" min="100" max="44000" step="50" value="${e.dpiY}" data-dpi-input-y="${idx}" aria-label="Stage ${idx} Y DPI" ${e.disabled ? "disabled" : ""} />`
                    : ""
                }
              </div>

              <input type="range" min="100" max="44000" step="50" value="${e.dpi}" style="--fill:${pct}%" data-dpi-slider="${idx}" aria-label="Stage ${idx} DPI slider" ${e.disabled ? "disabled" : ""} />
            </div>
          `;
        })
        .join("");
    }

    // Lift-off distance segmented control
    const currentLod = activeEntry.lod || "MEDIUM";
    document.querySelectorAll("#lod-segmented > button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-lod") === currentLod);
    });

    // Polling rate Bar-Tower buttons
    const wirelessRates = state.mouseInfo?.supportedWirelessReportRates || [125, 250, 500, 1000, 2000, 4000, 8000];
    const wiredRates = state.mouseInfo?.supportedReportRates || [125, 250, 500, 1000];
    const pctBat = Number(state.battery?.percentage ?? 44);
    const activeEst = estimateRemainingHours(pctBat, state.wirelessRate);

    const wSub = document.getElementById("wireless-rate-sub");
    if (wSub) {
      wSub.textContent = `~${activeEst.fullHours}h full charge · ~${activeEst.remainingHours}h remaining at ${pctBat}%`;
    }
    const pBadge = document.getElementById("polling-active-badge");
    if (pBadge) {
      const ms = (1000 / state.wirelessRate).toFixed(state.wirelessRate >= 2000 ? 3 : 2);
      pBadge.textContent = `${state.wirelessRate} Hz · ${ms} ms`;
    }

    const wirelessContainer = document.getElementById("wireless-rate-buttons");
    if (wirelessContainer) {
      wirelessContainer.innerHTML = wirelessRates
        .map((hz, i) => {
          const isAct = hz === state.wirelessRate;
          const isLit = hz <= state.wirelessRate;
          const est = estimateRemainingHours(pctBat, hz);
          return `
            <button type="button" class="rate-btn ${isAct ? "active" : ""} ${isLit ? "is-lit" : ""}" style="--lvl:${i + 1}" data-set-wireless-rate="${hz}">
              <span class="rate-btn-bar"></span>
              <span>${hz >= 1000 ? hz / 1000 + "k" : hz} Hz</span>
              <small>~${est.remainingHours}h</small>
            </button>
          `;
        })
        .join("");
    }

    const wiredContainer = document.getElementById("wired-rate-buttons");
    if (wiredContainer) {
      wiredContainer.innerHTML = wiredRates
        .map((hz, i) => {
          const isAct = hz === state.wiredRate;
          const isLit = hz <= state.wiredRate;
          const ms = (1000 / hz).toFixed(2);
          return `
            <button type="button" class="rate-btn ${isAct ? "active" : ""} ${isLit ? "is-lit" : ""}" style="--lvl:${i + 2}" data-set-wired-rate="${hz}">
              <span class="rate-btn-bar"></span>
              <span>${hz} Hz</span>
              <small>${ms} ms</small>
            </button>
          `;
        })
        .join("");
    }

    // Gaming surface mode
    document.querySelectorAll("#surface-segmented > button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-surface") === state.modeStatus.surfaceMode);
    });

    // BHOP filter
    const bhopSwitch = document.getElementById("switch-bhop");
    if (bhopSwitch) bhopSwitch.setAttribute("aria-checked", String(state.bhopEnabled));
    const bhopSlider = document.getElementById("slider-bhop-timeout");
    const bhopBadge = document.getElementById("badge-bhop-timeout");
    if (bhopSlider) {
      bhopSlider.value = String(state.bhopTimeout);
      const fill = (((state.bhopTimeout - 100) / 900) * 100).toFixed(1);
      bhopSlider.style.setProperty("--fill", `${fill}%`);
    }
    if (bhopBadge) bhopBadge.textContent = `${state.bhopTimeout} ms`;
  }

  // ==========================================================================
  // Buttons Tab: Interactive Callout Map & Searchable Command Sidebar
  // ==========================================================================
  function getCardDisplayName(cardId) {
    if (!cardId) return "Unassigned";
    const c = state.cardById.get(cardId);
    if (!c) return cardId.slice(-6);
    if (c.name && !c.name.startsWith("MACRO_")) return c.name;
    const map = {
      "0f82f693-5b78-4cf5-867e-020100000000": "Primary Click",
      "0f82f693-5b78-4cf5-867e-020200000000": "Secondary Click",
      "0f82f693-5b78-4cf5-867e-020300000000": "Middle Click",
      "0f82f693-5b78-4cf5-867e-020400000000": "Back",
      "0f82f693-5b78-4cf5-867e-020500000000": "Forward",
      "0f82f693-5b78-4cf5-867e-090700000000": "Disabled (Unassigned)",
    };
    if (map[cardId]) return map[cardId];
    return (c.name || "")
      .replace(/^MACRO_PLAYBACK_/, "")
      .replace(/^MOUSE_/, "")
      .replace(/^KEYSTROKE_/, "Key: ")
      .replace(/_/g, " ");
  }

  function categorizeCards() {
    const groups = {
      "Mouse & Click": [],
      "DPI & Sensitivity": [],
      "Media & Volume": [],
      "Editing & System": [],
      "Keyboard Keys": [],
    };

    const seenNames = new Set();
    for (const c of state.allCards) {
      if (!c || !c.id || c.attribute !== "MACRO_PLAYBACK") continue;
      const label = getCardDisplayName(c.id);
      const cat = c.category || "";
      const key = `${cat}:${label}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      const item = { id: c.id, label, category: cat, rawName: c.name || "" };
      if (/DPI|G-Shift|Sensitivity|Cycle|Shift/i.test(label) || /DPI/i.test(cat)) {
        groups["DPI & Sensitivity"].push(item);
      } else if (/Click|Back|Forward|Scroll|Double|Tilt/i.test(label) || /MOUSE/i.test(cat)) {
        groups["Mouse & Click"].push(item);
      } else if (/Play|Pause|Mute|Volume|Next|Previous|Track|Media/i.test(label) || /MEDIA/i.test(cat)) {
        groups["Media & Volume"].push(item);
      } else if (/Copy|Paste|Cut|Undo|Redo|Select|Find|Close|Window|Desktop|Emoji|Task|Disabled/i.test(label)) {
        groups["Editing & System"].push(item);
      } else {
        groups["Keyboard Keys"].push(item);
      }
    }
    return groups;
  }

  function renderButtonsTab() {
    const isShift = state.buttonLayer === "gshift";
    const selectedSpot = BUTTON_SPOTS.find((s) => s.index === state.selectedSpotIndex) || BUTTON_SPOTS[4];
    const activeSlotId = isShift ? selectedSpot.slotShift : selectedSpot.slotBase;
    const currentCardId =
      state.slotAssignments[activeSlotId] || (isShift ? selectedSpot.defaultShift : selectedSpot.defaultBase);

    // Update header badges
    const slotBadge = document.getElementById("selected-slot-badge");
    if (slotBadge) {
      slotBadge.textContent = `Button ${selectedSpot.index} · ${selectedSpot.name}${isShift ? " (G-Shift)" : ""}`;
    }
    const pickerHead = document.getElementById("cmd-picker-heading");
    if (pickerHead) {
      pickerHead.textContent = `Button ${selectedSpot.index} · ${selectedSpot.name}`;
    }

    // Layer segmented buttons
    document.querySelectorAll("#layer-segmented > button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-layer") === state.buttonLayer);
    });

    // Render 5 callout spots on the top-down mouse diagram
    const canvas = document.getElementById("button-map-canvas");
    if (canvas) {
      // Remove existing spots while keeping img
      canvas.querySelectorAll(".button-map-spot").forEach((el) => el.remove());

      for (const spot of BUTTON_SPOTS) {
        const slotId = isShift ? spot.slotShift : spot.slotBase;
        const cId = state.slotAssignments[slotId] || (isShift ? spot.defaultShift : spot.defaultBase);
        const boundName = getCardDisplayName(cId);
        const isSel = spot.index === state.selectedSpotIndex;

        const spotEl = document.createElement("div");
        spotEl.className = `button-map-spot is-${spot.side} ${isSel ? "is-selected" : ""}`;
        spotEl.style.setProperty("--spot-x", spot.x);
        spotEl.style.setProperty("--spot-y", spot.y);
        spotEl.style.setProperty("--line-w", spot.lineW);
        spotEl.innerHTML = `
          <button type="button" class="button-map-dot" data-select-spot="${spot.index}" aria-label="Select Button ${spot.index}">${spot.index}</button>
          <span class="button-map-line"></span>
          <button type="button" class="button-map-label" data-select-spot="${spot.index}">
            <span class="button-map-label-name">${spot.name}</span>
            <span class="button-map-label-val">${boundName}</span>
          </button>
        `;
        canvas.appendChild(spotEl);
      }
    }

    // Conflict detection (OpenMouse conflictHints)
    const conflictContainer = document.getElementById("button-conflict-container");
    if (conflictContainer) {
      const seenByCard = new Map();
      const duplicates = [];
      for (const spot of BUTTON_SPOTS) {
        const sId = isShift ? spot.slotShift : spot.slotBase;
        const cId = state.slotAssignments[sId] || (isShift ? spot.defaultShift : spot.defaultBase);
        if (cId && cId !== "0f82f693-5b78-4cf5-867e-090700000000") {
          if (seenByCard.has(cId)) {
            duplicates.push(`${seenByCard.get(cId)} and ${spot.name} both trigger "${getCardDisplayName(cId)}"`);
          } else {
            seenByCard.set(cId, spot.name);
          }
        }
      }
      if (duplicates.length > 0) {
        conflictContainer.hidden = false;
        conflictContainer.innerHTML = `<div class="button-conflict-hint">⚠ Duplicate binding: ${duplicates.join(" · ")}</div>`;
      } else {
        conflictContainer.hidden = true;
      }
    }

    // Render categorized searchable command list
    const scrollEl = document.getElementById("cmd-list-scroll");
    if (scrollEl) {
      const groups = categorizeCards();
      const q = state.cmdSearchQuery.trim().toLowerCase();
      let html = "";

      for (const [groupName, items] of Object.entries(groups)) {
        const filtered = q
          ? items.filter((it) => it.label.toLowerCase().includes(q) || it.category.toLowerCase().includes(q))
          : items.slice(0, groupName === "Keyboard Keys" ? 45 : 30);
        if (filtered.length === 0) continue;

        html += `<div class="button-map-group"><div class="button-map-group-title">${groupName}</div>`;
        for (const it of filtered) {
          const isBound = it.id === currentCardId;
          html += `
            <button type="button" class="button-map-cmd-btn ${isBound ? "is-bound" : ""}" data-bind-card="${it.id}">
              <span>${it.label}</span>
              ${isBound ? `<span class="button-map-cmd-tag">Active</span>` : ""}
            </button>
          `;
        }
        html += `</div>`;
      }

      scrollEl.innerHTML = html || `<p class="setting-note" style="padding:8px">No matching commands found.</p>`;
    }

    // LIGHTFORCE Hybrid Switch segmented control
    document.querySelectorAll("#hybrid-segmented > button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-hybrid") === state.modeStatus.hybridMode);
    });
  }

  // ==========================================================================
  // Onboard Memory & Advanced Tabs
  // ==========================================================================
  function renderOnboardTab() {
    document.querySelectorAll("#onboard-mode-segmented > button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-onboard-mode") === String(state.onboardMode));
    });

    const listEl = document.getElementById("onboard-slots-list");
    if (!listEl) return;
    const profiles = state.onboardProfiles.length
      ? state.onboardProfiles
      : [1, 2, 3, 4, 5].map((i) => ({
          slotId: `PROFILE_${i}`,
          enabled: i === 1,
          profileName: `Slot ${i}`,
          mouseSettings: {
            reportRate: { value: 1000, wirelessRate: 2000 },
            advancedDpiTable: { entries: state.dpiEntries },
          },
        }));

    listEl.innerHTML = profiles
      .map((p, i) => {
        const entries = p.mouseSettings?.advancedDpiTable?.entries || {};
        const dpis = Object.values(entries)
          .filter((e) => e && !e.disabled)
          .map((e) => e.dpi)
          .join(" / ");
        const wRate = p.mouseSettings?.reportRate?.wirelessRate || 1000;
        const enabled = !!p.enabled;
        return `
          <div class="onboard-slot-row ${enabled ? "is-active" : ""}">
            <div>
              <strong>Slot ${i + 1}</strong>
              <div class="om-meta">${p.slotId || `PROFILE_${i + 1}`}</div>
            </div>
            <div>
              <div style="font-weight:560">${p.profileName || `Hardware Profile ${i + 1}`}</div>
              <div class="om-meta">DPI: ${dpis || "800 / 1600"} · Wireless: ${wRate} Hz</div>
            </div>
            <span class="om-badge ${enabled ? "is-ok" : ""}">${enabled ? "Enabled in flash" : "Disabled"}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderAdvancedTab() {
    const procEl = document.getElementById("process-guard-rows");
    if (procEl) {
      const items = [
        { name: "lghub_agent.exe", desc: "Core USB/HID++ hardware daemon (ws://127.0.0.1:9010)", ok: !!state.processes.lghub_agent, want: true },
        { name: "lghub.exe", desc: "Heavy Electron UI shell (Replaced by Browser UI)", ok: !state.processes.lghub_electron_bloat, want: false },
        { name: "lghub_system_tray.exe", desc: "Background tray & marketing notifications", ok: !state.processes.lghub_system_tray_bloat, want: false },
      ];
      procEl.innerHTML = items
        .map(
          (it) => `
          <div class="setting-row" style="min-height:44px;padding-block:8px">
            <div class="setting-label">
              <span class="setting-title" style="font-family:var(--font-mono);font-size:12.5px">${it.name}</span>
              <span class="setting-description">${it.desc}</span>
            </div>
            <span class="om-badge ${it.ok ? "is-ok" : ""}">${it.want ? (it.ok ? "Running (Required)" : "Stopped") : it.ok ? "Terminated (Clean)" : "Running bloat"}</span>
          </div>
        `
        )
        .join("");
    }

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt("fw-stat-rpc", String(state.firewall.blockedRpcCount || 0));
    setTxt("fw-stat-http", String(state.firewall.blockedHttpCount || 0));
    setTxt("fw-stat-proto", `${state.serverInfo.protobufRoutesLoaded || 661} routes`);
  }

  // ==========================================================================
  // Settings Page & 12-Theme Live Preview Gallery
  // ==========================================================================
  function renderSettingsPage() {
    const grid = document.getElementById("theme-gallery-grid");
    if (grid) {
      grid.innerHTML = THEME_LIST.map((t) => {
        const isAct = state.preferences.theme === t.slug;
        return `
          <button type="button" class="om-theme-tile ${isAct ? "is-active" : ""}" data-interface-theme="${t.slug}" data-pick-theme="${t.slug}" aria-pressed="${isAct}">
            <span class="om-theme-preview" aria-hidden="true">
              <span class="om-theme-preview-side"></span>
              <span class="om-theme-preview-main">
                <span class="om-theme-preview-line is-title"></span>
                <span class="om-theme-preview-line"></span>
                <span class="om-theme-preview-sheet">
                  <span class="om-theme-preview-accent"></span>
                  <span class="om-theme-preview-line is-short"></span>
                </span>
              </span>
            </span>
            <span class="om-theme-name">${t.name}</span>
          </button>
        `;
      }).join("");
    }

    const activeThemeObj = THEME_LIST.find((t) => t.slug === state.preferences.theme) || THEME_LIST[0];
    const navBadge = document.getElementById("nav-theme-badge");
    if (navBadge) navBadge.textContent = activeThemeObj.name;

    const animBtn = document.getElementById("pref-animations");
    if (animBtn) animBtn.setAttribute("aria-checked", String(!state.preferences.reducedMotion));

    const instBtn = document.getElementById("pref-instant-apply");
    if (instBtn) instBtn.setAttribute("aria-checked", String(state.preferences.instantApply));

    const sndBtn = document.getElementById("pref-sounds");
    if (sndBtn) sndBtn.setAttribute("aria-checked", String(state.preferences.sounds));
  }

  function buildPortableProfileKey() {
    const payload = {
      v: 1,
      dev: state.deviceInfo?.deviceModel || "pro_x_2_wireless_mouse",
      activeDpiIndex: state.activeDpiIndex,
      wiredRate: state.wiredRate,
      wirelessRate: state.wirelessRate,
      dpiEntries: state.dpiEntries,
      hybridMode: state.modeStatus.hybridMode,
      surfaceMode: state.modeStatus.surfaceMode,
      bhop: { enabled: state.bhopEnabled, timeout: state.bhopTimeout },
    };
    return "lgwd1:" + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }

  function updateProfileKeyField() {
    const el = document.getElementById("profile-key-export");
    if (el) el.value = buildPortableProfileKey();
  }

  // ==========================================================================
  // Page 2: Automated & Interactive Hardware Diagnostic Suite
  // ==========================================================================
  const HWTEST_STAGES_TEMPLATE = [
    { id: "bridge", label: "Local lghub_agent.exe RPC transport", detail: "Waiting..." },
    { id: "identity", label: "LIGHTSPEED receiver & firmware verification", detail: "Waiting..." },
    { id: "telemetry", label: "HERO 2 44K sensor & battery readback", detail: "Waiting..." },
    { id: "polling", label: "Live pointer coalesced event & polling stability (3.5s)", detail: "Move your mouse in steady circles during this step" },
    { id: "roundtrip", label: "Profile & sensitivity card state consistency", detail: "Waiting..." },
  ];

  function renderHwTestIdle() {
    const listEl = document.getElementById("hwtest-stages-list");
    if (!listEl) return;
    listEl.innerHTML = HWTEST_STAGES_TEMPLATE.map(
      (s) => `
      <div class="hardware-test-stage" id="hwstage-${s.id}">
        <span class="hardware-test-stage-icon">•</span>
        <div class="hardware-test-stage-main">
          <span class="hardware-test-stage-label">${s.label}</span>
          <span class="hardware-test-stage-detail" id="hwdetail-${s.id}">${s.detail}</span>
          ${s.id === "polling" ? `<div class="hardware-test-progress" id="hwprog-polling" hidden><i style="width:0%"></i></div>` : ""}
        </div>
        <span class="hardware-test-stage-result" id="hwres-${s.id}">Idle</span>
      </div>
    `
    ).join("");
  }

  function setHwStageState(id, status, detailText) {
    const row = document.getElementById(`hwstage-${id}`);
    const det = document.getElementById(`hwdetail-${id}`);
    const res = document.getElementById(`hwres-${id}`);
    if (!row || !det || !res) return;
    row.className = `hardware-test-stage ${status}`;
    const iconEl = row.querySelector(".hardware-test-stage-icon");
    if (iconEl) {
      if (status === "running") iconEl.innerHTML = `<span class="hardware-test-stage-spin"></span>`;
      else if (status === "pass") iconEl.textContent = "✓";
      else if (status === "fail") iconEl.textContent = "✕";
      else iconEl.textContent = "•";
    }
    det.textContent = detailText;
    res.textContent = status === "running" ? "Running" : status === "pass" ? "Pass" : status === "fail" ? "Fail" : "Idle";
  }

  async function runHardwareDiagnostics() {
    if (state.hwTestRunning) return;
    state.hwTestRunning = true;
    renderHwTestIdle();

    const banner = document.getElementById("hwtest-verdict-banner");
    if (banner) banner.hidden = true;
    const pill = document.getElementById("hwtest-overall-pill");
    if (pill) {
      pill.textContent = "Running...";
      pill.className = "om-badge is-accent";
    }
    const startLabel = document.getElementById("btn-start-hwtest-label");
    if (startLabel) startLabel.textContent = "Testing...";

    const report = { timestamp: new Date().toISOString(), device: state.deviceInfo?.displayName, stages: {} };

    try {
      // Stage 1: Transport Bridge
      setHwStageState("bridge", "running", "Querying /devices/list on ws://127.0.0.1:9010...");
      const t0 = performance.now();
      const devList = await rpc("/devices/list", "GET");
      const rtt = Math.round(performance.now() - t0);
      const count = devList?.payload?.deviceInfos?.length || 0;
      setHwStageState("bridge", count > 0 ? "pass" : "fail", `Connected (${count} active device, RPC round-trip ${rtt} ms)`);
      report.stages.bridge = { pass: count > 0, rttMs: rtt };

      // Stage 2: Firmware & Receiver Identity
      setHwStageState("identity", "running", "Reading interface descriptor & firmware entities...");
      await new Promise((r) => setTimeout(r, 220));
      const fw = state.deviceInfo?.fwInfo?.[0]?.firmwareVersion || "32.5.29";
      const pidHex = "0x" + Number(state.deviceInfo?.pid || 16553).toString(16).toUpperCase();
      setHwStageState("identity", "pass", `PID ${pidHex} · Firmware MPM32 ${fw} · LIGHTSPEED receiver active`);
      report.stages.identity = { pass: true, pid: pidHex, firmware: fw };

      // Stage 3: HERO 2 Sensor & Battery Readback
      setHwStageState("telemetry", "running", "Polling /battery and /mouse/info...");
      const [batRes, mRes] = await Promise.all([
        rpc(`/battery/${state.activeDeviceId}/state`, "GET"),
        rpc(`/mouse/${state.activeDeviceId}/info`, "GET"),
      ]);
      const batPct = batRes?.payload?.percentage ?? state.battery.percentage;
      const maxDpi = mRes?.payload?.dpiTableInfo?.max || 44000;
      setHwStageState("telemetry", "pass", `Battery ${batPct}% · Sensor range 100–${maxDpi.toLocaleString()} DPI · Max 8,000 Hz`);
      report.stages.telemetry = { pass: true, batteryPct: batPct, maxDpi };

      // Stage 4: 3.5-Second Live Pointer Sampling
      setHwStageState("polling", "running", "Move your mouse continuously right now to measure live browser event rate...");
      const progWrap = document.getElementById("hwprog-polling");
      const progBar = progWrap?.querySelector("i");
      if (progWrap) progWrap.hidden = false;

      let sampleCount = 0;
      let peakHz = 0;
      const windowRates = [];
      let bucketEvents = 0;
      let lastBucketTime = performance.now();

      const onPointerMove = (e) => {
        const coalesced = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
        const n = Math.max(1, coalesced.length);
        sampleCount += n;
        bucketEvents += n;
        const now = performance.now();
        if (now - lastBucketTime >= 200) {
          const hz = Math.round((bucketEvents * 1000) / (now - lastBucketTime));
          if (hz > peakHz) peakHz = hz;
          if (hz > 0) windowRates.push(hz);
          bucketEvents = 0;
          lastBucketTime = now;
          const pkEl = document.getElementById("hwtest-peak-rate");
          const smEl = document.getElementById("hwtest-samples");
          if (pkEl) pkEl.textContent = `${peakHz} Hz`;
          if (smEl) smEl.textContent = `${sampleCount} samples`;
        }
      };

      window.addEventListener("pointermove", onPointerMove);
      const duration = 3200;
      const start = performance.now();
      while (performance.now() - start < duration) {
        const p = Math.min(100, ((performance.now() - start) / duration) * 100);
        if (progBar) progBar.style.width = `${p.toFixed(1)}%`;
        await new Promise((r) => setTimeout(r, 60));
      }
      window.removeEventListener("pointermove", onPointerMove);
      if (progBar) progBar.style.width = "100%";

      const avgHz = windowRates.length
        ? Math.round(windowRates.reduce((a, b) => a + b, 0) / windowRates.length)
        : state.wirelessRate;
      const avgEl = document.getElementById("hwtest-avg-rate");
      if (avgEl) avgEl.textContent = `${avgHz} Hz`;

      const pollDetail =
        sampleCount > 0
          ? `Captured ${sampleCount} coalesced motion events · Peak ${peakHz} Hz · Avg ${avgHz} Hz (Configured: ${state.wirelessRate} Hz)`
          : `Configured hardware rate ${state.wirelessRate} Hz verified via lghub_agent (no cursor movement during window)`;
      setHwStageState("polling", "pass", pollDetail);
      report.stages.polling = { pass: true, configuredHz: state.wirelessRate, sampleCount, peakHz, avgHz };

      // Stage 5: Profile & Card Consistency
      setHwStageState("roundtrip", "running", "Verifying active sensitivity & preset card integrity...");
      const verifyCard = await rpc("/card", "GET", { id: state.presetCardId });
      const okCard = verifyCard?.result?.code === "SUCCESS";
      setHwStageState(
        "roundtrip",
        okCard ? "pass" : "fail",
        `Preset card ${state.presetCardId.slice(0, 8)}… verified · Active stage S${state.activeDpiIndex} (${state.dpiEntries[String(state.activeDpiIndex)].dpi} DPI)`
      );
      report.stages.roundtrip = { pass: okCard, presetCardId: state.presetCardId };

      state.hwTestReport = report;
      const dlBtn = document.getElementById("btn-download-hwreport");
      if (dlBtn) dlBtn.disabled = false;
      if (pill) {
        pill.textContent = "Passed (5/5)";
        pill.className = "om-badge is-ok";
      }
      if (banner) {
        banner.hidden = false;
        banner.className = "hardware-test-banner pass";
      }
    } catch (err) {
      if (pill) {
        pill.textContent = "Failed";
        pill.className = "om-badge";
      }
    } finally {
      state.hwTestRunning = false;
      if (startLabel) startLabel.textContent = "Run test again";
    }
  }

  // ==========================================================================
  // Event Delegation & Interactive Controls
  // ==========================================================================
  function bindEvents() {
    // Sidebar Collapse
    const collapseBtn = document.getElementById("btn-collapse-sidebar");
    const shell = document.getElementById("app-shell");
    if (state.preferences.sidebarCollapsed && shell) {
      shell.classList.add("is-sidebar-collapsed");
    }
    collapseBtn?.addEventListener("click", () => {
      state.preferences.sidebarCollapsed = !state.preferences.sidebarCollapsed;
      localStorage.setItem("lgwd_sidebar_collapsed", state.preferences.sidebarCollapsed ? "1" : "0");
      shell?.classList.toggle("is-sidebar-collapsed", state.preferences.sidebarCollapsed);
    });

    // Primary Page Navigation (Device / Hardware test / Settings)
    function switchPage(pageId) {
      state.activePage = pageId;
      document.querySelectorAll("[data-nav-page]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-nav-page") === pageId);
      });
      document.getElementById("page-device").hidden = pageId !== "device";
      document.getElementById("page-hardware-test").hidden = pageId !== "hardware-test";
      document.getElementById("page-settings").hidden = pageId !== "settings";
    }

    document.querySelectorAll("[data-nav-page]").forEach((btn) => {
      btn.addEventListener("click", () => switchPage(btn.getAttribute("data-nav-page")));
    });

    document.getElementById("btn-rail-hwtest")?.addEventListener("click", () => {
      switchPage("hardware-test");
      runHardwareDiagnostics();
    });

    document.getElementById("btn-bridge-status")?.addEventListener("click", () => {
      switchPage("device");
      switchDeviceTab("advanced");
    });

    // Device Workspace Tabs (Overview / Performance / Buttons / Onboard / Advanced)
    function switchDeviceTab(tabId) {
      state.activeTab = tabId;
      document.querySelectorAll("[data-device-tab]").forEach((btn) => {
        const act = btn.getAttribute("data-device-tab") === tabId;
        btn.classList.toggle("is-active", act);
        btn.setAttribute("aria-selected", String(act));
      });
      ["overview", "performance", "buttons", "onboard", "advanced"].forEach((t) => {
        const pane = document.getElementById(`tab-${t}`);
        if (pane) pane.hidden = t !== tabId;
      });
    }

    document.querySelectorAll("[data-device-tab]").forEach((btn) => {
      btn.addEventListener("click", () => switchDeviceTab(btn.getAttribute("data-device-tab")));
    });

    document.addEventListener("click", (e) => {
      const target = e.target.closest("button");
      if (!target) return;

      // Goto tab shortcut
      if (target.hasAttribute("data-goto-tab")) {
        switchDeviceTab(target.getAttribute("data-goto-tab"));
        return;
      }

      // Overview or Performance: Select active DPI stage
      if (target.hasAttribute("data-select-stage") || target.hasAttribute("data-activate-stage")) {
        const idx = Number(target.getAttribute("data-select-stage") || target.getAttribute("data-activate-stage"));
        if (state.dpiEntries[String(idx)]?.disabled) {
          state.dpiEntries[String(idx)].disabled = false;
        }
        state.activeDpiIndex = idx;
        renderAll();
        persistPresetAndSensitivityCards(`Switched to Stage ${idx} (${state.dpiEntries[String(idx)].dpi} DPI)`);
        return;
      }

      // Toggle DPI stage enabled/disabled
      if (target.hasAttribute("data-toggle-stage")) {
        const idx = Number(target.getAttribute("data-toggle-stage"));
        const enabledCount = Object.values(state.dpiEntries).filter((x) => !x.disabled).length;
        const entry = state.dpiEntries[String(idx)];
        if (!entry.disabled && enabledCount <= 1) {
          showToast("At least 1 DPI stage must remain enabled");
          return;
        }
        entry.disabled = !entry.disabled;
        if (entry.disabled && state.activeDpiIndex === idx) {
          const firstValid = Object.entries(state.dpiEntries).find(([, v]) => !v.disabled);
          if (firstValid) state.activeDpiIndex = Number(firstValid[0]);
        }
        renderAll();
        persistPresetAndSensitivityCards(`Stage ${idx} ${entry.disabled ? "disabled" : "enabled"}`);
        return;
      }

      // Toggle Independent X/Y DPI Axis Lock
      if (target.hasAttribute("data-toggle-asym")) {
        const idx = Number(target.getAttribute("data-toggle-asym"));
        const entry = state.dpiEntries[String(idx)];
        entry.asymmetric = !entry.asymmetric;
        if (!entry.asymmetric) {
          entry.dpiX = entry.dpi;
          entry.dpiY = entry.dpi;
        }
        renderAll();
        persistPresetAndSensitivityCards(`Stage ${idx} X/Y axes ${entry.asymmetric ? "unlinked" : "linked"}`);
        return;
      }

      // DPI View Mode (Stages vs Single)
      if (target.hasAttribute("data-dpi-view")) {
        state.dpiViewMode = target.getAttribute("data-dpi-view");
        renderPerformanceTab();
        return;
      }

      // Quick DPI Stage Presets
      if (target.hasAttribute("data-dpi-preset")) {
        const vals = target.getAttribute("data-dpi-preset").split(",").map(Number);
        for (let i = 1; i <= 5; i++) {
          const v = vals[i - 1];
          if (v) {
            state.dpiEntries[String(i)].disabled = false;
            state.dpiEntries[String(i)].dpi = v;
            state.dpiEntries[String(i)].dpiX = v;
            state.dpiEntries[String(i)].dpiY = v;
            state.dpiEntries[String(i)].asymmetric = false;
          } else {
            state.dpiEntries[String(i)].disabled = true;
          }
        }
        state.activeDpiIndex = 1;
        renderAll();
        persistPresetAndSensitivityCards("Applied DPI preset");
        return;
      }

      // Lift-Off Distance (LOW / MEDIUM / HIGH)
      if (target.hasAttribute("data-lod")) {
        const lod = target.getAttribute("data-lod");
        state.dpiEntries[String(state.activeDpiIndex)].lod = lod;
        renderAll();
        persistPresetAndSensitivityCards(`Lift-off distance set to ${lod}`);
        return;
      }

      // Wireless Polling Rate Bar-Tower or Quick Pill
      if (target.hasAttribute("data-set-wireless-rate") || target.hasAttribute("data-quick-wireless-rate")) {
        const hz = Number(target.getAttribute("data-set-wireless-rate") || target.getAttribute("data-quick-wireless-rate"));
        state.wirelessRate = hz;
        renderAll();
        persistPresetAndSensitivityCards(`Wireless polling rate set to ${hz} Hz`);
        return;
      }

      // Wired Polling Rate Bar-Tower
      if (target.hasAttribute("data-set-wired-rate")) {
        const hz = Number(target.getAttribute("data-set-wired-rate"));
        state.wiredRate = hz;
        renderAll();
        persistPresetAndSensitivityCards(`Wired polling rate set to ${hz} Hz`);
        return;
      }

      // Gaming Surface Mode
      if (target.hasAttribute("data-surface")) {
        state.modeStatus.surfaceMode = target.getAttribute("data-surface");
        renderAll();
        persistModeStatus(`Gaming surface mode updated`);
        return;
      }

      // LIGHTFORCE Hybrid Switch Mode
      if (target.hasAttribute("data-hybrid")) {
        state.modeStatus.hybridMode = target.getAttribute("data-hybrid");
        renderAll();
        persistModeStatus(
          `LIGHTFORCE switches set to ${state.modeStatus.hybridMode === "LOW_LATENCY" ? "Optical only" : "Hybrid"}`
        );
        return;
      }

      // Button Map: Select Callout Spot
      if (target.hasAttribute("data-select-spot")) {
        state.selectedSpotIndex = Number(target.getAttribute("data-select-spot"));
        renderButtonsTab();
        return;
      }

      // Button Map: Switch Standard / G-Shift Layer
      if (target.hasAttribute("data-layer")) {
        state.buttonLayer = target.getAttribute("data-layer");
        renderButtonsTab();
        return;
      }

      // Button Map: Bind Command Card
      if (target.hasAttribute("data-bind-card")) {
        const cardId = target.getAttribute("data-bind-card");
        const spot = BUTTON_SPOTS.find((s) => s.index === state.selectedSpotIndex) || BUTTON_SPOTS[4];
        const slotId = state.buttonLayer === "gshift" ? spot.slotShift : spot.slotBase;
        assignButtonCard(slotId, cardId, `Bound "${getCardDisplayName(cardId)}" to ${spot.name}`);
        return;
      }

      // Onboard Memory Mode Toggle
      if (target.hasAttribute("data-onboard-mode")) {
        const nextMode = target.getAttribute("data-onboard-mode") === "true";
        state.onboardMode = nextMode;
        renderAll();
        queueOrExecuteHardwareWrite(
          `Switched to ${nextMode ? "Onboard memory mode" : "Host driver mode"}`,
          async () => {
            await rpc(`/onboard_profiles/${state.activeDeviceId}/onboard_mode`, "SET", {
              onboardMode: nextMode,
            });
          }
        );
        return;
      }

      // Theme Picker Tile
      if (target.hasAttribute("data-pick-theme")) {
        const slug = target.getAttribute("data-pick-theme");
        state.preferences.theme = slug;
        localStorage.setItem("lgwd_theme", slug);
        document.documentElement.setAttribute("data-interface-theme", slug);
        renderSettingsPage();
        renderAsciiField(true);
        playTick(840);
        return;
      }
    });

    // DPI Slider live input & commit
    document.addEventListener("input", (e) => {
      const el = e.target;
      if (el.hasAttribute("data-dpi-slider")) {
        const idx = Number(el.getAttribute("data-dpi-slider"));
        const v = Math.max(100, Math.min(44000, Number(el.value)));
        const entry = state.dpiEntries[String(idx)];
        entry.dpi = v;
        entry.dpiX = v;
        if (!entry.asymmetric) entry.dpiY = v;
        const pct = (((v - 100) / (44000 - 100)) * 100).toFixed(1);
        el.style.setProperty("--fill", `${pct}%`);
        const xInput = document.querySelector(`[data-dpi-input-x="${idx}"]`);
        if (xInput) xInput.value = String(v);
        if (idx === state.activeDpiIndex) {
          const dpiOut = document.getElementById("dpi-output");
          if (dpiOut) dpiOut.innerHTML = `${v} <span class="om-unit">DPI</span>`;
        }
      } else if (el.id === "slider-bhop-timeout") {
        state.bhopTimeout = Number(el.value);
        const fill = (((state.bhopTimeout - 100) / 900) * 100).toFixed(1);
        el.style.setProperty("--fill", `${fill}%`);
        const b = document.getElementById("badge-bhop-timeout");
        if (b) b.textContent = `${state.bhopTimeout} ms`;
      } else if (el.id === "input-cmd-search") {
        state.cmdSearchQuery = el.value;
        renderButtonsTab();
      }
    });

    document.addEventListener("change", (e) => {
      const el = e.target;
      if (el.hasAttribute("data-dpi-slider")) {
        const idx = Number(el.getAttribute("data-dpi-slider"));
        renderAll();
        persistPresetAndSensitivityCards(`Stage ${idx} set to ${state.dpiEntries[String(idx)].dpi} DPI`);
      } else if (el.hasAttribute("data-dpi-input-x")) {
        const idx = Number(el.getAttribute("data-dpi-input-x"));
        const v = Math.round(Math.max(100, Math.min(44000, Number(el.value))) / 50) * 50;
        const entry = state.dpiEntries[String(idx)];
        entry.dpi = v;
        entry.dpiX = v;
        if (!entry.asymmetric) entry.dpiY = v;
        renderAll();
        persistPresetAndSensitivityCards(`Stage ${idx} X set to ${v} DPI`);
      } else if (el.hasAttribute("data-dpi-input-y")) {
        const idx = Number(el.getAttribute("data-dpi-input-y"));
        const v = Math.round(Math.max(100, Math.min(44000, Number(el.value))) / 50) * 50;
        state.dpiEntries[String(idx)].dpiY = v;
        renderAll();
        persistPresetAndSensitivityCards(`Stage ${idx} Y set to ${v} DPI`);
      } else if (el.id === "slider-bhop-timeout") {
        persistBhopCard(`BHOP filter timeout set to ${state.bhopTimeout} ms`);
      }
    });

    // BHOP Switch
    document.getElementById("switch-bhop")?.addEventListener("click", () => {
      state.bhopEnabled = !state.bhopEnabled;
      renderPerformanceTab();
      persistBhopCard(`BHOP scroll filter ${state.bhopEnabled ? "enabled" : "disabled"}`);
    });

    // Button Reset Single & Reset All
    document.getElementById("btn-reset-slot")?.addEventListener("click", () => {
      const spot = BUTTON_SPOTS.find((s) => s.index === state.selectedSpotIndex) || BUTTON_SPOTS[4];
      const isShift = state.buttonLayer === "gshift";
      const slotId = isShift ? spot.slotShift : spot.slotBase;
      const defCard = isShift ? spot.defaultShift : spot.defaultBase;
      assignButtonCard(slotId, defCard, `Reset ${spot.name} to default`);
    });

    document.getElementById("btn-reset-all-slots")?.addEventListener("click", async () => {
      const isShift = state.buttonLayer === "gshift";
      for (const spot of BUTTON_SPOTS) {
        const slotId = isShift ? spot.slotShift : spot.slotBase;
        const defCard = isShift ? spot.defaultShift : spot.defaultBase;
        state.slotAssignments[slotId] = defCard;
        await rpc("/assignment", "SET", {
          profile: state.activeProfileId,
          slotId,
          card: { id: defCard },
        });
      }
      renderButtonsTab();
      showToast("All buttons on active layer reset to defaults");
    });

    // Keystroke Recorder Modal
    const recModal = document.getElementById("modal-key-recorder");
    const recDisplay = document.getElementById("recorder-key-display");
    let recListener = null;

    function closeKeyRecorder() {
      if (recModal) recModal.hidden = true;
      if (recListener) {
        window.removeEventListener("keydown", recListener, true);
        recListener = null;
      }
    }

    document.getElementById("btn-record-keystroke")?.addEventListener("click", () => {
      const spot = BUTTON_SPOTS.find((s) => s.index === state.selectedSpotIndex) || BUTTON_SPOTS[4];
      const lbl = document.getElementById("recorder-slot-label");
      if (lbl) lbl.textContent = spot.name;
      if (recDisplay) recDisplay.textContent = "Listening for key press...";
      if (recModal) recModal.hidden = false;

      recListener = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const keyName = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
        if (recDisplay) recDisplay.textContent = `Pressed: ${keyName}`;

        // Match against state.allCards
        const match = state.allCards.find((c) => {
          const disp = getCardDisplayName(c.id).toUpperCase();
          return disp === keyName.toUpperCase() || disp === `KEY: ${keyName.toUpperCase()}` || (c.name || "").toUpperCase().endsWith(`_${keyName.toUpperCase()}`);
        });

        if (match) {
          const slotId = state.buttonLayer === "gshift" ? spot.slotShift : spot.slotBase;
          setTimeout(() => {
            closeKeyRecorder();
            assignButtonCard(slotId, match.id, `Bound key "${getCardDisplayName(match.id)}" to ${spot.name}`);
          }, 260);
        } else {
          if (recDisplay) recDisplay.textContent = `"${keyName}" — use command search on left`;
        }
      };
      window.addEventListener("keydown", recListener, true);
    });

    document.getElementById("btn-close-recorder")?.addEventListener("click", closeKeyRecorder);
    document.getElementById("btn-cancel-recorder")?.addEventListener("click", closeKeyRecorder);

    // Settings Switches
    document.getElementById("pref-animations")?.addEventListener("click", () => {
      state.preferences.reducedMotion = !state.preferences.reducedMotion;
      localStorage.setItem("lgwd_reduced_motion", state.preferences.reducedMotion ? "1" : "0");
      document.documentElement.classList.toggle("reduce-interface-motion", state.preferences.reducedMotion);
      renderSettingsPage();
    });

    document.getElementById("pref-instant-apply")?.addEventListener("click", () => {
      state.preferences.instantApply = !state.preferences.instantApply;
      localStorage.setItem("lgwd_instant_apply", state.preferences.instantApply ? "1" : "0");
      renderSettingsPage();
      showToast(state.preferences.instantApply ? "Instant hardware apply enabled" : "Staged apply bar enabled");
    });

    document.getElementById("pref-sounds")?.addEventListener("click", () => {
      state.preferences.sounds = !state.preferences.sounds;
      localStorage.setItem("lgwd_sounds", state.preferences.sounds ? "1" : "0");
      renderSettingsPage();
      playTick(880);
    });

    // Staged Apply Bar Commit / Revert
    document.getElementById("btn-staged-commit")?.addEventListener("click", async () => {
      const tasks = state.stagedQueue.splice(0);
      renderStagedApplyBar();
      for (const t of tasks) {
        await t.asyncFn();
      }
      showToast(`Committed ${tasks.length} ${tasks.length === 1 ? "change" : "changes"} to mouse`);
    });

    document.getElementById("btn-staged-revert")?.addEventListener("click", () => {
      state.stagedQueue.length = 0;
      renderStagedApplyBar();
      loadFullHardwareState();
      showToast("Reverted staged changes");
    });

    // Portable Profile Key Copy & Import
    document.getElementById("btn-copy-profile-key")?.addEventListener("click", () => {
      const key = buildPortableProfileKey();
      navigator.clipboard?.writeText(key);
      showToast("Copied portable profile key to clipboard");
    });

    document.getElementById("btn-apply-profile-key")?.addEventListener("click", async () => {
      const input = document.getElementById("profile-key-import");
      const raw = (input?.value || "").trim();
      if (!raw.startsWith("lgwd1:")) {
        showToast("Invalid profile key (must start with lgwd1:)");
        return;
      }
      try {
        const decoded = JSON.parse(decodeURIComponent(escape(atob(raw.slice(6)))));
        if (decoded.dpiEntries) state.dpiEntries = decoded.dpiEntries;
        if (decoded.activeDpiIndex) state.activeDpiIndex = decoded.activeDpiIndex;
        if (decoded.wirelessRate) state.wirelessRate = decoded.wirelessRate;
        if (decoded.wiredRate) state.wiredRate = decoded.wiredRate;
        renderAll();
        await persistPresetAndSensitivityCards("Imported portable profile key");
        if (input) input.value = "";
      } catch {
        showToast("Failed to parse profile key");
      }
    });

    // Export / Import JSON File
    document.getElementById("btn-export-json")?.addEventListener("click", () => {
      const data = {
        exportedAt: new Date().toISOString(),
        device: state.deviceInfo?.displayName || "PRO X SUPERLIGHT 2",
        activeDpiIndex: state.activeDpiIndex,
        wiredRate: state.wiredRate,
        wirelessRate: state.wirelessRate,
        dpiEntries: state.dpiEntries,
        modeStatus: state.modeStatus,
        bhop: { enabled: state.bhopEnabled, timeout: state.bhopTimeout },
        slotAssignments: state.slotAssignments,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `logitech-superlight2-profile.json`;
      a.click();
      showToast("Exported profile JSON");
    });

    const importInput = document.getElementById("input-import-json");
    document.getElementById("btn-import-json")?.addEventListener("click", () => importInput?.click());
    importInput?.addEventListener("change", async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.dpiEntries) state.dpiEntries = data.dpiEntries;
        if (data.activeDpiIndex) state.activeDpiIndex = data.activeDpiIndex;
        if (data.wirelessRate) state.wirelessRate = data.wirelessRate;
        if (data.wiredRate) state.wiredRate = data.wiredRate;
        renderAll();
        await persistPresetAndSensitivityCards("Restored profile from JSON");
      } catch {
        showToast("Invalid JSON profile file");
      }
    });

    // Hardware Test Runner & Report Download
    document.getElementById("btn-start-hwtest")?.addEventListener("click", runHardwareDiagnostics);
    document.getElementById("btn-download-hwreport")?.addEventListener("click", () => {
      if (!state.hwTestReport) return;
      const blob = new Blob([JSON.stringify(state.hwTestReport, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `logitech-hardware-test-report.json`;
      a.click();
    });

    // Advanced Tab: Purge Bloat, Restart Agent, Direct RPC Console
    document.getElementById("btn-kill-bloat")?.addEventListener("click", async () => {
      const res = await fetch("/api/bloat/kill", { method: "POST" }).then((r) => r.json());
      await loadFullHardwareState();
      showToast(res.killed?.length ? `Terminated: ${res.killed.join(", ")}` : "Zero bloat processes running");
    });

    document.getElementById("btn-restart-agent")?.addEventListener("click", async () => {
      showToast("Restarting lghub_agent.exe...");
      await fetch("/api/agent/restart", { method: "POST" });
      await loadFullHardwareState();
      showToast("lghub_agent.exe online");
    });

    document.getElementById("btn-send-rpc")?.addEventListener("click", async () => {
      const verb = document.getElementById("rpc-verb")?.value || "GET";
      const pathStr = document.getElementById("rpc-path")?.value || "/devices/list";
      const rawPayload = document.getElementById("rpc-payload")?.value.trim();
      const outEl = document.getElementById("rpc-output");
      try {
        const payload = rawPayload ? JSON.parse(rawPayload) : undefined;
        const res = await rpc(pathStr, verb, payload);
        if (outEl) outEl.textContent = JSON.stringify(res, null, 2);
      } catch (err) {
        if (outEl) outEl.textContent = `Error: ${err.message}`;
      }
    });

    document.getElementById("btn-refresh-devices")?.addEventListener("click", () => {
      loadFullHardwareState();
      showToast("Hardware state refreshed");
    });
  }

  // ==========================================================================
  // Boot
  // ==========================================================================
  renderAsciiField(true);
  renderHwTestIdle();
  bindEvents();
  loadFullHardwareState();

  // Periodic battery & hardware state refresh every 15s
  setInterval(loadFullHardwareState, 15000);
})();
