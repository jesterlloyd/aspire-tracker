// api/messages-staff-reply.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): POST a staff reply. Active Owner or Admin
// only. Requires the conversation's portal participant to still hold active
// access: if the grant expired, was revoked, or the student link is inactive, the
// transactional RPC raises MS409 and this returns 409 WITHOUT creating an
// inaccessible message. Staff may still resolve or manage the thread separately.
//
// Replying to a resolved conversation reopens it inside the RPC. Staff are not
// rate-limited through the portal-user mechanism.

/* global process */
import { Resend } from 'resend';
import { verifyStaffCaller, getServiceDb } from './lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, notFound, logApiError } from './lib/messagesApi.js';
import { validateBody, isUuid } from '../lib/server/messages/validation.js';
import { replyForStaff } from '../lib/server/messages/conversationService.js';
import { loadConversationRoutingContext, loadActiveParticipants } from './lib/messagesContext.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const conversationId = parsed.body.conversation_id;
  if (!isUuid(conversationId)) return res.status(422).json({ error: 'invalid_conversation_id' });
  const body = validateBody(parsed.body.body);
  if (!body.ok) return res.status(422).json({ error: body.error });

  const db = getServiceDb();

  try {
    const ctx = await loadConversationRoutingContext(db, conversationId);
    if (!ctx) return notFound(res);

    // The authoritative notification target is the portal account's
    // user_profiles.email, never students.school_email or personal_email.
    // UL-PORTAL: a direct thread has TWO active participants. Staff intervene in
    // both shapes, so the recipient is chosen deterministically rather than
    // arbitrarily: reply to whoever sent the most recent non-staff message, and
    // fall back to join order. The RPC independently re-validates that this
    // recipient is an active-access participant of this conversation.
    const participants = await loadActiveParticipants(db, conversationId);
    if (participants.length === 0) {
      return res.status(409).json({ error: 'conflict', reason: 'no_active_participant' });
    }
    let participant = participants[0];
    if (participants.length > 1) {
      const { data: lastInbound } = await db
        .from('messages')
        .select('author_profile_id')
        .eq('conversation_id', conversationId)
        .neq('author_role', 'staff')
        .order('created_at', { ascending: false })
        .limit(1);
      const lastAuthorId = lastInbound?.[0]?.author_profile_id;
      const preferred = participants.find(p => p.profileId === lastAuthorId);
      if (preferred) participant = preferred;
    }

    const out = await replyForStaff(
      { db, resend: new Resend(process.env.RESEND_API_KEY) },
      {
        profile: caller.profile,
        conversationId,
        conversation: ctx,
        participantProfileId: participant.profileId,
        participantEmail: participant.email,
        body: body.value,
      },
    );
    if (out.rpcError) {
      const mapped = mapRpcError(out.rpcError);
      logApiError('messages-staff-reply', mapped.error, out.rpcError);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    if (!out.ok) return res.status(409).json({ error: 'conflict', reason: out.reason });

    return res.status(201).json({
      message_id: out.result.message_id,
      created_at: out.result.created_at,
      reopened: out.result.reopened === true,
    });
  } catch (err) {
    logApiError('messages-staff-reply', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
