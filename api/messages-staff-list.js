// api/messages-staff-list.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET the staff conversation inbox. Active
// Owner or Admin only (never is_staff, which includes interviewer and viewer).
// Filters, search, and cursor pagination. Assignment and related context are
// projections and filters only; they never grant access.

import { verifyStaffCaller, getUserScopedDb } from './lib/messagesAuth.js';
import { methodGuard, logApiError } from './lib/messagesApi.js';
import {
  parseLimit, parseCursor, nextCursorFrom, isUuid, validateStatus, validateCategory,
} from '../lib/server/messages/validation.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const limit = parseLimit(req.query?.limit, { fallback: 25, max: 100 });
  if (!limit.ok) return res.status(422).json({ error: limit.error });
  const cursor = parseCursor({ cursorTs: req.query?.cursor_ts, cursorId: req.query?.cursor_id });
  if (!cursor.ok) return res.status(422).json({ error: cursor.error });

  let status = null;
  if (req.query?.status) {
    const v = validateStatus(req.query.status);
    if (!v.ok) return res.status(422).json({ error: v.error });
    status = v.value;
  }
  let category = null;
  if (req.query?.category) {
    const v = validateCategory(req.query.category);
    if (!v.ok) return res.status(422).json({ error: v.error });
    category = v.value;
  }
  let assignee = null;
  if (req.query?.assignee) {
    if (!isUuid(req.query.assignee)) return res.status(422).json({ error: 'invalid_assignee' });
    assignee = req.query.assignee;
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

  try {
    const { data, error } = await db.rpc('messages_staff_list_conversations', {
      p_limit: limit.value,
      p_cursor_ts: cursor.value.ts,
      p_cursor_id: cursor.value.id,
      p_status: status,
      p_assignee: assignee,
      p_category: category,
      p_flagged: flagged,
      p_search: search,
    });
    if (error) {
      logApiError('messages-staff-list', 'rpc_failed', error);
      return res.status(error.code === 'MS403' ? 403 : 500).json({ error: error.code === 'MS403' ? 'forbidden' : 'internal_error' });
    }
    const conversations = data?.conversations || [];
    return res.status(200).json({
      conversations,
      next_cursor: nextCursorFrom(conversations, limit.value, 'last_message_at'),
    });
  } catch (err) {
    logApiError('messages-staff-list', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
