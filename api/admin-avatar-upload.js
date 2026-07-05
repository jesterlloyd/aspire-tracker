// api/admin-avatar-upload.js
//
// ADMIN-AVATAR-UPLOAD-1: owner/admin sets ANOTHER user's profile picture from the Account
// Profile modal. Server-gated upload - the browser NEVER touches Storage for another user and
// never receives the service-role key.
//
// Authorization is SERVER-VERIFIED and mirrors api/admin-users.js exactly: caller identity and
// authority come ONLY from the verified Supabase JWT + the authoritative user_profiles row;
// req.body never controls caller authorization. body.user_id is a user_profiles.id (profile PK);
// self-targeting is decided by comparing the RESOLVED target.auth_user_id to the caller's
// auth.users.id.
//
// Gates (all must pass before any write):
//   1 JWT verified  2 caller profile resolved  3 caller is owner/admin
//   4 target UUID valid  5 file type + decoded size valid  6 target fetched → exists
//   7 target Owner-immutable  8 target not self  9 target active
//   10 admin caller restricted to interviewer/viewer targets
//
// Transport: base64 JSON (the project has no multipart parser dependency; a 2 MB image is ~2.7 MB
// of base64, well under Vercel's ~4.5 MB request-body limit). The server decodes, re-validates the
// declared content-type against the file's magic bytes, uploads with the service role to the
// `avatars` bucket at ${target.auth_user_id}/avatar.<ext> (upsert), then writes user_profiles
// .avatar_url server-side. No Storage RLS / bucket policy is created or changed (service role
// bypasses RLS for this single, server-derived path).

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'avatars';
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB, enforced on the DECODED buffer

// content-type → file extension. The extension is derived from this fixed map (never from a
// client-supplied filename), so the storage key can carry no traversal/path characters.
const TYPE_EXT = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

// Magic-byte sniff - the decoded bytes must actually be the declared image type (defence in depth
// against a mislabelled/renamed payload).
function sniffType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// ── Server-verified caller identity (WS1/admin-users pattern, replicated) ─────
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
    return {
      authenticated: true,
      authUserId: user.id,
      profileId: profile.id,
      role: profile.role || '',
      isOwner: profile.is_owner === true,
      userName: profile.full_name || '',
    };
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' };
  }
}

function isOwnerAdmin(role, isOwner) {
  return isOwner === true || role === 'admin';
}

