// api/portal/messages-start.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): POST a new conversation from an active
// Student Portal user to the ASPIRE Team.
//
// Order: verify JWT, resolve the profile through auth_user_id, verify the active
// student grant and link, validate input, consume BOTH portal rate limits
// (new_conversation and message for the initial message), route with the Phase 2
// service, build the delivery payload server-side, call the transactional RPC,
// confirm a non-null delivery_id, then attempt the awaited send. Email failure
// never fails the authoritative message.
//
// The client supplies only subject, category, and body. It never supplies a
// delivery payload, recipient, event type, idempotency key, snapshot, or CTA.

/* global process */
import { Resend } from 'resend';
import { verifyPortalStudentCaller, getServiceDb } from '../lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, rateLimitResponse, logApiError } from '../lib/messagesApi.js';
import { validateSubject, validateBody, validateCategory } from '../../lib/server/messages/validation.js';
import { consumeNewConversation, consumeMessage } from '../../lib/server/messages/rateLimitUtil.js';
import { startConversationForPortal } from '../../lib/server/messages/conversationService.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const caller = await verifyPortalStudentCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const subject = validateSubject(parsed.body.subject);
  if (!subject.ok) return res.status(422).json({ error: subject.error });
  const body = validateBody(parsed.body.body);
  if (!body.ok) return res.status(422).json({ error: body.error });
  const category = validateCategory(parsed.body.category);
  if (!category.ok) return res.status(422).json({ error: category.error });

  const db = getServiceDb();

  // Rate limits use the SERVER-VERIFIED profile id only, and fail closed.
  try {
    const conv = await consumeNewConversation(db, caller.profile.id);
    if (!conv.allowed) return rateLimitResponse(res, conv);
    const msg = await consumeMessage(db, caller.profile.id);
    if (!msg.allowed) return rateLimitResponse(res, msg);
  } catch (err) {
    logApiError('portal/messages-start', 'rate_limit_failed', err);
    return res.status(429).json({ error: 'rate_limited', retry_after_seconds: 60 });
  }

  // Version one links one active student; use the caller's single active link.
  const studentId = caller.studentIds[0];

  try {
    const out = await startConversationForPortal(
      { db, resend: new Resend(process.env.RESEND_API_KEY) },
      { profile: caller.profile, studentId, subject: subject.value, category: category.value, body: body.value },
    );
    if (out.rpcError) {
      const mapped = mapRpcError(out.rpcError);
      logApiError('portal/messages-start', mapped.error, out.rpcError);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    if (!out.ok) return res.status(409).json({ error: 'conflict', reason: out.reason });

    return res.status(201).json({
      conversation_id: out.result.conversation_id,
      message_id: out.result.message_id,
      created_at: out.result.created_at,
      status: 'Open',
      confirmation: 'Your message was sent to the ASPIRE Team.',
    });
  } catch (err) {
    logApiError('portal/messages-start', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
