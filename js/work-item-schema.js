// Declarative field schemas for each work-item type. app.js renders a form
// from these definitions and stores answers as {fieldKey: value}.
//
// Field types: 'select', 'number', 'unit-number' (number + ft/m select),
// 'text', 'textarea'.

const WORK_TYPES = [
  { value: "fencing", label: "Fencing" },
  { value: "road", label: "Road" },
  { value: "pipeline", label: "Pipeline" },
  { value: "well", label: "Well Digging" },
  { value: "excavation", label: "Excavation" },
  { value: "resurfacing", label: "Resurfacing / Re-layering" },
];

const WORK_ITEM_SCHEMAS = {
  fencing: {
    label: "Fencing",
    fields: [
      {
        key: "fence_type",
        label: "Fencing type",
        type: "select",
        options: [
          { value: "barbed_wire", label: "Barbed wire" },
          { value: "chain_link", label: "Chain link" },
          { value: "rcc_pole", label: "RCC pole + wire" },
          { value: "compound_wall", label: "Compound wall" },
          { value: "other", label: "Other (specify in notes)" },
        ],
        required: true,
      },
      { key: "length", label: "Length", type: "unit-number", required: true },
      { key: "height", label: "Height", type: "unit-number", required: false },
    ],
  },

  road: {
    label: "Road",
    fields: [
      {
        key: "surface_type",
        label: "Road type",
        type: "select",
        options: ROAD_SURFACE_TYPES,
        required: true,
      },
      { key: "width", label: "Width", type: "unit-number", required: true },
      { key: "length", label: "Length", type: "unit-number", required: false },
    ],
  },

  pipeline: {
    label: "Pipeline",
    fields: [
      {
        key: "material",
        label: "Material",
        type: "select",
        options: PIPELINE_MATERIALS,
        required: true,
      },
      {
        key: "diameter_in",
        label: "Diameter (inches)",
        type: "diameter",
        // options resolved dynamically from material (plastic/cement lists)
        required: true,
      },
      { key: "length", label: "Length", type: "unit-number", required: false },
      {
        key: "laying_depth",
        label: "Laying depth (optional)",
        type: "unit-number",
        required: false,
      },
    ],
  },

  well: {
    label: "Well Digging",
    fields: [
      {
        key: "topology",
        label: "Shape",
        type: "select",
        options: WELL_TOPOLOGIES,
        required: true,
      },
      {
        key: "dimension_a",
        label: "Side length / Diameter",
        type: "unit-number",
        required: true,
        hint: "Side (square), diameter (circle), or length (rectangle)",
      },
      {
        key: "dimension_b",
        label: "Width (rectangle only)",
        type: "unit-number",
        required: false,
      },
      { key: "depth", label: "Depth", type: "unit-number", required: true },
    ],
  },

  excavation: {
    label: "Excavation",
    fields: [
      {
        key: "base_type",
        label: "Base / material type",
        type: "select",
        options: EXCAVATION_BASE_TYPES,
        required: true,
      },
      { key: "length", label: "Length", type: "unit-number", required: false },
      { key: "width", label: "Width", type: "unit-number", required: false },
      { key: "depth", label: "Depth", type: "unit-number", required: true },
    ],
  },

  resurfacing: {
    label: "Resurfacing / Re-layering",
    fields: [
      {
        key: "surface_type",
        label: "New surface type",
        type: "select",
        options: ROAD_SURFACE_TYPES,
        required: true,
      },
      { key: "length", label: "Length", type: "unit-number", required: false },
      { key: "width", label: "Width", type: "unit-number", required: false },
      {
        key: "layer_thickness",
        label: "Layer thickness (optional)",
        type: "unit-number",
        required: false,
      },
    ],
  },
};
