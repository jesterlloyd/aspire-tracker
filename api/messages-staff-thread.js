// api/messages-staff-thread.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET one conversation thread for an active
// Owner or Admin, with paginated messages, the participant identity and current
// access status, read-only related context, assignment, category, follow-up flag,
// status, and a lifecycle event summary. Marking read is a separate explicit
// action.
//
// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: prefers the v3 RPC, which adds a
// per-message reactions array. While the migration is unapplied, PGRST202/42883
// falls back to v2 (no reactions field) and reactions_available is reported
// false so the client never shows a reaction affordance against a page that
// cannot carry reaction data.

import { verifyStaffCaller, getUserScopedDb } from './lib/messagesAuth.js';
import { methodGuard, notFound, logApiError } from './lib/messagesApi.js';
import { parseLimit, parseCursor, isUuid } from '../lib/server/messages/validation.js';

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
    // Phase 4B2a Stage A added messages_staff_get_thread_v2, because the original
    // RPC pages FORWARD from the oldest message: its first page is the oldest
    // content, so "Load earlier messages" is impossible and staff would open a
    // long thread on the wrong end. v2 opens at the NEWEST bounded page and pages
    // BACKWARD. The browser never calls this RPC directly: it reaches it only
    // through this authenticated endpoint.
    const rpcArgs = {
      p_conversation_id: conversationId,
      p_limit: limit.value,
      p_cursor_ts: cursor.value.ts,
      p_cursor_id: cursor.value.id,
    };
    // MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: prefer v3 (adds per-message
    // reactions); fall back to v2 while the migration has not yet been applied.
    let { data, error } = await db.rpc('messages_staff_get_thread_v3', rpcArgs);
    let reactionsAvailable = true;
    if (error && (String(error.code) === 'PGRST202' || String(error.code) === '42883')) {
      reactionsAvailable = false;
      ;({ data, error } = await db.rpc('messages_staff_get_thread_v2', rpcArgs));
    }
    if (error) {
      logApiError('messages-staff-thread', 'rpc_failed', error);
      // MS400 is a validation rejection from the RPC (a partial cursor);
      // MS403 is the active Owner/Admin gate.
      const httpStatus = error.code === 'MS403' ? 403 : error.code === 'MS400' ? 422 : 500;
      const code = error.code === 'MS403' ? 'forbidden'
        : error.code === 'MS400' ? 'validation_failed' : 'internal_error';
      return res.status(httpStatus).json({ error: code });
    }
    if (!data) return notFound(res);

    return res.status(200).json({
      conversation: data.conversation,
      messages: data.messages || [],
      events: data.events || [],
      // v2 returns the authoritative BACKWARD cursor (the oldest message of the
      // page) and has_more itself, so the API passes them through rather than
      // deriving a forward cursor from the returned rows.
      next_cursor: data.next_cursor ?? null,
      has_more: data.has_more === true,
      reactions_available: reactionsAvailable,
    });
  } catch (err) {
    logApiError('messages-staff-thread', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
