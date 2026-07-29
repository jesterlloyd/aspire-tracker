// One canonical, label-independent unit key: upper-case with all non-alphanumeric characters removed,
// so spacing/punctuation/case variants of a unit name collapse to the same key (e.g. '6 NE', '6NE',
// '6-ne' -> '6NE'). Shared by the response-target matching, the target-management UI, and tests.
//
// The server (api/cohort-unit-response-targets.js canonicalUnitKey) and the database
// (cohort_unit_response_targets.unit_key_canon generated column) keep an EXACT copy of this rule;
// a test guards their parity. Never match units by display-label equality.
export function canonicalUnitKey(value) {
  return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}
