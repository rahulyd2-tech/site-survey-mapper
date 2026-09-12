/**
 * Site Survey Mapper — Apps Script backend.
 *
 * Deploy: open the target Google Sheet -> Extensions > Apps Script, paste
 * this file in as Code.gs, run setup() once (see below), then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone
 * with the link). Copy the /exec URL into the SPA's Settings screen along
 * with the token you set in setup().
 *
 * See ../README.md for the full walkthrough.
 */

const SHEET_USERS = "Users";
const SHEET_WORK_ITEMS = "WorkItems";
const SHEET_MEDIA = "Media";
const SHEET_DRONE_FLIGHTS = "DroneFlights";
const SHEET_LOGINS = "Logins";

const ADMIN_EMPLOYEE_ID = "AOAID0001";

const HEADERS = {
  [SHEET_USERS]: [
    "employeeId", "name", "mobileNumber", "passwordSalt", "passwordHash",
    "role", "status", "createdAt", "updatedAt",
  ],
  [SHEET_LOGINS]: [
    "id", "capturedAt", "receivedAt", "engineerName", "projectName",
    "latitude", "longitude", "accuracy", "photoDriveUrl", "employeeId",
  ],
  [SHEET_WORK_ITEMS]: [
    "id", "capturedAt", "receivedAt", "engineerName", "projectName",
    "workType", "latitude", "longitude", "fieldsJson", "notes",
  ],
  [SHEET_MEDIA]: [
    "id", "capturedAt", "receivedAt", "engineerName", "projectName",
    "mediaType", "latitude", "longitude", "driveFileUrl", "manualDriveUrl",
    "linkedWorkItemId", "fileName", "notes",
  ],
  [SHEET_DRONE_FLIGHTS]: [
    "id", "capturedAt", "receivedAt", "engineerName", "projectName",
    "frameCount", "durationSec", "startTime", "endTime",
    "startLat", "startLon", "endLat", "endLon",
    "bboxMinLat", "bboxMaxLat", "bboxMinLon", "bboxMaxLon",
    "relAltMin", "relAltMax", "relAltAvg", "absAltMin", "absAltMax", "absAltAvg",
    "pathJson", "srtFileName", "srtDriveUrl", "mp4FileName", "mp4DriveUrl", "notes",
  ],
};

/**
 * Run this once from the Apps Script editor (select `setup` in the function
 * dropdown, click Run) before deploying. Prompts nothing — edit the two
 * constants below first. Safe to re-run later: it won't duplicate the
 * seeded users or re-create sheets that already exist.
 */
function setup() {
  const TOKEN = "CHANGE-ME-TO-A-LONG-RANDOM-STRING";
  const props = PropertiesService.getScriptProperties();
  props.setProperty("TOKEN", TOKEN);

  if (!props.getProperty("DRIVE_ROOT_FOLDER_ID")) {
    const rootFolder = DriveApp.getRootFolder()
      .createFolder("Site Survey Mapper Uploads");
    props.setProperty("DRIVE_ROOT_FOLDER_ID", rootFolder.getId());
  }

  ensureSheets_();
  // Edit these two placeholder passwords before running setup(), then you
  // can blank them out again (or leave them — they're only read once, the
  // first time each employee ID is seeded; re-running setup() is a no-op
  // for users that already exist).
  seedUser_(ADMIN_EMPLOYEE_ID, "Admin", "", "CHANGE-ME-ADMIN-PASSWORD", "admin");
  seedUser_("AOAID0103", "Hemant Jadhav", "", "CHANGE-ME-FIELD-PASSWORD", "field");

  Logger.log("Setup complete. Token: %s", TOKEN);
}

function ensureSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const name of Object.keys(HEADERS)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS[name]);
      sheet.setFrozenRows(1);
    }
  }
}

function doGet(e) {
  return jsonResponse_({ ok: true, data: { status: "Site Survey Mapper backend is running." } });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty("TOKEN");
    if (!token || body.token !== token) {
      return jsonResponse_({ ok: false, error: "Invalid token." });
    }

    ensureSheets_();

    switch (body.action) {
      case "ping":
        return jsonResponse_({ ok: true, data: {} });
      case "authenticate":
        return jsonResponse_({ ok: true, data: authenticate_(body.payload) });
      case "changeOwnPassword":
        return jsonResponse_({ ok: true, data: changeOwnPassword_(body.payload) });
      case "adminListUsers":
        return jsonResponse_({ ok: true, data: adminListUsers_(body.payload) });
      case "adminAddUser":
        return jsonResponse_({ ok: true, data: adminAddUser_(body.payload) });
      case "adminEditUser":
        return jsonResponse_({ ok: true, data: adminEditUser_(body.payload) });
      case "adminSetStatus":
        return jsonResponse_({ ok: true, data: adminSetStatus_(body.payload) });
      case "adminDeleteUser":
        return jsonResponse_({ ok: true, data: adminDeleteUser_(body.payload) });
      case "addLogin":
        return jsonResponse_({ ok: true, data: addLogin_(body.payload) });
      case "addWorkItem":
        return jsonResponse_({ ok: true, data: addWorkItem_(body.payload) });
      case "addMedia":
        return jsonResponse_({ ok: true, data: addMedia_(body.payload) });
      case "addDroneFlight":
        return jsonResponse_({ ok: true, data: addDroneFlight_(body.payload) });
      case "uploadFile":
        return jsonResponse_({ ok: true, data: uploadFile_(body.payload) });
      default:
        return jsonResponse_({ ok: false, error: `Unknown action: ${body.action}` });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

// ---------------------------------------------------------------------
// Users / authentication / admin
// ---------------------------------------------------------------------

function generateSalt_() {
  return Utilities.getUuid();
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ":" + password);
  return bytes
    .map((b) => {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    })
    .join("");
}

function findUserRow_(employeeId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf("employeeId");
  const needle = String(employeeId || "").trim().toUpperCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim().toUpperCase() === needle) {
      return { rowIndex: i + 1, headers, row: data[i] };
    }
  }
  return null;
}

