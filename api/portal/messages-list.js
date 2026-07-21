// api/portal/messages-list.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET the authenticated student's
// conversations. Cursor paginated, newest first. Reads go through the
// authenticated SECURITY DEFINER RPC with the CALLER's JWT, so access is scoped
// by my_message_conversation_ids() and never by an unrestricted service_role
// query. Returns no staff email and no other participant's data.

import { verifyPortalMessagesCaller, getUserScopedDb } from '../lib/messagesAuth.js';
import { methodGuard, logApiError } from '../lib/messagesApi.js';
import { parseLimit, parseCursor, nextCursorFrom } from '../../lib/server/messages/validation.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  // UL-PORTAL: admits a student OR a unit leader. The RPC below gates every row
  // through my_message_conversation_ids(), which handles both kinds, so this only
  // decides whether the account may use Messages at all. Student behavior is
  // unchanged: verifyPortalMessagesCaller returns the student result untouched.
  const caller = await verifyPortalMessagesCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const limit = parseLimit(req.query?.limit, { fallback: 25, max: 100 });
  if (!limit.ok) return res.status(422).json({ error: limit.error });
  const cursor = parseCursor({ cursorTs: req.query?.cursor_ts, cursorId: req.query?.cursor_id });
  if (!cursor.ok) return res.status(422).json({ error: cursor.error });

  const db = getUserScopedDb(req);
  if (!db) return res.status(401).json({ error: 'unauthenticated' });

  try {
    const { data, error } = await db.rpc('messages_portal_list_conversations', {
      p_limit: limit.value,
      p_cursor_ts: cursor.value.ts,
      p_cursor_id: cursor.value.id,
    });
    if (error) {
      logApiError('portal/messages-list', 'rpc_failed', error);
      return res.status(500).json({ error: 'internal_error' });
    }
    const conversations = data?.conversations || [];
    return res.status(200).json({
      conversations,
      next_cursor: nextCursorFrom(conversations, limit.value, 'last_message_at'),
    });
  } catch (err) {
    logApiError('portal/messages-list', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
