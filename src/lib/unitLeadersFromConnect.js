// src/lib/unitLeadersFromConnect.js
//
// UNIT-LEADERS-RETIRE-1 (Owner, 2026-09-20): "whatever is in ASPIRE Connect > Contacts is
// the canon." Unit leadership is read from Connect contacts in the Unit Leader category and
// from nowhere else. The hand-seeded `unit_leaders` table is no longer read by anything; it
// is dropped in a later, Owner-gated migration. Rows that only ever lived in that table are
// not carried over: a leader who is not in Connect is not a leader the app knows.
//
// This module is PURE (node-testable, no client). It turns Connect contacts into the row
// shape the six former readers of unit_leaders already understood, so their logic did not
// have to be rewritten while their source changed:
//
//   { unit_name, full_name, preferred_name, email, role, role_qualifier,
//     is_primary_lead, is_active: true, contact_id }
//
// One row per (unit, contact): a multi-unit NPD Practitioner appears once for each unit on
// the contact (unit_name plus related_units), exactly as the old table listed them.
//
// THE UNIT'S LEAD. The old table marked one is_primary_lead per unit by hand, and it was the
// Associate Director in 25 of 27 units (an Acting Associate Director and an Executive
// Director acting over Float Pool were the other two). Connect has no such flag, so the lead
// is derived: the unit's Associate Director (interim or acting included), else its Director,
// else an executive acting over it. Ties break on name. Nothing else is ever the lead, so a
// unit whose only Connect contacts are an ANM and an NPD-P has no lead, and the surfaces
// that need one say so rather than guessing.
//
// The Student Portal's own selector (placementLeadership.js) reads the same contacts with a
// narrower purpose (who is copied on Email Preceptor) and keeps its own tiering; the two
// modules deliberately share the category, title and unit-name rules and nothing else.

import { canonicalCategory, contactUnitList, LEGACY_TITLE_MAP } from './contactCategories.js'
import { unitNameKey } from './unitNameCanon.js'

/** The columns every reader selects from contacts, so the adapter always has what it needs. */
export const UNIT_LEADER_CONTACT_COLUMNS =
  'id, full_name, preferred_name, email, role, role_qualifier, category, unit_name, related_units, is_active'

/** Stored category values that mean Unit Leader (the canonical form and the pre-canon one). */
export const UNIT_LEADER_CATEGORY_VALUES = Object.freeze(['Unit Leader', 'Unit Leadership'])

/** Titles that can be the unit's lead, best first. */
const LEAD_TIER = Object.freeze({
  'Associate Director': 1,
  'Interim Associate Director': 1,
  'Acting Associate Director': 1,
  'Director': 2,
  'Executive Director': 3,
})

/** The Connect Unit Leader ranking, for display order (lead first is applied separately). */
const DISPLAY_TIER = Object.freeze({
  'Executive Director': 0,
  'Director': 1,
  'Associate Director': 2, 'Interim Associate Director': 2, 'Acting Associate Director': 2,
  'Assistant Nurse Manager': 3,
  'NPD Practitioner': 4, 'Clinical Nurse Specialist': 4,
})

/** The operational team a lead's own submission is copied to (the old routing rule, kept). */
export const OPERATIONAL_TITLES = Object.freeze(['Assistant Nurse Manager', 'NPD Practitioner', 'Clinical Nurse Specialist'])

const clean = (v) => String(v || '').trim()
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(v))
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })

/** 'Unit NPD-P' and 'Unit NPD Practitioner' are the pre-canon spellings of 'NPD Practitioner'. */
export function canonicalUnitLeaderTitle(role) {
  const t = clean(role)
  return LEGACY_TITLE_MAP['Unit Leader']?.[t] || t
}

