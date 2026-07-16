// api/messages-staff-read.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): staff read state. Active Owner or Admin
// only.
//   GET  -> this staff member's unread count (portal-authored messages only)
//   POST -> mark one conversation read for THIS staff member only
//
// Read state is strictly per staff profile: one staff member reading never
// clears another staff member's unread count, and it never affects participant
// read state. The pointer is set to a SERVER-DERIVED timestamp inside the RPC; a
// client-supplied last_read_at is never accepted.

import { verifyStaffCaller, getServiceDb, getUserScopedDb } from './lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, logApiError } from './lib/messagesApi.js';
import { isUuid } from '../lib/server/messages/validation.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  if (req.method === 'GET') {
    const db = getUserScopedDb(req);
    if (!db) return res.status(401).json({ error: 'unauthenticated' });
    try {
      const { data, error } = await db.rpc('messages_staff_unread_count');
      if (error) {
        logApiError('messages-staff-read', 'rpc_failed', error);
        return res.status(error.code === 'MS403' ? 403 : 500)
          .json({ error: error.code === 'MS403' ? 'forbidden' : 'internal_error' });
      }
      return res.status(200).json({ unread_count: Number(data) || 0 });
    } catch (err) {
      logApiError('messages-staff-read', 'threw', err);
      return res.status(500).json({ error: 'internal_error' });
    }
  }

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
  const conversationId = parsed.body.conversation_id;
  if (!isUuid(conversationId)) return res.status(422).json({ error: 'invalid_conversation_id' });

  try {
    const { data, error } = await getServiceDb().rpc('messages_mark_read', {
      p_actor_profile_id: caller.profile.id,
      p_actor_kind: 'staff',
      p_conversation_id: conversationId,
    });
    if (error) {
      const mapped = mapRpcError(error);
      logApiError('messages-staff-read', mapped.error, error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    return res.status(200).json({ conversation_id: data.conversation_id, last_read_at: data.last_read_at });
  } catch (err) {
    logApiError('messages-staff-read', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
