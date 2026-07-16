// lib/server/messages/idempotency.js
//
// ASPIRE MESSAGES, PHASE 2 (STAGE B): deterministic delivery idempotency key.
// Pure. One logical notification maps to exactly one key, so a duplicate enqueue
// for the same key collides on the Stage A UNIQUE(idempotency_key) constraint.
// The key is derived from the logical event AND the actual recipient identity
// (not the recipient kind alone), so different recipients of the same event get
// different keys. The same durable key is reused as the Resend Idempotency-Key.

import { createHash } from 'node:crypto';

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Build the deterministic key. recipientKind selects how recipient identity is
// composed: a shared inbox is identified by its normalized email; assigned staff
// and portal users additionally include the recipient profile id. The identity
// portion is hashed so the stored key is opaque and length-bounded while still
// distinguishing recipients.
export function buildDeliveryIdempotencyKey({
  eventType,
  conversationId,
  messageId = null,
  recipientKind,
  recipientProfileId = null,
  recipientEmail,
} = {}) {
  if (!eventType || !conversationId || !recipientKind) {
    throw new Error('buildDeliveryIdempotencyKey requires eventType, conversationId, recipientKind');
  }
  const email = normalizeEmail(recipientEmail);
  const identity = recipientKind === 'shared_inbox'
    ? `email:${email}`
    : `profile:${recipientProfileId || ''}|email:${email}`;
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  return `mnd_v1:${eventType}:${conversationId}:${messageId || 'none'}:${recipientKind}:${digest}`;
}
