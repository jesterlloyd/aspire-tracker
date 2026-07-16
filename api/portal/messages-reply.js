// api/portal/messages-reply.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): POST a reply from an active Student Portal
// participant. Replying to a resolved conversation reopens it automatically
// inside the transactional RPC, which also records the reopened audit event.
//
// The conversation context fetched here is used ONLY to route the notification
// (Phase 2 routing needs the subject, category, and any eligible assignee). It
// never grants access: the RPC re-validates live participant access and returns
// a non-enumerating 404 otherwise.

/* global process */
import { Resend } from 'resend';
import { verifyPortalStudentCaller, getServiceDb } from '../lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, rateLimitResponse, notFound, logApiError } from '../lib/messagesApi.js';
import { validateBody, isUuid } from '../../lib/server/messages/validation.js';
import { consumeMessage } from '../../lib/server/messages/rateLimitUtil.js';
import { replyForPortal } from '../../lib/server/messages/conversationService.js';
import { loadConversationRoutingContext } from '../lib/messagesContext.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const caller = await verifyPortalStudentCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const conversationId = parsed.body.conversation_id;
  if (!isUuid(conversationId)) return res.status(422).json({ error: 'invalid_conversation_id' });
  const body = validateBody(parsed.body.body);
  if (!body.ok) return res.status(422).json({ error: body.error });

  const db = getServiceDb();

  try {
    const msg = await consumeMessage(db, caller.profile.id);
    if (!msg.allowed) return rateLimitResponse(res, msg);
  } catch (err) {
    logApiError('portal/messages-reply', 'rate_limit_failed', err);
    return res.status(429).json({ error: 'rate_limited', retry_after_seconds: 60 });
  }

  try {
    const ctx = await loadConversationRoutingContext(db, conversationId);
    if (!ctx) return notFound(res);

    const out = await replyForPortal(
      { db, resend: new Resend(process.env.RESEND_API_KEY) },
      { profile: caller.profile, conversationId, conversation: ctx, body: body.value },
    );
    if (out.rpcError) {
      const mapped = mapRpcError(out.rpcError);
      logApiError('portal/messages-reply', mapped.error, out.rpcError);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    if (!out.ok) return res.status(409).json({ error: 'conflict', reason: out.reason });

    return res.status(201).json({
      message_id: out.result.message_id,
      created_at: out.result.created_at,
      reopened: out.result.reopened === true,
      confirmation: 'Your message was sent to the ASPIRE Team.',
    });
  } catch (err) {
    logApiError('portal/messages-reply', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
