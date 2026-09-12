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
  // Check-in selfies are attendance records, not survey data — keep them off the map/list.
  const records = (await DBApi.allRecords()).filter((r) => r.type !== "login");
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
  syncBadge.textContent = syncing ? "" : count > 0 ? String(count > 9 ? "9+" : count) : "";
  syncBadge.className = "nav-badge" + (syncing ? " syncing" : count > 0 ? " pending" : " ok");
  syncBadge.title = syncing ? "Syncing…" : count > 0 ? `${count} item(s) pending` : "All synced";
  if (currentView === "sync") renderSyncView();
  if (currentView === "dashboard") renderDashboard();
});

// ---------------------------------------------------------------------
// Field check-in — mandatory every time the app opens. Captures a live
// front-camera photo (no file picker — camera stream only) and the
// engineer's name, while silently grabbing a current GPS fix in the
// background. Not dismissible without completing both.
// ---------------------------------------------------------------------

const checkinOverlay = document.getElementById("checkin-overlay");
const checkinVideo = document.getElementById("checkin-video");
const checkinCanvas = document.getElementById("checkin-canvas");
const checkinStatus = document.getElementById("checkin-camera-status");
const checkinError = document.getElementById("checkin-error");
const wayEmployeeIdInput = document.getElementById("way-employee-id");
const wayPasswordInput = document.getElementById("way-password");
const wayProjectInput = document.getElementById("way-project");
const waySaveBtn = document.getElementById("way-save");

let checkinStream = null;
let checkinLocation = null;
let cameraReady = false;

function updateCheckinSaveEnabled() {
  waySaveBtn.disabled = !(
    cameraReady &&
    wayEmployeeIdInput.value.trim().length > 0 &&
    wayPasswordInput.value.length > 0
  );
}

async function startCheckinCamera() {
  cameraReady = false;
  updateCheckinSaveEnabled();
  checkinStatus.hidden = false;
  checkinStatus.classList.remove("camera-status-error");
  checkinStatus.textContent = "Starting camera…";
  try {
    checkinStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    checkinVideo.srcObject = checkinStream;
    await checkinVideo.play().catch(() => {});
    cameraReady = true;
    checkinStatus.hidden = true;
  } catch (err) {
    checkinStatus.textContent =
      "Camera access is required to check in. Please allow camera access and retry.";
    checkinStatus.classList.add("camera-status-error");
  }
  updateCheckinSaveEnabled();
}

function stopCheckinCamera() {
  if (checkinStream) {
    checkinStream.getTracks().forEach((t) => t.stop());
    checkinStream = null;
  }
  checkinVideo.srcObject = null;
}

