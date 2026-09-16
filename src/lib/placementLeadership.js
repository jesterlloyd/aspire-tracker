// src/lib/placementLeadership.js
//
// STUDENT-PORTAL-PRECEPTOR-CONTACT-1: the ASPIRE Connect unit leadership copied
// on the Student Portal's Email Preceptor compose. Pure and node-testable. It is
// split from placementContacts.js so the Student Portal bundle never pulls in
// the contact and unit catalogs: only api/lib/studentPortalSummary.js imports it.
//
// Source (Owner decision 2026-09-16): Connect contacts in the Unit Leader
// category whose units (unit_name + related_units) include the student's unit.
// The legacy unit_leaders table is deliberately NOT read.

import {
  canonicalCategory, contactDisplayName, contactUnitList, LEGACY_TITLE_MAP,
} from './contactCategories.js'
import { unitNameKey } from './unitNameCanon.js'

// Leadership copied on Email Preceptor: the unit's Associate Director, its
// Assistant Nurse Managers, and its NPD Practitioner or Clinical Nurse
// Specialist. Directors and executives are intentionally not copied. The order
// is the Connect Unit Leader ranking (AD, then ANM, then NPD-P/CNS).
const CC_TITLE_TIER = {
  'Associate Director': 1,
  'Interim Associate Director': 1,
  'Assistant Nurse Manager': 2,
  'NPD Practitioner': 3,
  'Clinical Nurse Specialist': 3,
}

const clean = (v) => String(v || '').trim()
const emailKey = (v) => clean(v).toLowerCase()
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(v))
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })

function canonicalTitle(role) {
  const t = clean(role)
  return LEGACY_TITLE_MAP['Unit Leader']?.[t] || t
}

// Connect Unit Leader contacts for the student's unit(s), ranked AD > ANM >
// NPD-P/CNS then name, deduplicated by email. Unit names compare through
// unitNameKey so '7 SCCT' and '7SCCT' match.
export function selectUnitLeadershipCc(contacts, unitNames) {
  const wanted = new Set((Array.isArray(unitNames) ? unitNames : []).map(unitNameKey).filter(Boolean))
  if (!wanted.size) return []
  const seen = new Set()
  const out = []
  for (const c of Array.isArray(contacts) ? contacts : []) {
    if (!c || c.is_active === false) continue
    if (canonicalCategory(c.category) !== 'Unit Leader') continue
    const title = canonicalTitle(c.role)
    if (!CC_TITLE_TIER[title]) continue
    if (!contactUnitList(c).some(u => wanted.has(unitNameKey(u)))) continue
    if (!isEmail(c.email)) continue
    const key = emailKey(c.email)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: contactDisplayName(c) || clean(c.full_name), title, email: clean(c.email) })
  }
  return out.sort((a, b) => (CC_TITLE_TIER[a.title] - CC_TITLE_TIER[b.title]) || byName(a.name, b.name))
}
