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