function requestCheckinLocation() {
  checkinLocation = null;
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      checkinLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
    },
    () => {
      checkinLocation = null;
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

function openCheckin() {
  const cfg = getConfig();
  wayEmployeeIdInput.value = cfg.employeeId || "";
  wayPasswordInput.value = "";
  wayProjectInput.value = cfg.projectName || "";
  checkinError.textContent = "";
  checkinOverlay.hidden = false;
  requestCheckinLocation();
  startCheckinCamera();
  updateCheckinSaveEnabled();
}

function closeCheckin() {
  checkinOverlay.hidden = true;
  stopCheckinCamera();
}

document.getElementById("brand-button").addEventListener("click", openCheckin);
wayEmployeeIdInput.addEventListener("input", updateCheckinSaveEnabled);
wayPasswordInput.addEventListener("input", updateCheckinSaveEnabled);
document.getElementById("checkin-camera-status").addEventListener("click", () => {
  if (!cameraReady) startCheckinCamera();
});

waySaveBtn.addEventListener("click", async () => {
  const employeeId = wayEmployeeIdInput.value.trim().toUpperCase();
  const password = wayPasswordInput.value;
  if (!employeeId || !password) {
    checkinError.textContent = "Employee code and password are required.";
    return;
  }
  if (!cameraReady) {
    checkinError.textContent = "Camera isn't ready yet — allow camera access to continue.";
    return;
  }
  checkinError.className = "hint";
  checkinError.textContent = "Verifying…";
  waySaveBtn.disabled = true;

  let employee;
  try {
    employee = await authenticateEmployee(employeeId, password);
  } catch (err) {
    checkinError.className = "hint error";
    checkinError.textContent = err.message;
    updateCheckinSaveEnabled();
    return;
  }
  checkinError.textContent = "";

  const w = checkinVideo.videoWidth || 480;
  const h = checkinVideo.videoHeight || 480;
  checkinCanvas.width = w;
  checkinCanvas.height = h;
  checkinCanvas.getContext("2d").drawImage(checkinVideo, 0, 0, w, h);
  const blob = await new Promise((resolve) =>
    checkinCanvas.toBlob(resolve, "image/jpeg", 0.85)
  );

  const projectName = wayProjectInput.value.trim();
  setConfig({
    ...getConfig(),
    employeeId: employee.employeeId,
    engineerName: employee.name,
    projectName,
  });

  const id = newId("login");
  const fileId = blob ? `${id}_photo` : null;
  if (blob && fileId) {
    await DBApi.putFile(fileId, blob, { fileName: `${id}.jpg` });
  }
  const loc = checkinLocation || {};
  const record = {
    id,
    type: "login",
    createdAt: Date.now(),
    syncStatus: "pending",
    data: { employeeId: employee.employeeId, engineerName: employee.name, projectName, ...loc },
  };
  await DBApi.putRecord(record);
  await DBApi.enqueue({
    opType: "login",
    recordId: id,
    fileId,
    data: {
      id,
      capturedAt: new Date(record.createdAt).toISOString(),
      employeeId: employee.employeeId,
      engineerName: employee.name,
      projectName,
      latitude: loc.latitude ?? null,
      longitude: loc.longitude ?? null,
      accuracy: loc.accuracy ?? null,
    },
  });
  syncNow();

  closeCheckin();
});

// ---------------------------------------------------------------------
// Admin mode — restricted to the AOAID0001 account. Reached via a link on
// the check-in screen (no camera/photo needed for admin actions). Every
// privileged call re-sends the admin's employee code + password so the
// backend re-verifies authorization on each request; the password only
// ever lives in memory for the duration of the admin session.
// ---------------------------------------------------------------------

let adminSession = null; // { employeeId, password, users }
let adminPanelMode = "list"; // 'list' | 'add' | 'edit'
let adminEditingUser = null;

function openAdminLogin() {
  closeCheckin();
  document.getElementById("admin-login-id").value = "";
  document.getElementById("admin-login-password").value = "";
  document.getElementById("admin-login-error").textContent = "";
  document.getElementById("admin-login-overlay").hidden = false;
}

function closeAdminLogin() {
  document.getElementById("admin-login-overlay").hidden = true;
}

document.getElementById("way-admin-link").addEventListener("click", openAdminLogin);
document.getElementById("admin-login-back").addEventListener("click", () => {
  closeAdminLogin();
  openCheckin();
});

document.getElementById("admin-login-submit").addEventListener("click", async () => {
  const employeeId = document.getElementById("admin-login-id").value.trim();
  const password = document.getElementById("admin-login-password").value;
  const errorEl = document.getElementById("admin-login-error");
  if (!employeeId || !password) {
    errorEl.textContent = "Employee code and password are required.";
    return;
  }
  errorEl.textContent = "";
  const btn = document.getElementById("admin-login-submit");
  btn.disabled = true;
  try {
    const users = await adminListUsers(employeeId, password);
    adminSession = { employeeId: employeeId.trim().toUpperCase(), password, users };
    closeAdminLogin();
    adminPanelMode = "list";
    openAdminPanel();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

function openAdminPanel() {
  document.getElementById("admin-panel-overlay").hidden = false;
  renderAdminPanel();
}

function closeAdminPanel() {
  document.getElementById("admin-panel-overlay").hidden = true;
  adminSession = null;
  openCheckin();
}

async function refreshAdminUsers() {
  adminSession.users = await adminListUsers(adminSession.employeeId, adminSession.password);
}

function renderAdminPanel() {
  const container = document.getElementById("admin-panel-content");

  if (adminPanelMode === "list") {
    container.innerHTML = `
      <div class="admin-panel-header">
        <h2>Admin Panel</h2>
        <button id="admin-exit" class="link-button" type="button">Exit</button>
      </div>
      <button id="admin-add-user-btn" class="btn-primary">+ Add User</button>
      <div id="admin-users-list">
        ${adminSession.users.map((u) => adminUserRow(u)).join("")}
      </div>
      <h3>Change my password</h3>
      <div class="field-group">
        <label>Current password</label>
        <input id="admin-pw-current" type="password" autocomplete="off" />
      </div>
      <div class="field-group">
        <label>New password (min 6 characters)</label>
        <input id="admin-pw-new" type="password" autocomplete="off" />
      </div>
      <div id="admin-pw-error" class="hint error"></div>
      <div id="admin-pw-success" class="hint success"></div>
      <button id="admin-pw-submit" class="btn-secondary">Update Password</button>
    `;
    document.getElementById("admin-exit").addEventListener("click", closeAdminPanel);
    document.getElementById("admin-add-user-btn").addEventListener("click", () => {
      adminPanelMode = "add";
      adminEditingUser = null;
      renderAdminPanel();
    });
    container.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        adminEditingUser = adminSession.users.find((u) => u.employeeId === btn.dataset.edit);
        adminPanelMode = "edit";
        renderAdminPanel();
      });
    });
    container.querySelectorAll("[data-suspend]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const emp = btn.dataset.suspend;
        const user = adminSession.users.find((u) => u.employeeId === emp);
        const newStatus = user.status === "suspended" ? "active" : "suspended";
        btn.disabled = true;
        try {
          await adminSetStatus(adminSession.employeeId, adminSession.password, emp, newStatus);
          await refreshAdminUsers();
          renderAdminPanel();
        } catch (err) {
          window.alert(err.message);
          btn.disabled = false;
        }
      });
    });
    container.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const emp = btn.dataset.delete;
        if (!window.confirm(`Delete user ${emp}? This can't be undone.`)) return;
        btn.disabled = true;
        try {
          await adminDeleteUser(adminSession.employeeId, adminSession.password, emp);
          await refreshAdminUsers();
          renderAdminPanel();
        } catch (err) {
          window.alert(err.message);
          btn.disabled = false;
        }
      });
    });
    document.getElementById("admin-pw-submit").addEventListener("click", async () => {
      const current = document.getElementById("admin-pw-current").value;
      const next = document.getElementById("admin-pw-new").value;
      const errEl = document.getElementById("admin-pw-error");
      const okEl = document.getElementById("admin-pw-success");
      errEl.textContent = "";
      okEl.textContent = "";
      try {
        await changeOwnPassword(adminSession.employeeId, current, next);
        adminSession.password = next;
        okEl.textContent = "Password updated.";
        document.getElementById("admin-pw-current").value = "";
        document.getElementById("admin-pw-new").value = "";
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  } else {
    const isEdit = adminPanelMode === "edit";
    const u = adminEditingUser || {};
    const isSelf = isEdit && u.employeeId === adminSession.employeeId;
    container.innerHTML = `
      <div class="admin-panel-header">
        <h2>${isEdit ? "Edit User" : "Add User"}</h2>
        <button id="admin-form-back" class="link-button" type="button">Back</button>
      </div>
      <div class="field-group">
        <label>Employee ID${isEdit ? "" : ' <span class="required">*</span>'}</label>
        <input id="admin-form-id" type="text" value="${u.employeeId || ""}" ${isEdit ? "disabled" : ""} autocapitalize="characters" />
      </div>
      <div class="field-group">
        <label>Name</label>
        <input id="admin-form-name" type="text" value="${u.name ? escapeHtml(u.name) : ""}" />
      </div>
      <div class="field-group">
        <label>Mobile number</label>
        <input id="admin-form-mobile" type="text" value="${u.mobileNumber ? escapeHtml(u.mobileNumber) : ""}" />
      </div>
      ${
        isSelf
          ? `<p class="hint">Use "Change my password" on the previous screen to update your own password.</p>`
          : `<div class="field-group">
              <label>${isEdit ? "New password (leave blank to keep current)" : "Password"}${isEdit ? "" : ' <span class="required">*</span>'}</label>
              <input id="admin-form-password" type="password" autocomplete="off" />
            </div>`
      }
      <div id="admin-form-error" class="hint error"></div>
      <button id="admin-form-submit" class="btn-primary">${isEdit ? "Save Changes" : "Add User"}</button>
    `;
    document.getElementById("admin-form-back").addEventListener("click", () => {
      adminPanelMode = "list";
      renderAdminPanel();
    });
    document.getElementById("admin-form-submit").addEventListener("click", async () => {
      const errEl = document.getElementById("admin-form-error");
      errEl.textContent = "";
      const employeeId = document.getElementById("admin-form-id").value.trim();
      const name = document.getElementById("admin-form-name").value.trim();
      const mobileNumber = document.getElementById("admin-form-mobile").value.trim();
      const passwordField = document.getElementById("admin-form-password");
      const password = passwordField ? passwordField.value : "";
      const btn = document.getElementById("admin-form-submit");
      btn.disabled = true;
      try {
        if (isEdit) {
          await adminEditUser(adminSession.employeeId, adminSession.password, {
            employeeId: u.employeeId,
            name,
            mobileNumber,
            ...(password ? { password } : {}),
          });
        } else {
          if (!employeeId) throw new Error("Employee ID is required.");
          if (!password) throw new Error("Password is required.");
          await adminAddUser(adminSession.employeeId, adminSession.password, {
            employeeId,
            name,
            mobileNumber,
            password,
          });
        }
        await refreshAdminUsers();
        adminPanelMode = "list";
        renderAdminPanel();
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  }
}

function adminUserRow(u) {
  const isSelf = u.employeeId === adminSession.employeeId;
  const statusBadgeClass = u.status === "suspended" ? "badge-error" : "badge-synced";
  return `<div class="list-item">
    <div class="list-item-body">
      <div class="list-item-title">${escapeHtml(u.name || "(no name)")} <span class="hint">${u.employeeId}</span></div>
      <div class="list-item-sub">${escapeHtml(u.mobileNumber || "No mobile on file")}</div>
    </div>
    <span class="badge ${statusBadgeClass}">${u.status}</span>
    <button class="icon-btn" data-edit="${u.employeeId}" title="Edit">✏️</button>
    ${
      isSelf
        ? ""
        : `<button class="icon-btn" data-suspend="${u.employeeId}" title="${u.status === "suspended" ? "Reactivate" : "Suspend"}">${u.status === "suspended" ? "▶️" : "⏸️"}</button>
           <button class="icon-btn" data-delete="${u.employeeId}" title="Delete">🗑️</button>`
    }
  </div>`;
}

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
openCheckin();
