// src/lib/displayFormatters.js
// Centralised display-name utilities.
// Consumed by StudentCard (all variants) and List View Identity column.
// Single source of truth for abbreviation rules — update once, propagates everywhere.

// ── School shortener ──────────────────────────────────────────────────────────

const SCHOOL_MAP = {
  // Cal State system
  'Cal State LA':                                    'CSULA',
  'California State University Los Angeles':         'CSULA',
  'California State University, Los Angeles':        'CSULA',
  'CSULA':                                           'CSULA',

  'Cal State Long Beach':                            'CSULB',
  'California State University Long Beach':          'CSULB',
  'California State University, Long Beach':         'CSULB',
  'CSULB':                                           'CSULB',

  'Cal State Northridge':                            'CSUN',
  'California State University Northridge':          'CSUN',
  'California State University, Northridge':         'CSUN',
  'CSUN':                                            'CSUN',

  // UC system
  'UCLA':                                            'UCLA',
  'University of California Los Angeles':            'UCLA',
  'University of California, Los Angeles':           'UCLA',
  'UCLA School of Nursing':                          'UCLA',

  // Private
  'Azusa Pacific University':                        'APU',
  'APU':                                             'APU',

  'West Coast University Anaheim':                   'WCU - Anaheim',
  'WCU Anaheim':                                     'WCU - Anaheim',
  'West Coast University - Anaheim':                 'WCU - Anaheim',

  'West Coast University North Hollywood':           'WCU - NoHo',
  'WCU North Hollywood':                             'WCU - NoHo',
  'WCU NoHo':                                        'WCU - NoHo',
  'West Coast University - North Hollywood':         'WCU - NoHo',

  'Charles R. Drew University':                      'CDU',
  "Charles R. Drew University of Medicine and Science": 'CDU',

  'Mount Saint Mary\'s University':                  'MSMU',
  "Mount St. Mary's University":                     'MSMU',
};

/**
 * Returns a compact school abbreviation for display in tight spaces.
 * Falls back to the raw string if it's short (< 10 chars) or can't be mapped.
 */
export function shortenSchool(school) {
  if (!school) return '';
  if (SCHOOL_MAP[school]) return SCHOOL_MAP[school];
  // Smart abbreviation: uppercase first letter of each word
  if (school.length >= 10) {
    const abbr = school.split(/\s+/).filter(w => /[A-Z]/.test(w[0])).map(w => w[0]).join('');
    if (abbr.length >= 2) return abbr;
  }
  return school;
}

// ── Program type shortener ────────────────────────────────────────────────────

const PROGRAM_MAP = {
  'Accelerated BSN':                     'ABSN',
  'ABSN':                                'ABSN',
  'BSN':                                 'BSN',
  'BSN (Trimester)':                     'BSN (Trimester)',
  'BSN Trimester':                       'BSN',
  'BSN (Semester)':                      'BSN (Semester)',
  'BSN Semester':                        'BSN',
  'BSN (Quarter)':                       'BSN (Quarter)',
  'BSN Quarter':                         'BSN',
  "Master's Entry Clinical Nurse":       'MECN',
  "Master's Entry Clinical Nurse (MECN)":'MECN',
  'MECN':                                'MECN',
  "Entry-Level Master's in Nursing":     'ELMN',
  "Entry-Level Master's in Nursing (ELMN)": 'ELMN',
  'ELMN':                                'ELMN',
  'LVN to BSN':                          'LVN-BSN',
  'LVN-BSN':                             'LVN-BSN',
  'RN to BSN':                           'RN-BSN',
};

/** Returns a compact program type abbreviation. Returns input unchanged if unknown. */
export function shortenProgram(programType) {
  if (!programType) return '';
  return PROGRAM_MAP[programType] ?? programType;
}

// ── Combined formatter ────────────────────────────────────────────────────────

/**
 * Returns "School · Program" using a middle-dot separator.
 * Omits the component that's empty. Returns '' if both are empty.
 *
 * @param {string} school
 * @param {string} programType
 * @returns {string}
 */
export function formatSchoolProgram(school, programType) {
  const s = shortenSchool(school);
  const p = shortenProgram(programType);
  if (s && p) return `${s} · ${p}`;
  return s || p || '';
}
