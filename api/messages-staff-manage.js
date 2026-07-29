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
//
// Every action records its auditable lifecycle event inside the RPC, EXCEPT
// archive: MESSAGES-ARCHIVE-P1 per-user visibility is intentionally NOT
// evented, exactly like the staff/participant read pointers - it is UI state,
// not part of the append-only record. NONE of these actions sends an email:
// resolution is silent, and assignment, category, follow-up, and archive
// changes never notify.

import { verifyStaffCaller, getServiceDb } from './lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, logApiError } from './lib/messagesApi.js';
import { isUuid, validateStatus, validateCategory } from '../lib/server/messages/validation.js';

const ACTIONS = ['assign', 'status', 'category', 'flag', 'archive'];

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const { action, conversation_id: conversationId } = parsed.body;
  if (!ACTIONS.includes(action)) return res.status(422).json({ error: 'invalid_action' });
  if (!isUuid(conversationId)) return res.status(422).json({ error: 'invalid_conversation_id' });

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
  } else {
    // MESSAGES-ARCHIVE-P1: archive is always for the calling staff profile.
    if (typeof parsed.body.archived !== 'boolean') return res.status(422).json({ error: 'invalid_archived' });
    rpc = 'messages_set_conversation_archived';
    args = {
      p_actor_profile_id: caller.profile.id,
      p_actor_kind: 'staff',
      p_conversation_id: conversationId,
      p_archived: parsed.body.archived,
    };
  }

  try {
    const { data, error } = await db.rpc(rpc, args);
    if (error) {
      // MESSAGES-ARCHIVE-P1: pre-migration readiness. The archive RPC does not
      // exist yet, so report 503 rather than a generic 500.
      if (action === 'archive' && (String(error.code) === 'PGRST202' || String(error.code) === '42883')) {
        return res.status(503).json({ error: 'archive_not_ready' });
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
