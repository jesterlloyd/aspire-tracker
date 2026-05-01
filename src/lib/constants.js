export const SCHOOLS = [
  'Azusa Pacific University',
  'Cal State LA',
  'Cal State Long Beach',
  'WCU Anaheim',
  'WCU North Hollywood',
]

export const SCHOOL_DEFAULTS = {
  'WCU North Hollywood': {
    term_dates: 'Jun 8 - Aug 18, 2026',
    hours_required: 90,
    coordinators:
      'Therese Sandoval (ThSandoval@westcoastuniversity.edu); Laura Nunez (lNunez@westcoastuniversity.edu); Silvia St George (sStgeorge@westcoastuniversity.edu); Tony Kim (ToKim@westcoastuniversity.edu)',
  },
  'WCU Anaheim': {
    term_dates: 'Jun 8 - Aug 16, 2026',
    hours_required: 90,
    coordinators:
      'Joelene Balatero (jBalatero@westcoastuniversity.edu); Rena Youssef (RYoussef@westcoastuniversity.edu)',
  },
  'Azusa Pacific University': {
    term_dates: 'May 4 - Jul 30, 2026',
    hours_required: 180,
    coordinators: 'Susan Hunter (shunter@apu.edu)',
  },
  'Cal State Long Beach': {
    term_dates: 'Jun 1 - Aug 14, 2026',
    hours_required: 90,
    coordinators: 'Lucy Van Otterloo (Lucy.VanOtterloo@csulb.edu)',
  },
  'Cal State LA': {
    term_dates: 'Jun 1 - Aug 7, 2026',
    hours_required: 144,
    coordinators:
      'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)',
  },
}

// Legacy UNITS_BY_DIVISION used in the students tab unit dropdown
export const UNITS_BY_DIVISION = {
  Surgical: [
    '4N - General Surgery',
    '5N - Orthopedic Surgery',
    '5S - Spine / Neurosurgery',
    '6N - Plastics / Reconstruction',
    'OR - Operating Room',
    'PACU - Post-Anesthesia Care',
  ],
  Medical: [
    '3N - Medical / Oncology',
    '3S - General Medical',
    '4S - Cardiac Telemetry',
    '4E - Progressive Care',
    'Float Pool - Med-Surg',
  ],
  'Critical Care': [
    'MICU - Medical ICU',
    'SICU - Surgical ICU',
    'CVICU - Cardiovascular ICU',
    'CCU - Cardiac Care Unit',
    'NICU - Neonatal ICU',
    'Step-Down / SDU',
    'Emergency Department',
  ],
}

// Full Cedars-Sinai unit roster for the Unit Setup Panel (Part 3)
export const UNIT_ROSTER = {
  Surgical: [
    '7NE', '7NW', '8SE', '8SW', '8NE', '8NW',
    '3SPT', '3SW', '4S', '3 PACU', '6 PACU', '7 GI PACU',
  ],
  Medical: [
    '3SE', '3SW', '4SE', '4SW', '4NE/4NW',
    '5SE', '5SW', '5NE', '5NW', '6SE', '6SW', '7SE', '7SW',
  ],
  'Critical Care': [
    '6NE', '6NW', '3SCCT', '4SCCT', '5SCCT',
    '6SCCT', '7SCCT', '8SCCT', 'CMC',
  ],
  Specialty: [
    'Labor and Delivery', 'PACU', 'NICU', 'PICU',
    'Pediatrics', 'Postpartum', 'Float Pool', '3 South',
  ],
}

export const ASPIRE_STATUSES = [
  'Form Sent',
  'Form Returned',
  'Interviewed',
  'Accepted',
  'Active Rotation',
  'Completed',
  'Declined',
]

export const NGRP_OUTCOMES = [
  'Pending',
  'Applied',
  'Interviewed',
  'Offered',
  'Hired',
  'Declined',
]

export const COHORTS = ['Summer 2026', 'Fall 2026', 'Spring 2027', 'Summer 2027']

// ── Matching tab constants ────────────────────────────────────────────

export const INTERVIEW_OUTCOMES = [
  'Pending Interview',
  'Accepted',
  'Accepted with Reservations',
  'Declined',
]

export const SHIFT_OPTIONS = ['Day', 'Night', 'Either', 'Day and Night']

// The 14 Cedars-Sinai units available for matching preference dropdowns
export const UNIT_NAMES = [
  '4 NE/NW', '4 SE/SW', '5 SCCT', '5 SE/SW',
  '6 NE', '6 NW', '6 SE/SW', '7 NE/NW',
  '8 NE/NW', '8 SE/SW', 'Labor & Delivery',
  'NICU', 'PACU', 'Pediatrics',
]

export const COHORT_STATUSES = ['Planning', 'Active', 'Completed', 'Archived']

export const PROGRAM_TYPES = [
  'BSN Semester',
  'BSN Trimester',
  'Accelerated BSN',
  'LVN to BSN',
  'MECN',
  'ELMN',
]

// Clinical area groupings for yellow (same-area) compatibility
export const UNIT_AREAS = {
  'Labor & Delivery': 'OB / Women\'s Health',
  '6 NW':  'Medical-Surgical',
  '6 NE':  'Medical-Surgical',
  'PACU':  'Perioperative',
  '7 NE/NW': 'Medical-Surgical',
  '8 NE/NW': 'Medical-Surgical',
  '8 SE/SW': 'Medical-Surgical',
  '4 SE/SW': 'Oncology',
  '5 SE/SW': 'Medical-Surgical',
  'Pediatrics': 'Pediatrics',
  'NICU': 'Critical Care',
  '6 SE/SW': 'Medical-Surgical',
  '5 SCCT': 'Critical Care',
  '4 NE/NW': 'Medical-Surgical',
}

export function getCompatibility(student, unitName) {
  const prefs = [
    student.unit_preference_1,
    student.unit_preference_2,
    student.unit_preference_3,
  ].filter(Boolean)
  if (prefs.includes(unitName)) return 'green'
  const unitArea = UNIT_AREAS[unitName]
  if (unitArea && prefs.some(p => UNIT_AREAS[p] === unitArea)) return 'yellow'
  return 'gray'
}
