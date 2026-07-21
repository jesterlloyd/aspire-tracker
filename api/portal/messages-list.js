// api/portal/messages-list.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET the authenticated student's
// conversations. Cursor paginated, newest first. Reads go through the
// authenticated SECURITY DEFINER RPC with the CALLER's JWT, so access is scoped
// by my_message_conversation_ids() and never by an unrestricted service_role
// query. Returns no staff email and no other participant's data.

import { verifyPortalMessagesCaller, getUserScopedDb, getServiceDb } from '../lib/messagesAuth.js';
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
    let conversations = data?.conversations || [];
    // UL-POLISH P0: a Unit Leader's inbox must distinguish a direct student
    // thread from an ASPIRE Team thread. The caller's OWN participant rows
    // already carry scope_student_id for direct threads, and the thread view
    // already shows that student's name through the three-way author
    // projection, so naming the counterpart here exposes nothing new. Students
    // never receive the field, and rows without a named student stay untouched.
    if (caller.actorKind === 'unit_leader' && conversations.length > 0) {
      conversations = await withDirectStudentNames(conversations, caller.profile.id);
    }
    return res.status(200).json({
      conversations,
      next_cursor: nextCursorFrom(conversations, limit.value, 'last_message_at'),
    });
  } catch (err) {
    logApiError('portal/messages-list', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}

/**
 * Attach direct_student_name to each conversation where the CALLER's own
 * unit_leader participant row names a student. Read-only, bounded to the ids on
 * this page, and best-effort: any failure returns the rows unchanged rather
 * than failing the inbox.
 */
async function withDirectStudentNames(conversations, profileId) {
  try {
    const svc = getServiceDb();
    if (!svc) return conversations;
    const ids = conversations.map((c) => c.id);
    const { data: parts, error: pErr } = await svc
      .from('conversation_participants')
      .select('conversation_id, scope_student_id')
      .eq('participant_profile_id', profileId)
      .eq('participant_role', 'unit_leader')
      .in('conversation_id', ids)
      .not('scope_student_id', 'is', null);
    if (pErr || !parts?.length) return conversations;

    const studentIds = [...new Set(parts.map((r) => r.scope_student_id))];
    const { data: students, error: sErr } = await svc
      .from('students')
      .select('id, first_name, preferred_first_name, last_name')
      .in('id', studentIds);
    if (sErr) return conversations;

    const nameOf = new Map((students || []).map((st) => [
      st.id,
      `${st.preferred_first_name || st.first_name || ''} ${st.last_name || ''}`.trim(),
    ]));
    const byConversation = new Map(parts.map((r) => [r.conversation_id, r.scope_student_id]));
    return conversations.map((c) => {
      const sid = byConversation.get(c.id);
      const name = sid ? nameOf.get(sid) : null;
      return name ? { ...c, direct_student_name: name } : c;
    });
  } catch {
    return conversations;
  }
}
