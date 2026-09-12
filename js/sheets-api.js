// Client for the companion Google Apps Script Web App (apps-script/Code.gs).
// Uses text/plain request bodies so the browser sends a CORS "simple
// request" and skips the OPTIONS preflight that Apps Script doesn't handle.

const CONFIG_KEY = "ssm_config";

// Backend is pre-provisioned for this deployment — no setup screen needed.
// These placeholders are substituted at deploy time by
// .github/workflows/deploy.yml, which reads the real values from this
// repo's Actions secret (SSM_TOKEN) and variable (SSM_WEB_APP_URL) — the
// actual values are never committed to source control. For local dev,
// override them via `setConfig({...getConfig(), webAppUrl, token})` in the
// browser console.
const DEFAULT_WEB_APP_URL = "__SSM_WEB_APP_URL__";
const DEFAULT_TOKEN = "__SSM_TOKEN__";

function getConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch {
    saved = {};
  }
  return {
    webAppUrl: saved.webAppUrl || DEFAULT_WEB_APP_URL,
    token: saved.token || DEFAULT_TOKEN,
    employeeId: saved.employeeId || "",
    engineerName: saved.engineerName || "",
    projectName: saved.projectName || "",
  };
}

function setConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function isConfigured() {
  return true;
}

async function callAppsScript(action, payload) {
  const cfg = getConfig();
  if (!cfg.webAppUrl || !cfg.token) {
    throw new Error("App not configured — set the Apps Script Web App URL and token in Settings.");
  }
  const res = await fetch(cfg.webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, token: cfg.token, payload }),
  });
  if (!res.ok) {
    throw new Error(`Server error ${res.status}`);
  }
  const json = await res.json();
  if (!json.ok) {
    throw new Error(json.error || "Unknown server error");
  }
  return json.data;
}

// ---- Authentication / admin (direct calls, not queued — these need an
// immediate answer, and only work online since verification happens on
// the backend against the Users sheet) ---------------------------------

async function authenticateEmployee(employeeId, password) {
  return callAppsScript("authenticate", { employeeId, password });
}

async function changeOwnPassword(employeeId, currentPassword, newPassword) {
  return callAppsScript("changeOwnPassword", { employeeId, currentPassword, newPassword });
}

async function adminListUsers(adminEmployeeId, adminPassword) {
  const data = await callAppsScript("adminListUsers", { adminEmployeeId, adminPassword });
  return data.users;
}

async function adminAddUser(adminEmployeeId, adminPassword, user) {
  return callAppsScript("adminAddUser", { adminEmployeeId, adminPassword, ...user });
}

async function adminEditUser(adminEmployeeId, adminPassword, user) {
  return callAppsScript("adminEditUser", { adminEmployeeId, adminPassword, ...user });
}

async function adminSetStatus(adminEmployeeId, adminPassword, employeeId, status) {
  return callAppsScript("adminSetStatus", { adminEmployeeId, adminPassword, employeeId, status });
}

async function adminDeleteUser(adminEmployeeId, adminPassword, employeeId) {
  return callAppsScript("adminDeleteUser", { adminEmployeeId, adminPassword, employeeId });
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---- Sync engine -----------------------------------------------------

let syncing = false;
const syncListeners = [];
function onSyncChange(fn) {
  syncListeners.push(fn);
}
function notifySyncChange() {
  syncListeners.forEach((fn) => fn());
}

async function syncNow() {
  if (syncing) return;
  if (!isConfigured() || !navigator.onLine) {
    notifySyncChange();
    return;
  }

  syncing = true;
  notifySyncChange();
  try {
    const queue = await DBApi.allQueue();
    // Oldest first, stable order via queueId
    queue.sort((a, b) => a.queueId - b.queueId);

    for (const op of queue) {
      try {
        await processQueueOp(op);
        await DBApi.removeQueueItem(op.queueId);
        const record = await DBApi.getRecord(op.recordId);
        if (record) {
          record.syncStatus = "synced";
          record.syncError = null;
          await DBApi.putRecord(record);
        }
      } catch (err) {
        op.attempts = (op.attempts || 0) + 1;
        op.lastError = String(err.message || err);
        await DBApi.updateQueueItem(op);
        const record = await DBApi.getRecord(op.recordId);
        if (record) {
          record.syncStatus = "error";
          record.syncError = op.lastError;
          await DBApi.putRecord(record);
        }
        console.warn("Sync op failed", op, err);
      }
      notifySyncChange();
    }
  } finally {
    syncing = false;
    notifySyncChange();
  }
}

async function processQueueOp(op) {
  if (op.opType === "login") {
    let photoDriveUrl = null;
    if (op.fileId) {
      const fileRow = await DBApi.getFile(op.fileId);
      if (fileRow) {
        const driveResult = await callAppsScript("uploadFile", {
          folder: "CheckIns",
          base64: await blobToBase64(fileRow.blob),
          mimeType: fileRow.blob.type || "image/jpeg",
          fileName: fileRow.meta.fileName,
        });
        photoDriveUrl = driveResult.url;
      }
    }
    await callAppsScript("addLogin", { ...op.data, photoDriveUrl });
  } else if (op.opType === "workItem") {
    await callAppsScript("addWorkItem", op.data);
  } else if (op.opType === "media") {
    let fileData = null;
    if (op.fileId) {
      const fileRow = await DBApi.getFile(op.fileId);
      if (fileRow) {
        fileData = {
          base64: await blobToBase64(fileRow.blob),
          mimeType: fileRow.blob.type,
          fileName: fileRow.meta.fileName,
        };
      }
    }
    const driveResult = fileData
      ? await callAppsScript("uploadFile", {
          folder: op.data.driveFolder || "Photos",
          ...fileData,
        })
      : null;
    await callAppsScript("addMedia", {
      ...op.data,
      driveFileUrl: driveResult ? driveResult.url : null,
    });
  } else if (op.opType === "droneFlight") {
    let srtDriveUrl = null;
    if (op.fileId) {
      const fileRow = await DBApi.getFile(op.fileId);
      if (fileRow) {
        const driveResult = await callAppsScript("uploadFile", {
          folder: "DroneFlights",
          base64: await blobToBase64(fileRow.blob),
          mimeType: fileRow.blob.type || "text/plain",
          fileName: fileRow.meta.fileName,
        });
        srtDriveUrl = driveResult.url;
      }
    }
    await callAppsScript("addDroneFlight", { ...op.data, srtDriveUrl });
  } else {
    throw new Error(`Unknown queue op type: ${op.opType}`);
  }
}

async function pendingCount() {
  const queue = await DBApi.allQueue();
  return queue.length;
}

window.addEventListener("online", () => {
  syncNow();
});