function userRowToObject_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => (obj[h] = row[i]));
  return obj;
}

function verifyUserPassword_(employeeId, password) {
  const found = findUserRow_(employeeId);
  if (!found) return null;
  const user = userRowToObject_(found.headers, found.row);
  if (hashPassword_(password || "", user.passwordSalt) !== user.passwordHash) return null;
  return { user, rowIndex: found.rowIndex, headers: found.headers };
}

function requireAdmin_(adminEmployeeId, adminPassword) {
  const verified = verifyUserPassword_(adminEmployeeId, adminPassword);
  if (!verified) throw new Error("Admin authentication failed.");
  if (String(verified.user.employeeId).toUpperCase() !== ADMIN_EMPLOYEE_ID || verified.user.role !== "admin") {
    throw new Error("Not authorized for admin actions.");
  }
  if (verified.user.status !== "active") throw new Error("Admin account is suspended.");
  return verified;
}

function seedUser_(employeeId, name, mobileNumber, password, role) {
  if (findUserRow_(employeeId)) return;
  const salt = generateSalt_();
  const hash = hashPassword_(password, salt);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const now = new Date().toISOString();
  sheet.appendRow([employeeId.toUpperCase(), name, mobileNumber || "", salt, hash, role, "active", now, now]);
}

function authenticate_(p) {
  const verified = verifyUserPassword_(p && p.employeeId, p && p.password);
  if (!verified) throw new Error("Invalid employee code or password.");
  if (verified.user.status !== "active") {
    throw new Error("This account is suspended. Contact your administrator.");
  }
  return {
    employeeId: verified.user.employeeId,
    name: verified.user.name,
    mobileNumber: verified.user.mobileNumber,
    role: verified.user.role,
  };
}

function changeOwnPassword_(p) {
  const verified = verifyUserPassword_(p && p.employeeId, p && p.currentPassword);
  if (!verified) throw new Error("Current password is incorrect.");
  if (!p.newPassword || String(p.newPassword).length < 6) {
    throw new Error("New password must be at least 6 characters.");
  }
  const salt = generateSalt_();
  const hash = hashPassword_(p.newPassword, salt);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const headers = verified.headers;
  sheet.getRange(verified.rowIndex, headers.indexOf("passwordSalt") + 1).setValue(salt);
  sheet.getRange(verified.rowIndex, headers.indexOf("passwordHash") + 1).setValue(hash);
  sheet.getRange(verified.rowIndex, headers.indexOf("updatedAt") + 1).setValue(new Date().toISOString());
  return {};
}

function adminListUsers_(p) {
  requireAdmin_(p && p.adminEmployeeId, p && p.adminPassword);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const users = [];
  for (let i = 1; i < data.length; i++) {
    const u = userRowToObject_(headers, data[i]);
    users.push({
      employeeId: u.employeeId,
      name: u.name,
      mobileNumber: u.mobileNumber,
      role: u.role,
      status: u.status,
    });
  }
  return { users };
}

