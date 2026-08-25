// Compact, reporting-specific labels for the Nursing Education & Leadership
// portal. Stored values stay canonical; only this dense portal surface uses
// these abbreviations.

import { shortenSchool } from '../../lib/displayFormatters'

const SCHOOL_OVERRIDES = Object.freeze({
  'Azusa Pacific University': 'APU',
  'Cal State LA': 'CSULA',
  'California State University, Los Angeles': 'CSULA',
  'Cal State Long Beach': 'CSULB',
  'California State University, Long Beach': 'CSULB',
  'Cal State Northridge': 'CSUN',
  'California State University, Northridge': 'CSUN',
  'University of California, Los Angeles': 'UCLA',
  UCLA: 'UCLA',
  'West Coast University Anaheim': 'WCU-Anaheim',
  'West Coast University - Anaheim': 'WCU-Anaheim',
  'WCU Anaheim': 'WCU-Anaheim',
  'WCU - Anaheim': 'WCU-Anaheim',
  'West Coast University North Hollywood': 'WCU-NoHo',
  'West Coast University - North Hollywood': 'WCU-NoHo',
  'WCU North Hollywood': 'WCU-NoHo',
  'WCU NoHo': 'WCU-NoHo',
  'WCU - NoHo': 'WCU-NoHo',
})

export function academicsSchoolLabel(school) {
  if (!school) return '-'
  return SCHOOL_OVERRIDES[school] || shortenSchool(school)
}

const PROGRAM_LABELS = Object.freeze({
  'Accelerated BSN': 'ABSN',
  ABSN: 'ABSN',
  ELMN: 'ELMN',
  "Entry-Level Master's in Nursing": 'ELMN',
  "Entry-Level Master's in Nursing (ELMN)": 'ELMN',
  MECN: 'MECN',
  "Master's Entry Clinical Nurse": 'MECN',
  "Master's Entry Clinical Nurse (MECN)": 'MECN',
  'BSN Semester': 'BSN (Semester)',
  'BSN (Semester)': 'BSN (Semester)',
  'BSN Trimester': 'BSN (Trimester)',
  'BSN (Trimester)': 'BSN (Trimester)',
  'BSN Quarter': 'BSN (Quarter)',
  'BSN (Quarter)': 'BSN (Quarter)',
  BSN: 'BSN',
})

export function academicsProgramLabel(program) {
  if (!program) return '-'
  return PROGRAM_LABELS[program] || program
}

export function academicsProgramGroup(program) {
  const label = academicsProgramLabel(program)
  if (label.startsWith('BSN')) return 'BSN'
  if (['ABSN', 'ELMN', 'MECN'].includes(label)) return label
  return 'Other'
}
