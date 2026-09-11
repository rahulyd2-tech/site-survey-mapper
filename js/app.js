// App shell: routing, view rendering, capture flows. Vanilla JS, no build step.

const AUTO_UPLOAD_SIZE_LIMIT = 15 * 1024 * 1024; // 15MB — bigger files get a manual Drive-link field instead
const viewRoot = document.getElementById("view-root");
const syncBadge = document.getElementById("sync-badge");

let currentView = "dashboard";
let recentWorkItems = [];

function navigate(view) {
  currentView = view;
  document.querySelectorAll(".bottom-nav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  render();
}

document.querySelectorAll(".bottom-nav button").forEach((btn) => {
  btn.addEventListener("click", () => navigate(btn.dataset.view));
});

async function render() {
  switch (currentView) {
    case "dashboard":
      return renderDashboard();
    case "new-entry":
      return renderEntryPicker();
    case "work-item-form":
      return renderWorkItemForm();
    case "media-photo":
      return renderMediaCapture("photo");
    case "media-video":
      return renderMediaCapture("video");
    case "drone-import":
      return renderDroneImport();
    case "sync":
      return renderSyncView();
    default:
      return renderDashboard();
  }
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------

async function renderDashboard() {
  viewRoot.innerHTML = `
    <div class="view view-dashboard">
      <div id="map" class="map"></div>
      <div class="dashboard-list" id="dashboard-list"></div>
    </div>
  `;
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
  initMap("map");
  // The #map div was just inserted; wait a layout pass so Leaflet reads its
  // real size (otherwise fitBounds miscalculates zoom against a 0x0 container).
  await new Promise((resolve) => requestAnimationFrame(resolve));
  mapInstance.invalidateSize();
  const records = await DBApi.allRecords();
  recentWorkItems = records
    .filter((r) => r.type === "workItem")
    .sort((a, b) => b.createdAt - a.createdAt);
  renderRecordsOnMap(records);

  const list = document.getElementById("dashboard-list");
  list.innerHTML = records
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 15)
    .map((r) => dashboardListItem(r))
    .join("") || `<div class="empty">No entries yet. Tap “+ New” to start a survey.</div>`;
}

function dashboardListItem(r) {
  const label =
    r.type === "workItem"
      ? WORK_ITEM_SCHEMAS[r.data.workType]?.label || r.data.workType
      : r.type === "droneFlight"
      ? "Drone Flight"
      : r.type === "photo"
      ? "Photo"
      : "Video";
  return `<div class="list-item">
    <span class="dot" style="background:${TYPE_COLORS[r.type] || "#334155"}"></span>
    <div class="list-item-body">
      <div class="list-item-title">${label}</div>
      <div class="list-item-sub">${new Date(r.createdAt).toLocaleString()}</div>
    </div>
    <span class="badge badge-${r.syncStatus}">${r.syncStatus}</span>
  </div>`;
}

// ---------------------------------------------------------------------
// New entry picker
// ---------------------------------------------------------------------

function renderEntryPicker() {
  viewRoot.innerHTML = `
    <div class="view view-picker">
      <h2>New Entry</h2>
      <button class="tile" data-goto="work-item-form">
        <span class="tile-icon tile-icon-a">📍</span>
        <span class="tile-text">
          <span class="tile-title">Work Item</span>
          <span class="tile-sub">Fencing, road, pipeline, well, excavation…</span>
        </span>
      </button>
      <button class="tile" data-goto="media-photo">
        <span class="tile-icon tile-icon-b">📷</span>
        <span class="tile-text">
          <span class="tile-title">Photo</span>
          <span class="tile-sub">Geo-tagged site photo</span>
        </span>
      </button>
      <button class="tile" data-goto="media-video">
        <span class="tile-icon tile-icon-b">🎥</span>
        <span class="tile-text">
          <span class="tile-title">Video</span>
          <span class="tile-sub">Geo-tagged walkthrough video</span>
        </span>
      </button>
      <button class="tile" data-goto="drone-import">
        <span class="tile-icon tile-icon-c">🚁</span>
        <span class="tile-text">
          <span class="tile-title">Drone Flight</span>
          <span class="tile-sub">Import DJI Air 3 .SRT telemetry</span>
        </span>
      </button>
    </div>
  `;
  viewRoot.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.goto));
  });
}

