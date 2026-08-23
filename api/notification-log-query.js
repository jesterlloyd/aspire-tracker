// api/notification-log-query.js
//
// Owner/admin-authenticated, READ-ONLY paginated query over notification_log for
// the Sent History view (Communication History Phase C.1).
//
// INVARIANTS:
//   - Read-only. No INSERT/UPDATE/DELETE. No sends. No Resend calls.
//   - Returns raw notification_type (presentation labels are the frontend's job).
//   - Recipient names are resolved via separate lookup queries (no DB join syntax):
//     fetch the page rows, collect their contact_id/student_id, then look those up
//     in contacts/students and merge resolved fields into the response.
//   - Default window is the last 30 days. Page size default 50, max 100.
//
// GET /api/notification-log-query
// Authorization: Bearer <session-token>
//
// Query params (all optional):
//   start_date  ISO date     (default: 30 days ago)
//   end_date    ISO date     (default: now)
//   page        integer ≥1   (default: 1)
//   per_page    integer 1-100 (default: 50)
//   contact_id  uuid          (optional filter - for future right-rail use)
//   student_id  uuid          (optional filter - for future right-rail use)
//
// Response 200:
//   { results: [...], total, page, per_page, total_pages }

import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { AUDIENCES, aggregateOutreach, classifyAudience } from '../lib/server/outreachAnalytics.js';
import { INACTIVE_MESSAGE } from './lib/activeAccount.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_PATTERN.test(v); }

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── 1. Auth: Bearer session token ─────────────────────────────────────────
    const authHeader  = req.headers['authorization'] || '';
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!bearerToken) return res.status(401).json({ error: 'Unauthorized' });

    const userClient = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
    );

    let user;
    try {
      const { data: { user: u }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !u) return res.status(401).json({ error: 'Unauthorized' });
      user = u;
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── 2. Role check (owner/admin) ───────────────────────────────────────────
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('id, role, is_active')
      .eq('auth_user_id', user.id)
      .single();

    // S-05: a deactivated account keeps a valid access token until it expires.
    // Refuse it before any work is performed, so deactivation ends access at once.
    if (profile && profile.is_active === false) {
      return res.status(403).json({ error: 'Forbidden', message: INACTIVE_MESSAGE });
    }
    if (!profile || !['owner', 'admin'].includes(profile.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // ── 3. Parse + validate query params ──────────────────────────────────────
    const q = req.query || {};

    let perPage = q.per_page !== undefined ? parseInt(q.per_page, 10) : 50;
    if (Number.isNaN(perPage) || perPage < 1) perPage = 50;
    if (perPage > 100) return res.status(400).json({ error: 'per_page must not exceed 100' });

    let page = q.page !== undefined ? parseInt(q.page, 10) : 1;
    if (Number.isNaN(page) || page < 1) page = 1;

    // Date range - the END boundary is always EXCLUSIVE (`<`).
    // The frontend (SentHistory) sends full ISO instants computed in the user's
    // LOCAL (Pacific) timezone: start = local 00:00 of the first day; end = local
    // 00:00 of the day AFTER the last day. That makes "today"/"last N days"/custom
    // ranges cover the user's full local calendar days with no UTC-midnight drift.
    //
    // Date-only inputs (YYYY-MM-DD), if ever received, are normalized defensively:
    // start → start of that UTC day; end → next UTC day (still exclusive).
    const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
    const now = new Date();

    const rawStart = q.start_date || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rawEnd   = q.end_date   || now.toISOString();

    const startInstant = DATE_ONLY.test(rawStart)
      ? new Date(`${rawStart}T00:00:00.000Z`)
      : new Date(rawStart);

    let endInstant;
    if (DATE_ONLY.test(rawEnd)) {
      const d = new Date(`${rawEnd}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);   // next-day exclusive → include the full end day
      endInstant = d;
    } else {
      endInstant = new Date(rawEnd);      // full ISO instant - already next-day-exclusive
    }

    if (Number.isNaN(startInstant.getTime()) || Number.isNaN(endInstant.getTime())) {
      return res.status(400).json({ error: 'Invalid start_date or end_date' });
    }

    if (q.contact_id && !isUuid(q.contact_id)) return res.status(400).json({ error: 'contact_id must be a valid UUID' });
    if (q.student_id && !isUuid(q.student_id)) return res.status(400).json({ error: 'student_id must be a valid UUID' });

    // New filters (Phase C.2)
    const notificationTypes = q.notification_types
      ? q.notification_types.split(',').map(s => s.trim()).filter(Boolean)
      : null;
    const recipientTypeFilter = q.recipient_type_filter || 'all';
    const statusFilter        = q.status_filter || 'all';
    const audienceFilter      = q.audience_filter || 'all';
    if (audienceFilter !== 'all' && !AUDIENCES.includes(audienceFilter)) {
      return res.status(400).json({ error: 'Invalid audience_filter' });
    }

    // ── 4a. OUTREACH-ANALYTICS-1: aggregate mode ─────────────────────────────
    // Same authorization, same window, same filter chain as the list below -
    // built by applyFilters so the KPI total is by construction the number the
    // list reports. Selects four small columns and NEVER a message body or
    // subject; pages through in chunks so a wide range does not depend on
    // PostgREST's default row ceiling.
    const applyFilters = (qb) => {
      let x = qb
        .gte('sent_at', startInstant.toISOString())
        .lt('sent_at', endInstant.toISOString());
      if (q.contact_id) x = x.eq('contact_id', q.contact_id);
      if (q.student_id) x = x.eq('student_id', q.student_id);
      if (notificationTypes && notificationTypes.length > 0) x = x.in('notification_type', notificationTypes);
      if (recipientTypeFilter === 'student')      x = x.eq('recipient_type', 'student');
      else if (recipientTypeFilter === 'contact') x = x.eq('recipient_type', 'contact');
      else if (recipientTypeFilter === 'null')    x = x.is('recipient_type', null);
      if (statusFilter === 'failed') x = x.in('status', ['failed', 'bounced', 'complained']);
      return x;
    };

    const loadContactCategories = async (rows) => {
      const contactCategories = new Map();
      const neededIds = [...new Set((rows || []).map(r => r.contact_id).filter(Boolean))];
      for (let i = 0; i < neededIds.length; i += 500) {
        const { data: cats, error: categoryError } = await supabaseAdmin
          .from('contacts').select('id, category').in('id', neededIds.slice(i, i + 500));
        if (categoryError) throw categoryError;
        for (const c of cats || []) contactCategories.set(c.id, c.category);
      }
      return contactCategories;
    };

    if (q.aggregate === '1' || q.aggregate === 'true') {
      const CHUNK = 1000;
      const MAX_ROWS = 25000;        // safety ceiling; reported honestly below
      const minimal = [];
      let truncated = false;
      for (let offset = 0; offset < MAX_ROWS; offset += CHUNK) {
        const { data, error: aggErr } = await applyFilters(
          supabaseAdmin.from('notification_log').select('sent_at, recipient_type, contact_id, status')
        ).order('sent_at', { ascending: false }).range(offset, offset + CHUNK - 1);
        if (aggErr) {
          console.error('[notification-log-query] aggregate error:', aggErr.message);
          return res.status(500).json({ error: 'Failed to load communication analytics' });
        }
        const batch = data || [];
        minimal.push(...batch);
        if (batch.length < CHUNK) break;
        if (minimal.length >= MAX_ROWS) { truncated = true; break; }
      }

      // Contact categories: ONE lookup of the small contacts table, ids only.
      const contactCategories = await loadContactCategories(minimal);

      const tzOffsetMinutes = Number.isFinite(Number(q.tz_offset_minutes)) ? Number(q.tz_offset_minutes) : 0;
      const agg = aggregateOutreach(minimal, {
        contactCategories,
        startIso: startInstant.toISOString(),
        endIso: endInstant.toISOString(),
        tzOffsetMinutes,
      });
      return res.status(200).json({ ...agg, truncated });
    }

    // ── 4. Query notification_log ─────────────────────────────────────────────
    const from = (page - 1) * perPage;
    const to   = from + perPage - 1;
    const LIST_COLUMNS = 'id, notification_type, recipient_type, contact_id, student_id, recipient_email, recipient_name, subject, status, sent_at, metadata';
    let pageRows;
    let total;

    if (audienceFilter === 'all') {
      // The unfiltered path keeps PostgREST's exact-count pagination and its
      // existing performance characteristics.
      const { data: rows, count, error } = await applyFilters(
        supabaseAdmin.from('notification_log').select(LIST_COLUMNS, { count: 'exact' })
      ).order('sent_at', { ascending: false }).range(from, to);

      if (error) {
        console.error('[notification-log-query] query error:', error.message);
        return res.status(500).json({ error: 'Failed to load communication history' });
      }
      pageRows = rows || [];
      total = count || 0;
    } else {
      // Audience is a derived classification: Students comes from
      // recipient_type, the two partner buckets come from contacts.category,
      // and Other is the residual. Fetch the filtered candidate set first,
      // classify it with the SAME pure function used by analytics, then page.
      // This is intentionally server-side and applies to the full result set,
      // never just the currently visible page.
      const CHUNK = 1000;
      const MAX_AUDIENCE_ROWS = 100000;
      const candidates = [];
      let complete = false;
      for (let offset = 0; offset < MAX_AUDIENCE_ROWS; offset += CHUNK) {
        const { data, error } = await applyFilters(
          supabaseAdmin.from('notification_log').select(LIST_COLUMNS)
        ).order('sent_at', { ascending: false }).range(offset, offset + CHUNK - 1);
        if (error) {
          console.error('[notification-log-query] audience query error:', error.message);
          return res.status(500).json({ error: 'Failed to load communication history' });
        }
        const batch = data || [];
        candidates.push(...batch);
        if (batch.length < CHUNK) { complete = true; break; }
      }
      if (!complete) {
        return res.status(422).json({ error: 'Too many communications for an audience filter; narrow the date range' });
      }

      const contactCategories = await loadContactCategories(candidates);
      const matching = candidates.filter(row => classifyAudience(row, contactCategories) === audienceFilter);
      total = matching.length;
      pageRows = matching.slice(from, to + 1);
    }

    // ── 5. Resolve recipient names via separate lookup queries (no DB joins) ──
    const contactIds = [...new Set(pageRows.map(r => r.contact_id).filter(Boolean))];
    const studentIds = [...new Set(pageRows.map(r => r.student_id).filter(Boolean))];

    const contactsById = {};
    const studentsById = {};

    if (contactIds.length) {
      const { data: contacts } = await supabaseAdmin
        .from('contacts')
        .select('id, full_name, category')
        .in('id', contactIds);
      for (const c of contacts || []) contactsById[c.id] = c;
    }

    if (studentIds.length) {
      const { data: students } = await supabaseAdmin
        .from('students')
        .select('id, first_name, last_name, school')
        .in('id', studentIds);
      for (const s of students || []) studentsById[s.id] = s;
    }

    // ── 6. Merge resolved fields. Labels are intentionally NOT derived here -
    //       the frontend maps notification_type to human-readable labels. ──────
    const results = pageRows.map(r => {
      const contact = r.contact_id ? contactsById[r.contact_id] : null;
      const student = r.student_id ? studentsById[r.student_id] : null;

      const resolvedName =
        contact ? contact.full_name :
        student ? `${student.first_name || ''} ${student.last_name || ''}`.trim() :
        (r.recipient_name || null);

      return {
        id:                          r.id,
        notification_type:           r.notification_type,
        recipient_type:              r.recipient_type,
        contact_id:                  r.contact_id,
        student_id:                  r.student_id,
        recipient_email:             r.recipient_email,
        subject:                     r.subject,
        status:                      r.status,
        sent_at:                     r.sent_at,
        metadata:                    r.metadata,
        recipient_name:              resolvedName,
        recipient_display_category:  contact ? (contact.category || null) : null,
        recipient_display_school:    student ? (student.school || null) : null,
      };
    });

    return res.status(200).json({
      results,
      total,
      page,
      per_page: perPage,
      total_pages: Math.max(1, Math.ceil(total / perPage)),
    });

  } catch (err) {
    console.error('[notification-log-query] unhandled exception:', err?.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
}
