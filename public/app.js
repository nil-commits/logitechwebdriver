/**
 * Logitech G Web Hub — Wootility / MCHOSE / Corsair Web Hub Inspired Controller
 * Direct zero-cloud hardware control over lghub_agent.exe via local JSON RPC.
 */
(function () {
  "use strict";

  const STAGE_COLORS = {
    1: "#ff5252",
    2: "#00b8fc",
    3: "#00e676",
    4: "#ffb300",
    5: "#c084fc",
  };

  const BUTTON_ACTIONS = [
    { id: "0f82f693-5b78-4cf5-867e-020100000000", label: "Primary Click (Left)" },
    { id: "0f82f693-5b78-4cf5-867e-020200000000", label: "Secondary Click (Right)" },
    { id: "0f82f693-5b78-4cf5-867e-020300000000", label: "Middle Click (Wheel)" },
    { id: "0f82f693-5b78-4cf5-867e-020400000000", label: "Back (Mouse 4)" },
    { id: "0f82f693-5b78-4cf5-867e-020500000000", label: "Forward (Mouse 5)" },
    { id: "0f82f693-5b78-4cf5-867e-040400000000", label: "DPI Cycle" },
    { id: "0f82f693-5b78-4cf5-867e-040300000000", label: "DPI Shift (Sniper Hold)" },
    { id: "0f82f693-5b78-4cf5-867e-040100000000", label: "DPI Up" },
    { id: "0f82f693-5b78-4cf5-867e-040200000000", label: "DPI Down" },
    { id: "0f82f693-5b78-4cf5-867e-090500000000", label: "G-Shift (Layer Hold)" },
    { id: "0f82f693-5b78-4cf5-867e-090900000000", label: "Polling Rate Cycle" },
    { id: "0f82f693-5b78-4cf5-867e-090600000000", label: "Battery Level Check" },
    { id: "0f82f693-5b78-4cf5-867e-040800000000", label: "Double Click" },
    { id: "0f82f693-5b78-4cf5-867e-030100000000", label: "Media Play / Pause" },
    { id: "0f82f693-5b78-4cf5-867e-030700000000", label: "Audio Mute" },
    { id: "0f82f693-5b78-4cf5-867e-030500000000", label: "Next Track" },
    { id: "0f82f693-5b78-4cf5-867e-030600000000", label: "Previous Track" },
    { id: "747de5e9-4fe6-4277-a405-42b8bccbd891", label: "Macro: Autoclicker" },
    { id: "0f82f693-5b78-4cf5-867e-090700000000", label: "Default (Unshifted)" },
  ];

  const BUTTON_SLOTS = [
    { key: "g1", name: "G1 — Left Trigger", slotNormal: "prox2wirelessmouse_g1_m1", slotShift: "prox2wirelessmouse_g1_m1_shifted" },
    { key: "g2", name: "G2 — Right Trigger", slotNormal: "prox2wirelessmouse_g2_m1", slotShift: "prox2wirelessmouse_g2_m1_shifted" },
    { key: "g3", name: "G3 — Middle Wheel", slotNormal: "prox2wirelessmouse_g3_m1", slotShift: "prox2wirelessmouse_g3_m1_shifted" },
    { key: "g4", name: "G4 — Side Back", slotNormal: "prox2wirelessmouse_g4_m1", slotShift: "prox2wirelessmouse_g4_m1_shifted" },
    { key: "g5", name: "G5 — Side Forward", slotNormal: "prox2wirelessmouse_g5_m1", slotShift: "prox2wirelessmouse_g5_m1_shifted" },
  ];

  const state = {
    deviceId: "dev00000000",
    deviceName: "PRO X SUPERLIGHT 2",
    pidHex: "0x40A9",
    firmware: "32.5.29",
    connectionType: "WIRELESS",
    batteryPct: 44,
    charging: false,
    activeProfileId: "420fd454-0c36-499d-bde4-146823b16147",
    sensitivityCardId: "59bb56c0-a1aa-42cb-8169-18caa3637fff",
    presetCardId: "e311d1c8-76ee-4250-8ff4-1003343ef5c5",
    bhopCardId: "67ff9ab8-e126-362b-8874-d4d5137b4d32",

    sensitivityCard: null,
    presetCard: null,
    bhopCard: null,

    activeStage: 1,
    editingStage: 1,
    stages: {
      1: { disabled: false, asymmetric: false, dpi: 800, dpiX: 800, dpiY: 800, lod: 2 },
      2: { disabled: false, asymmetric: false, dpi: 1200, dpiX: 1200, dpiY: 1200, lod: 2 },
      3: { disabled: false, asymmetric: false, dpi: 1600, dpiX: 1600, dpiY: 1600, lod: 2 },
      4: { disabled: false, asymmetric: false, dpi: 2400, dpiX: 2400, dpiY: 2400, lod: 2 },
      5: { disabled: false, asymmetric: false, dpi: 3200, dpiX: 3200, dpiY: 3200, lod: 2 },
    },
    wirelessRate: 2000,
    wiredRate: 1000,

    hybridMode: "POWER_SAVE",
    surfaceMode: "AUTOMATIC_DETECTION_MODE",
    bhopEnabled: false,
    bhopTimeout: 100,

    buttonLayer: "normal", // "normal" | "gshift"
    assignments: {},

    onboardMode: false,
    onboardSlots: [],
  };

  let toastTimer = null;
  let dpiDebounceTimer = null;

  function showToast(msg = "✓ Synced to Hardware") {
    const el = document.getElementById("saveToast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1700);
  }

  function appendRpcLog(verb, path, payload, result) {
    const list = document.getElementById("rpcLogList");
    if (!list) return;
    const card = document.createElement("div");
    card.className = "log-card";
    const time = new Date().toLocaleTimeString();
    const txStr = payload ? ` ${JSON.stringify(payload).slice(0, 140)}` : "";
    const rxStr = JSON.stringify(result?.payload ?? result?.result ?? result ?? {}).slice(0, 220);
    card.innerHTML = `
      <div style="color:#637083; margin-bottom:2px;">[${time}] ${result?.result?.code || "OK"}</div>
      <div class="tx">TX ▸ ${verb} ${path}${txStr}</div>
      <div class="rx">RX ◂ ${rxStr}</div>
    `;
    list.prepend(card);
    while (list.children.length > 45) {
      list.removeChild(list.lastChild);
    }
  }

  async function rpc(verb, path, payload) {
    try {
      const res = await fetch("/api/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verb, path, payload }),
      });
      const data = await res.json();
      appendRpcLog(verb, path, payload, data);
      return data;
    } catch (err) {
      appendRpcLog(verb, path, payload, { error: err.message });
      return { error: err.message };
    }
  }

  // =========================================================================
  // 1. HARDWARE INITIALIZATION & LIVE SYNC FROM lghub_agent.exe
  // =========================================================================
  async function loadAllHardwareState() {
    try {
      // 1. Status & Processes
      const stRes = await fetch("/api/status");
      const st = await stRes.json();
      renderProcessStatus(st);

      const chip = document.getElementById("agentChip");
      const chipLbl = document.getElementById("agentChipLabel");
      if (st.processes?.lghub_agent) {
        chip.classList.remove("offline");
        chipLbl.textContent = "lghub_agent • Online";
      } else {
        chip.classList.add("offline");
        chipLbl.textContent = "lghub_agent • Offline";
      }

      if (Array.isArray(st.activeDevices) && st.activeDevices.length > 0) {
        const d = st.activeDevices[0];
        state.deviceId = d.id || "dev00000000";
        state.deviceName = d.displayName || "PRO X SUPERLIGHT 2";
        state.pidHex = d.pid ? `0x${Number(d.pid).toString(16).toUpperCase()}` : "0x40A9";
        state.firmware = d.firmwareVersion || "32.5.29";
        state.connectionType = d.connectionType || "WIRELESS";
      }

      if (st.battery && typeof st.battery.percentage === "number") {
        state.batteryPct = st.battery.percentage;
        state.charging = Boolean(st.battery.charging);
      }

      // 2. Active Profile & Assignments
      const profRes = await rpc("GET", "/profiles");
      const profiles = profRes?.payload?.profiles || [];
      const activeProf = profiles.find((p) => p.activeForApplication) || profiles[0];
      if (activeProf) {
        state.activeProfileId = activeProf.id;
        state.assignments = {};
        for (const a of activeProf.assignments || []) {
          state.assignments[a.slotId] = a.cardId;
          if (a.slotId.endsWith("_mouse_sensitivity")) {
            state.sensitivityCardId = a.cardId;
          } else if (a.slotId.endsWith("_bunny_hopping")) {
            state.bhopCardId = a.cardId;
          }
        }
      }

      // 3. Mouse Sensitivity Pointer Card
      if (state.sensitivityCardId) {
        const sensRes = await rpc("GET", "/card", { id: state.sensitivityCardId });
        if (sensRes?.payload?.id) {
          state.sensitivityCard = sensRes.payload;
          const ms = sensRes.payload.mouseSensitivity || {};
          if (ms.presetId) state.presetCardId = ms.presetId;
          if (ms.activeDpiIndex) {
            state.activeStage = Number(ms.activeDpiIndex) || 1;
            state.editingStage = state.activeStage;
          }
        }
      }

      // 4. Mouse Settings Advanced Preset Card (DPI stages + Polling Rate)
      if (state.presetCardId) {
        const preRes = await rpc("GET", "/card", { id: state.presetCardId });
        if (preRes?.payload?.id) {
          state.presetCard = preRes.payload;
          const ms = preRes.payload.mouseSettings || {};
          if (ms.reportRate) {
            state.wiredRate = Number(ms.reportRate.value) || 1000;
            state.wirelessRate = Number(ms.reportRate.wirelessRate) || state.wiredRate;
          }
          const table = ms.advancedDpiTable || {};
          if (table.defaultIndex && !state.sensitivityCard?.mouseSensitivity?.activeDpiIndex) {
            state.activeStage = Number(table.defaultIndex) || 1;
            state.editingStage = state.activeStage;
          }
          const entries = table.entries || {};
          for (let i = 1; i <= 5; i++) {
            const e = entries[String(i)];
            if (e) {
              state.stages[i] = {
                disabled: Boolean(e.disabled),
                asymmetric: Boolean(e.asymmetric),
                dpi: Number(e.dpi) || Number(e.dpiX) || 800,
                dpiX: Number(e.dpiX) || Number(e.dpi) || 800,
                dpiY: Number(e.dpiY) || Number(e.dpi) || 800,
                lod: Number(e.lod) || 2,
              };
            }
          }
        }
      }

      // 5. Bunny Hopping (Scroll Wheel Debounce Filter) Card
      if (state.bhopCardId) {
        const bhopRes = await rpc("GET", "/card", { id: state.bhopCardId });
        if (bhopRes?.payload?.id) {
          state.bhopCard = bhopRes.payload;
          const bh = bhopRes.payload.bunnyHopping || {};
          state.bhopEnabled = Boolean(bh.enabled);
          state.bhopTimeout = Number(bh.timeout) || 100;
        }
      }

      // 6. Onboard Profiles
      await loadOnboardProfiles();

      // Render all UI views
      updateAllUI();
    } catch (err) {
      console.error("Error loading hardware state:", err);
    }
  }

  async function loadOnboardProfiles() {
    const res = await rpc("GET", `/onboard_profiles/${state.deviceId}/profiles`);
    if (res?.payload?.directoryEntries) {
      state.onboardSlots = res.payload.directoryEntries;
    }
    renderOnboardSlots();
  }

  // =========================================================================
  // 2. HARDWARE MUTATIONS (Auto-Save with Instant Feedback)
  // =========================================================================
  async function syncDpiAndPollingToHardware() {
    if (!state.presetCard) return;

    // Ensure advancedEnabled is true if LOD != 2 or asymmetric is used
    let needsAdvanced = false;
    const entriesPayload = {};
    for (let i = 1; i <= 5; i++) {
      const s = state.stages[i];
      if (s.asymmetric || s.lod !== 2) needsAdvanced = true;
      entriesPayload[String(i)] = {
        disabled: Boolean(s.disabled),
        asymmetric: Boolean(s.asymmetric),
        dpi: s.asymmetric ? Number(s.dpiX) : Number(s.dpi),
        dpiX: Number(s.dpiX),
        dpiY: s.asymmetric ? Number(s.dpiY) : Number(s.dpiX),
        lod: Number(s.lod) || 2,
      };
    }

    state.presetCard.mouseSettings = {
      ...(state.presetCard.mouseSettings || {}),
      reportRate: {
        value: Number(state.wiredRate) || 1000,
        deviceId: "",
        wirelessRate: Number(state.wirelessRate) || 2000,
      },
      advancedDpiTable: {
        ...(state.presetCard.mouseSettings?.advancedDpiTable || {}),
        entries: entriesPayload,
        defaultIndex: Number(state.activeStage) || 1,
        shiftIndex: Number(state.activeStage) || 1,
        advancedEnabled: Boolean(needsAdvanced || state.presetCard.mouseSettings?.advancedDpiTable?.advancedEnabled),
      },
    };

    await rpc("SET", "/card", state.presetCard);

    if (state.sensitivityCard) {
      state.sensitivityCard.mouseSensitivity = {
        presetId: state.presetCard.id,
        activeDpiIndex: Number(state.activeStage) || 1,
      };
      await rpc("SET", "/card", state.sensitivityCard);
    }

    showToast(`✓ Synced (${state.stages[state.activeStage].dpiX} DPI • ${state.wirelessRate} Hz)`);
  }

  function scheduleDpiSync() {
    updateAllUI();
    clearTimeout(dpiDebounceTimer);
    dpiDebounceTimer = setTimeout(() => {
      syncDpiAndPollingToHardware();
    }, 110);
  }

  async function syncButtonAssignment(slotId, cardId) {
    state.assignments[slotId] = cardId;
    await rpc("SET", "/assignment", {
      profile: state.activeProfileId,
      slotId,
      card: { id: cardId },
    });
    const action = BUTTON_ACTIONS.find((a) => a.id === cardId);
    showToast(`✓ Bound ${action ? action.label : "Action"}`);
    renderRemapList();
  }

  async function syncSwitchAndSurfaceMode() {
    await rpc("SET", `/mouse/${state.deviceId}/mode_status`, {
      value: 0,
      hybridMode: state.hybridMode,
      surfaceMode: state.surfaceMode,
    });
    showToast(`✓ Switch & Surface Mode Updated`);
    updateAllUI();
  }

  async function syncBhopCard() {
    if (!state.bhopCard) return;
    const updated = {
      ...state.bhopCard,
      readOnly: false,
      bunnyHopping: {
        enabled: Boolean(state.bhopEnabled),
        timeout: Number(state.bhopTimeout) || 100,
      },
    };
    await rpc("SET", "/card", updated);
    showToast(`✓ BHOP Filter ${state.bhopEnabled ? state.bhopTimeout + " ms" : "Off"}`);
    updateAllUI();
  }

  async function syncOperatingMode(enableOnboard) {
    state.onboardMode = Boolean(enableOnboard);
    await rpc("SET", `/onboard_profiles/${state.deviceId}/onboard_mode`, {
      onboardMode: state.onboardMode,
    });
    showToast(state.onboardMode ? "✓ Onboard Memory Mode Enabled" : "✓ Software Driver Mode Active");
    updateAllUI();
  }

  // =========================================================================
  // 3. UI RENDERING & INTERACTION BINDINGS
  // =========================================================================
  function updateAllUI() {
    const activeSt = state.stages[state.activeStage] || state.stages[1];
    const editSt = state.stages[state.editingStage] || activeSt;
    const activeColor = STAGE_COLORS[state.activeStage] || "#00b8fc";

    // Top bar & Hero Meta
    document.getElementById("pillDevName").textContent = state.deviceName;
    document.getElementById("pillDevBat").textContent = `${state.batteryPct}%`;
    document.getElementById("metaName").textContent = state.deviceName;
    document.getElementById("metaPid").textContent = state.pidHex;
    document.getElementById("metaFw").textContent = state.firmware;
    document.getElementById("metaLink").textContent =
      state.connectionType === "WIRELESS" ? "LIGHTSPEED Wireless" : state.connectionType;

    // Hero Left Telemetry: Active DPI & Stage Dots
    document.getElementById("stageIndexBadge").textContent = `STAGE ${state.activeStage}`;
    document.getElementById("stageIndexBadge").style.color = activeColor;
    document.getElementById("stageDpiVal").textContent = activeSt.asymmetric
      ? `${activeSt.dpiX}/${activeSt.dpiY}`
      : `${activeSt.dpiX}`;

    const dotsRow = document.getElementById("stageDotsRow");
    dotsRow.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const st = state.stages[i];
      if (st.disabled) continue;
      const dot = document.createElement("div");
      dot.className = `stage-dot ${i === state.activeStage ? "active" : ""}`;
      dot.style.setProperty("--dot-color", STAGE_COLORS[i]);
      dotsRow.appendChild(dot);
    }

    // Hero Left Telemetry: Polling Rate
    const latencyMs = (1000 / (state.wirelessRate || 1000)).toFixed(state.wirelessRate >= 4000 ? 3 : 2);
    document.getElementById("stagePollVal").textContent = `${state.wirelessRate}`;
    document.getElementById("stageLatencyBadge").textContent = `${latencyMs} ms`;
    document.getElementById("stageWiredPollSub").textContent = `Wired USB: ${state.wiredRate} Hz`;

    // Hero Center Mouse Silhouette LED
    const chassis = document.getElementById("mouseChassis");
    const ledDot = document.getElementById("mouseLedDot");
    chassis.style.setProperty("--led-color", activeColor);
    chassis.style.setProperty("--stage-glow", `${activeColor}22`);
    ledDot.style.setProperty("--led-color", activeColor);

    // Hero Right Telemetry: Battery & Switches
    document.getElementById("stageBatVal").textContent = `${state.batteryPct}%`;
    document.getElementById("stageBatBar").style.width = `${Math.max(4, Math.min(100, state.batteryPct))}%`;
    document.getElementById("stageChargeState").textContent = state.charging ? "⚡ CHARGING" : "DISCHARGING";

    const lodLabel = activeSt.lod === 1 ? "LOD LOW" : activeSt.lod === 3 ? "LOD HIGH" : "LOD MED";
    document.getElementById("stageLodBadge").textContent = lodLabel;
    document.getElementById("stageSwitchMode").textContent =
      state.hybridMode === "LOW_LATENCY" ? "LIGHTFORCE Optical" : "LIGHTFORCE Hybrid";
    document.getElementById("stageBhopSub").textContent = state.bhopEnabled
      ? `BHOP Filter: ${state.bhopTimeout} ms`
      : "BHOP Filter: Off";

    // Panel 1: DPI Stage Cards
    document.getElementById("badgeActiveStage").textContent = `Stage ${state.activeStage} • ${activeSt.dpiX} DPI`;
    document.getElementById("badgeEditingStage").textContent = `Stage ${state.editingStage}`;
    renderDpiStagesGrid();

    // Panel 1: Fine Tuning Sliders & LOD
    document.getElementById("inpDpiX").value = editSt.dpiX;
    document.getElementById("rngDpiX").value = editSt.dpiX;
    document.getElementById("chkAsymmetric").checked = Boolean(editSt.asymmetric);
    document.getElementById("blockDpiY").classList.toggle("hidden", !editSt.asymmetric);
    document.getElementById("lblDpiPrimary").textContent = editSt.asymmetric
      ? "Horizontal X-Axis Sensitivity (DPI)"
      : "X / Y Sensitivity (100 – 44,000 DPI)";
    document.getElementById("inpDpiY").value = editSt.dpiY;
    document.getElementById("rngDpiY").value = editSt.dpiY;

    document.querySelectorAll("#lodBtnGroup .preset-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.lod) === Number(editSt.lod));
    });

    document.querySelectorAll("#quickDpiPresets .preset-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.quickDpi) === Number(editSt.dpiX));
    });

    // Panel 2: Polling Rate
    document.getElementById("badgeWirelessHz").textContent = `${state.wirelessRate} Hz (${latencyMs} ms)`;
    document.querySelectorAll("#wirelessHzGrid .preset-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.whz) === Number(state.wirelessRate));
    });
    document.querySelectorAll("#wiredHzGrid .preset-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.uhz) === Number(state.wiredRate));
    });

    // Panel 3: Buttons & Switches
    renderRemapList();
    document.getElementById("badgeSwitchMode").textContent =
      state.hybridMode === "LOW_LATENCY" ? "Optical Only" : "Hybrid";
    document.querySelectorAll("#switchModeGrid .preset-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.hybrid === state.hybridMode);
    });
    document.querySelectorAll("#surfaceModeGrid .preset-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.surface === state.surfaceMode);
    });
    document.getElementById("chkBhop").checked = Boolean(state.bhopEnabled);
    document.getElementById("rngBhopMs").value = state.bhopTimeout;
    document.getElementById("valBhopMs").textContent = `${state.bhopTimeout} ms`;

    // Panel 4: Onboard Mode
    document.getElementById("badgeOpMode").textContent = state.onboardMode ? "Onboard Memory" : "Software Driver";
    document.getElementById("btnOpSoftware").classList.toggle("active", !state.onboardMode);
    document.getElementById("btnOpOnboard").classList.toggle("active", state.onboardMode);
  }

  function renderDpiStagesGrid() {
    const grid = document.getElementById("dpiStagesGrid");
    grid.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const st = state.stages[i];
      const color = STAGE_COLORS[i];
      const card = document.createElement("div");
      card.className = `dpi-stage-card ${i === state.activeStage ? "active" : ""} ${st.disabled ? "disabled" : ""}`;
      card.style.setProperty("--st-color", color);
      card.innerHTML = `
        <div class="st-head">
          <span>S${i}</span>
          <button class="st-toggle" title="Enable/Disable Stage ${i}" data-toggle-stage="${i}"></button>
        </div>
        <div class="st-dpi">${st.dpiX}</div>
        <div class="st-sub">${st.asymmetric ? `Y:${st.dpiY}` : "DPI"}</div>
      `;

      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-toggle-stage]")) {
          e.stopPropagation();
          const enabledCount = Object.values(state.stages).filter((x) => !x.disabled).length;
          if (!st.disabled && enabledCount <= 1) {
            showToast("⚠ At least 1 DPI stage must remain enabled");
            return;
          }
          st.disabled = !st.disabled;
          if (st.disabled && state.activeStage === i) {
            const firstEnabled = [1, 2, 3, 4, 5].find((k) => !state.stages[k].disabled) || 1;
            state.activeStage = firstEnabled;
            state.editingStage = firstEnabled;
          }
          scheduleDpiSync();
          return;
        }

        // Activate & select this stage
        st.disabled = false;
        state.activeStage = i;
        state.editingStage = i;
        scheduleDpiSync();
      });

      grid.appendChild(card);
    }
  }

  function renderRemapList() {
    const container = document.getElementById("remapList");
    if (!container) return;
    container.innerHTML = "";

    const isShift = state.buttonLayer === "gshift";
    document.getElementById("btnLayerNormal").classList.toggle("accent", !isShift);
    document.getElementById("btnLayerGshift").classList.toggle("accent", isShift);

    BUTTON_SLOTS.forEach((b) => {
      const slotId = isShift ? b.slotShift : b.slotNormal;
      const currentCardId = state.assignments[slotId] || "";
      const row = document.createElement("div");
      row.className = "remap-row";
      row.dataset.slotKey = b.key;

      const optionsHtml = BUTTON_ACTIONS.map(
        (act) => `<option value="${act.id}" ${act.id === currentCardId ? "selected" : ""}>${act.label}</option>`
      ).join("");

      row.innerHTML = `
        <div class="remap-key">
          <span class="k-badge">${b.key.toUpperCase()}</span>
          <span>${b.name.replace(/^G\d — /, "")}</span>
        </div>
        <select class="remap-select" data-slot-id="${slotId}">
          ${optionsHtml}
        </select>
      `;

      row.addEventListener("mouseenter", () => {
        document.querySelectorAll(`[data-slot="${b.key}"]`).forEach((el) => el.classList.add("highlight"));
      });
      row.addEventListener("mouseleave", () => {
        document.querySelectorAll(`[data-slot="${b.key}"]`).forEach((el) => el.classList.remove("highlight"));
      });

      const select = row.querySelector("select");
      select.addEventListener("change", () => {
        syncButtonAssignment(slotId, select.value);
      });

      container.appendChild(row);
    });
  }

  function renderOnboardSlots() {
    const grid = document.getElementById("onboardSlotsGrid");
    if (!grid) return;
    grid.innerHTML = "";
    const slots = state.onboardSlots.length
      ? state.onboardSlots
      : [1, 2, 3, 4, 5].map((n) => ({ onboardSlotId: `PROFILE_${n}`, enabled: n === 1 }));

    slots.forEach((s, idx) => {
      const entries = s.mouseSettings?.advancedDpiTable?.entries || {};
      const defIdx = s.mouseSettings?.advancedDpiTable?.defaultIndex || 1;
      const defDpi = entries[String(defIdx)]?.dpi || 800;
      const wHz = s.mouseSettings?.reportRate?.wirelessRate || 1000;

      const el = document.createElement("div");
      el.className = `slot-card ${s.enabled ? "enabled" : ""}`;
      el.innerHTML = `
        <div style="font-size:0.68rem; font-weight:700; color:${s.enabled ? "var(--green)" : "var(--text-muted)"};">
          SLOT ${idx + 1} ${s.enabled ? "• ON" : "• OFF"}
        </div>
        <div style="font-family:var(--font-mono); font-size:0.95rem; font-weight:700;">
          ${defDpi} DPI
        </div>
        <div style="font-family:var(--font-mono); font-size:0.68rem; color:var(--text-secondary);">
          ${wHz} Hz Wireless
        </div>
      `;
      grid.appendChild(el);
    });
  }

  function renderProcessStatus(st) {
    const box = document.getElementById("processStatusList");
    if (!box || !st?.processes) return;
    const p = st.processes;
    const bloatClean = !p.lghub_electron_bloat && !p.lghub_system_tray && !p.lghub_sso_handler;
    const badge = document.getElementById("badgeBloatStatus");
    if (badge) {
      badge.textContent = bloatClean ? "100% Bloat-Free" : "Bloat Detected";
      badge.className = `module-badge ${bloatClean ? "green" : "amber"}`;
    }

    const row = (name, ok, statusText) => `
      <div style="display:flex; justify-content:space-between; padding:4px 8px; background:#101520; border-radius:6px; border:1px solid var(--border);">
        <span>${name}</span>
        <span style="color:${ok ? "var(--green)" : "var(--danger)"}; font-weight:700;">${statusText}</span>
      </div>
    `;
    box.innerHTML = [
      row("lghub_agent.exe (Hardware HID Daemon)", p.lghub_agent, p.lghub_agent ? "ONLINE" : "OFFLINE"),
      row("lghub.exe (600MB Electron UI Bloat)", !p.lghub_electron_bloat, p.lghub_electron_bloat ? "RUNNING" : "TERMINATED"),
      row("lghub_system_tray.exe (Background Tray)", !p.lghub_system_tray, p.lghub_system_tray ? "RUNNING" : "TERMINATED"),
      row("lghub_sso_handler.exe (Cloud Login/OAuth)", !p.lghub_sso_handler, p.lghub_sso_handler ? "RUNNING" : "TERMINATED"),
    ].join("");
  }

  // =========================================================================
  // 4. EVENT LISTENERS & LIVE BENCHMARK PAD
  // =========================================================================
  function bindEvents() {
    // Dock Tab Switching
    document.querySelectorAll(".dock-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".dock-tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
        tab.classList.add("active");
        const panel = document.getElementById(tab.dataset.panel);
        if (panel) panel.classList.remove("hidden");
      });
    });

    // Clicking a button zone on the interactive Mouse Silhouette jumps to Buttons & Switches
    document.querySelectorAll("[data-slot]").forEach((zone) => {
      zone.addEventListener("click", () => {
        const slotKey = zone.dataset.slot;
        const btnTab = document.querySelector('[data-panel="panel-buttons"]');
        if (btnTab) btnTab.click();
        document.querySelectorAll(".remap-row").forEach((r) => {
          r.classList.toggle("highlight", r.dataset.slotKey === slotKey);
        });
      });
    });

    // DPI Slider & Number Input (Primary / X-Axis)
    const setStageDpiX = (val) => {
      const clamped = Math.max(100, Math.min(44000, Math.round(Number(val) || 800)));
      const st = state.stages[state.editingStage];
      st.dpiX = clamped;
      st.dpi = clamped;
      if (!st.asymmetric) st.dpiY = clamped;
      scheduleDpiSync();
    };

    document.getElementById("rngDpiX").addEventListener("input", (e) => setStageDpiX(e.target.value));
    document.getElementById("inpDpiX").addEventListener("change", (e) => setStageDpiX(e.target.value));

    // Quick DPI Presets
    document.querySelectorAll("#quickDpiPresets .preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => setStageDpiX(btn.dataset.quickDpi));
    });

    // Independent X/Y Axis (Asymmetric)
    document.getElementById("chkAsymmetric").addEventListener("change", (e) => {
      const st = state.stages[state.editingStage];
      st.asymmetric = e.target.checked;
      if (!st.asymmetric) st.dpiY = st.dpiX;
      scheduleDpiSync();
    });

    const setStageDpiY = (val) => {
      const clamped = Math.max(100, Math.min(44000, Math.round(Number(val) || 800)));
      const st = state.stages[state.editingStage];
      st.dpiY = clamped;
      scheduleDpiSync();
    };

    document.getElementById("rngDpiY").addEventListener("input", (e) => setStageDpiY(e.target.value));
    document.getElementById("inpDpiY").addEventListener("change", (e) => setStageDpiY(e.target.value));

    // Lift-Off Distance (LOD)
    document.querySelectorAll("#lodBtnGroup .preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.stages[state.editingStage].lod = Number(btn.dataset.lod);
        scheduleDpiSync();
      });
    });

    // Wireless Polling Rate
    document.querySelectorAll("#wirelessHzGrid .preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.wirelessRate = Number(btn.dataset.whz);
        scheduleDpiSync();
      });
    });

    // Wired Polling Rate
    document.querySelectorAll("#wiredHzGrid .preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.wiredRate = Number(btn.dataset.uhz);
        scheduleDpiSync();
      });
    });

    // Standard vs G-Shift Button Layer
    document.getElementById("btnLayerNormal").addEventListener("click", () => {
      state.buttonLayer = "normal";
      renderRemapList();
    });
    document.getElementById("btnLayerGshift").addEventListener("click", () => {
      state.buttonLayer = "gshift";
      renderRemapList();
    });

    // Switch Mode & Surface Mode
    document.querySelectorAll("#switchModeGrid .preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.hybridMode = btn.dataset.hybrid;
        syncSwitchAndSurfaceMode();
      });
    });
    document.querySelectorAll("#surfaceModeGrid .preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.surfaceMode = btn.dataset.surface;
        syncSwitchAndSurfaceMode();
      });
    });

    // BHOP Scroll Wheel Filter
    document.getElementById("chkBhop").addEventListener("change", (e) => {
      state.bhopEnabled = e.target.checked;
      syncBhopCard();
    });
    document.getElementById("rngBhopMs").addEventListener("input", (e) => {
      state.bhopTimeout = Number(e.target.value);
      document.getElementById("valBhopMs").textContent = `${state.bhopTimeout} ms`;
    });
    document.getElementById("rngBhopMs").addEventListener("change", () => {
      syncBhopCard();
    });

    // Onboard vs Software Operating Mode
    document.getElementById("btnOpSoftware").addEventListener("click", () => syncOperatingMode(false));
    document.getElementById("btnOpOnboard").addEventListener("click", () => syncOperatingMode(true));
    document.getElementById("btnRefreshOnboard").addEventListener("click", () => {
      loadOnboardProfiles();
      showToast("✓ Refreshed Onboard Slots");
    });

    // System & Debloat Controls
    document.getElementById("btnPurgeBloat").addEventListener("click", async () => {
      await fetch("/api/debloat", { method: "POST" });
      await loadAllHardwareState();
      showToast("✓ Bloat Processes Terminated");
    });
    document.getElementById("btnRestartAgent").addEventListener("click", async () => {
      await fetch("/api/start-agent", { method: "POST" });
      await loadAllHardwareState();
      showToast("✓ Hardware Agent Verified");
    });
    document.getElementById("btnRefreshStatus").addEventListener("click", async () => {
      await loadAllHardwareState();
      showToast("✓ Hardware Telemetry Refreshed");
    });

    // Export / Import Profile JSON
    document.getElementById("btnExportProfile").addEventListener("click", () => {
      const exportData = {
        device: state.deviceName,
        exportedAt: new Date().toISOString(),
        activeStage: state.activeStage,
        stages: state.stages,
        wirelessRate: state.wirelessRate,
        wiredRate: state.wiredRate,
        hybridMode: state.hybridMode,
        surfaceMode: state.surfaceMode,
        bhopEnabled: state.bhopEnabled,
        bhopTimeout: state.bhopTimeout,
        assignments: state.assignments,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `logitech-${state.deviceName.toLowerCase().replace(/\s+/g, "-")}-profile.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("✓ Profile Exported");
    });

    document.getElementById("inpImportProfile").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.stages) state.stages = data.stages;
        if (data.activeStage) {
          state.activeStage = Number(data.activeStage);
          state.editingStage = state.activeStage;
        }
        if (data.wirelessRate) state.wirelessRate = Number(data.wirelessRate);
        if (data.wiredRate) state.wiredRate = Number(data.wiredRate);
        await syncDpiAndPollingToHardware();
        updateAllUI();
        showToast("✓ Profile Imported & Synced");
      } catch {
        showToast("⚠ Invalid Profile JSON");
      }
    });

    // Slide-Over RPC Inspector Drawer
    const drawer = document.getElementById("rpcDrawer");
    document.getElementById("btnToggleDrawer").addEventListener("click", () => {
      drawer.classList.toggle("open");
    });
    document.getElementById("btnCloseDrawer").addEventListener("click", () => {
      drawer.classList.remove("open");
    });
    document.getElementById("btnClearLogs").addEventListener("click", () => {
      document.getElementById("rpcLogList").innerHTML = "";
    });
    document.getElementById("btnSendCustomRpc").addEventListener("click", () => {
      const path = document.getElementById("inpCustomRpcPath").value.trim();
      if (path) rpc("GET", path);
    });

    // Live Polling Rate (Hz) Benchmark Pad
    initPollingBenchmarkPad();
  }

  function initPollingBenchmarkPad() {
    const pad = document.getElementById("hzTestPad");
    const liveEl = document.getElementById("hzLiveReadout");
    const subEl = document.getElementById("hzSubReadout");
    const peakEl = document.getElementById("badgePeakHz");
    if (!pad) return;

    let sampleTimestamps = [];
    let peakHz = 0;

    const recordEvent = (e) => {
      const now = performance.now();
      const coalesced = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
      const count = coalesced && coalesced.length > 0 ? coalesced.length : 1;
      for (let i = 0; i < count; i++) {
        sampleTimestamps.push(now);
      }
      const cutoff = now - 500;
      while (sampleTimestamps.length > 0 && sampleTimestamps[0] < cutoff) {
        sampleTimestamps.shift();
      }
      if (sampleTimestamps.length >= 4) {
        const currentHz = Math.round(sampleTimestamps.length * 2);
        if (currentHz > peakHz) peakHz = currentHz;
        liveEl.textContent = `${currentHz} Hz`;
        peakEl.textContent = `Peak: ${peakHz} Hz`;
        subEl.textContent = `Interval: ${(1000 / Math.max(1, currentHz)).toFixed(2)} ms • Click pad to reset peak`;
      }
    };

    if ("onpointerrawupdate" in window) {
      pad.addEventListener("pointerrawupdate", recordEvent);
    } else {
      pad.addEventListener("pointermove", recordEvent);
    }

    pad.addEventListener("click", () => {
      peakHz = 0;
      sampleTimestamps = [];
      liveEl.textContent = "Move Mouse Here";
      peakEl.textContent = "Peak: 0 Hz";
      subEl.textContent = "Peak reset • Circle mouse inside pad";
    });
  }

  // Kick off initial hardware load + periodic battery refresh
  bindEvents();
  loadAllHardwareState();
  setInterval(async () => {
    const res = await rpc("GET", `/battery/${state.deviceId}/state`);
    if (res?.payload && typeof res.payload.percentage === "number") {
      state.batteryPct = res.payload.percentage;
      state.charging = Boolean(res.payload.charging);
      updateAllUI();
    }
  }, 30000);
})();
