// src/lib/unitCatalog.js
// Canonical unit catalog - 29 units with descriptive subtitles, division, and ASPIRE eligibility.
// This is the code-level source of truth for unit dropdowns and labeling across the app.
// Per-cohort instance data (slot counts, is_participating, etc.) lives in the `units` DB table.
// Static metadata (canonical name, description, division) lives here.

export const UNIT_CATALOG = [
  // Critical Care
  // 6 NE / 6 NW belong to the Critical Care Division (Unit Specialty Resource Chart, page 3, 2022-12-01).
  // 6 NW has a mixed PCU / Medical-Surgical population but its primary division is Critical Care; those
  // characteristics are preserved as descriptors. See docs/product/UNIT_SPECIALTY_CLASSIFICATION.md.
  { name: '6 NE',             description: 'PCU, Heart Transplant, Lung Transplant, Mechanical Circulatory Support', division: 'Critical Care', defaultEligible: true, publicName: 'Heart and Lung Transplant Progressive Care' },
  { name: '6 NW',             description: 'PCU, Medical-Surgical, Kidney/Pancreas Transplant, Liver Transplant, Hepatobiliary, Trauma, Thoracic', division: 'Critical Care', defaultEligible: true, publicName: 'Transplant and Surgical Progressive Care' },
  { name: '3 SCCT',           description: 'Medicine Telemetry Stepdown',                          division: 'Critical Care',   defaultEligible: true, publicName: 'Medical Telemetry Stepdown' },
  { name: '4 SCCT',           description: 'Cardiac Care ICU (CICU)',                              division: 'Critical Care',   defaultEligible: true, publicName: 'Cardiac ICU' },
  { name: '5 SCCT',           description: 'Surgical Trauma Transplant ICU (SICU)',                division: 'Critical Care',   defaultEligible: true, publicName: 'Surgical ICU' },
  { name: '6 SCCT',           description: 'Cardiac Surgery ICU (CSICU)',                          division: 'Critical Care',   defaultEligible: true, publicName: 'Cardiac Surgery ICU' },
  { name: '7 SCCT',           description: 'Medicine Respiratory ICU (MICU)',                      division: 'Critical Care',   defaultEligible: true, publicName: 'Medical ICU' },
  { name: '8 SCCT',           description: 'Neuroscience ICU (Neuro ICU)',                         division: 'Critical Care',   defaultEligible: true, publicName: 'Neuroscience ICU' },

  // Medical
  { name: '3 South Short Stay', description: 'Medical Observation, Short Stay',                   division: 'Medical',         defaultEligible: true, publicName: 'Medical Short Stay' },
  { name: '4 North',           description: 'Stroke, Epilepsy, Monitored Medical, PCU',           division: 'Medical',         defaultEligible: true, publicName: 'Neurology and Stroke Progressive Care' },
  { name: '4 South',           description: 'Medicine, Oncology, PCU, Bone Marrow Transplant',    division: 'Medical',         defaultEligible: true, publicName: 'Oncology and Bone Marrow Transplant' },
  { name: '5 North',           description: 'PCU, Post Cardiac Cath Care',                        division: 'Medical',         defaultEligible: true, publicName: 'Cardiac Progressive Care' },
  { name: '5 South',           description: 'Medical, PCU, Safety Quad',                          division: 'Medical',         defaultEligible: true, publicName: 'Medical Progressive Care' },
  { name: '6 South',           description: 'Advanced Heart Failure, PCU',                        division: 'Medical',         defaultEligible: true, publicName: 'Heart Failure Progressive Care' },
  { name: '7 South',           description: 'PCU, General Medical',                               division: 'Medical',         defaultEligible: true, publicName: 'General Medicine' },

  // Surgical
  { name: '7 North',           description: 'Orthopedics, Surgical, Trauma',                      division: 'Surgical',        defaultEligible: true, publicName: 'Orthopedics and Trauma' },
  { name: '8 North',           description: 'Neurosurgical, Spine, Trauma Stepdown',              division: 'Surgical',        defaultEligible: true, publicName: 'Neurosurgery and Spine' },
  { name: '8 South',           description: 'General Surgery, Plastics, Trauma',                  division: 'Surgical',        defaultEligible: true, publicName: 'General Surgery' },

  // Women & Children
  // UNIT-RENAME-POSTPARTUM-1 (Owner, 2026-10-29): formerly '3 North'; stored rows were renamed
  // by db/maintenance/rename_3_north_postpartum_20261029.sql.
  { name: 'Postpartum',        description: 'Mother-Baby',                                        division: "Women & Children", defaultEligible: true, publicName: 'Postpartum (Mother-Baby)' },
  { name: 'Labor & Delivery',  description: 'Labor and Delivery, Maternal Fetal Care Unit',       division: "Women & Children", defaultEligible: true, publicName: 'Labor and Delivery' },
  { name: 'NICU',              description: 'Neonatal Intensive Care Unit',                        division: "Women & Children", defaultEligible: true, publicName: 'Neonatal ICU' },
  { name: 'Pediatrics',        description: 'Pediatric Acute Care, ages 0 to 21',                 division: "Women & Children", defaultEligible: true, publicName: 'Pediatrics' },
  { name: 'PICU',              description: 'Pediatric ICU and Congenital Cardiac ICU',            division: "Women & Children", defaultEligible: true, publicName: 'Pediatric ICU' },

  // Support / Procedural
  { name: 'ACU/CDU',           description: 'Alternate Care Unit, Clinical Decision Unit',        division: 'Support',         defaultEligible: true, publicName: 'Clinical Decision Unit' },
  { name: 'Float Pool',        description: 'Cross-unit nursing support',                          division: 'Support',         defaultEligible: true, publicName: 'Float Pool' },
  { name: 'PACU',              description: 'Post-Anesthesia Care Unit (Phase I, II, Extended)',  division: 'Procedural',      defaultEligible: true, publicName: 'Post-Anesthesia Care' },

  // Default-hidden: real units for the contact directory, portal access scopes,
  // and division filtering, but NOT ASPIRE student placement units.
  // (show with ?showAll=true in form URLs)
  { name: 'Operating Room',    description: 'Operating Room and Perioperative Services',           division: 'Procedural',      defaultEligible: false, publicName: 'Operating Room' },
  { name: 'Emergency Department', description: 'Emergency Department',                            division: 'Emergency',       defaultEligible: false, publicName: 'Emergency Department' },
  { name: 'Transfer Center',   description: 'Patient Transfer Center, Capacity and Throughput',    division: 'Capacity Management', defaultEligible: false, publicName: 'Transfer Center' },
];

