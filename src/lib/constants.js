export const SCHOOLS = [
  'Azusa Pacific University',
  'Cal State LA',
  'Cal State Long Beach',
  'Cal State Northridge',
  'UCLA',
  'West Coast University Anaheim',
  'West Coast University North Hollywood',
]

export const SCHOOL_DEFAULTS = {
  'West Coast University North Hollywood': {
    term_dates: 'Jun 8 - Aug 18, 2026',
    hours_required: 90,
    coordinators:
      'Therese Sandoval (ThSandoval@westcoastuniversity.edu); Laura Nunez (lNunez@westcoastuniversity.edu); Silvia St George (sStgeorge@westcoastuniversity.edu); Tony Kim (ToKim@westcoastuniversity.edu)',
  },
  'West Coast University Anaheim': {
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
  // Cal State Northridge and UCLA: add coordinators/dates when known
  'Cal State Northridge': {},
  'UCLA': {},
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

// Full Cedars-Sinai unit roster for the Unit Setup Panel
export const UNIT_ROSTER = {
  'Surgical Division': [
    '7NE', '7NW', '8SE', '8SW', '8NE', '8NW', 'ACUs',
  ],
  'Medical Division': [
    '3SE', '3SW', '4SE', '4SW', '4NE/4NW',
    '5SE', '5SW', '5NE', '5NW', '6SE', '6SW', '7SE', '7SW',
  ],
  'Critical Care Division': [
    '6NE', '6NW', '3SCCT', '4SCCT', '5SCCT',
    '6SCCT', '7SCCT', '8SCCT', 'CMC', 'MSCCT', '6SE PFT', '6NE ABG',
  ],
  Specialty: [
    'Labor and Delivery', 'PACU', 'NICU', 'PICU',
    'Pediatrics', 'Postpartum', '3 South', 'Float Pool',
  ],
}

// Pre-seeded patient population descriptions per unit
export const PATIENT_POPULATIONS = {
  '7NE': 'Orthopedics, Surgical, Trauma',
  '7NW': 'Orthopedics, Surgical, Trauma',
  '8SE': 'General Surgery, Colorectal, Urology, OB/GYN, Plastic Surgery, Gender Affirming, ENT, GYN, Trauma',
  '8SW': 'General Surgery, Colorectal, Urology, OB/GYN, Plastic Surgery, Gender Affirming, ENT, GYN, Trauma',
  '8NE': 'Neurosurgical, Neuro Step-down, Trauma Step-down',
  '8NW': 'Spine Surgeries, Trauma, Lumbar Drains',
  'ACUs': 'Medical/Surgical Unit Overflow',
  '3SE': 'Medical Observation Unit, Telemetry',
  '3SW': 'Medical Observation Unit, Telemetry',
  '4SE': 'Medicine, Oncology, PCU, Bone Marrow Transplants',
  '4SW': 'Medicine, Oncology, PCU, Bone Marrow Transplants',
  '4NE/4NW': 'Monitored, Stroke, Epilepsy, Medical, PCU',
  '5SE': 'Medical, PCU',
  '5SW': 'Medicine, PCU, Safety Quad',
  '5NE': 'PCU, Monitored Post Cardiac Cath Care',
  '5NW': 'PCU, Monitored Post Cardiac Cath Care',
  '6SE': 'Advanced Heart Failure, PCU',
  '6SW': 'Advanced Heart Failure, PCU',
  '7SE': 'PCU, Generic Medical, Diabetes',
  '7SW': 'PCU, Generic Medical, Surgery Overflow',
  '6NE': 'PCU, Heart Transplant, Lung Transplant, Mechanical Circulatory Support',
  '6NW': 'PCU, Kidney/Pancreas Transplant, Liver Transplant, Hepatobiliary, Trauma, Thoracic',
  '3SCCT': 'Medicine Telemetry',
  '4SCCT': 'Medicine Cardiac Care Intensive Care Unit',
  '5SCCT': 'Surgical Trauma Transplant Intensive Care Unit',
  '6SCCT': 'Surgical Cardiac Intensive Care Unit',
  '7SCCT': 'Medicine Respiratory Intensive Care Unit',
  '8SCCT': 'Neuroscience Intensive Care Unit',
  'CMC': 'Monitored',
  'MSCCT': 'Respiratory Therapy Department',
  '6SE PFT': 'Pulmonary Function Lab',
  '6NE ABG': 'Arterial Blood Gas Lab',
  'Labor and Delivery': 'Labor and Delivery',
  'PACU': 'Post-Anesthesia Care Unit',
  'NICU': 'Neonatal Intensive Care Unit',
  'PICU': 'Pediatric Intensive Care Unit',
  'Pediatrics': 'Pediatrics',
  'Postpartum': 'Postpartum',
  '3 South': 'Medical/Surgical',
  'Float Pool': 'Float Pool',
}

// Hardcoded fallback map for patient population descriptions.
// Used when the units table patient_population column is empty or missing.
// Layer 2 of the two-layer approach: constants always win over an empty DB value.
export const PATIENT_POPULATION_MAP = {
  '7NE': 'Orthopedics, Surgical, Trauma',
  '7NW': 'Orthopedics, Surgical, Trauma',
  '8SE': 'General Surgery, Colorectal, Urology, OB/GYN, Plastic Surgery, Gender Affirming, ENT, GYN, Trauma',
  '8SW': 'General Surgery, Colorectal, Urology, OB/GYN, Plastic Surgery, Gender Affirming, ENT, GYN, Trauma',
  '8NE': 'Neurosurgical, Neuro Step-down, Trauma Step-down',
  '8NW': 'Spine Surgeries, Trauma, Lumbar Drains',
  'ACUs': 'Medical/Surgical Unit Overflow',
  '3SE': 'Medical Observation Unit, Telemetry',
  '3SW': 'Medical Observation Unit, Telemetry',
  '4SE': 'Medicine, Oncology, PCU, Bone Marrow Transplants',
  '4SW': 'Medicine, Oncology, PCU, Bone Marrow Transplants',
  '4NE/4NW': 'Monitored, Stroke, Epilepsy, Medical, PCU',
  '5SE': 'Medical, PCU',
  '5SW': 'Medicine, PCU, Safety Quad',
  '5NE': 'PCU, Monitored Post Cardiac Cath Care',
  '5NW': 'PCU, Monitored Post Cardiac Cath Care',
  '6SE': 'Advanced Heart Failure, PCU',
  '6SW': 'Advanced Heart Failure, PCU',
  '7SE': 'PCU, Generic Medical, Diabetes',
  '7SW': 'PCU, Generic Medical, Surgery Overflow',
  '6NE': 'PCU, Heart Transplant, Lung Transplant, Mechanical Circulatory Support',
  '6NW': 'PCU, Kidney/Pancreas Transplant, Liver Transplant, Hepatobiliary, Trauma, Thoracic',
  '3SCCT': 'Medicine Telemetry',
  '4SCCT': 'Medicine Cardiac Care Intensive Care Unit',
  '5SCCT': 'Surgical Trauma Transplant Intensive Care Unit',
  '6SCCT': 'Surgical Cardiac Intensive Care Unit',
  '7SCCT': 'Medicine Respiratory Intensive Care Unit',
  '8SCCT': 'Neuroscience Intensive Care Unit',
  'CMC': 'Monitored',
  'MSCCT': 'Respiratory Therapy Department',
  '6SE PFT': 'Pulmonary Function Lab',
  '6NE ABG': 'Arterial Blood Gas Lab',
  'Labor and Delivery': 'Labor and Delivery',
  'PACU': 'Post-Anesthesia Care Unit',
  'NICU': 'Neonatal Intensive Care Unit',
  'PICU': 'Pediatric Intensive Care Unit',
  'Pediatrics': 'Pediatrics',
  'Postpartum': 'Postpartum',
  '3 South': 'Medical/Surgical',
  'Float Pool': 'Float Pool',
}

// Reverse lookup: unit_name -> division (matches the 'division' column values in Supabase)
export const UNIT_DIVISION_MAP = {
  '7NE': 'Surgical',  '7NW': 'Surgical',
  '8SE': 'Surgical',  '8SW': 'Surgical',
  '8NE': 'Surgical',  '8NW': 'Surgical',
  'ACUs': 'Surgical',

  '3SE': 'Medical',   '3SW': 'Medical',
  '4SE': 'Medical',   '4SW': 'Medical',
  '4NE/4NW': 'Medical',
  '5SE': 'Medical',   '5SW': 'Medical',
  '5NE': 'Medical',   '5NW': 'Medical',
  '6SE': 'Medical',   '6SW': 'Medical',
  '7SE': 'Medical',   '7SW': 'Medical',

  '6NE': 'Critical Care', '6NW': 'Critical Care',
  '3SCCT': 'Critical Care', '4SCCT': 'Critical Care',
  '5SCCT': 'Critical Care', '6SCCT': 'Critical Care',
  '7SCCT': 'Critical Care', '8SCCT': 'Critical Care',
  'CMC':   'Critical Care', 'MSCCT': 'Critical Care',
  '6SE PFT': 'Critical Care', '6NE ABG': 'Critical Care',

  'Labor and Delivery': 'Specialty', 'PACU': 'Specialty',
  'NICU': 'Specialty', 'PICU': 'Specialty',
  'Pediatrics': 'Specialty', 'Postpartum': 'Specialty',
  '3 South': 'Specialty', 'Float Pool': 'Specialty',
}

export const ASPIRE_STATUSES = [
  'Pending Outreach',
  'Form Sent',
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
  'BSN Quarter',
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