// ---------------------------------------------------------------------
// Geolocation helper
// ---------------------------------------------------------------------

function engineerProjectMeta() {
  const cfg = getConfig();
  return { engineerName: cfg.engineerName || null, projectName: cfg.projectName || null };
}

function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported on this device/browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      ...options,
    });
  });
}

// ---------------------------------------------------------------------
// Work item form
// ---------------------------------------------------------------------

function renderWorkItemForm() {
  viewRoot.innerHTML = `
    <div class="view view-form">
      <h2>New Work Item</h2>
      <div class="field-group">
        <label>Location</label>
        <div class="gps-row">
          <button id="capture-gps" class="btn-secondary">📍 Capture current location</button>
          <span id="gps-status" class="gps-status">Not captured</span>
        </div>
        <div class="two-col">
          <input id="wi-lat" type="number" step="any" placeholder="Latitude" />
          <input id="wi-lon" type="number" step="any" placeholder="Longitude" />
        </div>
      </div>

      <div class="field-group">
        <label>Work type</label>
        <select id="wi-type">
          ${WORK_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join("")}
        </select>
      </div>

      <div id="wi-fields"></div>

      <div class="field-group">
        <label>Notes</label>
        <textarea id="wi-notes" rows="3" placeholder="Additional detail…"></textarea>
      </div>

      <button id="wi-save" class="btn-primary">Save Work Item</button>
      <div id="wi-error" class="error"></div>
    </div>
  `;

  const typeSelect = document.getElementById("wi-type");
  const fieldsContainer = document.getElementById("wi-fields");

  function renderFields() {
    const schema = WORK_ITEM_SCHEMAS[typeSelect.value];
    fieldsContainer.innerHTML = schema.fields.map((f) => renderFieldHtml(f)).join("");
    if (typeSelect.value === "excavation") {
      fieldsContainer.innerHTML += `<details class="details-note">
        <summary>Regional geology reference</summary>
        <p class="geology-note">${PURANDAR_GEOLOGY_NOTES}</p>
      </details>`;
    }
    wireFieldEvents(fieldsContainer, schema);
  }

  typeSelect.addEventListener("change", renderFields);
  renderFields();

  document.getElementById("capture-gps").addEventListener("click", async () => {
    const status = document.getElementById("gps-status");
    status.textContent = "Locating…";
    try {
      const pos = await getCurrentPosition();
      document.getElementById("wi-lat").value = pos.coords.latitude.toFixed(6);
      document.getElementById("wi-lon").value = pos.coords.longitude.toFixed(6);
      status.textContent = `±${Math.round(pos.coords.accuracy)}m accuracy`;
    } catch (err) {
      status.textContent = `Failed: ${err.message}`;
    }
  });

  document.getElementById("wi-save").addEventListener("click", async () => {
    const errorEl = document.getElementById("wi-error");
    errorEl.textContent = "";
    const lat = parseFloat(document.getElementById("wi-lat").value);
    const lon = parseFloat(document.getElementById("wi-lon").value);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      errorEl.textContent = "Capture or enter a location first.";
      return;
    }
    const workType = typeSelect.value;
    const schema = WORK_ITEM_SCHEMAS[workType];
    const fields = collectFieldValues(fieldsContainer, schema);
    const missing = schema.fields.filter((f) => f.required && !fields[f.key]);
    if (missing.length) {
      errorEl.textContent = `Required: ${missing.map((f) => f.label).join(", ")}`;
      return;
    }

    const id = newId("wi");
    const record = {
      id,
      type: "workItem",
      latitude: lat,
      longitude: lon,
      createdAt: Date.now(),
      syncStatus: "pending",
      data: { workType, fields, notes: document.getElementById("wi-notes").value },
    };
    await DBApi.putRecord(record);
    await DBApi.enqueue({
      opType: "workItem",
      recordId: id,
      data: {
        id,
        latitude: lat,
        longitude: lon,
        workType,
        fields,
        notes: record.data.notes,
        capturedAt: new Date(record.createdAt).toISOString(),
        ...engineerProjectMeta(),
      },
    });
    syncNow();
    navigate("dashboard");
  });
}