// TRANSITION-FORM-ACLS-1 (Owner, 2026-10-29): the units whose residents need ACLS. The
// Critical Care division less 3 SCCT, which the Owner noted is a telemetry stepdown and not
// critical care. A residency need, usually due by the start date rather than to apply.
export const ACLS_REQUIRED_UNITS = Object.freeze(['6 NE', '6 NW', '4 SCCT', '5 SCCT', '6 SCCT', '7 SCCT', '8 SCCT'])

// Division display order for dropdowns
export const DIVISION_ORDER = [
  'Critical Care',
  'Medical',
  'Surgical',
  'Women & Children',
  'Procedural',
  'Support',
  'Capacity Management',
  'Emergency',
];

// UNIT-LABELS-1 (Owner, 2026-10-29): a unit in a dropdown says what it is, "8 SCCT - Neuroscience
// ICU (Neuro ICU)". The value stays the bare name; a unit not in the catalog shows its name alone.
export function unitOptionLabel(name) {
  const d = getUnit(name)?.description
  return d ? `${name} - ${d}` : name
}

// AP-UNIT-NAMES-1 (Owner, 2026-11-08): what a reader outside Cedars-Sinai calls a unit. An
// Academic Partner does not know 8 SCCT; they know their student went to the Neuroscience ICU.
// Every catalog unit has one; a name the catalog does not hold reads as itself.
export function unitPublicName(name) {
  if (!name) return name
  return getUnit(name)?.publicName || name
}

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
