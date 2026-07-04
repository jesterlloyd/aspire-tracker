// api/admin-users.js
//
// WS1c: secure user-administration mutations.
//
// Authorization is SERVER-VERIFIED. Caller identity/authority come ONLY from the
// verified Supabase JWT + the authoritative user_profiles row; req.body never
// controls caller authorization. Named-operation allow-list only (no arbitrary
// table/column/RPC). Owner accounts are IMMUTABLE through this endpoint. Callers
// cannot mutate themselves. Identifier domains are kept strict: req.body.user_id
// is a user_profiles.id (profile PK); self-targeting is decided by comparing the
// RESOLVED target.auth_user_id to the caller's auth.users.id.
//
// Gates (all must pass before any mutation):
//   1 JWT verified  2 caller profile resolved  3 operation allow-listed
//   4 caller authorized for the operation  5 no is_owner in body
//   6 input valid (UUID target + per-op fields; 'owner' never a target role)
//   7 target fetched → 7a exists, 7b Owner-immutable, 7c not self
//   8 operation-specific (role-transition matrix / admin target restriction)
//   9 idempotency (no-op short-circuit)
//
// Account-state model: profile boolean `is_active` (no Supabase Auth ban). All
// mutations use target.id (profile PK) resolved from the fetched record.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERMITTED_ROLES_FOR_UPDATE = ['admin', 'interviewer', 'viewer'];
const ALLOWED_OPERATIONS = ['update_role', 'toggle_active', 'toggle_interviewer', 'update_interviewer_color', 'update_avatar', 'send_password_reset'];

// ── Server-verified caller identity (WS1/WS1b pattern, replicated) ────────────
async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' };

  const url     = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
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
    return { authenticated: true, userId: user.id, profileId: profile.id, userName: profile.full_name || '', role: profile.role || '', isOwner: profile.is_owner === true };
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' };
  }
}

// Best-effort audit (house pattern from templates-admin.js: warn + continue on failure). Actor is
// the CALLER's user_profiles.id, never auth.users.id.
async function emitAudit(db, auth, { actionType, targetProfileId, targetAuthUserId, targetName, description, requestId }) {
  try {
    const { error } = await db.from('activity_logs').insert({
      user_id: auth.profileId,
      user_name: auth.userName,
      user_role: auth.role,
      action_type: actionType,
      entity_type: 'user_profile',
      entity_id: String(targetProfileId || ''),
      cohort_id: null,
      description: description || `${actionType} for ${targetName || 'a user'}`,
      metadata: { target_profile_id: targetProfileId, target_auth_user_id: targetAuthUserId },
    });
    if (error) console.warn('[admin-users] audit insert error', { request_id: requestId, actionType, errorCode: error.code });
  } catch {
    console.warn('[admin-users] audit insert threw', { request_id: requestId, actionType });
  }
}

// May the caller perform this operation at all? (default deny)
function canPerformOperation(operation, role, isOwner) {
  if (!ALLOWED_OPERATIONS.includes(operation)) return false;
  if (isOwner) return true;
  if (role === 'admin') return true;
  return false;
}

