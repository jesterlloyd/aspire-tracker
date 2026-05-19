// Cedars-Sinai Nursing Executive Leadership.
// This is the layer ABOVE the unit-level Associate Directors and Executive Directors of individual units.
// Static metadata; rarely changes. Used by Keith for "who is the executive over X" lookups.

export const NURSING_EXECUTIVE_LEADERSHIP = [
  {
    full_name: 'David Marshall',
    email: 'David.Marshall@cshs.org',
    role: 'Senior Vice President, Chief Nursing Executive',
    scope: 'All nursing across Cedars-Sinai Health System',
    is_chief: true,
    related_units: [],
  },
  {
    full_name: 'Dan Sabin',
    email: 'Dan.Sabin@cshs.org',
    role: 'Executive Director, OR Operations',
    additional_title: 'Clinical Care Service Line Operations VP',
    scope: 'Operating Room and perioperative services',
    related_units: ['Operating Room'],
  },
  {
    full_name: 'Christine Tuchmayer',
    email: 'Christine.Tuchmayer@cshs.org',
    role: 'Executive Director, Office of Licensure, Accreditation & Regulation (OLAR)',
    scope: 'Licensure, accreditation, and regulation across nursing',
    related_units: [],
  },
  {
    full_name: 'Patricia Hain',
    preferred_name: 'Peachy',
    email: 'Patricia.Hain@cshs.org',
    role: 'Executive Director, Surgical Services',
    scope: 'Surgical division',
    related_units: ['7 North', '8 North', '8 South', 'PACU'],
  },
  {
    full_name: 'Charina Emerson',
    email: 'Charina.Emerson@cshs.org',
    role: 'Executive Director, Nursing Operations',
    scope: 'Float pool, nursing operations',
    related_units: ['Float Pool'],
  },
  {
    full_name: 'Carol Mention',
    email: 'Carol.Mention@cshs.org',
    role: 'Executive Director, Critical Care Services',
    scope: 'Critical Care division (all SCCT units)',
    related_units: ['3 SCCT', '4 SCCT', '5 SCCT', '6 SCCT', '7 SCCT', '8 SCCT'],
  },
  {
    full_name: 'Michelle Williams-Rivers',
    email: 'Michelle.Williams@cshs.org',
    role: 'Executive Director, Medical Services',
    scope: 'Medical division',
    related_units: ['3 South Short Stay', '4 North', '4 South', '5 North', '5 South', '6 NE', '6 NW', '6 South', '7 South'],
  },
  {
    full_name: 'Michelle Souza',
    email: 'Michelle.Souza@cshs.org',
    role: "Executive Director, Women and Children's Services",
    scope: "Women & Children division",
    related_units: ['3 North', 'Labor & Delivery', 'NICU', 'Pediatrics', 'PICU'],
  },
  {
    full_name: 'Heidi High',
    email: 'Heidi.High@cshs.org',
    role: 'Executive Director, Capacity Management',
    scope: 'Capacity management and overflow',
    related_units: ['ACU/CDU'],
  },
  {
    full_name: 'Margo B. Minissian',
    email: 'Margo.Minissian@cshs.org',
    role: 'Executive Director, Geri and Richard Brawerman Nursing Institute',
    additional_title: 'Nursing Education, Nursing Research, and Nursing Innovation',
    credentials: 'PhD, ACNP-BC, NEA-BC, FAHA, FAAN',
    scope: 'BNI: Nursing Education, Nursing Research, Nursing Innovation (includes the ASPIRE Program)',
    related_units: [],
  },
];

export function getExecutiveForUnit(unitName) {
  return NURSING_EXECUTIVE_LEADERSHIP.find(exec =>
    exec.related_units && exec.related_units.includes(unitName)
  ) || null;
}

export function getExecutiveByEmail(email) {
  if (!email) return null;
  return NURSING_EXECUTIVE_LEADERSHIP.find(exec =>
    exec.email.toLowerCase() === email.toLowerCase().trim()
  ) || null;
}

export function getChiefNursingExecutive() {
  return NURSING_EXECUTIVE_LEADERSHIP.find(exec => exec.is_chief) || null;
}
