// api/availability.js
//
// WS1d-B: secure interview availability + booking administration.
//
// Authorization is SERVER-VERIFIED (WS1/WS1b/WS1c pattern). This is scheduling
// self-service + oversight (NOT account administration):
//   - Owner/Admin may manage all blocks and cancel any booking.
//   - Interviewer may create blocks (attributed to themselves), delete only the
//     blocks they created, and cancel bookings only on slots of blocks they created.
// Ownership is resolved via interview_availability_blocks.created_by_user_id →
// user_profiles.id (profile PK), matching the existing UI model. The caller's
// profile is resolved from the verified JWT; request-supplied interviewer identity
// is never trusted as ownership proof.
//
// Owner-immutability does NOT apply here: an Owner who participates as an
// interviewer is doing operational scheduling work, not mutating account state.
// These operations never change role/is_owner/account state; such fields are
// rejected if present in the body.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = ['create_block', 'delete_block', 'cancel_booking'];

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' };

  const url        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let user;
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await userClient.auth.getUser();
    if (error || !data?.user) return { authenticated: false, status: 401, reason: 'invalid_token' };
    user = data.user;
  } catch {
    return { authenticated: false, status: 401, reason: 'verify_threw' };
  }

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner, full_name')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' };
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' };
    return { authenticated: true, userId: user.id, profileId: profile.id, fullName: profile.full_name || '', role: profile.role || '', isOwner: profile.is_owner === true };
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' };
  }
}

