// api/aspire-events.js
//
// ASPIRE-EVENTS-CALENDAR-2B: gated CRUD for public.aspire_events (custom ASPIRE events).
//
// Authorization is SERVER-VERIFIED and mirrors api/admin-users.js. Reads/writes use the service-role
// client, which BYPASSES RLS - so this endpoint (not RLS) is the real gate:
//   • list    → any ACTIVE internal user (has a user_profiles row, not deactivated)
//   • create/update/archive → owner/admin only
// Client-side direct writes are blocked by RLS (no client write policy); all writes come through here.
// Never hard-deletes: "archive" sets status='archived'. created_by/updated_by are the caller's
// user_profiles.id. Generic error messages; best-effort activity_logs audit.

/* global process */
import { PORTAL_AUDIENCE_VALUES, legacyAudienceFor } from '../src/lib/aspireEvents.js';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Kept in sync with src/lib/aspireEvents.js (api/ imports don't resolve safely at the Vercel runtime).
const EVENT_TYPES = ['ngrp_open','ngrp_deadline','town_hall','interview_window','orientation','milestone','deadline','rotation','reminder','birthday','custom'];
const AUDIENCES = ['internal','all','cohort','school'];
const RECURRENCE_VALUES = ['none','weekly','monthly','annually'];
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// Server release flag. Recurrence is enabled ONLY when this is the exact lowercase string 'true'.
// No VITE_ prefix: it is server-only, so the browser cannot read or spoof it. Unsetting it (or any
// other value) is the safe operational rollback - it disables recurrence WITHOUT dropping any data.
export function recurrenceReleaseEnabled(env = process.env) {
  return env.ASPIRE_EVENT_RECURRENCE_ENABLED === 'true';
}

// Runtime readiness for recurrence. Fail-closed and requires BOTH gates:
//   1. the server release flag is exactly 'true', AND
//   2. the database capability sentinel (public.aspire_event_recurrence_capability, created LAST by
//      20260731000000_add_aspire_event_recurrence.sql and EXECUTE-able only by service_role) returns
//      true when probed with the service-role client.
// A missing function, a failed/throwing probe, or an unset/other flag all keep recurrence disabled.
// One-time events are unaffected either way; a recurring create/update returns 503 while disabled.
export async function isRecurrenceReady(db, env = process.env) {
  if (!recurrenceReleaseEnabled(env)) return false;
  try {
    const { data, error } = await db.rpc('aspire_event_recurrence_capability');
    return !error && data === true;
  } catch {
    return false;
  }
}

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
      .select('id, role, is_owner, is_active, full_name')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' };
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' };
    // Inactive internal users get nothing (RLS blocks the client; this blocks the service-role path).
    if (profile.is_active === false) return { authenticated: false, status: 403, reason: 'inactive' };
    return {
      authenticated: true,
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

// Best-effort audit (house pattern). Actor = caller's user_profiles.id.
async function emitAudit(db, auth, { actionType, eventId, title, requestId }) {
  try {
    const { error } = await db.from('activity_logs').insert({
      user_id: auth.profileId,
      user_name: auth.userName,
      user_role: auth.role,
      action_type: actionType,
      entity_type: 'aspire_event',
      entity_id: String(eventId || ''),
      cohort_id: null,
      description: `${actionType.replace(/_/g, ' ')}: ${title || 'event'}`,
      metadata: { event_id: eventId },
    });
    if (error) console.warn('[aspire-events] audit insert error', { request_id: requestId, actionType, errorCode: error.code });
  } catch {
    console.warn('[aspire-events] audit insert threw', { request_id: requestId, actionType });
  }
}

// Validate + normalize a create/update payload → { ok, value } or { ok:false, status, field, message }.
function validateEventBody(body, { partial = false } = {}) {
  const out = {};

  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const req = (cond) => !partial || cond; // required fields only enforced on create (partial=false)

  // title
  if (req(true) || has('title')) {
    if (has('title') || !partial) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) return { ok: false, status: 400, field: 'title', message: 'Title is required.' };
      if (title.length > 200) return { ok: false, status: 400, field: 'title', message: 'Title is too long.' };
      out.title = title;
    }
  }

  // event_type
  if (has('event_type') || !partial) {
    const t = typeof body.event_type === 'string' ? body.event_type : '';
    if (!EVENT_TYPES.includes(t)) return { ok: false, status: 400, field: 'event_type', message: 'Invalid event type.' };
    out.event_type = t;
  }

  // start_at (required on create)
  if (has('start_at') || !partial) {
    const s = body.start_at;
    const sd = s ? new Date(s) : null;
    if (!s || !sd || Number.isNaN(sd.getTime())) return { ok: false, status: 400, field: 'start_at', message: 'A valid start date/time is required.' };
    out.start_at = new Date(s).toISOString();
  }

  // end_at (optional; if present must be >= start_at)
  if (has('end_at')) {
    if (body.end_at === null || body.end_at === '') {
      out.end_at = null;
    } else {
      const ed = new Date(body.end_at);
      if (Number.isNaN(ed.getTime())) return { ok: false, status: 400, field: 'end_at', message: 'Invalid end date/time.' };
      const startRef = out.start_at || body.start_at;
      if (startRef && ed.getTime() < new Date(startRef).getTime()) {
        return { ok: false, status: 400, field: 'end_at', message: 'End cannot be before start.' };
      }
      out.end_at = ed.toISOString();
    }
  }

  if (has('all_day')) {
    if (typeof body.all_day !== 'boolean') return { ok: false, status: 400, field: 'all_day', message: 'all_day must be a boolean.' };
    out.all_day = body.all_day;
  }
  // EVENT-AUDIENCE-2: `is_milestone` is retired (Owner, 2026-09-04). The column stays, nothing
  // writes it, and nothing reads it; "Show in Masthead" is the one flag.
  if (has('show_on_welcome')) {
    if (typeof body.show_on_welcome !== 'boolean') return { ok: false, status: 400, field: 'show_on_welcome', message: 'show_on_welcome must be a boolean.' };
    out.show_on_welcome = body.show_on_welcome;
  }

  // EVENT-AUDIENCE-2: the set of portal roles. Validated against the allowed values, de-duplicated,
  // and the legacy single-value column is DERIVED from it so old readers stay coherent. A body
  // that sends only the legacy `audience` (an older client) still works, unchanged.
  if (has('audiences')) {
    if (!Array.isArray(body.audiences) || body.audiences.some(v => typeof v !== 'string')) {
      return { ok: false, status: 400, field: 'audiences', message: 'audiences must be an array of roles.' };
    }
    const set = [...new Set(body.audiences)];
    const bad = set.find(v => !PORTAL_AUDIENCE_VALUES.includes(v));
    if (bad) return { ok: false, status: 400, field: 'audiences', message: `Unknown audience "${bad}".` };
    out.audiences = set;
    out.audience = legacyAudienceFor(set);
  } else if (has('audience') || !partial) {
    const a = typeof body.audience === 'string' && body.audience ? body.audience : 'internal';
    if (!AUDIENCES.includes(a)) return { ok: false, status: 400, field: 'audience', message: 'Invalid audience.' };
    out.audience = a;
    if (!partial) out.audiences = a === 'all' ? ['student'] : [];
  }

  if (has('color')) {
    if (body.color === null || body.color === '') out.color = null;
    else if (typeof body.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(body.color)) out.color = body.color;
    else return { ok: false, status: 400, field: 'color', message: 'Color must be a hex value like #1D2567.' };
  }

  if (has('url')) {
    if (body.url === null || body.url === '') out.url = null;
    else if (typeof body.url === 'string' && body.url.length <= 2000 && /^https?:\/\//i.test(body.url.trim())) out.url = body.url.trim();
    else return { ok: false, status: 400, field: 'url', message: 'Link must start with http:// or https://' };
  }

  if (has('location')) out.location = typeof body.location === 'string' ? body.location.trim().slice(0, 300) || null : null;
  if (has('school'))   out.school   = typeof body.school === 'string' ? body.school.trim().slice(0, 200) || null : null;
  if (has('description')) out.description = typeof body.description === 'string' ? body.description.trim().slice(0, 4000) || null : null;

  if (has('cohort_id')) {
    if (body.cohort_id === null || body.cohort_id === '') out.cohort_id = null;
    else if (typeof body.cohort_id === 'string' && UUID_REGEX.test(body.cohort_id)) out.cohort_id = body.cohort_id;
    else return { ok: false, status: 400, field: 'cohort_id', message: 'Invalid cohort.' };
  }

  // recurrence (defaults to 'none' on create). Validated independently of the client.
  if (has('recurrence') || !partial) {
    const r = typeof body.recurrence === 'string' && body.recurrence ? body.recurrence : 'none';
    if (!RECURRENCE_VALUES.includes(r)) return { ok: false, status: 400, field: 'recurrence', message: 'Invalid recurrence.' };
    out.recurrence = r;
  }
  // recurrence_end (optional, date-only 'YYYY-MM-DD'; NULL/'' = never).
  if (has('recurrence_end')) {
    if (body.recurrence_end === null || body.recurrence_end === '') out.recurrence_end = null;
    else if (typeof body.recurrence_end === 'string' && YMD_RE.test(body.recurrence_end)) out.recurrence_end = body.recurrence_end;
    else return { ok: false, status: 400, field: 'recurrence_end', message: 'Recurrence end must be a date.' };
  }
  // One-time events IGNORE recurrence-only fields; recurrence end cannot precede the start.
  if (out.recurrence === 'none') {
    if ('recurrence_end' in out) out.recurrence_end = null;
  } else if (out.recurrence_end) {
    const startRef = out.start_at || body.start_at;
    if (startRef) {
      const startYmd = new Date(startRef).toISOString().slice(0, 10);
      if (out.recurrence_end < startYmd) {
        return { ok: false, status: 400, field: 'recurrence_end', message: 'Recurrence end cannot be before the start.' };
      }
    }
  }

  return { ok: true, value: out };
}

// Map a Supabase/Postgres write error to a SAFE, coded client response. Never returns the raw database
// message, details, hint, constraint internals, SQL, or stack. CHECK violations (23514) are told apart
// by CONSTRAINT NAME - not by the generic code - so an event-type rejection is distinct from a date
// rejection, and recurrence-readiness is never inferred here (that stays the explicit pre-insert 503).
// EVENT-AUDIENCE-2: PostgREST reports an unknown column as PGRST204 (schema cache) or 42703.
function audiencesColumnMissing(error) {
  return ['PGRST204', '42703'].includes(error?.code) && /audiences/.test(`${error?.message || ''} ${error?.details || ''}`);
}

export function classifyWriteError(error) {
  const code = error?.code || '';
  const where = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  const names = (n) => where.includes(n);

  if (code === '23514') {
    if (names('aspire_events_event_type_chk')) {
      return { status: 422, body: { error: "That event type isn't available yet.", code: 'EVENT_TYPE_UNAVAILABLE' } };
    }
    if (names('aspire_events_end_after_start_chk') || names('chk_aspire_events_recurrence_end')) {
      return { status: 422, body: { error: 'Please check the event dates.', code: 'INVALID_EVENT_DATES' } };
    }
  }
  return { status: 500, body: { error: 'Could not save the event.', code: 'EVENT_SAVE_FAILED' } };
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

  const auth = await verifyCaller(req);
  if (!auth.authenticated) {
    console.log('[aspire-events] auth rejected', { reason: auth.reason, request_id: requestId });
    if (auth.reason === 'no_profile' || auth.reason === 'inactive') return res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const action = typeof body.action === 'string' ? body.action : null;
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── list: any active internal user; returns ACTIVE events overlapping [from, to] ─────────────
  if (action === 'list') {
    const from = typeof body.from === 'string' ? body.from : null; // 'YYYY-MM-DD'
    const to   = typeof body.to === 'string' ? body.to : null;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'invalid_request', field: 'range' });
    }
    const fromStart = new Date(`${from}T00:00:00`).toISOString();
    const toEnd     = new Date(`${to}T23:59:59.999`).toISOString();
    const recurrenceReady = await isRecurrenceReady(db);
    // Active events overlapping [fromStart, toEnd]: start on/before the window end AND
    // (start on/after the window start OR end on/after it). For point events (end_at NULL) the
    // NULL end comparison is false, so start_at.gte alone decides - which is correct.
    // When recurrence is available, ALSO include active recurring parents that started before the
    // window; their occurrences are expanded client-side by eventOnDate, which bounds them to the
    // requested range and to recurrence_end (no materialized rows, no duplicates).
    const overlap = recurrenceReady
      ? `start_at.gte.${fromStart},end_at.gte.${fromStart},recurrence.neq.none`
      : `start_at.gte.${fromStart},end_at.gte.${fromStart}`;
    const { data, error } = await db
      .from('aspire_events')
      .select('*')
      .eq('status', 'active')
      .lte('start_at', toEnd)
      .or(overlap)
      .order('start_at', { ascending: true });
    if (error) {
      console.log('[aspire-events] list failed', { request_id: requestId, errorCode: error.code });
      return res.status(500).json({ error: 'internal_error' });
    }
    return res.status(200).json({ success: true, events: data || [], recurrence_enabled: recurrenceReady });
  }

  // ── writes: owner/admin only ─────────────────────────────────────────────────────────────────
  if (!isOwnerAdmin(auth.role, auth.isOwner)) {
    console.log('[aspire-events] insufficient authority for write', { callerRole: auth.role, action, request_id: requestId });
    return res.status(403).json({ error: 'forbidden', code: 'EVENT_PERMISSION_DENIED', message: "You don't have permission to do that." });
  }

  if (action === 'create') {
    const v = validateEventBody(body, { partial: false });
    if (!v.ok) return res.status(v.status).json({ error: 'invalid_request', field: v.field, message: v.message });
    const recurrenceReady = await isRecurrenceReady(db);
    // Fail closed: a recurring event cannot be created until the Owner applies the recurrence migration.
    if (v.value.recurrence && v.value.recurrence !== 'none' && !recurrenceReady) {
      return res.status(503).json({ error: 'recurrence_not_enabled', message: 'Recurring events are not enabled yet. The recurrence update is pending.' });
    }
    const row = {
      ...v.value,
      status: 'active',
      created_by: auth.profileId,
      updated_by: auth.profileId,
    };
    // Without the columns, never reference them (a one-time event still saves normally).
    if (!recurrenceReady) { delete row.recurrence; delete row.recurrence_end; }
    let { data, error } = await db.from('aspire_events').insert(row).select('*').single();
    if (error && audiencesColumnMissing(error) && 'audiences' in row) {
      // EVENT-AUDIENCE-2 not applied yet: save without the set. The legacy `audience` value,
      // derived from the same ticks, still carries what the column would have.
      delete row.audiences;
      ({ data, error } = await db.from('aspire_events').insert(row).select('*').single());
    }
    if (error || !data) {
      const mapped = classifyWriteError(error);
      console.log('[aspire-events] create failed', { request_id: requestId, errorCode: error?.code, mappedCode: mapped.body.code });
      return res.status(mapped.status).json(mapped.body);
    }
    await emitAudit(db, auth, { actionType: 'aspire_event_created', eventId: data.id, title: data.title, requestId });
    return res.status(200).json({ success: true, event: data });
  }

  if (action === 'update') {
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id || !UUID_REGEX.test(id)) return res.status(400).json({ error: 'invalid_request', field: 'id' });
    const v = validateEventBody(body, { partial: true });
    if (!v.ok) return res.status(v.status).json({ error: 'invalid_request', field: v.field, message: v.message });
    const recurrenceReady = await isRecurrenceReady(db);
    if (v.value.recurrence && v.value.recurrence !== 'none' && !recurrenceReady) {
      return res.status(503).json({ error: 'recurrence_not_enabled', message: 'Recurring events are not enabled yet. The recurrence update is pending.' });
    }
    // Client never sets status directly here (archive is a separate action).
    const patch = { ...v.value, updated_by: auth.profileId };
    delete patch.status;
    if (!recurrenceReady) { delete patch.recurrence; delete patch.recurrence_end; }
    if (Object.keys(patch).length === 1) return res.status(400).json({ error: 'invalid_request', message: 'Nothing to update.' });
    let { data, error } = await db.from('aspire_events').update(patch).eq('id', id).eq('status', 'active').select('*').maybeSingle();
    if (error && audiencesColumnMissing(error) && 'audiences' in patch) {
      delete patch.audiences;
      ({ data, error } = await db.from('aspire_events').update(patch).eq('id', id).eq('status', 'active').select('*').maybeSingle());
    }
    if (error) {
      const mapped = classifyWriteError(error);
      console.log('[aspire-events] update failed', { request_id: requestId, errorCode: error.code, mappedCode: mapped.body.code });
      return res.status(mapped.status).json(mapped.body);
    }
    if (!data) return res.status(404).json({ error: 'not_found' });
    await emitAudit(db, auth, { actionType: 'aspire_event_updated', eventId: data.id, title: data.title, requestId });
    return res.status(200).json({ success: true, event: data });
  }

  if (action === 'archive') {
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id || !UUID_REGEX.test(id)) return res.status(400).json({ error: 'invalid_request', field: 'id' });
    const { data, error } = await db
      .from('aspire_events')
      .update({ status: 'archived', updated_by: auth.profileId })
      .eq('id', id)
      .select('id, title')
      .maybeSingle();
    if (error) {
      console.log('[aspire-events] archive failed', { request_id: requestId, errorCode: error.code });
      return res.status(500).json({ error: 'internal_error', message: 'Could not archive the event.' });
    }
    if (!data) return res.status(404).json({ error: 'not_found' });
    await emitAudit(db, auth, { actionType: 'aspire_event_archived', eventId: data.id, title: data.title, requestId });
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Unknown action.' });
}
