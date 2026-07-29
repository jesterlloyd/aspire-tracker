// api/portal/messages-archive.js
//
// MESSAGES-ARCHIVE-P1: POST archive or unarchive one conversation for the
// authenticated portal caller (student, unit_leader, or academic_partner).
// Archive requires only READ visibility (message_participant_can_read, checked
// inside the RPC), never send: a frozen-but-readable thread - for example a
// former Unit Leader's ended assignment - may still be archived. Archiving
// also advances the caller's own read pointer to a server-derived timestamp,
// clearing their unread count; unarchiving simply removes their visibility
// row. No email is sent and no conversation_events row is written: per-user
// archive state is intentionally not part of the append-only record, exactly
// like the read pointers.
//
// This endpoint applies NO rate limit: it is not message creation, and every
// write is scoped to the caller's own single visibility row.

import { verifyPortalMessagesCaller, getServiceDb } from '../lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, logApiError } from '../lib/messagesApi.js';
import { isUuid } from '../../lib/server/messages/validation.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  // UL-PORTAL / AP-PORTAL: any supported portal kind may archive. The RPC
  // re-validates read access against the conversation, so the kind is
  // descriptive here, not authority.
  const caller = await verifyPortalMessagesCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const conversationId = parsed.body.conversation_id;
  if (!isUuid(conversationId)) return res.status(422).json({ error: 'invalid_conversation_id' });
  if (typeof parsed.body.archived !== 'boolean') return res.status(422).json({ error: 'invalid_archived' });

  try {
    const { data, error } = await getServiceDb().rpc('messages_set_conversation_archived', {
      p_actor_profile_id: caller.profile.id,
      p_actor_kind: caller.actorKind,
      p_conversation_id: conversationId,
      p_archived: parsed.body.archived,
    });
    if (error) {
      // MESSAGES-ARCHIVE-P1: pre-migration readiness. The RPC does not exist
      // yet, so report 503 rather than a generic 500.
      if (String(error.code) === 'PGRST202' || String(error.code) === '42883') {
        return res.status(503).json({ error: 'archive_not_ready' });
      }
      const mapped = mapRpcError(error);
      logApiError('portal/messages-archive', mapped.error, error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    return res.status(200).json({ conversation_id: conversationId, archived: data.archived });
  } catch (err) {
    logApiError('portal/messages-archive', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
