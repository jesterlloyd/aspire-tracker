// api/messages-staff-options.js
//
// ASPIRE MESSAGES, PHASE 4A: the two narrow lookups the staff interface needs.
// Active Owner or Admin only, reusing the Phase 3 verifyStaffCaller (which never
// uses is_staff, so interviewer and viewer are excluded, and an inactive Owner or
// Admin is denied).
//
//   GET ?kind=assignees            -> active Owner/Admin assignment options
//   GET ?kind=participants&q=...   -> active Student Portal participants
//
// Both are deliberately NARROW. This is not a directory: it returns only the few
// fields an assignment control or a participant picker needs, and never
// auth_user_id, role-grant history, permission internals, contact details, or
// unrelated profiles.
//
// api/list-portal-access.js was evaluated for the participant lookup and
// rejected: it returns ALL role grants (active and historical) across ALL portal
// roles, with emails, last_login_at, and unit/school scope history. That is a
// general portal-access admin view, not this narrow active-student lookup.
//
// Identity: every option is keyed by user_profiles.id, preserving the
// three-identity model. Staff email is not returned; the server owns all
// notification routing, so the browser never needs a recipient address.

import { verifyStaffCaller, getServiceDb } from './lib/messagesAuth.js';
import { methodGuard, logApiError } from './lib/messagesApi.js';

const ASSIGNEE_LIMIT = 50;    // the Owner/Admin list is intentionally small
const PARTICIPANT_LIMIT = 20; // capped picker results
const MIN_SEARCH = 2;

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const kind = req.query?.kind;
  if (kind !== 'assignees' && kind !== 'participants') {
    return res.status(422).json({ error: 'invalid_kind' });
  }

  const db = getServiceDb();

  try {
    if (kind === 'assignees') return await listAssignees(db, caller, res);
    return await listParticipants(db, req, res);
  } catch (err) {
    logApiError('messages-staff-options', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}

// Active Owner and Admin profiles only. Interviewer, viewer, student, portal, and
// any inactive profile are excluded.
async function listAssignees(db, caller, res) {
  const { data, error } = await db
    .from('user_profiles')
    .select('id, full_name, role, is_active')
    .in('role', ['owner', 'admin'])
    .limit(ASSIGNEE_LIMIT);

  if (error) {
    logApiError('messages-staff-options', 'assignee_read_failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }

  // COALESCE(is_active, true): legacy null means active, matching is_staff() and
  // is_active_owner_or_admin().
  const options = (data || [])
    .filter((p) => p.is_active !== false)
    .map((p) => ({
      profile_id: p.id,
      display_name: p.full_name || 'ASPIRE staff',
      role: p.role,
      is_current_user: p.id === caller.profile.id,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return res.status(200).json({ options });
}

// Active Student Portal participants only, using the canonical active predicate.
// Excludes revoked, expired, and not-yet-started grants; revoked student links;
// inactive profiles; and every non-student portal role.
async function listParticipants(db, req, res) {
  const q = typeof req.query?.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const nowIso = new Date().toISOString();

  const { data: grants, error: gErr } = await db
    .from('user_role_grants')
    .select('user_profile_id, starts_at, expires_at, revoked_at')
    .eq('role', 'student')
    .is('revoked_at', null);
  if (gErr) {
    logApiError('messages-staff-options', 'grant_read_failed', gErr);
    return res.status(500).json({ error: 'internal_error' });
  }

  const activeProfileIds = [...new Set((grants || [])
    .filter((g) => g.starts_at <= nowIso && (g.expires_at == null || g.expires_at > nowIso))
    .map((g) => g.user_profile_id))];
  if (activeProfileIds.length === 0) return res.status(200).json({ options: [] });

  // Active student links only.
  const { data: links } = await db
    .from('user_student_links')
    .select('user_profile_id, student_id')
    .in('user_profile_id', activeProfileIds)
    .is('revoked_at', null);
  const linkByProfile = new Map((links || []).map((l) => [l.user_profile_id, l.student_id]));
  const linkedProfileIds = [...linkByProfile.keys()];
  if (linkedProfileIds.length === 0) return res.status(200).json({ options: [] });

  // Active profiles only. The portal role marker keeps staff profiles out.
  let profileQuery = db
    .from('user_profiles')
    .select('id, full_name, is_active')
    .in('id', linkedProfileIds);
  if (q.length >= MIN_SEARCH) profileQuery = profileQuery.ilike('full_name', `%${q}%`);
  const { data: profiles, error: pErr } = await profileQuery.limit(PARTICIPANT_LIMIT);
  if (pErr) {
    logApiError('messages-staff-options', 'profile_read_failed', pErr);
    return res.status(500).json({ error: 'internal_error' });
  }

  const active = (profiles || []).filter((p) => p.is_active !== false);
  const studentIds = active.map((p) => linkByProfile.get(p.id)).filter(Boolean);

  // Minimal disambiguating context only (school). No clinical or contact detail.
  let studentsById = {};
  if (studentIds.length) {
    const { data: studs } = await db
      .from('students')
      .select('id, school')
      .in('id', studentIds);
    studentsById = Object.fromEntries((studs || []).map((s) => [s.id, s]));
  }

  const options = active.map((p) => {
    const studentId = linkByProfile.get(p.id);
    return {
      participant_profile_id: p.id,
      student_id: studentId,
      display_name: p.full_name || 'ASPIRE student',
      context: studentsById[studentId]?.school || null,
      access_active: true,
    };
  }).sort((a, b) => a.display_name.localeCompare(b.display_name));

  return res.status(200).json({ options });
}
