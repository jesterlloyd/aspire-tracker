// src/lib/unitLeaders.js
// Frontend-only helper for querying the unit_leaders table.
// Uses the browser anon client (public read via RLS policy).
// For server-side (notification routing), recipients.js queries directly via service role.

import { supabase } from './supabase.js';

export async function getUnitLeaders(unitName) {
  const { data, error } = await supabase
    .from('unit_leaders')
    .select('*')
    .eq('unit_name', unitName)
    .eq('is_active', true)
    .order('is_primary_lead', { ascending: false });

  if (error) {
    console.error('[unitLeaders] fetch error:', error);
    return [];
  }
  return data || [];
}

export async function getAllUnitLeaders() {
  const { data, error } = await supabase
    .from('unit_leaders')
    .select('*')
    .eq('is_active', true)
    .order('unit_name')
    .order('is_primary_lead', { ascending: false });

  if (error) {
    console.error('[unitLeaders] fetch all error:', error);
    return [];
  }
  return data || [];
}

export function findPrimaryLead(leaders) {
  return leaders.find(l => l.is_primary_lead) || null;
}

export function findOperationalLeaders(leaders) {
  return leaders.filter(l =>
    ['Assistant Nurse Manager', 'NPD Practitioner', 'Clinical Nurse Specialist'].includes(l.role)
  );
}

export function isSubmitterPrimaryLead(leaders, submitterEmail) {
  if (!submitterEmail) return false;
  const primary = findPrimaryLead(leaders);
  if (!primary) return false;
  return primary.email.toLowerCase() === submitterEmail.toLowerCase().trim();
}
