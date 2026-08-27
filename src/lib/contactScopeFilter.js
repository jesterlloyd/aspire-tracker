// src/lib/contactScopeFilter.js
//
// NA-CONTACTS-SCOPE-1: the pure School / Division / Unit scope filter for the
// Nursing Education & Leadership Contacts directory. No I/O, node-testable.
//
// The dropdown's options come from the code-level catalogs (school identity
// groups + the canonical unit catalog with its divisions), so the filter can
// never invent a scope. Matching rules (approved 2026-08-27):
//   School   - the contact's school (or organization) resolves to that
//              operative school identity (exact-normalized, never fuzzy).
//   Unit     - the contact's unit list (unit_name + related_units) contains
//              the unit (acting executives with stored units match too).
//   Division - the contact's units include ANY unit of that catalog division
//              (3 SCCT is Critical Care, per the catalog), OR the contact's
//              Services text mentions the division (Carol Mention's
//              "Critical Care Services" matches the Critical Care division).

import { UNIT_CATALOG } from './unitCatalog.js'
import { SCHOOL_PICKER_OPTIONS, resolveOperativeSchoolName } from './schoolIdentity.js'
import { contactUnitList } from './contactCategories.js'

const SCHOOL_OPTIONS = SCHOOL_PICKER_OPTIONS
const DIVISIONS = [...new Set(UNIT_CATALOG.map(u => u.division).filter(Boolean))]
const UNIT_OPTIONS = UNIT_CATALOG.map(u => u.name)
const UNITS_BY_DIVISION = new Map(DIVISIONS.map(d => [
  d, new Set(UNIT_CATALOG.filter(u => u.division === d).map(u => u.name)),
]))
const SCHOOL_SET = new Set(SCHOOL_OPTIONS)
const UNIT_SET = new Set(UNIT_OPTIONS)
const DIVISION_SET = new Set(DIVISIONS)

// The grouped options for the dropdown, in reading order.
export const CONTACT_SCOPE_GROUPS = Object.freeze([
  { label: 'Schools', options: SCHOOL_OPTIONS },
  { label: 'Divisions', options: DIVISIONS },
  { label: 'Units', options: UNIT_OPTIONS },
])

export function contactScopeKind(scope) {
  if (!scope) return null
  if (SCHOOL_SET.has(scope)) return 'school'
  if (DIVISION_SET.has(scope)) return 'division'
  if (UNIT_SET.has(scope)) return 'unit'
  return null
}

const clean = v => String(v || '').trim()

function matchesSchool(contact, school) {
  const stored = resolveOperativeSchoolName(contact?.school_name)?.displayName
    || resolveOperativeSchoolName(contact?.organization)?.displayName
    || null
  return stored === school
}

// NA-CONTACTS-SCOPE-2: word-bounded service aliases per division, so an
// executive whose Services text names the division by another name still
// matches (Dan Sabin's "OR Operations" -> Procedural). All-caps aliases match
// case-sensitively (a lowercase word "or" must never match); the rest are
// case-insensitive.
const DIVISION_SERVICE_ALIASES = {
  Procedural: ['OR', 'Operating Room', 'Perioperative', 'PACU'],
}
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function serviceAliasMatches(services, alias) {
  const caseSensitive = alias === alias.toUpperCase()
  const re = new RegExp(`(^|[^A-Za-z])${escapeRe(alias)}([^A-Za-z]|$)`, caseSensitive ? '' : 'i')
  return re.test(services)
}

function matchesDivision(contact, division) {
  const units = UNITS_BY_DIVISION.get(division)
  if (contactUnitList(contact || {}).some(u => units?.has(u))) return true
  // Services-text match: "Critical Care Services" mentions "Critical Care".
  const services = clean(contact?.services)
  if (services.toLowerCase().includes(division.toLowerCase())) return true
  return (DIVISION_SERVICE_ALIASES[division] || []).some(alias => serviceAliasMatches(services, alias))
}

// True when the contact belongs to the selected scope (empty scope = everyone).
export function contactMatchesScope(contact, scope) {
  const kind = contactScopeKind(scope)
  if (!kind) return true
  if (kind === 'school') return matchesSchool(contact, scope)
  if (kind === 'unit') return contactUnitList(contact || {}).includes(scope)
  return matchesDivision(contact, scope)
}

// NA-CONTACTS-SCOPE-2 (approved): under a UNIT or DIVISION scope, the grouped
// directory leads with the chain of command - Nursing Executives, then Unit
// Leaders, then Preceptors - before the remaining categories. School scopes
// and the unscoped view keep the base order.
export function scopedCategoryOrder(scope, baseOrder) {
  const kind = contactScopeKind(scope)
  if (kind !== 'unit' && kind !== 'division') return baseOrder
  const lead = ['Nursing Executive', 'Unit Leader', 'Preceptor']
  return [...lead, ...baseOrder.filter(c => !lead.includes(c))]
}
