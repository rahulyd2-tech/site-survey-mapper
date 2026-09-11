// Reference data for Purandar Taluka, Pune District, Maharashtra.
// Used to inform dropdown labels/tooltips in the Excavation form so field
// entries use terminology that matches local geology and the building-stone trade.

const PURANDAR_GEOLOGY_NOTES = `Purandar Taluka sits on the Deccan Trap basalt plateau (multiple stacked lava
flows, ~65 million years old). Flow tops are weathered into reddish murum
(lateritic weathered basalt / moorum) used as sub-base and crushed rock;
below that lies fresh, compact/vesicular hard basalt. Valley and plateau-top
soils are mostly medium-to-deep black cotton soil (regur, basalt-derived,
used for bajra/jowar/grape/pomegranate/fig cultivation); slopes and hill
shoulders (e.g. around Purandar and Vajragad forts) carry shallower
reddish-orange lateritic soil. Dug wells typically pass through murum before
reaching the fractured/weathered basalt aquifer zone. Regionally quarried
building-stone trap is traded locally as "Manjri stone" (from Manjari/Uruli
Kanchan quarries near Pune) in black, greenish (chlorite/epidote-altered)
and reddish (iron-oxide/laterite-stained) varieties.`;

const EXCAVATION_BASE_TYPES = [
  {
    value: "agri_black_soil",
    label: "Agricultural Black Soil (regur / black cotton soil)",
    hint: "Basalt-derived black cotton soil, common in valley/plateau farmland.",
  },
  {
    value: "agri_orange_soil",
    label: "Agricultural Orange / Red Soil",
    hint: "Shallower lateritic soil typical of slopes and hill shoulders.",
  },
  {
    value: "crushed_rock_murum",
    label: "Crushed Rock (Murum / Moorum)",
    hint: "Weathered basalt gravel layer, usually below topsoil, above hard rock.",
  },
  {
    value: "hard_rock_black_basalt",
    label: "Hard Rock — Black Basalt",
    hint: "Fresh compact/vesicular Deccan Trap basalt.",
  },
  {
    value: "hard_rock_green_manjri",
    label: "Hard Rock — Green Manjri",
    hint: "Greenish trap variant (chlorite/epidote altered), local quarry trade name.",
  },
  {
    value: "hard_rock_red_manjri",
    label: "Hard Rock — Red Manjri",
    hint: "Reddish trap variant (iron-oxide/laterite stained), local quarry trade name.",
  },
  { value: "other", label: "Other (specify in notes)", hint: "" },
];

const ROAD_SURFACE_TYPES = [
  { value: "rocky", label: "Rocky / Murum (unpaved)" },
  { value: "asphalt", label: "Asphalt" },
  { value: "concrete", label: "Concrete" },
  { value: "other", label: "Other (specify in notes)" },
];

const PIPELINE_MATERIALS = [
  { value: "plastic", label: "Plastic (PVC/HDPE)" },
  { value: "cement", label: "Cement (RCC / Hume pipe)" },
];

// Standard nominal plastic pipe sizes, inches -> mm
const PLASTIC_PIPE_SIZES_IN = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6];

// Common cement/RCC (Hume) pipe sizes, inches -> mm
const CEMENT_PIPE_SIZES_IN = [4, 6, 8, 9, 10, 12, 15, 18, 24, 30, 36];

const WELL_TOPOLOGIES = [
  { value: "square", label: "Square" },
  { value: "rectangle", label: "Rectangle" },
  { value: "circle", label: "Circle" },
];

const LENGTH_UNITS = [
  { value: "ft", label: "ft" },
  { value: "m", label: "m" },
];

function inToMm(inches) {
  return Math.round(inches * 25.4 * 100) / 100;
}

function ftToM(ft) {
  return Math.round(ft * 0.3048 * 1000) / 1000;
}

function mToFt(m) {
  return Math.round((m / 0.3048) * 1000) / 1000;
}

// Normalize a {value, unit} length field to meters for consistent storage.
function normalizeToMeters(value, unit) {
  const v = parseFloat(value);
  if (Number.isNaN(v)) return null;
  return unit === "ft" ? ftToM(v) : v;
}
