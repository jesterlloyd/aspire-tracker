// api/messages-staff-list.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET the staff conversation inbox. Active
// Owner or Admin only (never is_staff, which includes interviewer and viewer).
// Filters, search, and cursor pagination. Assignment and related context are
// projections and filters only; they never grant access.
//
// MESSAGES-ARCHIVE-P1: also accepts ?view= (active default | archived | all)
// and prefers the v3 RPC, which adds p_view and an is_archived flag per row.
// While the migration is unapplied, PGRST202/42883 falls back to v2 (no
// archive support) and archive_available is reported false so the client never
// treats an unfiltered v2 page as an authoritative "active" view.

import { verifyStaffCaller, getUserScopedDb } from './lib/messagesAuth.js';
import { methodGuard, logApiError } from './lib/messagesApi.js';
import {
  parseLimit, parseCursor, nextCursorFrom, isUuid, validateStatus, validateCategory,
} from '../lib/server/messages/validation.js';

const VIEWS = ['active', 'archived', 'all'];

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const limit = parseLimit(req.query?.limit, { fallback: 25, max: 100 });
  if (!limit.ok) return res.status(422).json({ error: limit.error });
  const cursor = parseCursor({ cursorTs: req.query?.cursor_ts, cursorId: req.query?.cursor_id });
  if (!cursor.ok) return res.status(422).json({ error: cursor.error });

  // MESSAGES-ARCHIVE-P1: view defaults to active; archived and all are the
  // only other accepted values.
  const view = req.query?.view === undefined ? 'active' : req.query.view;
  if (!VIEWS.includes(view)) return res.status(422).json({ error: 'invalid_view' });

  let status = null;
  if (req.query?.status) {
    const v = validateStatus(req.query.status);
    if (!v.ok) return res.status(422).json({ error: v.error });
    status = v.value;
  }
  // Category: translate the safe HTTP value into an explicit v2 mode. Absent or
  // 'all' means any; the sentinel 'uncategorized' means category IS NULL;
  // anything else must be one approved category.
  let categoryMode = 'any';
  let category = null;
  if (req.query?.category && req.query.category !== 'all') {
    if (req.query.category === 'uncategorized') {
      categoryMode = 'uncategorized';
    } else {
      const v = validateCategory(req.query.category);
      if (!v.ok) return res.status(422).json({ error: v.error });
      categoryMode = 'specific';
      category = v.value;
    }
  }

  // Assignee: translate into an explicit v2 mode. 'me' resolves ONLY to the
  // server-verified caller profile; a client-supplied profile id is never
  // trusted for Me. A specific id must be a uuid, and the RPC still enforces
  // that the row actually matches, so a guessed id leaks nothing.
  let assigneeMode = 'any';
  let assigneeProfileId = null;
  if (req.query?.assignee && req.query.assignee !== 'all') {
    if (req.query.assignee === 'unassigned') {
      assigneeMode = 'unassigned';
    } else if (req.query.assignee === 'me') {
      assigneeMode = 'specific';
      assigneeProfileId = caller.profile.id;
    } else {
      if (!isUuid(req.query.assignee)) return res.status(422).json({ error: 'invalid_assignee' });
      assigneeMode = 'specific';
      assigneeProfileId = req.query.assignee;
    }
  }
  let flagged = null;
  if (req.query?.flagged === 'true') flagged = true;
  else if (req.query?.flagged === 'false') flagged = false;
  else if (req.query?.flagged !== undefined) return res.status(422).json({ error: 'invalid_flagged' });

  const search = typeof req.query?.search === 'string' && req.query.search.trim()
    ? req.query.search.trim().slice(0, 120)
    : null;

  const db = getUserScopedDb(req);
  if (!db) return res.status(401).json({ error: 'unauthenticated' });

  // Phase 4B Stage A added messages_staff_list_conversations_v2 with explicit
  // filter modes, because the original RPC treats a null assignee or category
  // as "no filter" and cannot express IS NULL. The browser never calls this
  // RPC directly: it reaches it only through this authenticated endpoint.
  const rpcArgs = {
    p_limit: limit.value,
    p_cursor_ts: cursor.value.ts,
    p_cursor_id: cursor.value.id,
    p_status: status,
    p_assignee_mode: assigneeMode,
    p_assignee_profile_id: assigneeProfileId,
    p_category_mode: categoryMode,
    p_category: category,
    p_flagged: flagged,
    p_search: search,
  };

  try {
    // MESSAGES-ARCHIVE-P1: prefer v3 (adds p_view and is_archived); fall back
    // to v2 (no archive support) while the migration has not yet been applied.
    let { data, error } = await db.rpc('messages_staff_list_conversations_v3', { ...rpcArgs, p_view: view });
    let archiveAvailable = true;
    if (error && (String(error.code) === 'PGRST202' || String(error.code) === '42883')) {
      archiveAvailable = false;
      ;({ data, error } = await db.rpc('messages_staff_list_conversations_v2', rpcArgs));
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
      archive_available: archiveAvailable,
    });
  } catch (err) {
    logApiError('messages-staff-list', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
