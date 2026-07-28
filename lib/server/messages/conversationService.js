// lib/server/messages/conversationService.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): the trusted service layer for authoritative
// conversation and message writes. It owns the required order:
//
//   6. calculate routing with the Phase 2 routing service
//   7. construct the internal delivery payload (server-side only)
//   8. call the appropriate transactional Phase 3 RPC
//   9. confirm conversation_id, message_id, and a NON-NULL delivery_id
//  10. after the transaction commits, attempt the awaited Phase 2 delivery
//  11. return authoritative success even when email enters a retry state
//
// The client NEVER supplies p_delivery, recipient_email, recipient_kind,
// recipient_profile_id, event_type, idempotency_key, snapshot fields, or the CTA
// path. This module builds the complete delivery object from verified server
// state only, and passes exactly the explicit fields the applied SQL requires.
// No message body, preview, snippet, content, HTML, quoted text, metadata, or
// nested object ever enters the delivery payload.
//
// Email is a notification only: a send failure leaves the durable delivery row
// for the Phase 2 retry worker and never rolls back or fails the authoritative
// write.

import { createHash, randomUUID } from 'node:crypto';
import { planNotificationRecipients } from './routing.js';
import { buildRpcDeliveryIdempotencyKey } from './idempotency.js';
import { ctaPathForKind } from './emailContent.js';
import { claimAndSendDeliveryById } from './deliveryService.js';
import { SHARED_INBOX_EMAIL } from './config.js';

// Build the complete, allowlisted delivery payload. Exactly the fields the
// applied RPC validates, and nothing else.
function buildDeliveryPayload({ eventType, conversationId, delivery, senderName, subject, category }) {
  const attemptId = randomUUID();
  return {
    idempotency_key: buildRpcDeliveryIdempotencyKey({
      eventType,
      conversationId,
      attemptId,
      recipientKind: delivery.recipientKind,
      recipientProfileId: delivery.recipientProfileId,
      recipientEmail: delivery.recipientEmail,
    }),
    recipient_email: delivery.recipientEmail,
    recipient_kind: delivery.recipientKind,
    recipient_profile_id: delivery.recipientProfileId || '',
    event_type: eventType,
    snapshot_sender_name: senderName,
    snapshot_subject: subject,
    snapshot_category: category || null,
    cta_path: ctaPathForKind(delivery.recipientKind),
  };
}

// Resolve the single routed recipient for an event, or a suppression reason.
// Duplicate suppression and sender-self suppression are the Phase 2 routing
// service's decisions; this never re-implements them.
function routeSingle(input) {
  const { deliveries, suppressed } = planNotificationRecipients(input);
  if (deliveries.length === 0) {
    return { delivery: null, reason: suppressed[0]?.reason || 'suppressed' };
  }
  return { delivery: deliveries[0], reason: null };
}

// Step 10: attempt the awaited send for the row the RPC just committed. Never
// throws into the caller: an email failure must not change the authoritative
// result. Returns the outcome for reporting only.
async function attemptDelivery(deps, deliveryId) {
  if (!deliveryId) return { attempted: false, outcome: 'no_delivery' };
  try {
    const result = await claimAndSendDeliveryById(deps.db, deps.resend, deliveryId, {
      worker: `messages-api:${randomUUID()}`,
    });
    if (!result) return { attempted: false, outcome: 'already_claimed' };
    return { attempted: true, outcome: result.queueStatus };
  } catch {
    // The durable row remains queued or retry_wait for the Phase 2 worker.
    return { attempted: true, outcome: 'retry_pending' };
  }
}

function assertRpcResult(result) {
  if (!result || !result.delivery_id) {
    const err = new Error('delivery_not_created');
    err.code = 'MS409';
    throw err;
  }
  return result;
}

const GENERAL_TEAM_CATEGORY = 'General question';
const GENERAL_TEAM_FALLBACK_SUBJECT = 'Message to ASPIRE Team';
const SUBJECT_MAX_CHARS = 120;

function compactWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function deriveGeneralTeamSubject(body) {
  const firstLine = String(body || '').split('\n').map(compactWhitespace).find(Boolean) || '';
  const candidate = firstLine || GENERAL_TEAM_FALLBACK_SUBJECT;
  const bounded = candidate.slice(0, SUBJECT_MAX_CHARS).trim();
  return bounded.length >= 3 ? bounded : GENERAL_TEAM_FALLBACK_SUBJECT;
}