// Best-effort audit (house pattern from templates-admin.js: warn + continue on failure). The actor
// is the CALLER's user_profiles.id, never auth.users.id.
async function emitAudit(db, auth, { targetProfileId, targetAuthUserId, targetName, requestId }) {
  try {
    const { error } = await db.from('activity_logs').insert({
      user_id: auth.profileId,
      user_name: auth.userName,
      user_role: auth.role,
      action_type: 'admin_avatar_updated',
      entity_type: 'user_profile',
      entity_id: String(targetProfileId || ''),
      cohort_id: null,
      description: `Updated the profile photo for ${targetName || 'a user'}`,
      metadata: { target_profile_id: targetProfileId, target_auth_user_id: targetAuthUserId },
    });
    if (error) console.warn('[admin-avatar-upload] audit insert error', { request_id: requestId, errorCode: error.code });
  } catch {
    console.warn('[admin-avatar-upload] audit insert threw', { request_id: requestId });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: 'internal_error' });

  const requestId = `req_${randomUUID().slice(0, 8)}`;

  // ── Gate 1 & 2: JWT verification + caller-profile resolution ────────────────
  const auth = await verifyCaller(req);
  if (!auth.authenticated) {
    console.log('[admin-avatar-upload] auth rejected', { reason: auth.reason, request_id: requestId });
    if (auth.reason === 'no_profile') return res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
  }

  // ── Gate 3: caller must be owner/admin ──────────────────────────────────────
  if (!isOwnerAdmin(auth.role, auth.isOwner)) {
    console.log('[admin-avatar-upload] insufficient caller authority', { callerRole: auth.role, callerIsOwner: auth.isOwner, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to perform this operation.' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  // ── Gate 4: target UUID (a user_profiles.id) ────────────────────────────────
  const targetIdentifier = typeof body.user_id === 'string' ? body.user_id : null;
  if (!targetIdentifier || !UUID_REGEX.test(targetIdentifier)) {
    return res.status(400).json({ error: 'invalid_request', field: 'user_id' });
  }

  // ── Gate 5: file type + decoded size ────────────────────────────────────────
  const contentType = typeof body.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
  const ext = TYPE_EXT[contentType];
  if (!ext) return res.status(400).json({ error: 'invalid_request', field: 'content_type', message: 'Please upload a JPG, PNG, or WebP image.' });

  let raw = typeof body.data_base64 === 'string' ? body.data_base64 : '';
  const comma = raw.indexOf(','); // tolerate a data: URL prefix
  if (raw.startsWith('data:') && comma !== -1) raw = raw.slice(comma + 1);
  if (!raw) return res.status(400).json({ error: 'invalid_request', field: 'data_base64' });

  let buf;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    return res.status(400).json({ error: 'invalid_request', field: 'data_base64' });
  }
  if (!buf.length) return res.status(400).json({ error: 'invalid_request', field: 'data_base64' });
  if (buf.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'file_too_large', message: 'Image must be under 2MB.' });
  if (sniffType(buf) !== contentType) {
    return res.status(400).json({ error: 'invalid_request', field: 'content_type', message: 'The file does not match the selected image type.' });
  }

  // ── Gate 6: fetch target (includes auth_user_id for self-check) ─────────────
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: target, error: targetError } = await db
    .from('user_profiles')
    .select('id, auth_user_id, role, is_owner, is_active, full_name')
    .eq('id', targetIdentifier)
    .maybeSingle();

  if (targetError) {
    console.log('[admin-avatar-upload] target lookup failed', { callerRole: auth.role, request_id: requestId, errorCode: targetError.code });
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!target) return res.status(404).json({ error: 'not_found' });
  if (!target.auth_user_id) return res.status(409).json({ error: 'conflict', message: 'This account cannot receive a photo.' });

  // ── Gate 7: OWNER IMMUTABILITY ──────────────────────────────────────────────
  if (target.is_owner === true || target.role === 'owner') {
    console.log('[admin-avatar-upload] Owner target blocked', { callerRole: auth.role, callerIsOwner: auth.isOwner, targetProfileId: target.id, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'This operation is not permitted on this account.' });
  }

  // ── Gate 8: SELF-TARGETING blocked (self photo lives in UserMenu) ───────────
  if (target.auth_user_id === auth.authUserId) {
    console.log('[admin-avatar-upload] self-target blocked', { callerRole: auth.role, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'Change your own photo from your profile menu.' });
  }

  // ── Gate 9: inactive target blocked (reactivate first) ──────────────────────
  if (target.is_active === false) {
    console.log('[admin-avatar-upload] inactive target blocked', { callerRole: auth.role, targetProfileId: target.id, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'Reactivate this account before changing its photo.' });
  }

  // ── Gate 10: admin callers may only act on interviewer/viewer targets ───────
  if (!auth.isOwner && target.role !== 'interviewer' && target.role !== 'viewer') {
    console.log('[admin-avatar-upload] admin target not permitted', { callerRole: auth.role, targetRole: target.role, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', message: 'This operation is not permitted on this account.' });
  }

  // ── All gates passed - upload with the service role, then write avatar_url ───
  const path = `${target.auth_user_id}/avatar.${ext}`;
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(path, buf, { upsert: true, contentType });
  if (uploadError) {
    console.log('[admin-avatar-upload] storage upload failed', { callerRole: auth.role, targetProfileId: target.id, request_id: requestId, message: uploadError.message });
    return res.status(502).json({ error: 'upload_failed', message: 'Could not upload the image. Please try again.' });
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  // The storage key is stable across replacements, so bust the browser/CDN cache with a version
  // token; the stored avatar_url is what every display surface reads.
  const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await db
    .from('user_profiles').update({ avatar_url: publicUrl }).eq('id', target.id);
  if (updateError) {
    console.log('[admin-avatar-upload] avatar_url update failed', { callerRole: auth.role, targetProfileId: target.id, request_id: requestId, errorCode: updateError.code });
    return res.status(500).json({ error: 'internal_error' });
  }

  await emitAudit(db, auth, { targetProfileId: target.id, targetAuthUserId: target.auth_user_id, targetName: target.full_name, requestId });

  console.log('[admin-avatar-upload] avatar updated', { callerRole: auth.role, callerIsOwner: auth.isOwner, targetProfileId: target.id, request_id: requestId });
  return res.status(200).json({ success: true, avatar_url: publicUrl });
}
