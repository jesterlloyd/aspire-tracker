// api/messages-staff-thread.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET one conversation thread for an active
// Owner or Admin, with paginated messages, the participant identity and current
// access status, read-only related context, assignment, category, follow-up flag,
// status, and a lifecycle event summary. Marking read is a separate explicit
// action.

import { verifyStaffCaller, getUserScopedDb } from './lib/messagesAuth.js';
import { methodGuard, notFound, logApiError } from './lib/messagesApi.js';
import { parseLimit, parseCursor, isUuid, nextCursorFrom } from '../lib/server/messages/validation.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const conversationId = req.query?.conversation_id;
  if (!isUuid(conversationId)) return res.status(422).json({ error: 'invalid_conversation_id' });

  const limit = parseLimit(req.query?.limit, { fallback: 50, max: 100 });
  if (!limit.ok) return res.status(422).json({ error: limit.error });
  const cursor = parseCursor({ cursorTs: req.query?.cursor_ts, cursorId: req.query?.cursor_id });
  if (!cursor.ok) return res.status(422).json({ error: cursor.error });

  const db = getUserScopedDb(req);
  if (!db) return res.status(401).json({ error: 'unauthenticated' });

  try {
    const { data, error } = await db.rpc('messages_staff_get_thread', {
      p_conversation_id: conversationId,
      p_limit: limit.value,
      p_cursor_ts: cursor.value.ts,
      p_cursor_id: cursor.value.id,
    });
    if (error) {
      logApiError('messages-staff-thread', 'rpc_failed', error);
      return res.status(error.code === 'MS403' ? 403 : 500).json({ error: error.code === 'MS403' ? 'forbidden' : 'internal_error' });
    }
    if (!data) return notFound(res);

    const messages = data.messages || [];
    return res.status(200).json({
      conversation: data.conversation,
      messages,
      events: data.events || [],
      next_cursor: nextCursorFrom(messages, limit.value, 'created_at'),
    });
  } catch (err) {
    logApiError('messages-staff-thread', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
