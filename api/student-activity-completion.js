import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import {
  REQUIRED_ACTIVITY_KEYS, ACTIVITY_LABELS, currentActivityState,
} from '../src/lib/evaluation/postRotationSequence.js';
import { isActiveProfile, INACTIVE_STATUS, INACTIVE_REASON, INACTIVE_MESSAGE } from './lib/activeAccount.js';

// POST-ROTATION-SEQUENCED-RELEASE-1 - record / correct required activity completion.
//
// This is the ONLY supported way staff record that a student completed a required
// program activity (Town Hall, Interview Bootcamp, Resume Review). Without it the
// release gate would be unusable without manual SQL.
//
// WHAT IT WILL NOT DO. It never sends email, never mints a token, never creates or
// touches an evaluation assignment, and never releases anything. Recording a
// completion can unblock a release in the UI, but a human still has to click
// Release in the panel, and that endpoint re-derives every prerequisite itself.
//
// APPEND-ONLY. A correction is a NEW 'reverse' row, so the original actor and
// timestamp survive untouched. The database enforces this: the migration REVOKEs
// UPDATE and DELETE from service_role, so this endpoint could not rewrite history
// even if it tried.
//
// IDENTITY IS NEVER TAKEN FROM THE BODY. The acting user is resolved from the
// bearer token -> user_profiles. A body-supplied recorded_by is rejected outright
// rather than ignored, so a caller cannot even appear to attribute an action to
// someone else.

/* global process */

