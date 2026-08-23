/* global process */
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
// S-02: the canonical identity-based entitlement predicate, reused rather than re-queried so the
// "does this interviewer hold this cohort" question has one answer everywhere.
import { activeEntitledCohortIds } from '../lib/server/interviewerEntitlements.js';
import { isActiveProfile, INACTIVE_STATUS, INACTIVE_REASON, INACTIVE_MESSAGE } from './lib/activeAccount.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = ['create_block', 'delete_block', 'delete_slot', 'cancel_booking'];

// AVAILABILITY-CALENDAR-1: breaks between interviews.
//
// The break is a GENERATION parameter, not new schema: it only changes the
// stride between generated slots, and the resulting gap is already fully
// described by the stored slot times (next slot_time minus this slot_time minus
// duration_minutes). Readers derive it with deriveBreakMinutes below, so
// configurable breaks ship with NO migration and NO new column.
const ALLOWED_BREAKS = [0, 5, 10, 15, 30];

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
      .select('id, role, is_owner, full_name, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' };
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' };
    // S-05: a deactivated account keeps a valid access token until it expires.
    // Refuse it before any work is performed, so deactivation ends access at once.
    if (!isActiveProfile(profile)) return { authenticated: false, status: INACTIVE_STATUS, reason: INACTIVE_REASON };
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

