// Minimal IndexedDB wrapper. Stores three object stores:
//  - records   : all captured records (work items, media, drone flights) — local source of truth for the map/list UI
//  - queue     : pending sync operations (references a record by id)
//  - files     : raw Blob storage for photos/videos/SRT keyed by fileId
//
// Everything is offline-first: writes go here immediately; sheets-api.js
// drains `queue` whenever the app is online.

const DB_NAME = "site-survey-mapper";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath: "id" });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("syncStatus", "syncStatus", { unique: false });
      }
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "queueId", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "fileId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let _dbPromise = null;
function db() {
  if (!_dbPromise) _dbPromise = openDb();
  return _dbPromise;
}

function tx(storeNames, mode) {
  return db().then((d) => d.transaction(storeNames, mode));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DBApi = {
  async putRecord(record) {
    const t = await tx(["records"], "readwrite");
    t.objectStore("records").put(record);
    return reqToPromise(t.objectStore("records").get(record.id));
  },

  async getRecord(id) {
    const t = await tx(["records"], "readonly");
    return reqToPromise(t.objectStore("records").get(id));
  },

  async allRecords() {
    const t = await tx(["records"], "readonly");
    return reqToPromise(t.objectStore("records").getAll());
  },

  async recordsByType(type) {
    const t = await tx(["records"], "readonly");
    return reqToPromise(t.objectStore("records").index("type").getAll(type));
  },

  async enqueue(op) {
    const t = await tx(["queue"], "readwrite");
    const store = t.objectStore("queue");
    const addReq = store.add(op);
    return reqToPromise(addReq);
  },

  async allQueue() {
    const t = await tx(["queue"], "readonly");
    return reqToPromise(t.objectStore("queue").getAll());
  },

  async removeQueueItem(queueId) {
    const t = await tx(["queue"], "readwrite");
    t.objectStore("queue").delete(queueId);
  },

  async updateQueueItem(item) {
    const t = await tx(["queue"], "readwrite");
    t.objectStore("queue").put(item);
  },

  async putFile(fileId, blob, meta) {
    const t = await tx(["files"], "readwrite");
    t.objectStore("files").put({ fileId, blob, meta: meta || {} });
  },

  async getFile(fileId) {
    const t = await tx(["files"], "readonly");
    return reqToPromise(t.objectStore("files").get(fileId));
  },
};

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
