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

/* global process */
// Node/Vercel runtime global. The flat ESLint config registers browser globals
// only, so server files declare it file-scoped (same convention as
// lib/server/appUrl.js and api/portal-activation-event.js). Adding it here also
// clears the pre-existing no-undef noise this file carried.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { appUrl } from '../lib/server/appUrl.js';
import { staffInvitationEmail } from '../lib/server/email/staffInvitation.js';
import { normalizeEmailForLookup } from '../src/lib/emailUtils.js';

// STAFF-INVITE-CONTACTS-1 / PORTAL-ACTIVATION-RELIABILITY-1 parity.
//
// The staff invitation now uses the SAME scanner-safe activation flow the
// portal invitation uses. Previously this endpoint called
// admin.inviteUserByEmail with redirectTo the app ROOT, which had two live
// defects: (1) Supabase's default mailer embeds the /auth/v1/verify URL whose
// single-use token is consumed on GET, so email-security scanners could burn
// the link before the recipient clicked it, and (2) landing at the root
// established a session WITHOUT a password, so the invitee was locked out at
// their first sign-out - exactly the defect /auth/activate was built to fix.
//
// Now: generateLink({ type: 'invite' }) mints the token WITHOUT sending
// Supabase's email, the emailed URL is ASPIRE-owned and built from the token
// HASH (verified only on an explicit click), and the branded staff email is
// sent through Resend. No token, hash, or link is ever logged or returned.
const EMAIL_FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const EMAIL_REPLY_TO = 'aspire@cshs.org';

function activationUrl(hashedToken, type) {
  if (!hashedToken) return null;
  return `${appUrl('/auth/activate')}?token_hash=${encodeURIComponent(hashedToken)}&type=${encodeURIComponent(type)}`;
}

async function sendStaffInvitation({ to, firstName, activationLink, role, requestId }) {
  try {
    if (!process.env.RESEND_API_KEY || !activationLink) return false;
    const { subject, html } = staffInvitationEmail({ firstName, activationLink, role });
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: EMAIL_FROM, to, replyTo: EMAIL_REPLY_TO, subject, html });
    if (error) { console.log('[invite-user] branded staff email failed', { request_id: requestId }); return false; }
    return true;
  } catch {
    console.log('[invite-user] branded staff email threw', { request_id: requestId });
    return false;
  }
}

// Privacy-safe invitation ledger, same table and same discipline as the portal
// invitation writer: a strict field allowlist, no tokens/hashes/links, and
// fully defensive so diagnostics never break an invitation.
async function recordStaffInviteEvent(db, { eventType, email, actorProfileId = null, linkType = null, requestId = null }) {
  try {
    await db.from('portal_invitation_events').insert({
      event_type: String(eventType || ''),
      target_email: String(email || '').trim().toLowerCase(),
      actor_profile_id: actorProfileId,
      link_type: linkType,
      request_id: requestId ? String(requestId).slice(0, 128) : null,
    });
  } catch { /* diagnostics never block the invitation */ }
}

// ROLE-MODEL-1: Viewer is retired for new assignments (existing Viewer
// accounts are untouched and keep working). Owner is a capability, never
// invitable. Co-Lead is invitable now that the server honors its scope.
const PERMITTED_INVITE_ROLES = ['admin', 'co-lead', 'interviewer'];

