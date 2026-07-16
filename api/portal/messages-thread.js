// api/portal/messages-thread.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET one conversation thread for the
// authenticated student. Access comes only from active participation; an
// inaccessible or missing conversation returns an identical non-enumerating 404.
// Staff messages are labeled ASPIRE Team with an optional staff author name and
// never a staff email address.

import { verifyPortalStudentCaller, getUserScopedDb } from '../lib/messagesAuth.js';
import { methodGuard, notFound, logApiError } from '../lib/messagesApi.js';
import { parseLimit, parseCursor, isUuid, nextCursorFrom } from '../../lib/server/messages/validation.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const caller = await verifyPortalStudentCaller(req);
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
    const { data, error } = await db.rpc('messages_portal_get_thread', {
      p_conversation_id: conversationId,
      p_limit: limit.value,
      p_cursor_ts: cursor.value.ts,
      p_cursor_id: cursor.value.id,
    });
    if (error) {
      logApiError('portal/messages-thread', 'rpc_failed', error);
      return res.status(500).json({ error: 'internal_error' });
    }
    // The RPC returns NULL for both inaccessible and missing conversations.
    if (!data) return notFound(res);

    const messages = data.messages || [];
    return res.status(200).json({
      conversation: data.conversation,
      messages,
      next_cursor: nextCursorFrom(messages, limit.value, 'created_at'),
    });
  } catch (err) {
    logApiError('portal/messages-thread', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