export function buildGeneralTeamPayloadFingerprint({ actorKind, subject, category, body } = {}) {
  const canonical = JSON.stringify({
    version: 1,
    operation: 'general_team_thread_start',
    actor_kind: actorKind,
    subject,
    category,
    body,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// ── Portal: start a conversation ────────────────────────────────────────────
export async function startConversationForPortal(deps, { profile, studentId, subject, category, body }) {
  const { delivery, reason } = routeSingle({
    eventType: 'new_conversation',
    senderProfileId: profile.id,
    senderEmail: profile.email,
    sharedInboxEmail: SHARED_INBOX_EMAIL,
  });
  if (!delivery) return { ok: false, error: 'routing_suppressed', reason };

  const payload = buildDeliveryPayload({
    eventType: 'new_conversation',
    conversationId: null,
    delivery,
    senderName: profile.full_name || 'ASPIRE student',
    subject,
    category,
  });

  const { data, error } = await deps.db.rpc('messages_start_conversation', {
    p_actor_profile_id: profile.id,
    p_actor_kind: 'student',
    p_participant_profile_id: profile.id,
    p_student_id: studentId,
    p_subject: subject,
    p_category: category,
    p_body: body,
    p_delivery: payload,
  });
  if (error) return { ok: false, rpcError: error };

  const result = assertRpcResult(data);
  const send = await attemptDelivery(deps, result.delivery_id);
  return { ok: true, result, send };
}

// ── Portal: reply ───────────────────────────────────────────────────────────
export async function replyForPortal(deps, { profile, conversationId, conversation, body }) {
  const { delivery, reason } = routeSingle({
    eventType: 'portal_reply',
    senderProfileId: profile.id,
    senderEmail: profile.email,
    assignedStaff: conversation?.assignedStaff || null,
    sharedInboxEmail: SHARED_INBOX_EMAIL,
  });
  if (!delivery) return { ok: false, error: 'routing_suppressed', reason };

  const payload = buildDeliveryPayload({
    eventType: 'portal_reply',
    conversationId,
    delivery,
    senderName: profile.full_name || 'ASPIRE student',
    subject: conversation?.subject || 'ASPIRE Messages',
    category: conversation?.category || null,
  });

  const { data, error } = await deps.db.rpc('messages_post_reply', {
    p_actor_profile_id: profile.id,
    p_actor_kind: 'student',
    p_conversation_id: conversationId,
    p_body: body,
    p_delivery: payload,
  });
  if (error) return { ok: false, rpcError: error };

  const result = assertRpcResult(data);
  const send = await attemptDelivery(deps, result.delivery_id);
  return { ok: true, result, send };
}

// ── Staff: start a conversation with an active Student Portal participant ───
export async function startConversationForStaff(deps, {
  profile, participantProfileId, participantEmail, studentId, subject, category, body,
}) {
  const { delivery, reason } = routeSingle({
    eventType: 'staff_reply',
    senderProfileId: profile.id,
    senderEmail: profile.email,
    participant: { profileId: participantProfileId, email: participantEmail },
  });
  if (!delivery) return { ok: false, error: 'routing_suppressed', reason };

  const payload = buildDeliveryPayload({
    eventType: 'staff_reply',
    conversationId: null,
    delivery,
    senderName: profile.full_name || 'ASPIRE Team',
    subject,
    category,
  });

  const { data, error } = await deps.db.rpc('messages_start_conversation', {
    p_actor_profile_id: profile.id,
    p_actor_kind: 'staff',
    p_participant_profile_id: participantProfileId,
    p_student_id: studentId,
    p_subject: subject,
    p_category: category,
    p_body: body,
    p_delivery: payload,
  });
  if (error) return { ok: false, rpcError: error };

  const result = assertRpcResult(data);
  const send = await attemptDelivery(deps, result.delivery_id);
  return { ok: true, result, send };
}

// ── Staff: reply ────────────────────────────────────────────────────────────
export async function replyForStaff(deps, {
  profile, conversationId, conversation, participantProfileId, participantEmail, body,
}) {
  const { delivery, reason } = routeSingle({
    eventType: 'staff_reply',
    senderProfileId: profile.id,
    senderEmail: profile.email,
    participant: { profileId: participantProfileId, email: participantEmail },
  });
  if (!delivery) return { ok: false, error: 'routing_suppressed', reason };

  const payload = buildDeliveryPayload({
    eventType: 'staff_reply',
    conversationId,
    delivery,
    senderName: profile.full_name || 'ASPIRE Team',
    subject: conversation?.subject || 'ASPIRE Messages',
    category: conversation?.category || null,
  });

  const { data, error } = await deps.db.rpc('messages_post_reply', {
    p_actor_profile_id: profile.id,
    p_actor_kind: 'staff',
    p_conversation_id: conversationId,
    p_body: body,
    p_delivery: payload,
  });
  if (error) return { ok: false, rpcError: error };

  const result = assertRpcResult(data);
  const send = await attemptDelivery(deps, result.delivery_id);
  return { ok: true, result, send };
}

// ── UL-PORTAL: direct Unit Leader to student threads ────────────────────────
//
// A direct thread has TWO portal participants and no staff participant, so its
// routing is different in kind from every Phase 3 path: the recipient is the OTHER
// portal party, never the shared inbox and never an assigned staff member.
//
// planNotificationRecipients only knows the three Phase 3 shapes, so these two
// functions build the single portal_user delivery directly rather than teaching it
// a fourth shape. Every other invariant is unchanged and reused: the same
// buildDeliveryPayload allowlist, the same idempotency key derivation, the same
// assertRpcResult non-null delivery check, and the same fire-and-report send.
//
// The COUNTERPART is resolved by the caller from verified server state (the
// conversation's participant rows, or the student's linked portal account). It is
// never taken from the request.

// The sender is never the recipient. Mirrors the rule planNotificationRecipients
// applies for the Phase 3 shapes.
function directRecipient({ senderProfileId, counterpart }) {
  if (!counterpart?.profileId || !counterpart?.email) {
    return { delivery: null, reason: 'counterpart_unresolved' };
  }
  if (counterpart.profileId === senderProfileId) {
    return { delivery: null, reason: 'sender_is_recipient' };
  }
  return {
    delivery: {
      recipientKind: 'portal_user',
      recipientProfileId: counterpart.profileId,
      recipientEmail: counterpart.email,
    },
    reason: null,
  };
}

/**
 * Reply inside an existing DIRECT thread, as either portal party.
 * actorKind decides only the author role and the delivery event type; the RPC
 * independently re-authorizes through message_participant_can_send.
 */
export async function replyForPortalDirect(
  deps,
  { profile, actorKind, conversationId, conversation, counterpart, body },
) {
  const eventType = actorKind === 'unit_leader'
    ? 'unit_leader_message'
    : 'student_to_unit_leader_message';

  const { delivery, reason } = directRecipient({
    senderProfileId: profile.id,
    counterpart,
  });
  if (!delivery) return { ok: false, error: 'routing_suppressed', reason };

  const payload = buildDeliveryPayload({
    eventType,
    conversationId,
    delivery,
    senderName: profile.full_name || (actorKind === 'unit_leader' ? 'Unit Leader' : actorKind === 'academic_partner' ? 'Academic Partner' : 'ASPIRE student'),
    subject: conversation?.subject || 'ASPIRE Messages',
    category: conversation?.category || null,
  });

  const { data, error } = await deps.db.rpc('messages_post_reply', {
    p_actor_profile_id: profile.id,
    p_actor_kind: actorKind,
    p_conversation_id: conversationId,
    p_body: body,
    p_delivery: payload,
  });
  if (error) return { ok: false, rpcError: error };

  const result = assertRpcResult(data);
  const send = await attemptDelivery(deps, result.delivery_id);
  return { ok: true, result, send };
}

/**
 * Start a DIRECT Unit Leader to student thread.
 * unitKey and studentId are verified by the caller against the active scope AND
 * re-verified inside messages_start_conversation, which requires an active
 * unit_leader grant, an active user_unit_scopes row for that unit, and that the
 * student is actually placed in it via students.matched_unit_id.
 */
export async function startDirectThreadForUnitLeader(
  deps,
  { profile, studentId, unitKey, counterpart, subject, category, body },
) {
  const { delivery, reason } = directRecipient({
    senderProfileId: profile.id,
    counterpart,
  });
  if (!delivery) return { ok: false, error: 'routing_suppressed', reason };

  const payload = buildDeliveryPayload({
    eventType: 'unit_leader_message',
    conversationId: null,
    delivery,
    senderName: profile.full_name || 'Unit Leader',
    subject,
    category: category || null,
  });

  const { data, error } = await deps.db.rpc('messages_start_conversation', {
    p_actor_profile_id: profile.id,
    p_actor_kind: 'unit_leader',
    p_participant_profile_id: counterpart.profileId,
    p_student_id: studentId,
    p_subject: subject,
    p_category: category || null,
    p_body: body,
    p_delivery: payload,
    p_unit_key: unitKey,
  });
  if (error) return { ok: false, rpcError: error };

  const result = assertRpcResult(data);
  const send = await attemptDelivery(deps, result.delivery_id);
  return { ok: true, result, send };
}

/**
 * UL-PORTAL: REPORT A CONCERN. A Unit Leader opens a thread with the ASPIRE Team.
 *
 * This is NOT a direct thread. It creates exactly one participant row, the Unit
 * Leader, unit scoped, carrying the student as CONTEXT only. The student is not a
 * participant and therefore has no read path to it.
 *
 * Routing is the unchanged 'new_conversation' shape, so it reaches the shared inbox
 * exactly like a student's first message and needs no new delivery event type.
 *
 * Requires the 'unit_leader_to_staff' actor kind added by 20260720000002.
 */
export async function startConcernThreadForUnitLeader(
  deps,
  { profile, studentId, unitKey, subject, category, body },
) {
  const { delivery, reason } = routeSingle({
    eventType: 'new_conversation',
    senderProfileId: profile.id,
    senderEmail: profile.email,
    assignedStaff: null,
    sharedInboxEmail: SHARED_INBOX_EMAIL,
  });
  if (!delivery) return { ok: false, error: 'routing_suppressed', reason };

  const payload = buildDeliveryPayload({
    eventType: 'new_conversation',
    conversationId: null,
    delivery,
    senderName: profile.full_name || 'Unit Leader',
    subject,
    category: category || null,
  });

  const { data, error } = await deps.db.rpc('messages_start_conversation', {
    p_actor_profile_id: profile.id,
    p_actor_kind: 'unit_leader_to_staff',
    // The Unit Leader is the only participant, so they are their own participant id.
    p_participant_profile_id: profile.id,
    p_student_id: studentId,
    p_subject: subject,
    p_category: category || null,
    p_body: body,
    p_delivery: payload,
    p_unit_key: unitKey,
  });
  if (error) return { ok: false, rpcError: error };

  const result = assertRpcResult(data);
  const send = await attemptDelivery(deps, result.delivery_id);
  return { ok: true, result, send };
}

/**
 * Start a GENERAL portal-to-ASPIRE Team thread.
 *
 * This is the role-aware no-student/no-unit contract for the shared portal
 * Messages surface. The browser supplies only request_id and body. The server
 * derives subject, category, routing, actor kind, and delivery. The database RPC
 * owns request-level idempotency and rate limiting so a committed request can be
 * replayed safely without creating a second conversation or consuming a second
 * notification delivery.
 */
export async function startGeneralTeamConversationForPortal(
  deps,
  { profile, actorKind, requestId, body, schoolKey = null },
) {
  const subject = deriveGeneralTeamSubject(body);
  const category = GENERAL_TEAM_CATEGORY;
  const payloadFingerprint = buildGeneralTeamPayloadFingerprint({
    actorKind,
    subject,
    category,
    body,
  });

  const { delivery, reason } = routeSingle({
    eventType: 'new_conversation',
    senderProfileId: profile.id,
    senderEmail: profile.email,
    assignedStaff: null,
    sharedInboxEmail: SHARED_INBOX_EMAIL,
  });
  if (!delivery) return { ok: false, error: 'routing_suppressed', reason };

  const payload = buildDeliveryPayload({
    eventType: 'new_conversation',
    conversationId: null,
    delivery,
    senderName: profile.full_name || (actorKind === 'unit_leader' ? 'Unit Leader' : actorKind === 'academic_partner' ? 'Academic Partner' : 'ASPIRE student'),
    subject,
    category,
  });

  // Academic Partner uses the dedicated AP RPC, which takes the server-verified selected school_key.
  // Student and Unit Leader keep the original 8-arg RPC unchanged.
  const { data, error } = actorKind === 'academic_partner'
    ? await deps.db.rpc('messages_start_general_team_conversation_ap', {
      p_actor_profile_id: profile.id,
      p_request_id: requestId,
      p_payload_fingerprint: payloadFingerprint,
      p_subject: subject,
      p_category: category,
      p_body: body,
      p_delivery: payload,
      p_school_key: schoolKey,
    })
    : await deps.db.rpc('messages_start_general_team_conversation', {
      p_actor_profile_id: profile.id,
      p_actor_kind: actorKind,
      p_request_id: requestId,
      p_payload_fingerprint: payloadFingerprint,
      p_subject: subject,
      p_category: category,
      p_body: body,
      p_delivery: payload,
    });
  if (error) return { ok: false, rpcError: error };

  const result = assertRpcResult(data);
  const send = result.idempotent_replay === true
    ? { attempted: false, outcome: 'idempotent_replay' }
    : await attemptDelivery(deps, result.delivery_id);
  return { ok: true, result, send };
}
