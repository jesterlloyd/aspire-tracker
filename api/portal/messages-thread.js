// api/portal/messages-thread.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET one conversation thread for the
// authenticated student. Access comes only from active participation; an
// inaccessible or missing conversation returns an identical non-enumerating 404.
// Staff messages are labeled ASPIRE Team with an optional staff author name and
// never a staff email address.
//
// PHASE 5A: migrated onto messages_portal_get_thread_v2. The newest bounded page
// opens first, each page is chronological, and cursor_ts plus cursor_id page
// BACKWARD through history. next_cursor points at the oldest message of the page
// returned and is null when no older history remains.

import { verifyPortalMessagesCaller, getUserScopedDb } from '../lib/messagesAuth.js';
import { methodGuard, notFound, logApiError } from '../lib/messagesApi.js';
import { parseLimit, parseCursor, isUuid } from '../../lib/server/messages/validation.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  // UL-PORTAL: admits a student OR a unit leader. The RPC below gates every row
  // through my_message_conversation_ids(), which handles both kinds, so this only
  // decides whether the account may use Messages at all. Student behavior is
  // unchanged: verifyPortalMessagesCaller returns the student result untouched.
  const caller = await verifyPortalMessagesCaller(req);
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
    // Phase 5A added messages_portal_get_thread_v2, because the original RPC
    // pages FORWARD from the oldest message: its first page is the oldest
    // content, so a student opens a long thread on the wrong end and never
    // reaches the message they were notified about. "Load earlier messages" is
    // not expressible against it. v2 opens at the NEWEST bounded page and pages
    // BACKWARD. The browser never calls this RPC directly: it reaches it only
    // through this authenticated endpoint, running as the signed-in student.
    const { data, error } = await db.rpc('messages_portal_get_thread_v2', {
      p_conversation_id: conversationId,
      p_limit: limit.value,
      p_cursor_ts: cursor.value.ts,
      p_cursor_id: cursor.value.id,
    });
    if (error) {
      logApiError('portal/messages-thread', 'rpc_failed', error);
      // MS400 is a validation rejection from the RPC (a partial cursor). The
      // portal has no MS403 path: an inaccessible conversation returns NULL and
      // maps to the same non-enumerating 404 as a missing one.
      const httpStatus = error.code === 'MS400' ? 422 : 500;
      const code = error.code === 'MS400' ? 'validation_failed' : 'internal_error';
      return res.status(httpStatus).json({ error: code });
    }
    // The RPC returns NULL for both inaccessible and missing conversations.
    if (!data) return notFound(res);

    return res.status(200).json({
      conversation: data.conversation,
      messages: data.messages || [],
      // v2 returns the authoritative BACKWARD cursor (the oldest message of the
      // page) and has_more itself, so the API passes them through rather than
      // deriving a forward cursor from the returned rows.
      next_cursor: data.next_cursor ?? null,
      has_more: data.has_more === true,
    });
  } catch (err) {
    logApiError('portal/messages-thread', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
