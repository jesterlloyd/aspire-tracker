// api/invite-user.js
//
// WS1b: secure the user-invitation endpoint.
//
// Authorization is SERVER-VERIFIED. The caller's identity and authority come
// ONLY from the verified Supabase JWT + the authoritative user_profiles row.
// Nothing in req.body influences caller authorization. req.body.role is ONLY the
// requested invitee role (validated against an allow-list + a caller→target
// matrix). Any is_owner property in the body is rejected outright; created
// profiles always set is_owner: false.
//
// Seven gates must all pass before ANY privileged mutation (Auth invite / profile
// write): (1) JWT verified, (2) caller profile resolved, (3) caller may invite,
// (4) no is_owner in body, (5) requested role allow-listed, (6) caller may invite
// that role, (7) email (and full_name) present + minimally valid.
//
// Caller authority matrix:
//   - is_owner = true → may invite admin, interviewer, viewer
//   - role = 'admin'  → may invite interviewer, viewer (NOT admin)
//   - all other roles → may not invite
// 'owner' is never an allowed invitee role.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const PERMITTED_INVITE_ROLES = ['admin', 'interviewer', 'viewer'];

// ── Server-verified caller identity (WS1 pattern, replicated — not extracted) ──
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
    // Service-role here is permitted ONLY for the minimum authorization lookup.
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' };
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' };
    return { authenticated: true, userId: user.id, role: profile.role || '', isOwner: profile.is_owner === true };
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' };
  }
}

// May the caller invite users at all?
function canInvite(role, isOwner) {
  if (isOwner) return true;
  if (role === 'admin') return true;
  return false;
}

// May the caller invite this specific role? (default deny)
function canCallerInviteRole(callerRole, callerIsOwner, requestedRole) {
  if (callerIsOwner) return PERMITTED_INVITE_ROLES.includes(requestedRole);
  if (callerRole === 'admin') return requestedRole === 'interviewer' || requestedRole === 'viewer';
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' });
  }

  const requestId = `req_${randomUUID().slice(0, 8)}`;

  // ── Gate 1 & 2: JWT verification + caller-profile resolution ────────────────
  const auth = await verifyCaller(req);
  if (!auth.authenticated) {
    console.log('[invite-user] auth rejected', { reason: auth.reason, request_id: requestId });
    if (auth.reason === 'missing_token' || auth.reason === 'invalid_token' || auth.reason === 'verify_threw' || auth.reason === 'profile_lookup_failed' || auth.reason === 'profile_threw') {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }
    return res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
  }

  // ── Gate 3: caller authorized to invite users at all ────────────────────────
  if (!canInvite(auth.role, auth.isOwner)) {
    console.log('[invite-user] insufficient caller authority', { callerRole: auth.role, callerIsOwner: auth.isOwner, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to invite users.' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  // ── Gate 4: is_owner must be absent from the payload (any value rejected) ────
  if (Object.prototype.hasOwnProperty.call(body, 'is_owner')) {
    console.log('[invite-user] rejected is_owner property', { callerRole: auth.role, callerIsOwner: auth.isOwner, request_id: requestId });
    return res.status(400).json({ error: 'invalid_request', field: 'is_owner', message: 'Owner status cannot be set through this endpoint.' });
  }

  // ── Gate 5: requested invitee role allow-listed ─────────────────────────────
  const requestedRole = typeof body.role === 'string' ? body.role.trim() : null;
  if (!requestedRole || !PERMITTED_INVITE_ROLES.includes(requestedRole)) {
    return res.status(400).json({ error: 'invalid_request', field: 'role', message: 'Role is not permitted.' });
  }

  // ── Gate 6: caller authorized to invite this specific role ──────────────────
  if (!canCallerInviteRole(auth.role, auth.isOwner, requestedRole)) {
    console.log('[invite-user] unauthorized requested invitee role', { callerRole: auth.role, callerIsOwner: auth.isOwner, requestedRole, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to invite a user with that role.' });
  }

  // ── Gate 7: email (+ full_name, preserved as a required field) valid ─────────
  const email = typeof body.email === 'string' ? body.email.trim() : null;
  if (!email) {
    return res.status(400).json({ error: 'invalid_request', field: 'email', message: 'Email is required.' });
  }
  if (!email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'invalid_request', field: 'email', message: 'Email is invalid.' });
  }
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : null;
  if (!fullName) {
    return res.status(400).json({ error: 'invalid_request', field: 'full_name', message: 'Full name is required.' });
  }

  // ── All seven gates passed — privileged mutation may now begin ──────────────
  const url        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role: requestedRole },
      redirectTo: 'https://aspire-tracker.vercel.app',
    });

    if (error) {
      if ((error.message || '').toLowerCase().includes('already')) {
        return res.status(409).json({ error: 'conflict', message: 'A user with that email may already exist.' });
      }
      console.log('[invite-user] auth invite failed', { callerRole: auth.role, callerIsOwner: auth.isOwner, requestedRole, errorCode: error.code, request_id: requestId });
      return res.status(500).json({ error: 'internal_error' });
    }

    const newUserId = data.user.id;

    // Profile creation. Sequence preserved: Auth invite first, then profile
    // upsert (Auth and Postgres are NOT in a shared transaction — see report).
    // An existing temp profile (pre-created by email) is linked; otherwise insert.
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id, can_conduct_interviews, interviewer_color')
      .eq('email', email)
      .maybeSingle();

    let profileError;
    if (existingProfile) {
      ({ error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          auth_user_id: newUserId,
          login_enabled: true,
          full_name: fullName,
          role: requestedRole,
          ...(requestedRole === 'interviewer' && { can_conduct_interviews: true }),
        })
        .eq('id', existingProfile.id));
    } else {
      ({ error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          auth_user_id: newUserId,
          full_name: fullName,
          email,
          role: requestedRole,
          is_owner: false,
          is_active: true,
          login_enabled: true,
          // Interviewers must appear in the rubric dropdown immediately on invite;
          // can_conduct_interviews is the field get_active_interviewers RPC filters on.
          ...(requestedRole === 'interviewer' && { can_conduct_interviews: true }),
        }));
    }

    if (profileError) {
      console.log('[invite-user] profile write failed after auth invite', { newUserId, callerRole: auth.role, callerIsOwner: auth.isOwner, requestedRole, errorCode: profileError.code, request_id: requestId });
      return res.status(500).json({ error: 'internal_error', message: 'Invitation partially processed. The ASPIRE team will follow up.' });
    }

    console.log('[invite-user] invitation issued', { callerRole: auth.role, callerIsOwner: auth.isOwner, requestedRole, newUserId, request_id: requestId });
    return res.status(200).json({ success: true, message: 'Invitation sent.' });
  } catch (err) {
    console.log('[invite-user] unexpected error', { request_id: requestId, errorCode: err?.code });
    return res.status(500).json({ error: 'internal_error' });
  }
}