// Role-transition matrix. 'owner' never a source or target. Admin: interviewer↔viewer only.
function isTransitionAllowed(currentRole, newRole, callerRole, callerIsOwner) {
  if (newRole === 'owner') return false;
  if (currentRole === 'owner') return false; // defensive; Gate 7b blocks first
  if (callerIsOwner) return ['admin', 'interviewer', 'viewer'].includes(newRole);
  if (callerRole === 'admin') {
    if (currentRole === 'interviewer' && newRole === 'viewer') return true;
    if (currentRole === 'viewer' && newRole === 'interviewer') return true;
    return false;
  }
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: 'internal_error' });

  const requestId = `req_${randomUUID().slice(0, 8)}`;

  // ── Gate 1 & 2: JWT verification + caller-profile resolution ────────────────
  const auth = await verifyCaller(req);
  if (!auth.authenticated) {
    console.log('[admin-users] auth rejected', { reason: auth.reason, request_id: requestId });
    if (auth.reason === 'no_profile') return res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const operation = typeof body.action === 'string' ? body.action : null;

  // ── Gate 3: operation must be allow-listed ──────────────────────────────────
  if (!operation || !ALLOWED_OPERATIONS.includes(operation)) {
    console.log('[admin-users] unknown operation', { callerRole: auth.role, callerIsOwner: auth.isOwner, request_id: requestId });
    return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Operation not permitted.' });
  }

  // ── Gate 4: caller authorized for this operation ────────────────────────────
  if (!canPerformOperation(operation, auth.role, auth.isOwner)) {
    console.log('[admin-users] insufficient caller authority', { callerRole: auth.role, callerIsOwner: auth.isOwner, operation, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to perform this operation.' });
  }

  // ── Gate 5: is_owner must be absent from the body (any value rejected) ───────
  if (Object.prototype.hasOwnProperty.call(body, 'is_owner')) {
    console.log('[admin-users] rejected is_owner property', { callerRole: auth.role, callerIsOwner: auth.isOwner, operation, request_id: requestId });
    return res.status(400).json({ error: 'invalid_request', field: 'is_owner', message: 'Owner status cannot be set through this endpoint.' });
  }

  // ── Gate 6: input validation (target UUID + per-operation fields) ────────────
  const targetIdentifier = typeof body.user_id === 'string' ? body.user_id : null;
  if (!targetIdentifier || !UUID_REGEX.test(targetIdentifier)) {
    return res.status(400).json({ error: 'invalid_request', field: 'user_id' });
  }

  let newRole = null, newActive = null, newCanInterview = null, newColor = null, newAvatar = null;
  if (operation === 'update_role') {
    newRole = typeof body.role === 'string' ? body.role.trim() : null;
    if (!newRole || !PERMITTED_ROLES_FOR_UPDATE.includes(newRole)) {
      return res.status(400).json({ error: 'invalid_request', field: 'role', message: 'Role not permitted.' });
    }
  } else if (operation === 'toggle_active') {
    if (typeof body.is_active !== 'boolean') return res.status(400).json({ error: 'invalid_request', field: 'is_active', message: 'is_active must be a boolean.' });
    newActive = body.is_active;
  } else if (operation === 'toggle_interviewer') {
    if (typeof body.can_conduct_interviews !== 'boolean') return res.status(400).json({ error: 'invalid_request', field: 'can_conduct_interviews', message: 'can_conduct_interviews must be a boolean.' });
    newCanInterview = body.can_conduct_interviews;
  } else if (operation === 'update_interviewer_color') {
    if (typeof body.interviewer_color !== 'string' || body.interviewer_color.trim() === '') return res.status(400).json({ error: 'invalid_request', field: 'interviewer_color' });
    newColor = body.interviewer_color.trim();
  } else if (operation === 'update_avatar') {
    newAvatar = typeof body.avatar_url === 'string' ? body.avatar_url : '';
  }

  // ── Gate 7: fetch target profile (includes auth_user_id for self-check) ──────
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: target, error: targetError } = await db
    .from('user_profiles')
    .select('id, auth_user_id, role, is_owner, is_active, can_conduct_interviews, interviewer_color, email, full_name')
    .eq('id', targetIdentifier)
    .maybeSingle();

  if (targetError) {
    console.log('[admin-users] target lookup failed', { callerRole: auth.role, operation, request_id: requestId, errorCode: targetError.code });
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!target) return res.status(404).json({ error: 'not_found' });

  // Gate 7b: OWNER IMMUTABILITY — reject any Owner target before anything else.
  if (target.is_owner === true || target.role === 'owner') {
    console.log('[admin-users] Owner mutation blocked', { callerRole: auth.role, callerIsOwner: auth.isOwner, operation, targetProfileId: target.id, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'This operation is not permitted on this account.' });
  }

  // Gate 7c: SELF-TARGETING — compare RESOLVED auth_user_id (same domain).
  if (target.auth_user_id === auth.userId) {
    console.log('[admin-users] self-mutation blocked', { callerRole: auth.role, callerIsOwner: auth.isOwner, operation, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'You cannot modify your own account through this endpoint.' });
  }

  // ── Gate 8: operation-specific authorization ────────────────────────────────
  if (operation === 'update_role') {
    if (!isTransitionAllowed(target.role, newRole, auth.role, auth.isOwner)) {
      console.log('[admin-users] transition not permitted', { callerRole: auth.role, callerIsOwner: auth.isOwner, fromRole: target.role, toRole: newRole, request_id: requestId });
      return res.status(403).json({ error: 'forbidden', message: 'This role transition is not permitted.' });
    }
  } else {
    // Non-role mutations: Admin callers may only act on interviewer/viewer targets.
    // (Owner already passed Gate 7b for any non-Owner target.)
    if (!auth.isOwner && target.role !== 'interviewer' && target.role !== 'viewer') {
      console.log('[admin-users] admin target not permitted', { callerRole: auth.role, operation, targetRole: target.role, request_id: requestId });
      return res.status(403).json({ error: 'forbidden', message: 'This operation is not permitted on this account.' });
    }
  }

  // ── send_password_reset: no mutation — dispatch the recovery email via the SAME proven
  // self-service flow (implicit resetPasswordForEmail → /auth/reset-password). Inactive accounts
  // cannot sign in, so they cannot receive a reset. Owner/self/admin-to-admin already blocked above.
  if (operation === 'send_password_reset') {
    if (target.is_active === false) {
      console.log('[admin-users] reset on inactive target blocked', { callerRole: auth.role, targetProfileId: target.id, request_id: requestId });
      return res.status(403).json({ error: 'forbidden', message: 'This operation is not permitted on this account.' });
    }
    if (!target.email) {
      return res.status(409).json({ error: 'conflict', message: 'This account has no email on file.' });
    }
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: resetError } = await authClient.auth.resetPasswordForEmail(target.email, {
      redirectTo: 'https://aspire-tracker.vercel.app/auth/reset-password',
    });
    if (resetError) {
      console.log('[admin-users] password reset dispatch failed', { callerRole: auth.role, targetProfileId: target.id, request_id: requestId, message: resetError.message });
      return res.status(502).json({ error: 'reset_failed', message: 'Could not send password reset. Please try again.' });
    }
    await emitAudit(db, auth, {
      actionType: 'admin_password_reset_sent',
      targetProfileId: target.id, targetAuthUserId: target.auth_user_id, targetName: target.full_name,
      description: `Sent a password reset email to ${target.full_name || 'a user'}`,
      requestId,
    });
    console.log('[admin-users] password reset sent', { callerRole: auth.role, callerIsOwner: auth.isOwner, targetProfileId: target.id, request_id: requestId });
    return res.status(200).json({ success: true });
  }

  // ── Gate 9: idempotency short-circuit ───────────────────────────────────────
  if (operation === 'update_role' && target.role === newRole) {
    return res.status(200).json({ success: true, no_change: true, message: 'No change needed.' });
  }
  if (operation === 'toggle_active' && (target.is_active !== false) === newActive) {
    return res.status(200).json({ success: true, no_change: true, message: 'No change needed.' });
  }
  if (operation === 'toggle_interviewer' && target.can_conduct_interviews === newCanInterview) {
    return res.status(200).json({ success: true, no_change: true, message: 'No change needed.' });
  }
  if (operation === 'update_interviewer_color' && target.interviewer_color === newColor) {
    return res.status(200).json({ success: true, no_change: true, message: 'No change needed.' });
  }

  // ── All gates passed — perform the mutation using the resolved profile PK ────
  let patch;
  if (operation === 'update_role')                  patch = { role: newRole };
  else if (operation === 'toggle_active')           patch = { is_active: newActive };
  else if (operation === 'toggle_interviewer')      patch = { can_conduct_interviews: newCanInterview };
  else if (operation === 'update_interviewer_color')patch = { interviewer_color: newColor };
  else if (operation === 'update_avatar')           patch = { avatar_url: newAvatar };

  const { error: updateError } = await db.from('user_profiles').update(patch).eq('id', target.id);
  if (updateError) {
    console.log('[admin-users] mutation failed', { callerRole: auth.role, callerIsOwner: auth.isOwner, operation, targetProfileId: target.id, request_id: requestId, errorCode: updateError.code });
    return res.status(500).json({ error: 'internal_error' });
  }

  console.log('[admin-users] mutation applied', { callerRole: auth.role, callerIsOwner: auth.isOwner, operation, targetProfileId: target.id, targetAuthUserId: target.auth_user_id, request_id: requestId });
  return res.status(200).json({ success: true });
}
