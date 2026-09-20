// src/lib/unitLeaders.js
//
// Browser-side unit leadership, read from ASPIRE Connect > Contacts (UNIT-LEADERS-RETIRE-1,
// Owner 2026-09-20). The legacy `unit_leaders` table is not read here or anywhere else; the
// pure adapter in unitLeadersFromConnect.js turns Unit Leader contacts into the row shape
// these helpers always returned, so callers did not change. Server-side readers
// (notification routing, Keith) select the same columns with the service role and run the
// same adapter.

import { supabase } from './supabase.js';
import {
  UNIT_LEADER_CONTACT_COLUMNS, UNIT_LEADER_CATEGORY_VALUES, unitLeaderRows,
  findPrimaryLead, findOperationalLeaders,
} from './unitLeadersFromConnect.js';

export { findPrimaryLead, findOperationalLeaders };

/** Active Unit Leader contacts, as stored. Errors are reported and read as "no leaders". */
export async function fetchUnitLeaderContacts() {
  const { data, error } = await supabase
    .from('contacts')
    .select(UNIT_LEADER_CONTACT_COLUMNS)
    .in('category', [...UNIT_LEADER_CATEGORY_VALUES])
    .eq('is_active', true);
  if (error) {
    console.error('[unitLeaders] contacts fetch error:', error);
    return [];
  }
  return data || [];
}

/** One unit's leaders, lead first. */
export async function getUnitLeaders(unitName) {
  if (!unitName) return [];
  return unitLeaderRows(await fetchUnitLeaderContacts(), { unitName });
}

/** Every unit's leaders, by unit, lead first. */
export async function getAllUnitLeaders() {
  return unitLeaderRows(await fetchUnitLeaderContacts());
}

export function isSubmitterPrimaryLead(leaders, submitterEmail) {
  if (!submitterEmail) return false;
  const primary = findPrimaryLead(leaders);
  if (!primary) return false;
  return primary.email.toLowerCase() === submitterEmail.toLowerCase().trim();
}
