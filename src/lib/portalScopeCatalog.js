// ASPIRE-PORTAL-ACCESS-UI: client-side canonical catalogs for the Grant Portal
// Access modal's scope selectors. Units come from the existing UNIT_CATALOG
// (the exact keys provision_portal_access stores). Schools mirror the canonical
// names in api/lib/schoolAliases.js so the academic-partner school_keys the UI
// submits match the alias-aware matching used by the partner portal.
//
// These are display catalogs only. Authorization is always enforced server-side
// by the invite endpoint and provision_portal_access.

import { UNIT_CATALOG } from './unitCatalog.js'

// Canonical unit keys (exact strings provision_portal_access expects).
export const UNIT_SCOPE_OPTIONS = UNIT_CATALOG.map(u => ({
  value: u.name,
  label: u.name,
  hint: u.description,
  group: u.division,
}))

// Canonical school names with their approved aliases / abbreviations (kept in
// step with api/lib/schoolAliases.js). `aliases` drive alias-aware autofill
// matching (matchSchoolKeys) so forms like "Cal State LA" and "CSULA" resolve to
// the canonical key.
export const SCHOOL_SCOPE_OPTIONS = [
  { value: 'Azusa Pacific University', label: 'Azusa Pacific University', hint: 'APU',
    aliases: ['APU', 'Azusa Pacific', 'Azusa'] },
  { value: 'California State University, Long Beach', label: 'California State University, Long Beach', hint: 'CSULB',
    aliases: ['CSULB', 'Cal State Long Beach', 'CSU Long Beach', 'Long Beach State'] },
  { value: 'California State University, Los Angeles', label: 'California State University, Los Angeles', hint: 'CSULA',
    aliases: ['CSULA', 'Cal State LA', 'Cal State Los Angeles', 'CSU Los Angeles'] },
  { value: 'West Coast University Anaheim', label: 'West Coast University Anaheim', hint: 'WCU Anaheim',
    aliases: ['WCU Anaheim', 'West Coast University, Anaheim'] },
  { value: 'West Coast University North Hollywood', label: 'West Coast University North Hollywood', hint: 'WCU North Hollywood',
    aliases: ['WCU North Hollywood', 'WCU NoHo', 'West Coast University NoHo', 'West Coast University, North Hollywood'] },
]
