// Thin wrapper around Leaflet for the dashboard map view.

const TYPE_COLORS = {
  fencing: "#a855f7",
  road: "#64748b",
  pipeline: "#0ea5e9",
  well: "#0891b2",
  excavation: "#b45309",
  resurfacing: "#65a30d",
  photo: "#22c55e",
  video: "#22c55e",
  droneFlight: "#f97316",
};

// Approx centre of Purandar Taluka, Pune District (Saswad).
const DEFAULT_CENTER = [18.34, 74.03];

let mapInstance = null;
let markerLayer = null;

function initMap(containerId) {
  mapInstance = L.map(containerId, { zoomControl: true }).setView(DEFAULT_CENTER, 13);
  // Satellite base (Esri World Imagery) + a semi-transparent reference layer
  // for roads/place labels, so it reads like a standard hybrid satellite view.
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    }
  ).addTo(mapInstance);
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, opacity: 0.9 }
  ).addTo(mapInstance);
  markerLayer = L.layerGroup().addTo(mapInstance);
  return mapInstance;
}

function renderRecordsOnMap(records) {
  if (!mapInstance) return;
  markerLayer.clearLayers();
  const bounds = [];

  for (const r of records) {
    if (r.type === "droneFlight") {
      if (r.data.simplifiedPath && r.data.simplifiedPath.length > 1) {
        const line = L.polyline(r.data.simplifiedPath, {
          color: TYPE_COLORS.droneFlight,
          weight: 3,
        }).addTo(markerLayer);
        line.bindPopup(droneFlightPopup(r));
        r.data.simplifiedPath.forEach((p) => bounds.push(p));
      }
      continue;
    }

    const lat = r.latitude ?? r.data?.latitude;
    const lon = r.longitude ?? r.data?.longitude;
    if (lat == null || lon == null) continue;

    const color = TYPE_COLORS[r.type] || "#334155";
    const marker = L.circleMarker([lat, lon], {
      radius: 8,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 2,
    }).addTo(markerLayer);
    marker.bindPopup(recordPopup(r));
    bounds.push([lat, lon]);
  }

  if (bounds.length === 1) {
    mapInstance.setView(bounds[0], 17);
  } else if (bounds.length > 1) {
    mapInstance.fitBounds(bounds, { padding: [30, 30] });
  }
}

function recordPopup(r) {
  const statusBadge = `<span class="badge badge-${r.syncStatus}">${r.syncStatus}</span>`;
  if (r.type === "workItem") {
    const schema = WORK_ITEM_SCHEMAS[r.data.workType];
    const rows = (schema?.fields || [])
      .filter((f) => r.data.fields[f.key])
      .map((f) => `<div><b>${f.label}:</b> ${formatFieldValue(r.data.fields[f.key], f)}</div>`)
      .join("");
    return `<div class="popup"><h4>${schema?.label || r.data.workType} ${statusBadge}</h4>${rows}
      ${r.data.notes ? `<div class="notes">${escapeHtml(r.data.notes)}</div>` : ""}
      <div class="meta">${new Date(r.createdAt).toLocaleString()}</div></div>`;
  }
  if (r.type === "photo" || r.type === "video") {
    return `<div class="popup"><h4>${r.type === "photo" ? "Photo" : "Video"} ${statusBadge}</h4>
      ${r.data.notes ? `<div class="notes">${escapeHtml(r.data.notes)}</div>` : ""}
      <div class="meta">${new Date(r.createdAt).toLocaleString()}</div></div>`;
  }
  return `<div class="popup">${statusBadge}</div>`;
}

function droneFlightPopup(r) {
  const s = r.data.summary;
  return `<div class="popup"><h4>Drone Flight <span class="badge badge-${r.syncStatus}">${r.syncStatus}</span></h4>
    <div><b>Frames:</b> ${s.frameCount}</div>
    <div><b>Duration:</b> ${s.durationSec}s</div>
    <div><b>Rel alt:</b> ${s.relAlt.min}-${s.relAlt.max} m (avg ${s.relAlt.avg})</div>
    <div><b>Abs alt:</b> ${s.absAlt.min}-${s.absAlt.max} m</div>
    <div class="meta">${s.startTime}</div></div>`;
}

function formatFieldValue(v, field) {
  if (field.type === "unit-number" && v && typeof v === "object") {
    return `${v.value} ${v.unit}`;
  }
  if (field.type === "diameter" && v && typeof v === "object") {
    return `${v.inches}" (${v.mm} mm)`;
  }
  if (field.type === "select") {
    const opt = (field.options || []).find((o) => o.value === v);
    return opt ? opt.label : v;
  }
  return v;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
