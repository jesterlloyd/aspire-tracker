// NGRP-WORKSPACE-1 (correction): the ONE client-side NGRP capability check.
//
// The decision itself lives in the canonical ROLE-MODEL-1 table
// (lib/server/access.js): Owner CAPABILITY (is_owner, never the role string
// alone), Admin, and Co-Lead (both persisted spellings via normalizeRole).
// Interviewer, Viewer, portal roles, and anonymous callers hold nothing.
// This wrapper only adds the active-profile requirement, mirroring how the
// server verifiers layer isActiveProfile over the same table - a deactivated
// Owner/Admin/Co-Lead fails closed on both sides.
//
// Do NOT use AuthContext's broad canEdit for NGRP: it omits Co-Lead and does
// not express this workspace's role model.
import { can } from '../../../lib/server/access.js'

export function canAccessNgrp(profile) {
  if (!profile || profile.is_active === false) return false
  return can(profile, 'ngrp_access')
}

export function canManageNgrp(profile) {
  if (!profile || profile.is_active === false) return false
  return can(profile, 'ngrp_manage')
}

// Per-authenticated-user NGRP cycle preference (plan §3.2). Keyed by the
// Supabase user id - never one browser-global key - so two accounts on the
// same browser cannot inherit each other's cycle selection.
export function ngrpCycleStorageKey(userId) {
  return userId ? `aspire:ngrpCycle:${userId}` : null
}
