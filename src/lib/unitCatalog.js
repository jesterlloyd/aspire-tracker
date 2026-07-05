// src/lib/unitCatalog.js
// Canonical unit catalog - 28 units with descriptive subtitles, division, and ASPIRE eligibility.
// This is the code-level source of truth for unit dropdowns and labeling across the app.
// Per-cohort instance data (slot counts, is_participating, etc.) lives in the `units` DB table.
// Static metadata (canonical name, description, division) lives here.

export const UNIT_CATALOG = [
  // Critical Care
  { name: '3 SCCT',           description: 'Medicine Telemetry Stepdown',                          division: 'Critical Care',   defaultEligible: true  },
  { name: '4 SCCT',           description: 'Cardiac Care ICU (CICU)',                              division: 'Critical Care',   defaultEligible: true  },
  { name: '5 SCCT',           description: 'Surgical Trauma Transplant ICU (SICU)',                division: 'Critical Care',   defaultEligible: true  },
  { name: '6 SCCT',           description: 'Cardiac Surgery ICU (CSICU)',                          division: 'Critical Care',   defaultEligible: true  },
  { name: '7 SCCT',           description: 'Medicine Respiratory ICU (MICU)',                      division: 'Critical Care',   defaultEligible: true  },
  { name: '8 SCCT',           description: 'Neuroscience ICU (Neuro ICU)',                         division: 'Critical Care',   defaultEligible: true  },

  // Medical
  { name: '3 South Short Stay', description: 'Medical Observation, Short Stay',                   division: 'Medical',         defaultEligible: true  },
  { name: '4 North',           description: 'Stroke, Epilepsy, Monitored Medical, PCU',           division: 'Medical',         defaultEligible: true  },
  { name: '4 South',           description: 'Medicine, Oncology, PCU, Bone Marrow Transplant',    division: 'Medical',         defaultEligible: true  },
  { name: '5 North',           description: 'PCU, Post Cardiac Cath Care',                        division: 'Medical',         defaultEligible: true  },
  { name: '5 South',           description: 'Medical, PCU, Safety Quad',                          division: 'Medical',         defaultEligible: true  },
  { name: '6 NE',              description: 'Heart Transplant, Lung Transplant, Mechanical Circulatory Support', division: 'Medical', defaultEligible: true },
  { name: '6 NW',              description: 'Liver/Kidney/Pancreas Transplant, Hepatobiliary, Trauma, Thoracic', division: 'Medical', defaultEligible: true },
  { name: '6 South',           description: 'Advanced Heart Failure, PCU',                        division: 'Medical',         defaultEligible: true  },
  { name: '7 South',           description: 'PCU, General Medical',                               division: 'Medical',         defaultEligible: true  },

  // Surgical
  { name: '7 North',           description: 'Orthopedics, Surgical, Trauma',                      division: 'Surgical',        defaultEligible: true  },
  { name: '8 North',           description: 'Neurosurgical, Spine, Trauma Stepdown',              division: 'Surgical',        defaultEligible: true  },
  { name: '8 South',           description: 'General Surgery, Plastics, Trauma',                  division: 'Surgical',        defaultEligible: true  },

  // Women & Children
  { name: '3 North',           description: 'Postpartum, Mother-Baby',                            division: "Women & Children", defaultEligible: true  },
  { name: 'Labor & Delivery',  description: 'Labor and Delivery, Maternal Fetal Care Unit',       division: "Women & Children", defaultEligible: true  },
  { name: 'NICU',              description: 'Neonatal Intensive Care Unit',                        division: "Women & Children", defaultEligible: true  },
  { name: 'Pediatrics',        description: 'Pediatric Acute Care, ages 0 to 21',                 division: "Women & Children", defaultEligible: true  },
  { name: 'PICU',              description: 'Pediatric ICU and Congenital Cardiac ICU',            division: "Women & Children", defaultEligible: true  },

  // Support / Procedural
  { name: 'ACU/CDU',           description: 'Alternate Care Unit, Clinical Decision Unit',        division: 'Support',         defaultEligible: true  },
  { name: 'Float Pool',        description: 'Cross-unit nursing support',                          division: 'Support',         defaultEligible: true  },
  { name: 'PACU',              description: 'Post-Anesthesia Care Unit (Phase I, II, Extended)',  division: 'Procedural',      defaultEligible: true  },

  // Default-hidden (show with ?showAll=true in form URLs)
  { name: 'Operating Room',    description: 'Operating Room and Perioperative Services',           division: 'Procedural',      defaultEligible: false },
  { name: 'Emergency Department', description: 'Emergency Department',                            division: 'Emergency',       defaultEligible: false },
];

// Division display order for dropdowns
export const DIVISION_ORDER = [
  'Critical Care',
  'Medical',
  'Surgical',
  'Women & Children',
  'Procedural',
  'Support',
  'Emergency',
];

export function getUnit(name) {
  if (!name) return null;
  return UNIT_CATALOG.find(u => u.name === name) || null;
}

export function getEligibleUnits(showAll = false) {
  if (showAll) return UNIT_CATALOG;
  return UNIT_CATALOG.filter(u => u.defaultEligible);
}

export function getUnitsByDivision(showAll = false) {
  const units = getEligibleUnits(showAll);
  const grouped = {};
  for (const u of units) {
    if (!grouped[u.division]) grouped[u.division] = [];
    grouped[u.division].push(u);
  }
  return grouped;
}

// Groups an arbitrary list of unit name strings by catalog division.
// Units not in the catalog fall into an 'Other' group.
export function groupUnitNamesByDivision(unitNames) {
  const grouped = {};
  for (const name of unitNames) {
    const entry   = getUnit(name);
    const division = entry?.division || 'Other';
    if (!grouped[division]) grouped[division] = [];
    grouped[division].push(name);
  }
  return grouped;
}

export function formatUnitLabel(name) {
  const unit = getUnit(name);
  if (!unit) return name;
  return `${unit.name}, ${unit.description}`;
}

export function getCanonicalUnitNames() {
  return UNIT_CATALOG.map(u => u.name);
}

export function getUnitCatalogForKeith() {
  return UNIT_CATALOG.map(u => ({
    name:                      u.name,
    description:               u.description,
    division:                  u.division,
    aspire_eligible_by_default: u.defaultEligible,
  }));
}
