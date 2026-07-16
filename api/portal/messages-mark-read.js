// api/portal/messages-mark-read.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): POST mark one conversation read for the
// authenticated student participant. The RPC advances ONLY this participant's
// pointer, to a SERVER-DERIVED timestamp (the latest message time). A
// client-supplied last_read_at is never accepted, and staff read state is never
// affected.

import { verifyPortalStudentCaller, getServiceDb } from '../lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, logApiError } from '../lib/messagesApi.js';
import { isUuid } from '../../lib/server/messages/validation.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const caller = await verifyPortalStudentCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const conversationId = parsed.body.conversation_id;
  if (!isUuid(conversationId)) return res.status(422).json({ error: 'invalid_conversation_id' });

  try {
    const { data, error } = await getServiceDb().rpc('messages_mark_read', {
      p_actor_profile_id: caller.profile.id,
      p_actor_kind: 'student',
      p_conversation_id: conversationId,
    });
    if (error) {
      const mapped = mapRpcError(error);
      logApiError('portal/messages-mark-read', mapped.error, error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    return res.status(200).json({ conversation_id: data.conversation_id, last_read_at: data.last_read_at });
  } catch (err) {
    logApiError('portal/messages-mark-read', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
