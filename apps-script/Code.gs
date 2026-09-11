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

const SHEET_WORK_ITEMS = "WorkItems";
const SHEET_MEDIA = "Media";
const SHEET_DRONE_FLIGHTS = "DroneFlights";

const HEADERS = {
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
 * constants below first.
 */
function setup() {
  const TOKEN = "CHANGE-ME-TO-A-LONG-RANDOM-STRING";
  const props = PropertiesService.getScriptProperties();
  props.setProperty("TOKEN", TOKEN);

  const rootFolder = DriveApp.getRootFolder()
    .createFolder("Site Survey Mapper Uploads");
  props.setProperty("DRIVE_ROOT_FOLDER_ID", rootFolder.getId());

  ensureSheets_();
  Logger.log("Setup complete. Token: %s | Drive folder: %s", TOKEN, rootFolder.getUrl());
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
    return jsonResponse_({ ok: false, error: String(err) });
  }
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
