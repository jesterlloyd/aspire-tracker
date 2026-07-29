// api/portal/messages-react.js
//
// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: POST set, replace, or remove the
// authenticated portal caller's OWN reaction (student, unit_leader, or
// academic_partner) on one message. Reacting requires only READ visibility
// (message_participant_can_read, checked inside the RPC), never send: a
// frozen-but-readable thread may still be reacted to. No email is sent and no
// conversation_events row is written: per-user reaction state is intentionally
// not part of the append-only record, exactly like the read pointers and
// archive visibility.
//
// This endpoint applies NO rate limit, matching api/portal/messages-archive.js:
// the RPC is a single-row upsert or delete keyed by (message_id, profile_id),
// cheaper than one poll request, and every write is scoped to the caller's own
// single reaction row.

import { verifyPortalMessagesCaller, getServiceDb } from '../lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, logApiError } from '../lib/messagesApi.js';
import { isUuid } from '../../lib/server/messages/validation.js';

// The closed reaction set. Matches the table CHECK in the Phase 3A migration;
// the UI cannot invent keys and neither can this endpoint.
const REACTION_KEYS = ['acknowledge', 'thanks', 'celebrate'];

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  // UL-PORTAL / AP-PORTAL: any supported portal kind may react. The RPC
  // re-validates read access against the message's conversation, so the kind is
  // descriptive here, not authority.
  const caller = await verifyPortalMessagesCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const messageId = parsed.body.message_id;
  if (!isUuid(messageId)) return res.status(422).json({ error: 'invalid_message_id' });

  const reaction = parsed.body.reaction;
  if (reaction !== null && reaction !== undefined && !REACTION_KEYS.includes(reaction)) {
    return res.status(422).json({ error: 'invalid_reaction' });
  }

  try {
    const { data, error } = await getServiceDb().rpc('messages_set_message_reaction', {
      p_actor_profile_id: caller.profile.id,
      p_actor_kind: caller.actorKind,
      p_message_id: messageId,
      p_reaction_key: reaction ?? null,
    });
    if (error) {
      // MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: pre-migration readiness. The RPC
      // does not exist yet, so report 503 rather than a generic 500.
      if (String(error.code) === 'PGRST202' || String(error.code) === '42883') {
        return res.status(503).json({ error: 'reactions_not_ready' });
      }
      const mapped = mapRpcError(error);
      logApiError('portal/messages-react', mapped.error, error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    return res.status(200).json(data);
  } catch (err) {
    logApiError('portal/messages-react', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