function adminAddUser_(p) {
  requireAdmin_(p && p.adminEmployeeId, p && p.adminPassword);
  const employeeId = String((p && p.employeeId) || "").trim().toUpperCase();
  if (!employeeId) throw new Error("Employee ID is required.");
  if (!p.password || String(p.password).length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  if (findUserRow_(employeeId)) throw new Error("That Employee ID already exists.");

  const salt = generateSalt_();
  const hash = hashPassword_(p.password, salt);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const now = new Date().toISOString();
  sheet.appendRow([employeeId, p.name || "", p.mobileNumber || "", salt, hash, "field", "active", now, now]);
  return {};
}

function adminEditUser_(p) {
  requireAdmin_(p && p.adminEmployeeId, p && p.adminPassword);
  const found = findUserRow_(p && p.employeeId);
  if (!found) throw new Error("User not found.");
  if (p.password && String(p.password).length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const headers = found.headers;
  if (p.name != null) sheet.getRange(found.rowIndex, headers.indexOf("name") + 1).setValue(p.name);
  if (p.mobileNumber != null) {
    sheet.getRange(found.rowIndex, headers.indexOf("mobileNumber") + 1).setValue(p.mobileNumber);
  }
  if (p.password) {
    const salt = generateSalt_();
    const hash = hashPassword_(p.password, salt);
    sheet.getRange(found.rowIndex, headers.indexOf("passwordSalt") + 1).setValue(salt);
    sheet.getRange(found.rowIndex, headers.indexOf("passwordHash") + 1).setValue(hash);
  }
  sheet.getRange(found.rowIndex, headers.indexOf("updatedAt") + 1).setValue(new Date().toISOString());
  return {};
}

function adminSetStatus_(p) {
  requireAdmin_(p && p.adminEmployeeId, p && p.adminPassword);
  const employeeId = String((p && p.employeeId) || "").trim().toUpperCase();
  if (employeeId === ADMIN_EMPLOYEE_ID) throw new Error("You can't suspend the admin account.");
  const found = findUserRow_(employeeId);
  if (!found) throw new Error("User not found.");
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  sheet
    .getRange(found.rowIndex, found.headers.indexOf("status") + 1)
    .setValue(p.status === "suspended" ? "suspended" : "active");
  sheet
    .getRange(found.rowIndex, found.headers.indexOf("updatedAt") + 1)
    .setValue(new Date().toISOString());
  return {};
}

function adminDeleteUser_(p) {
  requireAdmin_(p && p.adminEmployeeId, p && p.adminPassword);
  const employeeId = String((p && p.employeeId) || "").trim().toUpperCase();
  if (employeeId === ADMIN_EMPLOYEE_ID) throw new Error("You can't delete the admin account.");
  const found = findUserRow_(employeeId);
  if (!found) throw new Error("User not found.");
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS).deleteRow(found.rowIndex);
  return {};
}

// ---------------------------------------------------------------------
// Data capture
// ---------------------------------------------------------------------

function addLogin_(p) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOGINS);
  sheet.appendRow([
    p.id, p.capturedAt, new Date().toISOString(), p.engineerName || "", p.projectName || "",
    p.latitude != null ? p.latitude : "", p.longitude != null ? p.longitude : "",
    p.accuracy != null ? p.accuracy : "", p.photoDriveUrl || "", p.employeeId || "",
  ]);
  return { row: sheet.getLastRow() };
}

function addWorkItem_(p) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_WORK_ITEMS);
  sheet.appendRow([
    p.id, p.capturedAt, new Date().toISOString(), p.engineerName || "", p.projectName || "",
    p.workType, p.latitude, p.longitude, JSON.stringify(p.fields || {}), p.notes || "",
  ]);
  return { row: sheet.getLastRow() };
}

function addMedia_(p) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MEDIA);
  sheet.appendRow([
    p.id, p.capturedAt, new Date().toISOString(), p.engineerName || "", p.projectName || "",
    p.mediaType, p.latitude, p.longitude, p.driveFileUrl || "", p.manualDriveUrl || "",
    p.linkedWorkItemId || "", p.fileName || "", p.notes || "",
  ]);
  return { row: sheet.getLastRow() };
}

function addDroneFlight_(p) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DRONE_FLIGHTS);
  const s = p.summary || {};
  sheet.appendRow([
    p.id, p.capturedAt, new Date().toISOString(), p.engineerName || "", p.projectName || "",
    s.frameCount, s.durationSec, s.startTime, s.endTime,
    s.startLatLon ? s.startLatLon[0] : "", s.startLatLon ? s.startLatLon[1] : "",
    s.endLatLon ? s.endLatLon[0] : "", s.endLatLon ? s.endLatLon[1] : "",
    s.bbox ? s.bbox.minLat : "", s.bbox ? s.bbox.maxLat : "",
    s.bbox ? s.bbox.minLon : "", s.bbox ? s.bbox.maxLon : "",
    s.relAlt ? s.relAlt.min : "", s.relAlt ? s.relAlt.max : "", s.relAlt ? s.relAlt.avg : "",
    s.absAlt ? s.absAlt.min : "", s.absAlt ? s.absAlt.max : "", s.absAlt ? s.absAlt.avg : "",
    JSON.stringify(p.path || []), p.srtFileName || "", p.srtDriveUrl || "",
    p.mp4FileName || "", p.mp4DriveUrl || "", p.notes || "",
  ]);
  return { row: sheet.getLastRow() };
}

function uploadFile_(p) {
  const props = PropertiesService.getScriptProperties();
  const rootId = props.getProperty("DRIVE_ROOT_FOLDER_ID");
  const root = DriveApp.getFolderById(rootId);

  let folder;
  const existing = root.getFoldersByName(p.folder || "Misc");
  folder = existing.hasNext() ? existing.next() : root.createFolder(p.folder || "Misc");

  const bytes = Utilities.base64Decode(p.base64);
  const blob = Utilities.newBlob(bytes, p.mimeType || "application/octet-stream", p.fileName || "file");
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { url: file.getUrl(), fileId: file.getId() };
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