function renderFieldHtml(f) {
  if (f.type === "select") {
    return `<div class="field-group" data-key="${f.key}">
      <label>${f.label}${f.required ? " *" : ""}</label>
      <select data-field="${f.key}">
        <option value="">Select…</option>
        ${f.options.map((o) => `<option value="${o.value}" title="${o.hint || ""}">${o.label}</option>`).join("")}
      </select>
      ${f.hint ? `<small class="hint">${f.hint}</small>` : ""}
    </div>`;
  }
  if (f.type === "unit-number") {
    return `<div class="field-group" data-key="${f.key}">
      <label>${f.label}${f.required ? " *" : ""}</label>
      <div class="two-col">
        <input type="number" step="any" data-field="${f.key}-value" placeholder="Value" />
        <select data-field="${f.key}-unit">
          ${LENGTH_UNITS.map((u) => `<option value="${u.value}">${u.label}</option>`).join("")}
        </select>
      </div>
      ${f.hint ? `<small class="hint">${f.hint}</small>` : ""}
    </div>`;
  }
  if (f.type === "diameter") {
    return `<div class="field-group" data-key="${f.key}">
      <label>${f.label}${f.required ? " *" : ""}</label>
      <select data-field="${f.key}"><option value="">Select material first…</option></select>
    </div>`;
  }
  return `<div class="field-group" data-key="${f.key}">
    <label>${f.label}${f.required ? " *" : ""}</label>
    <input type="text" data-field="${f.key}" />
  </div>`;
}

function wireFieldEvents(container, schema) {
  const materialSelect = container.querySelector('[data-field="material"]');
  const diameterSelect = container.querySelector('[data-field="diameter_in"]');
  if (materialSelect && diameterSelect) {
    materialSelect.addEventListener("change", () => {
      const sizes =
        materialSelect.value === "cement" ? CEMENT_PIPE_SIZES_IN : PLASTIC_PIPE_SIZES_IN;
      diameterSelect.innerHTML =
        `<option value="">Select…</option>` +
        sizes.map((s) => `<option value="${s}">${s}" (${inToMm(s)} mm)</option>`).join("");
    });
  }
}

