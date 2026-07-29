// api/messages-staff-manage.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): staff conversation management. Active Owner
// or Admin only. One endpoint, one validated action, mirroring the repository's
// multi-action endpoint convention (see api/manage-interviewers.js).
//
// Actions and their transactional RPCs:
//   assign   -> messages_set_assignment  (assignee must be an active Owner/Admin;
//                                         assignment NEVER grants access)
//   status   -> messages_set_status      (open | waiting | resolved; resolving
//                                         sets resolved_at, leaving it clears it)
//   category -> messages_set_category    (null or one approved category)
//   flag     -> messages_set_follow_up   (flag or unflag)
//   archive  -> messages_set_conversation_archived (MESSAGES-ARCHIVE-P1; archive
//                                         or unarchive for the calling staff
//                                         profile ONLY)
//   react    -> messages_set_message_reaction (MESSAGES-LIFECYCLE-PHASE3A-
//                                         REACTIONS; set, replace, or remove
//                                         the calling staff profile's OWN
//                                         reaction on one message; targets a
//                                         message_id, not a conversation_id)
//
// Every action records its auditable lifecycle event inside the RPC, EXCEPT
// archive and react: MESSAGES-ARCHIVE-P1 per-user visibility and MESSAGES-
// LIFECYCLE-PHASE3A-REACTIONS per-user reactions are intentionally NOT evented,
// exactly like the staff/participant read pointers - both are UI state, not
// part of the append-only record. NONE of these actions sends an email:
// resolution is silent, and assignment, category, follow-up, archive, and
// react changes never notify.

import { verifyStaffCaller, getServiceDb } from './lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, logApiError } from './lib/messagesApi.js';
import { isUuid, validateStatus, validateCategory } from '../lib/server/messages/validation.js';

const ACTIONS = ['assign', 'status', 'category', 'flag', 'archive', 'react'];
// The closed reaction set. Matches the table CHECK in the Phase 3A migration;
// the UI cannot invent keys and neither can this endpoint.
const REACTION_KEYS = ['acknowledge', 'thanks', 'celebrate'];

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const { action, conversation_id: conversationId, message_id: messageId } = parsed.body;
  if (!ACTIONS.includes(action)) return res.status(422).json({ error: 'invalid_action' });
  // react targets a message_id, not a conversation_id; every other action
  // targets a conversation_id.
  if (action !== 'react' && !isUuid(conversationId)) {
    return res.status(422).json({ error: 'invalid_conversation_id' });
  }

  const db = getServiceDb();
  let rpc;
  let args;

  if (action === 'assign') {
    const assignee = parsed.body.assignee_profile_id;
    // Null clears the assignment; otherwise it must be a uuid. The RPC enforces
    // that the assignee is an active Owner or Admin.
    if (assignee !== null && assignee !== undefined && !isUuid(assignee)) {
      return res.status(422).json({ error: 'invalid_assignee_profile_id' });
    }
    rpc = 'messages_set_assignment';
    args = {
      p_actor_profile_id: caller.profile.id,
      p_conversation_id: conversationId,
      p_assignee_profile_id: assignee ?? null,
    };
  } else if (action === 'status') {
    const v = validateStatus(parsed.body.status);
    if (!v.ok) return res.status(422).json({ error: v.error });
    rpc = 'messages_set_status';
    args = { p_actor_profile_id: caller.profile.id, p_conversation_id: conversationId, p_status: v.value };
  } else if (action === 'category') {
    const v = validateCategory(parsed.body.category);
    if (!v.ok) return res.status(422).json({ error: v.error });
    rpc = 'messages_set_category';
    args = { p_actor_profile_id: caller.profile.id, p_conversation_id: conversationId, p_category: v.value };
  } else if (action === 'flag') {
    if (typeof parsed.body.flagged !== 'boolean') return res.status(422).json({ error: 'invalid_flagged' });
    rpc = 'messages_set_follow_up';
    args = { p_actor_profile_id: caller.profile.id, p_conversation_id: conversationId, p_flagged: parsed.body.flagged };
  } else if (action === 'archive') {
    // MESSAGES-ARCHIVE-P1: archive is always for the calling staff profile.
    if (typeof parsed.body.archived !== 'boolean') return res.status(422).json({ error: 'invalid_archived' });
    rpc = 'messages_set_conversation_archived';
    args = {
      p_actor_profile_id: caller.profile.id,
      p_actor_kind: 'staff',
      p_conversation_id: conversationId,
      p_archived: parsed.body.archived,
    };
  } else {
    // MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: react is always for the calling
    // staff profile, and the actor kind is always the VERIFIED 'staff' kind,
    // never anything read from the request body.
    if (!isUuid(messageId)) return res.status(422).json({ error: 'invalid_message_id' });
    const reaction = parsed.body.reaction;
    if (reaction !== null && reaction !== undefined && !REACTION_KEYS.includes(reaction)) {
      return res.status(422).json({ error: 'invalid_reaction' });
    }
    rpc = 'messages_set_message_reaction';
    args = {
      p_actor_profile_id: caller.profile.id,
      p_actor_kind: 'staff',
      p_message_id: messageId,
      p_reaction_key: reaction ?? null,
    };
  }

  try {
    const { data, error } = await db.rpc(rpc, args);
    if (error) {
      // MESSAGES-ARCHIVE-P1 / MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: pre-migration
      // readiness. The archive or reaction RPC does not exist yet, so report 503
      // rather than a generic 500.
      if (action === 'archive' && (String(error.code) === 'PGRST202' || String(error.code) === '42883')) {
        return res.status(503).json({ error: 'archive_not_ready' });
      }
      if (action === 'react' && (String(error.code) === 'PGRST202' || String(error.code) === '42883')) {
        return res.status(503).json({ error: 'reactions_not_ready' });
      }
      const mapped = mapRpcError(error);
      logApiError('messages-staff-manage', mapped.error, error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    return res.status(200).json({ action, ...data });
  } catch (err) {
    logApiError('messages-staff-manage', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
