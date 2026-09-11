// Client for the companion Google Apps Script Web App (apps-script/Code.gs).
// Uses text/plain request bodies so the browser sends a CORS "simple
// request" and skips the OPTIONS preflight that Apps Script doesn't handle.

const CONFIG_KEY = "ssm_config";

function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch {
    return {};
  }
}

function setConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function isConfigured() {
  const cfg = getConfig();
  return !!(cfg.webAppUrl && cfg.token);
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
  if (op.opType === "workItem") {
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