/**
 * Connect contacts -> unit leader rows.
 *
 * @param {Array<object>} contacts  rows selected with UNIT_LEADER_CONTACT_COLUMNS
 * @param {object} [options]
 * @param {string} [options.unitName]  when given, only this unit's rows, with `unit_name`
 *                                     set to the requested spelling so callers that key on
 *                                     it get back what they asked for
 * @returns {Array<object>} rows sorted by unit, then the lead, then rank, then name
 */
export function unitLeaderRows(contacts, { unitName } = {}) {
  const wantedKey = unitName ? unitNameKey(unitName) : null
  const byUnit = new Map()   // unit key -> { label, rows: Map(emailKey -> row) }

  for (const c of Array.isArray(contacts) ? contacts : []) {
    if (!c || c.is_active === false) continue
    if (canonicalCategory(c.category) !== 'Unit Leader') continue
    if (!isEmail(c.email)) continue
    const role = canonicalUnitLeaderTitle(c.role)
    for (const unit of contactUnitList(c)) {
      const key = unitNameKey(unit)
      if (!key) continue
      if (wantedKey && key !== wantedKey) continue
      if (!byUnit.has(key)) byUnit.set(key, { label: wantedKey ? clean(unitName) : clean(unit), rows: new Map() })
      const bucket = byUnit.get(key)
      const emailKey = clean(c.email).toLowerCase()
      if (bucket.rows.has(emailKey)) continue
      bucket.rows.set(emailKey, {
        unit_name: bucket.label,
        full_name: clean(c.full_name),
        preferred_name: clean(c.preferred_name) || null,
        email: clean(c.email),
        role,
        role_qualifier: clean(c.role_qualifier) || null,
        is_primary_lead: false,
        is_active: true,
        contact_id: c.id ?? null,
      })
    }
  }

  const out = []
  const units = [...byUnit.values()].sort((a, b) => byName(a.label, b.label))
  for (const { rows } of units) {
    const list = [...rows.values()]
    const lead = list
      .filter(r => LEAD_TIER[r.role])
      .sort((a, b) => (LEAD_TIER[a.role] - LEAD_TIER[b.role]) || byName(a.full_name, b.full_name))[0]
    if (lead) lead.is_primary_lead = true
    list.sort((a, b) =>
      (b.is_primary_lead ? 1 : 0) - (a.is_primary_lead ? 1 : 0) ||
      ((DISPLAY_TIER[a.role] ?? 9) - (DISPLAY_TIER[b.role] ?? 9)) ||
      byName(a.full_name, b.full_name))
    out.push(...list)
  }
  return out
}

/** The unit's lead among rows unitLeaderRows() produced, or null. */
export function findPrimaryLead(leaders) {
  return (Array.isArray(leaders) ? leaders : []).find(l => l && l.is_primary_lead) || null
}

/** The unit's operational team (ANM, NPD-P, CNS) among rows unitLeaderRows() produced. */
export function findOperationalLeaders(leaders) {
  return (Array.isArray(leaders) ? leaders : []).filter(l => l && OPERATIONAL_TITLES.includes(l.role))
}

/**
 * Who is copied on the "unit form received" confirmation, from the unit's rows and the
 * submitter's address. The rule is the one the old table's routing carried, unchanged:
 * the lead submitted it -> copy the operational team; someone else submitted it -> copy
 * the lead; the submitter is never copied on their own confirmation. A unit with no lead
 * on file gets no CC, and the confirmation still goes to the submitter.
 */
export function selectUnitFormCc({ leaders, submitterEmail } = {}) {
  const submitter = clean(submitterEmail).toLowerCase()
  if (!submitter) return []
  const rows = Array.isArray(leaders) ? leaders : []
  const lead = findPrimaryLead(rows)
  const submitterIsLead = !!lead && clean(lead.email).toLowerCase() === submitter
  const cc = submitterIsLead ? findOperationalLeaders(rows) : (lead ? [lead] : [])
  return cc
    .filter(l => clean(l.email).toLowerCase() !== submitter)
    .map(l => ({ name: l.full_name, preferred_name: l.preferred_name || null, email: l.email }))
}