function collectFieldValues(container, schema) {
  const out = {};
  for (const f of schema.fields) {
    if (f.type === "unit-number") {
      const value = container.querySelector(`[data-field="${f.key}-value"]`).value;
      const unit = container.querySelector(`[data-field="${f.key}-unit"]`).value;
      if (value) out[f.key] = { value: parseFloat(value), unit, meters: normalizeToMeters(value, unit) };
    } else if (f.type === "diameter") {
      const inches = parseFloat(container.querySelector(`[data-field="${f.key}"]`).value);
      if (!Number.isNaN(inches)) out[f.key] = { inches, mm: inToMm(inches) };
    } else {
      const val = container.querySelector(`[data-field="${f.key}"]`).value;
      if (val) out[f.key] = val;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Photo / Video capture
// ---------------------------------------------------------------------

function renderMediaCapture(kind) {
  const isPhoto = kind === "photo";
  viewRoot.innerHTML = `
    <div class="view view-form">
      <h2>${isPhoto ? "New Photo" : "New Video"}</h2>
      <div class="field-group">
        <label>${isPhoto ? "Capture / choose photo" : "Capture / choose video"}</label>
        <input id="media-file" type="file" accept="${isPhoto ? "image/*" : "video/*"}" capture="environment" />
      </div>
      <div id="media-preview"></div>

      <div class="field-group">
        <label>Location</label>
        <div class="gps-row">
          <button id="capture-gps" class="btn-secondary">📍 Use current location</button>
          <span id="gps-status" class="gps-status">Not captured</span>
        </div>
        <div class="two-col">
          <input id="m-lat" type="number" step="any" placeholder="Latitude" />
          <input id="m-lon" type="number" step="any" placeholder="Longitude" />
        </div>
      </div>

      <div class="field-group">
        <label>Link to work item (optional)</label>
        <select id="m-link">
          <option value="">None</option>
          ${recentWorkItems
            .slice(0, 25)
            .map(
              (w) =>
                `<option value="${w.id}">${WORK_ITEM_SCHEMAS[w.data.workType]?.label} — ${new Date(w.createdAt).toLocaleDateString()}</option>`
            )
            .join("")}
        </select>
      </div>

      <div id="manual-link-group" class="field-group" style="display:none">
        <label>Drive link (paste after manually uploading — file is larger than the auto-upload limit)</label>
        <input id="m-manual-url" type="text" placeholder="https://drive.google.com/…" />
      </div>

      <div class="field-group">
        <label>Notes</label>
        <textarea id="m-notes" rows="3"></textarea>
      </div>

      <button id="m-save" class="btn-primary">Save ${isPhoto ? "Photo" : "Video"}</button>
      <div id="m-error" class="error"></div>
    </div>
  `;

  let selectedFile = null;
  let exifResult = null;

  document.getElementById("media-file").addEventListener("change", async (e) => {
    selectedFile = e.target.files[0];
    if (!selectedFile) return;
    const preview = document.getElementById("media-preview");
    if (isPhoto) {
      const url = URL.createObjectURL(selectedFile);
      preview.innerHTML = `<img src="${url}" class="preview-img" />`;
      exifResult = await parseExifGps(selectedFile);
      if (exifResult && exifResult.latitude != null) {
        document.getElementById("m-lat").value = exifResult.latitude.toFixed(6);
        document.getElementById("m-lon").value = exifResult.longitude.toFixed(6);
        document.getElementById("gps-status").textContent = "From photo EXIF";
      }
    } else {
      preview.innerHTML = `<div class="file-chip">${selectedFile.name} (${(selectedFile.size / 1e6).toFixed(1)} MB)</div>`;
    }
    document.getElementById("manual-link-group").style.display =
      selectedFile.size > AUTO_UPLOAD_SIZE_LIMIT ? "block" : "none";
  });

  document.getElementById("capture-gps").addEventListener("click", async () => {
    const status = document.getElementById("gps-status");
    status.textContent = "Locating…";
    try {
      const pos = await getCurrentPosition();
      document.getElementById("m-lat").value = pos.coords.latitude.toFixed(6);
      document.getElementById("m-lon").value = pos.coords.longitude.toFixed(6);
      status.textContent = `±${Math.round(pos.coords.accuracy)}m accuracy`;
    } catch (err) {
      status.textContent = `Failed: ${err.message}`;
    }
  });

  document.getElementById("m-save").addEventListener("click", async () => {
    const errorEl = document.getElementById("m-error");
    errorEl.textContent = "";
    if (!selectedFile) {
      errorEl.textContent = "Choose or capture a file first.";
      return;
    }
    const lat = parseFloat(document.getElementById("m-lat").value);
    const lon = parseFloat(document.getElementById("m-lon").value);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      errorEl.textContent = "Location is required — capture GPS or use photo EXIF.";
      return;
    }

    const id = newId(isPhoto ? "photo" : "video");
    const manualUrl = document.getElementById("m-manual-url").value || null;
    const autoUpload = selectedFile.size <= AUTO_UPLOAD_SIZE_LIMIT;
    let fileId = null;
    if (autoUpload) {
      fileId = `${id}_file`;
      await DBApi.putFile(fileId, selectedFile, { fileName: selectedFile.name });
    }

    const record = {
      id,
      type: isPhoto ? "photo" : "video",
      latitude: lat,
      longitude: lon,
      createdAt: Date.now(),
      syncStatus: "pending",
      data: {
        notes: document.getElementById("m-notes").value,
        linkedWorkItemId: document.getElementById("m-link").value || null,
        manualDriveUrl: manualUrl,
        fileName: selectedFile.name,
      },
    };
    await DBApi.putRecord(record);
    await DBApi.enqueue({
      opType: "media",
      recordId: id,
      fileId,
      data: {
        id,
        mediaType: isPhoto ? "photo" : "video",
        latitude: lat,
        longitude: lon,
        capturedAt: new Date(record.createdAt).toISOString(),
        notes: record.data.notes,
        linkedWorkItemId: record.data.linkedWorkItemId,
        driveFolder: isPhoto ? "Photos" : "Videos",
        manualDriveUrl: manualUrl,
        fileName: selectedFile.name,
        ...engineerProjectMeta(),
      },
    });
    syncNow();
    navigate("dashboard");
  });
}

// ---------------------------------------------------------------------
// Drone flight import
// ---------------------------------------------------------------------

function renderDroneImport() {
  viewRoot.innerHTML = `
    <div class="view view-form">
      <h2>Import Drone Flight (DJI Air 3)</h2>
      <div class="field-group">
        <label>.SRT telemetry file</label>
        <input id="srt-file" type="file" accept=".srt,.SRT" />
      </div>
      <div id="srt-summary"></div>

      <div class="field-group">
        <label>Matching video filename (optional)</label>
        <input id="mp4-name" type="text" placeholder="DJI_20241221160950_0006_D.MP4" />
      </div>
      <div class="field-group">
        <label>Video Drive link (paste after you manually upload the .MP4 — drone videos are usually too large to auto-upload)</label>
        <input id="mp4-url" type="text" placeholder="https://drive.google.com/…" />
      </div>
      <div class="field-group">
        <label>Notes</label>
        <textarea id="df-notes" rows="3"></textarea>
      </div>

      <button id="df-save" class="btn-primary" disabled>Save Drone Flight</button>
      <div id="df-error" class="error"></div>
    </div>
  `;

  let parsed = null;
  let srtFile = null;

  document.getElementById("srt-file").addEventListener("change", async (e) => {
    srtFile = e.target.files[0];
    if (!srtFile) return;
    const summaryEl = document.getElementById("srt-summary");
    const errorEl = document.getElementById("df-error");
    errorEl.textContent = "";
    try {
      const text = await srtFile.text();
      parsed = parseDjiSrt(text);
      const s = parsed.summary;
      summaryEl.innerHTML = `<div class="summary-card">
        <div><b>Frames:</b> ${s.frameCount}</div>
        <div><b>Duration:</b> ${s.durationSec}s</div>
        <div><b>Start:</b> ${s.startTime}</div>
        <div><b>Start position:</b> ${s.startLatLon[0].toFixed(6)}, ${s.startLatLon[1].toFixed(6)}</div>
        <div><b>Rel altitude:</b> ${s.relAlt.min}–${s.relAlt.max} m (avg ${s.relAlt.avg})</div>
        <div><b>Abs altitude:</b> ${s.absAlt.min}–${s.absAlt.max} m</div>
      </div>`;
      document.getElementById("mp4-name").value = srtFile.name.replace(/\.srt$/i, ".MP4");
      document.getElementById("df-save").disabled = false;
      if (mapInstance) {
        L.polyline(parsed.simplifiedPath, { color: TYPE_COLORS.droneFlight }).addTo(
          L.layerGroup().addTo(mapInstance)
        );
      }
    } catch (err) {
      errorEl.textContent = err.message;
      document.getElementById("df-save").disabled = true;
    }
  });

  document.getElementById("df-save").addEventListener("click", async () => {
    if (!parsed) return;
    const id = newId("drone");
    const fileId = `${id}_srt`;
    await DBApi.putFile(fileId, srtFile, { fileName: srtFile.name });

    const record = {
      id,
      type: "droneFlight",
      createdAt: Date.now(),
      syncStatus: "pending",
      data: {
        summary: parsed.summary,
        simplifiedPath: parsed.simplifiedPath,
        srtFileName: srtFile.name,
        mp4FileName: document.getElementById("mp4-name").value,
        mp4DriveUrl: document.getElementById("mp4-url").value || null,
        notes: document.getElementById("df-notes").value,
      },
    };
    await DBApi.putRecord(record);
    await DBApi.enqueue({
      opType: "droneFlight",
      recordId: id,
      fileId,
      data: {
        id,
        summary: parsed.summary,
        path: parsed.simplifiedPath,
        srtFileName: srtFile.name,
        mp4FileName: record.data.mp4FileName,
        mp4DriveUrl: record.data.mp4DriveUrl,
        notes: record.data.notes,
        capturedAt: new Date(record.createdAt).toISOString(),
        ...engineerProjectMeta(),
      },
    });
    syncNow();
    navigate("dashboard");
  });
}

// ---------------------------------------------------------------------
// Sync view
// ---------------------------------------------------------------------

async function renderSyncView() {
  const queue = await DBApi.allQueue();
  viewRoot.innerHTML = `
    <div class="view view-sync">
      <h2>Sync</h2>
      <div class="sync-summary">
        <div>${navigator.onLine ? "🟢 Online" : "🔴 Offline"}</div>
        <div>${queue.length} item(s) pending</div>
      </div>
      <button id="sync-now" class="btn-primary">Sync Now</button>
      <div class="queue-list">
        ${queue
          .map(
            (op) => `<div class="list-item">
          <div class="list-item-body">
            <div class="list-item-title">${op.opType}</div>
            <div class="list-item-sub">${op.attempts ? `Failed ${op.attempts}x: ${op.lastError}` : "Waiting to sync"}</div>
          </div>
        </div>`
          )
          .join("") || `<div class="empty">Queue is empty — everything is synced.</div>`}
      </div>
    </div>
  `;
  document.getElementById("sync-now").addEventListener("click", async () => {
    await syncNow();
    renderSyncView();
  });
}

onSyncChange(async () => {
  const count = await pendingCount();
  syncBadge.textContent = syncing ? "⇅ Syncing…" : count > 0 ? `⇅ ${count}` : "✓ Synced";
  syncBadge.className = "sync-badge" + (syncing ? " syncing" : count > 0 ? " pending" : " ok");
  if (currentView === "sync") renderSyncView();
  if (currentView === "dashboard") renderDashboard();
});

syncBadge.addEventListener("click", syncNow);

// ---------------------------------------------------------------------
// "Who are you?" onboarding modal — replaces a dedicated Settings screen.
// Shown automatically on first launch (no engineer name saved yet), and
// reopenable any time via tapping the header brand.
// ---------------------------------------------------------------------

const whoAreYouOverlay = document.getElementById("whoareyou-overlay");

function openWhoAreYou() {
  const cfg = getConfig();
  document.getElementById("way-engineer").value = cfg.engineerName || "";
  document.getElementById("way-project").value = cfg.projectName || "";
  whoAreYouOverlay.hidden = false;
}

function closeWhoAreYou() {
  whoAreYouOverlay.hidden = true;
}

document.getElementById("brand-button").addEventListener("click", openWhoAreYou);

document.getElementById("way-save").addEventListener("click", () => {
  setConfig({
    ...getConfig(),
    engineerName: document.getElementById("way-engineer").value.trim(),
    projectName: document.getElementById("way-project").value.trim(),
  });
  closeWhoAreYou();
});

document.getElementById("way-skip").addEventListener("click", closeWhoAreYou);

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

navigate("dashboard");
syncNow();

if (!getConfig().engineerName) {
  openWhoAreYou();
}