// WAVE F-2: confirm an active cohort entitlement for an interviewer, creating one
// if absent. Returns { ok:true } only when an active row is present afterward, so
// the caller can FAIL CLOSED. Idempotent: an existing active row is confirmed with
// no insert; a concurrent insert that trips the uq_ice_active unique index is
// re-checked and treated as present. Any other failure returns { ok:false } (never
// swallowed), and never revokes or mutates an existing row.
async function ensureCohortEntitlement(db, interviewerProfileId, cohortId, actorProfileId) {
  const active = () => db
    .from('interviewer_cohort_entitlements')
    .select('id')
    .eq('interviewer_profile_id', interviewerProfileId)
    .eq('cohort_id', cohortId)
    .is('revoked_at', null)
    .maybeSingle();

  const first = await active();
  if (first.error) return { ok: false };
  if (first.data) return { ok: true, idempotent: true };

  const { error: insErr } = await db
    .from('interviewer_cohort_entitlements')
    .insert({ interviewer_profile_id: interviewerProfileId, cohort_id: cohortId, granted_by_profile_id: actorProfileId });
  if (!insErr) return { ok: true };

  // A concurrent request may have inserted the active row (uq_ice_active). Re-check.
  const retry = await active();
  if (!retry.error && retry.data) return { ok: true, idempotent: true };
  return { ok: false };
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
    if (auth.reason === INACTIVE_REASON) return res.status(INACTIVE_STATUS).json({ error: 'forbidden', message: INACTIVE_MESSAGE });
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

      // S-02: cohort_id was previously taken from the body with no validation at all and used
      // directly in the block insert AND in the entitlement insert. Validate the shape and confirm
      // the cohort exists before either write, so a malformed or unknown id is refused here rather
      // than surfacing as a foreign-key failure part way through.
      if (typeof cohort_id !== 'string' || !UUID_REGEX.test(cohort_id)) {
        return res.status(400).json({ error: 'invalid_request', field: 'cohort_id', message: 'Select a valid cohort.' });
      }
      const { data: cohortRow, error: cohortErr } = await db
        .from('cohorts').select('id').eq('id', cohort_id).maybeSingle();
      if (cohortErr) return res.status(500).json({ error: 'internal_error' });
      if (!cohortRow) {
        return res.status(400).json({ error: 'invalid_request', field: 'cohort_id', message: 'Select a valid cohort.' });
      }

      // S-02: an interviewer must not be able to cause an entitlement to be created for
      // THEMSELVES. A non-admin caller is forced to their own profile id above, so this branch is
      // exactly the self-scheduling case, and the auto-ensure below would have inserted a row with
      // granted_by_profile_id set to the same person it grants. That contradicts
      // api/interviewer-entitlements.js ("Interviewers cannot grant or revoke their own
      // entitlement") and the entitlement UI ("access follows a decision, not a role").
      //
      // Cohort access must therefore already exist before an interviewer may schedule into that
      // cohort. Owner/Admin grant it in Settings, or by scheduling the interviewer themselves,
      // which is the admin-initiated path preserved unchanged below. Checked BEFORE any write, so
      // a refusal leaves nothing to compensate for. Fails closed on a lookup error.
      if (!adminLevel) {
        let entitled = false;
        try {
          entitled = (await activeEntitledCohortIds(db, interviewerProfileId)).has(cohort_id);
        } catch {
          return res.status(500).json({ error: 'internal_error' });
        }
        if (!entitled) {
          console.log('[availability] self-schedule refused, no active cohort entitlement', { interviewerProfileId, request_id: requestId });
          return res.status(403).json({
            error: 'forbidden',
            message: 'You do not have access to this cohort yet. Ask the ASPIRE team to add it to your account, then schedule your availability.',
          });
        }
      }

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

      // Generate time slots. The only change from the original logic is the
      // stride: an interview still occupies `dur` minutes, and the next one
      // starts `dur + breakMinutes` later. The loop condition is unchanged, so
      // a slot that would overflow the end time is still never created.
      const slots = [];
      const [startH, startM] = start_time.split(':').map(Number);
      const [endH, endM]     = end_time.split(':').map(Number);
      const startTotal = startH * 60 + startM;
      const endTotal   = endH * 60 + endM;
      const dur        = parseInt(duration_minutes);
      const rawBreak   = body.break_minutes === undefined ? 0 : parseInt(body.break_minutes, 10);
      if (!ALLOWED_BREAKS.includes(rawBreak)) {
        await db.from('interview_availability_blocks').delete().eq('id', block.id);
        return res.status(400).json({ error: 'invalid_request', field: 'break_minutes', message: 'Break must be 0, 5, 10, 15, or 30 minutes.' });
      }
      const stride = dur + rawBreak;
      for (let t = startTotal; t + dur <= endTotal; t += stride) {
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

      // WAVE F-2: scheduling an interviewer FAILS CLOSED on the cohort entitlement.
      // The interviewer now has scheduled work in this cohort, so an active
      // entitlement MUST be confirmed before we report success; if it cannot be, the
      // just-created block and slots are rolled back (compensated) and a safe error
      // is returned, so a schedule never exists without matching access. Ensuring is
      // idempotent (an active row is confirmed without a second insert; a concurrent
      // insert that trips uq_ice_active is re-checked and treated as present).
      // Owner/Admin assignees already have full file access and need no entitlement.
      // This is the permitted fallback to one transactional RPC: the block/slot/auth
      // flow already lives in this serverless handler with service-role compensating
      // deletes (see the slot-failure rollback above), so entitlement is confirmed
      // under the same model rather than moving the whole flow into PL/pgSQL.
      // S-02: this auto-ensure is now the ADMIN-INITIATED path only. An Owner/Admin scheduling an
      // interviewer IS the decision that grants the cohort, and granted_by_profile_id records the
      // admin who made it, which is what the schema comment on
      // interview_availability_blocks.interviewer_profile_id describes. A self-scheduling
      // interviewer never reaches here: they were required to hold the entitlement already, above.
      if (adminLevel && String(interviewerAcct.role || '').toLowerCase() === 'interviewer') {
        const ensured = await ensureCohortEntitlement(db, interviewerProfileId, cohort_id, auth.profileId);
        if (!ensured.ok) {
          // Fail closed: roll back the block and its slots so no schedule exists
          // without the matching cohort access, and return a safe error.
          await db.from('interview_slots').delete().eq('block_id', block.id);
          await db.from('interview_availability_blocks').delete().eq('id', block.id);
          console.log('[availability] entitlement ensure failed; block + slots rolled back', { callerRole: auth.role, blockId: block.id, interviewerProfileId, request_id: requestId });
          return res.status(500).json({ error: 'entitlement_failed', message: 'Could not confirm interviewer cohort access. Nothing was scheduled; please try again.' });
        }
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

      // AVAILABILITY-CALENDAR-1 INTEGRITY FIX. The previous order deleted every
      // unbooked slot FIRST and only then counted booked ones, so a refused
      // delete (409 "cancel those bookings first") had ALREADY destroyed the
      // block's open slots: the block stayed on screen advertising a window
      // whose availability was silently gone. The booked count is now taken
      // BEFORE anything is deleted, so a refusal changes nothing.
      const { count: bookedCount, error: countError } = await db
        .from('interview_slots').select('*', { count: 'exact', head: true })
        .eq('block_id', blockId).eq('is_booked', true);
      if (countError) return res.status(500).json({ error: 'internal_error' });
      const booked = bookedCount || 0;

      // A partially booked block can still have its OPEN slots released, but only
      // on explicit consent (open_only). The block row itself is retained because
      // the booked slots still reference it: deleting it would orphan scheduled
      // interviews. Booked slots are never touched by this action.
      if (booked > 0 && body.open_only !== true) {
        return res.status(409).json({
          error: 'conflict',
          booked_count: booked,
          message: `Cannot delete: ${booked} booked slot${booked !== 1 ? 's' : ''} in this block. Cancel those bookings first, or remove only the open slots.`,
        });
      }

      const { error: slotsError, count: removedOpen } = await db
        .from('interview_slots').delete({ count: 'exact' })
        .eq('block_id', blockId).eq('is_booked', false);
      if (slotsError) return res.status(500).json({ error: 'internal_error' });

      if (booked > 0) {
        // Partial release: open slots gone, booked interviews and their parent
        // block preserved, no orphaned rows.
        console.log('[availability] open slots released; block retained for booked interviews', { callerRole: auth.role, blockId, booked, request_id: requestId });
        return res.status(200).json({ success: true, block_retained: true, booked_count: booked, removed_open: removedOpen || 0 });
      }

      const { error: blockError } = await db.from('interview_availability_blocks').delete().eq('id', blockId);
      if (blockError) return res.status(500).json({ error: 'internal_error' });

      console.log('[availability] block deleted', { callerRole: auth.role, callerIsOwner: auth.isOwner, blockId, request_id: requestId });
      return res.status(200).json({ success: true, block_retained: false, removed_open: removedOpen || 0 });
    }

    // ── DELETE ONE OPEN SLOT (parent block preserved) ─────────────────────────
    // AVAILABILITY-CALENDAR-1: the day drawer previously deleted a single slot
    // with a raw client-side write, so the action carried no ownership check of
    // its own and no booked-slot guard. It now runs here, under the same
    // ownership rule as delete_block, and refuses to touch a booked slot.
    if (action === 'delete_slot') {
      const slotId = typeof body.slot_id === 'string' ? body.slot_id : null;
      if (!slotId || !UUID_REGEX.test(slotId)) {
        return res.status(400).json({ error: 'invalid_request', field: 'slot_id' });
      }

      const { data: slot, error: slotFetchError } = await db
        .from('interview_slots')
        .select('id, block_id, is_booked')
        .eq('id', slotId)
        .maybeSingle();
      if (slotFetchError) return res.status(500).json({ error: 'internal_error' });
      if (!slot) return res.status(404).json({ error: 'not_found' });
      if (slot.is_booked) {
        return res.status(409).json({ error: 'conflict', message: 'That slot is booked. Cancel the interview first.' });
      }

      // Ownership mirrors delete_block: Owner/Admin any, interviewer only their
      // own block. A slot with no parent block is treated as admin-only.
      if (!adminLevel) {
        if (!slot.block_id) {
          return res.status(403).json({ error: 'forbidden', message: 'You can only manage your own availability.' });
        }
        const { data: parent, error: parentError } = await db
          .from('interview_availability_blocks')
          .select('id, created_by_user_id')
          .eq('id', slot.block_id)
          .maybeSingle();
        if (parentError) return res.status(500).json({ error: 'internal_error' });
        if (!parent || parent.created_by_user_id !== auth.profileId) {
          return res.status(403).json({ error: 'forbidden', message: 'You can only manage your own availability.' });
        }
      }

      const { error: deleteError } = await db.from('interview_slots').delete().eq('id', slotId);
      if (deleteError) return res.status(500).json({ error: 'internal_error' });

      // Report the parent's remaining open count so the summary refreshes
      // immediately without a second round trip.
      let remainingOpen = null;
      if (slot.block_id) {
        const { count } = await db.from('interview_slots')
          .select('*', { count: 'exact', head: true })
          .eq('block_id', slot.block_id).eq('is_booked', false);
        remainingOpen = count || 0;
      }

      console.log('[availability] slot deleted', { callerRole: auth.role, slotId, blockId: slot.block_id, request_id: requestId });
      return res.status(200).json({ success: true, block_id: slot.block_id, remaining_open: remainingOpen });
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