const ACTIONS = ['complete', 'reverse'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v.trim());

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401 };

  const url        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  let user;
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await userClient.auth.getUser();
    if (error || !data?.user) return { ok: false, status: 401 };
    user = data.user;
  } catch {
    return { ok: false, status: 401 };
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role, is_owner, full_name, email, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!profile) return { ok: false, status: 403 };
  // S-05: a deactivated account keeps a valid access token until it expires.
  // Refuse it before any work is performed, so deactivation ends access at once.
  if (!isActiveProfile(profile)) return { ok: false, status: INACTIVE_STATUS, reason: INACTIVE_REASON };
  // Recording program-activity completion is an Owner/Admin action, matching the
  // release endpoints this feeds.
  if (!['owner', 'admin'].includes(profile.role)) return { ok: false, status: 403 };
  return { ok: true, profile };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  // ── 1. Authorize on the SERVER. UI gating is not a gate. ────────────────────
  const auth = await verifyCaller(req);
  if (auth.reason === INACTIVE_REASON) return res.status(INACTIVE_STATUS).json({ success: false, error: 'Forbidden', message: INACTIVE_MESSAGE });
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.status === 403 ? 'Forbidden' : 'Unauthorized' });
  }
  const actorId = auth.profile.id;
  const actorName = (auth.profile.full_name || auth.profile.email || 'Staff member').trim();

  // ── 2. Strict body allowlist ────────────────────────────────────────────────
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }

  const ALLOWED = ['student_id', 'activity_key', 'action', 'completed_at', 'reason', 'notes'];
  const extra = Object.keys(body).filter(k => !ALLOWED.includes(k));
  if (extra.length) {
    // Explicitly refuse an attempt to supply the acting identity, rather than
    // silently dropping it - a caller must never believe it worked.
    return res.status(400).json({
      success: false,
      error: `Unexpected field(s): ${extra.join(', ')}. The acting user is taken from your session, never from the request.`,
    });
  }

  const studentId = typeof body.student_id === 'string' ? body.student_id.trim() : '';
  if (!isUuid(studentId)) {
    return res.status(400).json({ success: false, error: 'student_id must be a valid UUID' });
  }
  const activityKey = typeof body.activity_key === 'string' ? body.activity_key.trim() : '';
  if (!REQUIRED_ACTIVITY_KEYS.includes(activityKey)) {
    return res.status(400).json({
      success: false,
      error: `Unknown activity. Allowed: ${REQUIRED_ACTIVITY_KEYS.join(', ')}.`,
    });
  }
  const action = typeof body.action === 'string' ? body.action.trim() : 'complete';
  if (!ACTIONS.includes(action)) {
    return res.status(400).json({ success: false, error: `action must be one of: ${ACTIONS.join(', ')}` });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (action === 'reverse' && !reason) {
    return res.status(400).json({ success: false, error: 'A correction requires a reason.' });
  }

  let completedAt = null;
  if (action === 'complete') {
    const raw = typeof body.completed_at === 'string' && body.completed_at.trim()
      ? body.completed_at.trim()
      : new Date().toISOString();
    const t = new Date(raw);
    if (Number.isNaN(t.getTime())) {
      return res.status(400).json({ success: false, error: 'completed_at is not a valid date' });
    }
    if (t.getTime() > Date.now() + 60 * 1000) {
      return res.status(400).json({ success: false, error: 'completed_at cannot be in the future' });
    }
    completedAt = t.toISOString();
  }

  // ── 3. Cohort membership, verified server-side ──────────────────────────────
  // The student must exist and belong to a cohort. The caller supplies no cohort
  // at all, so it cannot be spoofed; the student's own row is the authority.
  const { data: student, error: studentErr } = await supabaseAdmin
    .from('students')
    .select('id, cohort_id, first_name, preferred_first_name, last_name')
    .eq('id', studentId)
    .maybeSingle();
  if (studentErr) {
    return res.status(500).json({ success: false, error: 'Failed to load the student' });
  }
  if (!student) {
    return res.status(404).json({ success: false, error: 'Student not found' });
  }
  if (!student.cohort_id || !isUuid(student.cohort_id)) {
    return res.status(422).json({ success: false, error: 'This student is not in a cohort, so activity completion cannot be recorded.' });
  }

  // ── 4. Idempotency: read the current state before appending ─────────────────
  const { data: events, error: evErr } = await supabaseAdmin
    .from('student_activity_completions')
    .select('id, activity_key, action, completed_at, created_at, recorded_by_name')
    .eq('student_id', studentId)
    .eq('activity_key', activityKey)
    .order('created_at', { ascending: true })
    // Stable tiebreak: tied created_at must not resolve arbitrarily.
    .order('id', { ascending: true });
  if (evErr) {
    return res.status(500).json({ success: false, error: 'Activity tracking is unavailable. Nothing was recorded.' });
  }

  const current = currentActivityState(events || []).get(activityKey) || null;
  const alreadyComplete = !!(current && current.completed);

  if (action === 'complete' && alreadyComplete) {
    return res.status(200).json({
      success: true, recorded: false, idempotent: true,
      state: { activity_key: activityKey, completed: true, completed_at: current.completedAt, recorded_by_name: current.recordedByName },
      message: `${ACTIVITY_LABELS[activityKey] || activityKey} is already recorded as complete for this student.`,
    });
  }
  if (action === 'reverse' && !alreadyComplete) {
    return res.status(200).json({
      success: true, recorded: false, idempotent: true,
      state: { activity_key: activityKey, completed: false, completed_at: null },
      message: `${ACTIVITY_LABELS[activityKey] || activityKey} is not currently recorded as complete, so there is nothing to correct.`,
    });
  }

  // ── 5. Append. Never update, never delete. ──────────────────────────────────
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('student_activity_completions')
    .insert({
      student_id:       studentId,
      activity_key:     activityKey,
      action,
      completed_at:     completedAt,
      reason:           action === 'reverse' ? reason : null,
      source:           action === 'reverse' ? 'correction' : 'staff_confirmed',
      recorded_by:      actorId,
      recorded_by_name: actorName,
      notes:            typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null,
    })
    .select('id, activity_key, action, completed_at, created_at, recorded_by_name')
    .single();

  if (insErr) {
    return res.status(500).json({ success: false, error: 'Failed to record the activity. Nothing was changed.' });
  }

  // The caller gets the NEW effective state so the panel can update immediately
  // without a refetch race.
  const nextEvents = [...(events || []), inserted];
  const next = currentActivityState(nextEvents).get(activityKey) || null;

  return res.status(200).json({
    success: true,
    recorded: true,
    event: inserted,
    state: {
      activity_key: activityKey,
      completed: !!(next && next.completed),
      completed_at: next && next.completed ? next.completedAt : null,
      recorded_by_name: next && next.completed ? next.recordedByName : null,
    },
    // Stated explicitly because this endpoint sits next to ones that do send.
    sent_email: false,
  });
}
