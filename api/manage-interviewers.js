// api/manage-interviewers.js
//
// WS1d-A: secure interviewer-directory administration.
//
// Operates on the `interviewers` roster table (id, name, email, color, is_active)
// - a directory for interview attribution. It has NO role/is_owner/auth linkage
// and is NOT a login-account table, so:
//   - `add` does NOT create an auth user or user_profiles row (no WS1b overlap).
//   - There is no "Owner account" in this table → Owner-immutability does NOT
//     apply (these are directory/cosmetic fields, not account authority/identity).
//
// Authorization is SERVER-VERIFIED (WS1/WS1b/WS1c pattern). Directory administration
// is Owner/Admin only. Interviewer/viewer/others denied. No interviewer self-service
// here: the roster row has no auth linkage, so "self" cannot be safely resolved.
// req.body never controls caller authorization; is_owner/role in the body are rejected.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// S-04 / ACCOUNTS-ACCESS-DELETE-HARDEN-2: 'delete' closes the last directory action that
// still ran as a direct browser write. Every action here is Owner/Admin only.
const ALLOWED_ACTIONS = ['add', 'update_email', 'update_color', 'delete'];

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

// Directory administration: Owner/Admin only (default deny).
function canManageInterviewers(role, isOwner) {
  if (isOwner) return true;
  if (role === 'admin') return true;
  return false;
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
    console.log('[manage-interviewers] auth rejected', { reason: auth.reason, request_id: requestId });
    if (auth.reason === 'no_profile') return res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const action = typeof body.action === 'string' ? body.action : null;

  // Gate 3: action allow-list
  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Operation not permitted.' });
  }

  // Gate 4: caller authorized (Owner/Admin only)
  if (!canManageInterviewers(auth.role, auth.isOwner)) {
    console.log('[manage-interviewers] insufficient authority', { callerRole: auth.role, callerIsOwner: auth.isOwner, action, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to manage interviewers.' });
  }

  // Gate 5: reject account-authority fields (this endpoint never changes them)
  if (Object.prototype.hasOwnProperty.call(body, 'is_owner')) {
    return res.status(400).json({ error: 'invalid_request', field: 'is_owner', message: 'Owner status cannot be set through this endpoint.' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'role')) {
    return res.status(400).json({ error: 'invalid_request', field: 'role', message: 'Role cannot be set through this endpoint.' });
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (action === 'add') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'invalid_request', field: 'name', message: 'Name is required.' });
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const { data, error } = await db
        .from('interviewers')
        .insert({ name, email })
        .select('id, name, email, color')
        .single();
      if (error) {
        console.log('[manage-interviewers] add failed', { callerRole: auth.role, request_id: requestId, errorCode: error.code });
        return res.status(500).json({ error: 'internal_error' });
      }
      console.log('[manage-interviewers] interviewer added', { callerRole: auth.role, callerIsOwner: auth.isOwner, interviewerId: data.id, request_id: requestId });
      return res.status(200).json({ success: true, data });
    }

    // update_email / update_color require a valid directory id
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id || !UUID_REGEX.test(id)) return res.status(400).json({ error: 'invalid_request', field: 'id' });

    if (action === 'update_email') {
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const { error } = await db.from('interviewers').update({ email }).eq('id', id);
      if (error) {
        console.log('[manage-interviewers] update_email failed', { callerRole: auth.role, interviewerId: id, request_id: requestId, errorCode: error.code });
        return res.status(500).json({ error: 'internal_error' });
      }
      console.log('[manage-interviewers] email updated', { callerRole: auth.role, callerIsOwner: auth.isOwner, interviewerId: id, request_id: requestId });
      return res.status(200).json({ success: true });
    }

    if (action === 'update_color') {
      const color = typeof body.color === 'string' ? body.color.trim() : '';
      if (!color) return res.status(400).json({ error: 'invalid_request', field: 'color' });
      const { error } = await db.from('interviewers').update({ color }).eq('id', id);
      if (error) {
        console.log('[manage-interviewers] update_color failed', { callerRole: auth.role, interviewerId: id, request_id: requestId, errorCode: error.code });
        return res.status(500).json({ error: 'internal_error' });
      }
      console.log('[manage-interviewers] color updated', { callerRole: auth.role, callerIsOwner: auth.isOwner, interviewerId: id, request_id: requestId });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      const { error } = await db.from('interviewers').delete().eq('id', id);
      if (error) {
        console.log('[manage-interviewers] delete failed', { callerRole: auth.role, interviewerId: id, request_id: requestId, errorCode: error.code });
        return res.status(500).json({ error: 'internal_error' });
      }
      console.log('[manage-interviewers] interviewer deleted', { callerRole: auth.role, callerIsOwner: auth.isOwner, interviewerId: id, request_id: requestId });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'invalid_request', field: 'action' });
  } catch (err) {
    console.log('[manage-interviewers] unexpected error', { request_id: requestId, errorCode: err?.code });
    return res.status(500).json({ error: 'internal_error' });
  }
}