// ── Server-verified caller identity (WS1 pattern, replicated - not extracted) ──
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
    return { authenticated: true, userId: user.id, profileId: profile.id, role: profile.role || '', isOwner: profile.is_owner === true };
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
  // ROLE-MODEL-1: an Admin may invite the operational roles below Admin.
  // Inviting an Admin stays Owner-only; Viewer is retired and invitable by
  // no one.
  if (callerRole === 'admin') return requestedRole === 'co-lead' || requestedRole === 'interviewer';
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

  // ── All seven gates passed - privileged mutation may now begin ──────────────
  const url        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const normEmail = normalizeEmailForLookup(email) || email.toLowerCase();

  try {
    await recordStaffInviteEvent(supabaseAdmin, { eventType: 'invite_requested', email: normEmail, actorProfileId: auth.profileId, requestId });

    // ── EXISTING-IDENTITY PRE-CHECK (normalized email) ────────────────────────
    // Staff access already active is a conflict the caller must see; every other
    // pre-existing shape (portal-only profile, profile with no auth identity, a
    // disabled staff account) is a SAFE RE-INVITE that reuses the identity. The
    // account is never duplicated and nothing is ever deleted.
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id, role, is_owner, is_active, login_enabled, auth_user_id, can_conduct_interviews, interviewer_color')
      .ilike('email', normEmail)
      .maybeSingle();

    const STAFF_ROLES = ['owner', 'admin', 'co-lead', 'co_lead', 'interviewer', 'viewer'];
    const hasActiveStaff = !!existingProfile
      && (existingProfile.is_owner === true || STAFF_ROLES.includes(existingProfile.role || ''))
      && existingProfile.is_active !== false
      && !!existingProfile.auth_user_id;
    if (hasActiveStaff) {
      console.log('[invite-user] existing active staff account', { requestedRole, request_id: requestId });
      return res.status(409).json({
        error: 'conflict',
        message: 'That email already has an active staff account. Update their role from Accounts & Access instead of inviting again.',
      });
    }

    // ── Resolve or create the auth identity. NEVER create a second identity for
    //    an email that already has one (portal-only users and previously
    //    disabled staff both land here and keep their existing identity). ──────
    let newUserId = existingProfile?.auth_user_id || null;
    let activationLink = null;
    let linkType = null;

    if (newUserId) {
      // Existing auth identity (portal-only, or staff being re-enabled). Send a
      // recovery-type activation ONLY when password setup was never completed;
      // an established account keeps its password and simply gains staff access.
      let needsActivation = true;
      try {
        const { data: existingUser } = await supabaseAdmin.auth.admin.getUserById(newUserId);
        needsActivation = existingUser?.user?.user_metadata?.password_set !== true;
      } catch {
        needsActivation = true; // unknown state: sending a link beats a lockout
      }
      if (needsActivation) {
        const { data: reissue, error: reissueErr } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: appUrl('/auth/activate') },
        });
        if (!reissueErr) { activationLink = activationUrl(reissue?.properties?.hashed_token, 'recovery'); linkType = 'recovery'; }
      }
    } else {
      // Brand-new person: generateLink creates the identity and returns the
      // token WITHOUT sending Supabase's default email, so ASPIRE controls the
      // branded, scanner-safe send.
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { data: { full_name: fullName, role: requestedRole }, redirectTo: appUrl('/auth/activate') },
      });
      if (linkErr) {
        if (/already|registered|exists/i.test(linkErr.message || '')) {
          return res.status(409).json({ error: 'conflict', message: 'A user with that email may already exist.' });
        }
        console.log('[invite-user] auth invite failed', { callerRole: auth.role, callerIsOwner: auth.isOwner, requestedRole, errorCode: linkErr.code, request_id: requestId });
        return res.status(500).json({ error: 'internal_error' });
      }
      newUserId = linkData.user.id;
      activationLink = activationUrl(linkData.properties?.hashed_token, 'invite');
      linkType = 'invite';
    }

    // Profile creation. Sequence preserved: identity first, then profile upsert
    // (Auth and Postgres are NOT in a shared transaction - see report). The
    // existing profile resolved by the pre-check above is REUSED here, so a
    // portal-only user, a pre-created temp profile, or a previously disabled
    // staff account is linked and re-enabled rather than duplicated.
    let profileError;
    if (existingProfile) {
      ({ error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          auth_user_id: newUserId,
          login_enabled: true,
          is_active: true,
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

    // Send the branded, scanner-safe invitation. The account and role are already
    // committed, so a mail failure never rolls them back; it is reported honestly
    // (email_sent:false) so the caller can resend rather than being told a link
    // went out that did not.
    await recordStaffInviteEvent(supabaseAdmin, { eventType: 'link_generated', email: normEmail, actorProfileId: auth.profileId, linkType: linkType || 'none', requestId });
    let emailSent = false;
    if (activationLink) {
      await recordStaffInviteEvent(supabaseAdmin, { eventType: 'email_send_attempted', email: normEmail, actorProfileId: auth.profileId, linkType, requestId });
      emailSent = await sendStaffInvitation({
        to: email,
        firstName: (fullName.split(/\s+/)[0] || ''),
        activationLink,
        role: requestedRole,
        requestId,
      });
      await recordStaffInviteEvent(supabaseAdmin, { eventType: emailSent ? 'email_sent' : 'email_send_failed', email: normEmail, actorProfileId: auth.profileId, linkType, requestId });
    }

    console.log('[invite-user] invitation issued', { callerRole: auth.role, callerIsOwner: auth.isOwner, requestedRole, newUserId, link_type: linkType || 'none', email_sent: emailSent, request_id: requestId });
    return res.status(200).json({
      success: true,
      email_sent: emailSent,
      message: activationLink
        ? (emailSent
            ? 'Invitation sent and staff access granted.'
            : 'Staff access granted. The invitation email could not be sent; please resend.')
        : 'Staff access granted. This person already has a password, so they can sign in with their existing credentials.',
    });
  } catch (err) {
    console.log('[invite-user] unexpected error', { request_id: requestId, errorCode: err?.code });
    return res.status(500).json({ error: 'internal_error' });
  }
}
