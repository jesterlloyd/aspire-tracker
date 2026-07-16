// lib/server/messages/config.js
//
// ASPIRE MESSAGES, PHASE 2 (STAGE B): shared pure constants for notification
// delivery and portal-user rate limiting. No I/O, no secrets, no DB. Imported by
// both the pure logic and the server services so the two stay in lockstep with
// the Phase 2 Stage A migration
// (supabase/migrations/20260716000001_messages_phase2_notification_delivery_foundation.sql).

// The shared ASPIRE Team inbox. A new unassigned conversation notifies this
// address ONCE (never Jester and Krystal as separate deliveries).
export const SHARED_INBOX_EMAIL = 'aspire@cshs.org';

// Verified Resend sender and the reply-to for Messages notifications.
export const MESSAGE_FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
export const MESSAGE_REPLY_TO = 'aspire@cshs.org';

// The only three logical events that produce a notification. Resolution,
// acknowledgement, assignment-change-alone, follow-up-flag-change-alone, and
// email-reply ingestion never notify.
export const EVENT_TYPES = ['new_conversation', 'portal_reply', 'staff_reply'];

// Durable recipient kinds (mirror the Stage A CHECK constraint).
export const RECIPIENT_KINDS = ['shared_inbox', 'assigned_staff', 'portal_user'];

// Staff roles eligible to receive an assigned-conversation notification.
export const ELIGIBLE_STAFF_ROLES = ['owner', 'admin'];

// Approved configurable portal-user rate limits (applied by the server util).
// The 5000-character message limit is already enforced by the Phase 1 messages
// body constraint; it is surfaced here only as a shared validation constant.
export const MESSAGE_RATE_LIMITS = {
  new_conversation: { action: 'new_conversation', maxPerWindow: 5, windowSeconds: 3600 },
  message:          { action: 'message',          maxPerWindow: 20, windowSeconds: 600 },
};
export const MESSAGE_MAX_BODY_CHARS = 5000;

// Retry worker bounds (mirror the Stage A schema defaults and guardrails).
export const MAX_ATTEMPTS = 5;          // conservative, matches column default
export const CLAIM_STALE_SECONDS = 300; // a processing claim older than this is recoverable
export const CLAIM_BATCH_LIMIT = 25;    // rows claimed per worker invocation

// Bounded, non-decreasing backoff (seconds) applied after each failed attempt.
export const BACKOFF_SECONDS = [60, 300, 900, 1800, 3600];

// Snapshot columns that may be persisted on a delivery row. Never a body.
export const SNAPSHOT_ALLOWED_KEYS = [
  'snapshot_sender_name', 'snapshot_subject', 'snapshot_category', 'cta_path',
];
