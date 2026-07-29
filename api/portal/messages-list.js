// api/portal/messages-list.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET the authenticated student's
// conversations. Cursor paginated, newest first. Reads go through the
// authenticated SECURITY DEFINER RPC with the CALLER's JWT, so access is scoped
// by my_message_conversation_ids() and never by an unrestricted service_role
// query. Returns no staff email and no other participant's data.
//
// MESSAGES-ARCHIVE-P1: also accepts ?view= (active default | archived | all)
// and prefers the v3 RPC, which adds p_view and an is_archived flag per row.
// While the migration is unapplied, PGRST202/42883 falls back to v2 (Phase 0's
// per-row unread fix, no archive support) and further to v1 if v2 is also
// absent (the original Phase 0 chain). archive_available is reported false
// whenever v3 could not answer, so the client never treats an unfiltered v2/v1
// page as an authoritative "active" view.

import { verifyPortalMessagesCaller, getUserScopedDb, getServiceDb } from '../lib/messagesAuth.js';
import { methodGuard, logApiError } from '../lib/messagesApi.js';
import { parseLimit, parseCursor, nextCursorFrom } from '../../lib/server/messages/validation.js';
import { classifyPortalConversations } from '../lib/messagesContext.js';

const VIEWS = ['active', 'archived', 'all'];

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

  // MESSAGES-ARCHIVE-P1: view defaults to active; archived and all are the
  // only other accepted values.
  const view = req.query?.view === undefined ? 'active' : req.query.view;
  if (!VIEWS.includes(view)) return res.status(422).json({ error: 'invalid_view' });

  const db = getUserScopedDb(req);
  if (!db) return res.status(401).json({ error: 'unauthenticated' });

  try {
    // MESSAGES-CORRECTNESS-PHASE0-1: prefer the v2 list RPC, whose per-row unread
    // rule (author_profile_id <> caller) matches the global unread badge. The API
    // switches to v2 only once the Owner-gated migration exists: until then the
    // function is absent from the schema and we fall back to v1 (today's exact
    // behavior). Runtime detection mirrors the repo's readiness-probe pattern.
    const rpcArgs = {
      p_limit: limit.value,
      p_cursor_ts: cursor.value.ts,
      p_cursor_id: cursor.value.id,
    };
    // MESSAGES-ARCHIVE-P1: prefer v3 (adds p_view and is_archived).
    let { data, error } = await db.rpc('messages_portal_list_conversations_v3', { ...rpcArgs, p_view: view });
    let archiveAvailable = true;
    if (error && (String(error.code) === 'PGRST202' || String(error.code) === '42883')) {
      archiveAvailable = false;
      ;({ data, error } = await db.rpc('messages_portal_list_conversations_v2', rpcArgs));
      if (error && (String(error.code) === 'PGRST202' || String(error.code) === '42883')) {
        ;({ data, error } = await db.rpc('messages_portal_list_conversations', rpcArgs));
      }
    }
    if (error) {
      logApiError('portal/messages-list', 'rpc_failed', error);
      return res.status(500).json({ error: 'internal_error' });
    }
    let conversations = data?.conversations || [];
    // Explicit thread classification is attached only after the caller-scoped
    // RPC has authorized the row set. direct_student_name is preserved for the
    // existing Unit Leader inbox UI, but callers should now prefer thread_kind.
    if (conversations.length > 0) {
      try {
        const svc = getServiceDb();
        if (svc) conversations = await classifyPortalConversations(svc, conversations, caller.profile.id);
      } catch {
        // Classification is response metadata only. The authorized row set still
        // returns if this decoration cannot run.
      }
    }
    return res.status(200).json({
      conversations,
      next_cursor: nextCursorFrom(conversations, limit.value, 'last_message_at'),
      archive_available: archiveAvailable,
    });
  } catch (err) {
    logApiError('portal/messages-list', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
