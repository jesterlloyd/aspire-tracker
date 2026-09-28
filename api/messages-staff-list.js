// api/messages-staff-list.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET the staff conversation inbox. Active
// Owner or Admin only (never is_staff, which includes interviewer and viewer).
// Search and cursor pagination. Related context is a projection only; it never
// grants access.
//
// MESSAGES-SIMPLIFY-1: three views, ?view=needs_reply (default) | all | done,
// from messages_staff_list_conversations_v5 (migration 20261014000000), which
// returns needs_reply, is_done and handled_by on every row and counts for all
// three views. The legacy values active and archived are read as all and done.
// Until the migration is applied, PGRST202/42883 falls back to v4 (needs_reply
// through its attention mode, all as active, done as archived) and reports
// simplify_available=false; its counts carry no done figure.

import { verifyStaffCaller, getUserScopedDb } from './lib/messagesAuth.js';
import { methodGuard, logApiError } from './lib/messagesApi.js';
import { parseLimit, parseCursor, nextCursorFrom } from '../lib/server/messages/validation.js';

const VIEWS = ['needs_reply', 'all', 'done'];
const LEGACY_VIEW_NAMES = { active: 'all', archived: 'done' };
const isMissingRpc = (error) => error && (String(error.code) === 'PGRST202' || String(error.code) === '42883');

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const limit = parseLimit(req.query?.limit, { fallback: 25, max: 100 });
  if (!limit.ok) return res.status(422).json({ error: limit.error });
  const cursor = parseCursor({ cursorTs: req.query?.cursor_ts, cursorId: req.query?.cursor_id });
  if (!cursor.ok) return res.status(422).json({ error: cursor.error });

  const rawView = req.query?.view === undefined ? 'needs_reply' : String(req.query.view);
  const view = LEGACY_VIEW_NAMES[rawView] || rawView;
  if (!VIEWS.includes(view)) return res.status(422).json({ error: 'invalid_view' });

  const search = typeof req.query?.search === 'string' && req.query.search.trim()
    ? req.query.search.trim().slice(0, 120)
    : null;

  const db = getUserScopedDb(req);
  if (!db) return res.status(401).json({ error: 'unauthenticated' });

  const base = {
    p_limit: limit.value,
    p_cursor_ts: cursor.value.ts,
    p_cursor_id: cursor.value.id,
    p_search: search,
  };

  try {
    let { data, error } = await db.rpc('messages_staff_list_conversations_v5', { ...base, p_view: view });
    let simplifyAvailable = true;
    if (isMissingRpc(error)) {
      // Code-first fallback: the refinement v4 answers the same three questions
      // with the older rule (no reactions, no shared Done).
      simplifyAvailable = false;
      ;({ data, error } = await db.rpc('messages_staff_list_conversations_v4', {
        ...base,
        p_status: null,
        p_assignee_mode: 'any',
        p_assignee_profile_id: null,
        p_category_mode: 'any',
        p_category: null,
        p_flagged: null,
        p_view: view === 'done' ? 'archived' : 'active',
        p_attention: view === 'needs_reply' ? 'needs_reply' : 'all',
      }));
      if (!error && data?.counts) {
        data = {
          ...data,
          counts: { needs_reply: data.counts.needs_reply, all: data.counts.active, done: null },
        };
      }
    }
    if (error) {
      logApiError('messages-staff-list', 'rpc_failed', error);
      // MS400 is a validation rejection from the RPC (bad mode, status, or
      // cursor); MS403 is the active Owner/Admin gate.
      const status_ = error.code === 'MS403' ? 403 : error.code === 'MS400' ? 422 : 500;
      const code = error.code === 'MS403' ? 'forbidden' : error.code === 'MS400' ? 'validation_failed' : 'internal_error';
      return res.status(status_).json({ error: code });
    }
    const conversations = data?.conversations || [];
    return res.status(200).json({
      conversations,
      next_cursor: nextCursorFrom(conversations, limit.value, 'last_message_at'),
      view,
      simplify_available: simplifyAvailable,
      counts: data?.counts || { needs_reply: 0, all: 0, done: null },
    });
  } catch (err) {
    logApiError('messages-staff-list', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
