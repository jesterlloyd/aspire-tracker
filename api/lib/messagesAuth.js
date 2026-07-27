// api/lib/messagesAuth.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): server-verified caller identity for the
// Messages APIs. Builds on the existing verifyPortalCaller/getServiceDb pattern.
//
// Identity and authority come ONLY from the verified Supabase JWT plus
// authoritative rows. Nothing in a request body ever influences authorization.
// Every Messages actor is a user_profiles.id resolved through
// user_profiles.auth_user_id; a profile id is never compared to auth.uid().
//
// is_staff() is never used: it also returns true for interviewer and viewer.
// Staff Messages access requires an ACTIVE owner or admin.

/* global process */
import { createClient } from '@supabase/supabase-js';
import { verifyPortalCaller, getServiceDb } from './portalAuth.js';
import { verifyPortalUnitLeaderCaller } from './unitLeaderScope.js';
import { verifyPortalAcademicPartnerCaller } from './schoolScope.js';

export { getServiceDb };

const STAFF_ROLES = ['owner', 'admin'];

// A Supabase client scoped to the CALLER's JWT. Used only for the authenticated
// SECURITY DEFINER read RPCs, which resolve auth.uid() internally. Reads are
// therefore never unrestricted service_role queries.
export function getUserScopedDb(req) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const token = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!url || !anonKey || !token) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Active Owner or Admin only. Returns { ok: true, profile } or
// { ok: false, status, reason }.
export async function verifyStaffCaller(req) {
  const caller = await verifyPortalCaller(req);
  if (!caller.authenticated) {
    return { ok: false, status: caller.status || 401, reason: caller.reason || 'unauthenticated' };
  }
  const role = String(caller.profile.role || '').toLowerCase();
  if (!STAFF_ROLES.includes(role)) {
    return { ok: false, status: 403, reason: 'staff_role_required' };
  }
  if (caller.profile.is_active === false) {
    return { ok: false, status: 403, reason: 'inactive_staff' };
  }
  return { ok: true, profile: caller.profile };
}

// Active Student Portal user only. Version one authorizes the student role;
// unit_leader, academic_partner, and preceptor remain schema reservations and are
// intentionally NOT accepted here.
//
// Returns { ok: true, profile, studentIds } or { ok: false, status, reason }.
/**
 * UL-PORTAL / AP-PORTAL: an ACTIVE portal caller who may use Messages, of any supported kind.
 *
 * Returns { ok: true, profile, actorKind: 'student' | 'unit_leader' | 'academic_partner',
 *   studentIds, unitKeys, schoolKeys } or { ok: false, status, reason }.
 *
 * Student is tried FIRST and its result is returned unchanged, so every existing Student Portal path
 * behaves exactly as before, including its failure reasons. A unit leader is admitted only when the
 * student check finds no student role at all, never as a fallback for a student whose access is merely
 * broken. An academic partner is admitted LAST, only when the caller is neither a student nor a unit
 * leader, so no existing student/unit-leader behavior changes.
 *
 * This deliberately does NOT re-derive per-conversation authorization. The read RPCs gate every row
 * through my_message_conversation_ids(), and the write RPCs gate through message_participant_can_send.
 * For academic_partner those DB predicates are fail-closed until the Owner SQL gate is applied: reads
 * return an EMPTY inbox (never a leak) and general-thread creation is refused.
 * This helper only answers "may this account use Messages at all".
 */
export async function verifyPortalMessagesCaller(req) {
  const asStudent = await verifyPortalStudentCaller(req);
  if (asStudent.ok) {
    return { ...asStudent, actorKind: 'student', unitKeys: [] };
  }
  // Only a caller with no student role is considered as a unit leader. A student
  // with a revoked link keeps its own denial rather than being re-evaluated.
  if (asStudent.reason !== 'no_active_student_grant') return asStudent;

  const asUnitLeader = await verifyPortalUnitLeaderCaller(req);
  if (asUnitLeader.ok) {
    return {
      ok: true,
      profile: asUnitLeader.profile,
      actorKind: 'unit_leader',
      studentIds: [],
      unitKeys: asUnitLeader.unitKeys,
    };
  }

  // Academic Partner: active academic_partner grant + at least one active user_school_scopes row.
  const asPartner = await verifyPortalAcademicPartnerCaller(req);
  if (asPartner.ok) {
    const schoolKeys = [...new Set((asPartner.scopes || []).map((s) => s.school_key).filter(Boolean))];
    return {
      ok: true,
      profile: asPartner.profile,
      actorKind: 'academic_partner',
      studentIds: [],
      unitKeys: [],
      schoolKeys,
    };
  }

  // Neither student, unit leader, nor academic partner: keep the unit-leader denial (prior behavior).
  return { ok: false, status: asUnitLeader.status, reason: asUnitLeader.reason };
}

export async function verifyPortalStudentCaller(req) {
  const caller = await verifyPortalCaller(req);
  if (!caller.authenticated) {
    return { ok: false, status: caller.status || 401, reason: caller.reason || 'unauthenticated' };
  }

  const db = getServiceDb();
  const nowIso = new Date().toISOString();

  // Active student role grant (canonical predicate).
  const { data: grants, error: gErr } = await db
    .from('user_role_grants')
    .select('id, starts_at, expires_at, revoked_at')
    .eq('user_profile_id', caller.profile.id)
    .eq('role', 'student')
    .is('revoked_at', null);
  if (gErr) return { ok: false, status: 403, reason: 'grant_lookup_failed' };

  const activeGrant = (grants || []).some(
    (g) => g.starts_at <= nowIso && (g.expires_at == null || g.expires_at > nowIso),
  );
  if (!activeGrant) return { ok: false, status: 403, reason: 'no_active_student_grant' };

  // Active student link.
  const { data: links, error: lErr } = await db
    .from('user_student_links')
    .select('student_id')
    .eq('user_profile_id', caller.profile.id)
    .is('revoked_at', null);
  if (lErr) return { ok: false, status: 403, reason: 'link_lookup_failed' };

  const studentIds = (links || []).map((l) => l.student_id);
  if (studentIds.length === 0) return { ok: false, status: 403, reason: 'no_active_student_link' };

  return { ok: true, profile: caller.profile, studentIds };
}