// Owner/Admin/Interviewer may use availability (ownership enforced per-action). Default deny.
function canUseAvailability(role, isOwner) {
  if (isOwner) return true;
  return role === 'admin' || role === 'interviewer';
}
function isAdminLevel(role, isOwner) {
  return isOwner || role === 'admin';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'internal_error' });

  const requestId = `req_${randomUUID().slice(0, 8)}`;

  // Gate 1 & 2: JWT + caller profile
  const auth = await verifyCaller(req);
  if (!auth.authenticated) {
    console.log('[availability] auth rejected', { reason: auth.reason, request_id: requestId });
    if (auth.reason === 'no_profile') return res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const action = typeof body.action === 'string' ? body.action : null;

  // Gate 3: action allow-list
  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Operation not permitted.' });
  }

  // Gate 4: caller authorized to use availability at all
  if (!canUseAvailability(auth.role, auth.isOwner)) {
    console.log('[availability] insufficient authority', { callerRole: auth.role, callerIsOwner: auth.isOwner, action, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to manage availability.' });
  }

  // Gate 5: reject account-authority/state fields (this endpoint never changes them)
  for (const f of ['is_owner', 'role', 'is_active']) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      return res.status(400).json({ error: 'invalid_request', field: f, message: 'That field cannot be set through this endpoint.' });
    }
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminLevel = isAdminLevel(auth.role, auth.isOwner);

  try {
    // ── CREATE BLOCK + GENERATE SLOTS ─────────────────────────────────────────
    if (action === 'create_block') {
      const { cohort_id, block_date, start_time, end_time, duration_minutes } = body;
      if (!cohort_id || !block_date || !start_time || !end_time || !duration_minutes) {
        return res.status(400).json({ error: 'invalid_request', message: 'Missing required fields' });
      }

      // WAVE F-2: identity-backed attribution. Owner/Admin select a linked
      // interviewer ACCOUNT (interviewer_profile_id); an interviewer is forced to
      // themselves. The name is derived from the account for presentation only and
      // is never the authorization boundary. created_by_user_id stays the verified
      // caller's profile id.
      const interviewerProfileId = adminLevel
        ? (typeof body.interviewer_profile_id === 'string' ? body.interviewer_profile_id : '')
        : auth.profileId;
      if (!interviewerProfileId || !UUID_REGEX.test(interviewerProfileId)) {
        return res.status(400).json({ error: 'invalid_request', field: 'interviewer_profile_id', message: 'Select a linked interviewer account.' });
      }
      const { data: interviewerAcct, error: acctErr } = await db
        .from('user_profiles')
        .select('id, full_name, role, is_active')
        .eq('id', interviewerProfileId)
        .maybeSingle();
      if (acctErr) return res.status(500).json({ error: 'internal_error' });
      if (!interviewerAcct || interviewerAcct.is_active === false) {
        return res.status(400).json({ error: 'invalid_request', field: 'interviewer_profile_id', message: 'That interviewer account is not active.' });
      }
      const interviewerName = (interviewerAcct.full_name || '').trim();
      if (!interviewerName) return res.status(500).json({ error: 'internal_error' });

      const { data: block, error: blockError } = await db
        .from('interview_availability_blocks')
        .insert({
          cohort_id,
          interviewer_name: interviewerName,
          interviewer_profile_id: interviewerProfileId,
          block_date,
          start_time,
          end_time,
          duration_minutes: parseInt(duration_minutes),
          is_active: true,
          created_by_user_id: auth.profileId,
        })
        .select('id, cohort_id, interviewer_name, interviewer_profile_id, block_date, start_time, end_time, duration_minutes')
        .single();

      if (blockError) {
        console.log('[availability] create_block failed', { callerRole: auth.role, request_id: requestId, errorCode: blockError.code });
        return res.status(500).json({ error: 'internal_error' });
      }

      // Generate time slots (preserved logic)
      const slots = [];
      const [startH, startM] = start_time.split(':').map(Number);
      const [endH, endM]     = end_time.split(':').map(Number);
      const startTotal = startH * 60 + startM;
      const endTotal   = endH * 60 + endM;
      const dur        = parseInt(duration_minutes);
      for (let t = startTotal; t + dur <= endTotal; t += dur) {
        const h = Math.floor(t / 60).toString().padStart(2, '0');
        const m = (t % 60).toString().padStart(2, '0');
        slots.push({
          block_id: block.id, cohort_id, slot_date: block_date, slot_time: `${h}:${m}`,
          duration_minutes: dur, interviewer_name: interviewerName, is_booked: false, status: 'available',
        });
      }
      if (slots.length === 0) {
        await db.from('interview_availability_blocks').delete().eq('id', block.id);
        return res.status(400).json({ error: 'invalid_request', message: 'No slots generated. Check that end time is after start time and duration fits within the block.' });
      }

      const { data: createdSlots, error: slotsError } = await db
        .from('interview_slots')
        .insert(slots)
        .select('id, slot_date, slot_time, duration_minutes, interviewer_name, is_booked');
      if (slotsError) {
        await db.from('interview_availability_blocks').delete().eq('id', block.id);
        console.log('[availability] slot generation failed', { callerRole: auth.role, request_id: requestId, errorCode: slotsError.code });
        return res.status(500).json({ error: 'internal_error' });
      }

      // WAVE F-2: when the assignee is an interviewer, ensure an active cohort
      // entitlement exists (identity-based; the interviewer now has scheduled work
      // in this cohort). Idempotent: skip if an active row already exists; the
      // uq_ice_active index also guards a race. Owner/Admin assignees already have
      // full file access, so they need no entitlement. Best-effort: a failure here
      // never fails the block creation.
      if (String(interviewerAcct.role || '').toLowerCase() === 'interviewer') {
        try {
          const { data: existing } = await db
            .from('interviewer_cohort_entitlements')
            .select('id')
            .eq('interviewer_profile_id', interviewerProfileId)
            .eq('cohort_id', cohort_id)
            .is('revoked_at', null)
            .maybeSingle();
          if (!existing) {
            await db.from('interviewer_cohort_entitlements')
              .insert({ interviewer_profile_id: interviewerProfileId, cohort_id, granted_by_profile_id: auth.profileId });
          }
        } catch { /* best-effort; never blocks scheduling. Entitlement can be granted via the management API. */ }
      }

      console.log('[availability] block created', { callerRole: auth.role, callerIsOwner: auth.isOwner, blockId: block.id, createdBy: auth.profileId, interviewerProfileId, request_id: requestId });
      return res.status(200).json({ success: true, block, slots: createdSlots, slot_count: createdSlots.length });
    }

    // ── DELETE BLOCK + ITS UNBOOKED SLOTS ─────────────────────────────────────
    if (action === 'delete_block') {
      const blockId = typeof body.block_id === 'string' ? body.block_id : null;
      if (!blockId || !UUID_REGEX.test(blockId)) {
        return res.status(400).json({ error: 'invalid_request', field: 'block_id' });
      }

      // Resolve block + ownership
      const { data: block, error: blockFetchError } = await db
        .from('interview_availability_blocks')
        .select('id, created_by_user_id')
        .eq('id', blockId)
        .maybeSingle();
      if (blockFetchError) return res.status(500).json({ error: 'internal_error' });
      if (!block) return res.status(404).json({ error: 'not_found' });

      // Ownership: Owner/Admin any; interviewer only their own (resolved profile id).
      if (!adminLevel && block.created_by_user_id !== auth.profileId) {
        console.log('[availability] delete ownership denied', { callerRole: auth.role, blockId, request_id: requestId });
        return res.status(403).json({ error: 'forbidden', message: 'You can only manage your own availability.' });
      }

      // Scheduling integrity (preserved): drop unbooked slots, refuse if booked remain.
      const { error: slotsError } = await db.from('interview_slots').delete().eq('block_id', blockId).eq('is_booked', false);
      if (slotsError) return res.status(500).json({ error: 'internal_error' });

      const { count } = await db.from('interview_slots').select('*', { count: 'exact', head: true }).eq('block_id', blockId).eq('is_booked', true);
      if ((count || 0) > 0) {
        return res.status(409).json({ error: 'conflict', message: `Cannot delete: ${count} booked slot${count !== 1 ? 's' : ''} in this block. Cancel those bookings first.` });
      }

      const { error: blockError } = await db.from('interview_availability_blocks').delete().eq('id', blockId);
      if (blockError) return res.status(500).json({ error: 'internal_error' });

      console.log('[availability] block deleted', { callerRole: auth.role, callerIsOwner: auth.isOwner, blockId, request_id: requestId });
      return res.status(200).json({ success: true });
    }

    // ── CANCEL BOOKING (reverts student) ──────────────────────────────────────
    if (action === 'cancel_booking') {
      const slotId = typeof body.slot_id === 'string' ? body.slot_id : null;
      if (!slotId || !UUID_REGEX.test(slotId)) {
        return res.status(400).json({ error: 'invalid_request', field: 'slot_id' });
      }

      // Resolve the slot authoritatively: the affected student is the slot's
      // booked student - NEVER req.body.student_id (which is only validated to
      // match, for backward compatibility).
      const { data: slot, error: slotFetchError } = await db
        .from('interview_slots')
        .select('id, block_id, cohort_id, is_booked, booked_by_student_id')
        .eq('id', slotId)
        .maybeSingle();
      if (slotFetchError) return res.status(500).json({ error: 'internal_error' });
      if (!slot) return res.status(404).json({ error: 'not_found' });

      // The slot must currently be booked to exactly one student (single column).
      const bookedStudentId = slot.booked_by_student_id;
      if (!slot.is_booked || !bookedStudentId) {
        return res.status(409).json({ error: 'conflict', message: 'This slot is not currently booked.' });
      }

      // Backward-compat: if a student_id is supplied it MUST match the authoritative
      // booked student. Mismatch → reject with no mutation (prevents reverting an
      // unrelated student via an own-block slot id).
      if (Object.prototype.hasOwnProperty.call(body, 'student_id')) {
        const bodyStudentId = typeof body.student_id === 'string' ? body.student_id : null;
        if (!bodyStudentId || !UUID_REGEX.test(bodyStudentId) || bodyStudentId !== bookedStudentId) {
          console.log('[availability] cancel student mismatch', { callerRole: auth.role, slotId, request_id: requestId });
          return res.status(409).json({ error: 'conflict', message: 'student_id does not match the booked student.' });
        }
      }

      // Ownership: Owner/Admin any; interviewer only if the slot's block is theirs.
      if (!adminLevel) {
        const { data: block, error: blockFetchError } = await db
          .from('interview_availability_blocks')
          .select('id, created_by_user_id')
          .eq('id', slot.block_id)
          .maybeSingle();
        if (blockFetchError) return res.status(500).json({ error: 'internal_error' });
        if (!block || block.created_by_user_id !== auth.profileId) {
          console.log('[availability] cancel ownership denied', { callerRole: auth.role, slotId, request_id: requestId });
          return res.status(403).json({ error: 'forbidden', message: 'You can only manage bookings for your own availability.' });
        }
      }

      // All mutations use the RESOLVED bookedStudentId + slot.cohort_id.
      const { error: slotError } = await db
        .from('interview_slots')
        .update({ status: 'available', is_booked: false, booked_by_student_id: null, booked_at: null })
        .eq('id', slotId)
        .eq('booked_by_student_id', bookedStudentId);
      if (slotError) return res.status(500).json({ error: 'internal_error' });

      // Prune ONLY rubric-less sessions for the EXACT canceled booking: this slot
      // AND the resolved booked student. Scored/submitted sessions, and any sessions
      // for the same student on other slots/attempts/cohorts, are preserved. (The
      // prior broad student-only pass was legacy cleanup with no business rule or
      // uniqueness constraint backing it, so it is narrowed here.)
      const { data: sessions } = await db
        .from('interview_sessions')
        .select('id, cj_question_text, pp_question_text, ga_question_text')
        .eq('slot_id', slotId)
        .eq('student_id', bookedStudentId);
      if (sessions?.length > 0) {
        for (const sess of sessions) {
          const hasRubric = sess.cj_question_text || sess.pp_question_text || sess.ga_question_text;
          if (!hasRubric) await db.from('interview_sessions').delete().eq('id', sess.id);
        }
      }

      const { error: studentError } = await db
        .from('students')
        .update({ status: 'Form Received', interview_scheduled_date: null, interview_scheduled_time: null })
        .eq('id', bookedStudentId);
      if (studentError) console.warn('[availability] student revert error', { request_id: requestId, errorCode: studentError.code });

      const eventCohort = slot.cohort_id || (typeof body.cohort_id === 'string' ? body.cohort_id : null);
      if (eventCohort) {
        const { error: logErr } = await db.from('program_events').insert({
          student_id: bookedStudentId, cohort_id: eventCohort, event_type: 'interview_cancelled',
          event_date: new Date().toISOString().split('T')[0], notes: 'Interview booking cancelled.',
          created_by: auth.fullName || 'Coordinator',
        });
        if (logErr) console.warn('[availability] event log error', { request_id: requestId, errorCode: logErr.code });
      }

      console.log('[availability] booking cancelled', { callerRole: auth.role, callerIsOwner: auth.isOwner, slotId, request_id: requestId });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'invalid_request', field: 'action' });
  } catch (err) {
    console.log('[availability] unexpected error', { request_id: requestId, errorCode: err?.code });
    return res.status(500).json({ error: 'internal_error' });
  }
}
