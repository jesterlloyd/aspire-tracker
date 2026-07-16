// lib/server/messages/routing.js
//
// ASPIRE MESSAGES, PHASE 2 (STAGE B): pure notification routing. Given a logical
// event and the resolved staff/participant context, it produces the intended
// deliveries and any suppressed candidates. It performs the routing and
// duplicate-suppression decisions that can be made purely; the live portal
// active-access gating is performed later by the server service against the
// service-role helper (message_recipient_has_active_access).
//
// Rules (version one):
//   - new_conversation notifies the shared inbox once (new conversations are
//     unassigned).
//   - portal_reply notifies staff: the assigned active Owner/Admin with a valid
//     email, otherwise the shared inbox. If the assignee email normalizes to the
//     shared inbox, a single shared_inbox delivery is produced.
//   - staff_reply notifies the portal participant (user_profiles.email), flagged
//     for a live active-access check.
//   - Never notify the sender of their own message.
//   - No delivery is produced for resolution, acknowledgement, assignment change
//     alone, follow-up flag change alone, or email reply ingestion (those events
//     never reach this function).

import { SHARED_INBOX_EMAIL, ELIGIBLE_STAFF_ROLES } from './config.js';
import { normalizeEmail } from './idempotency.js';

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

function isEligibleAssignee(assignedStaff) {
  return !!assignedStaff
    && assignedStaff.isActive === true
    && ELIGIBLE_STAFF_ROLES.includes(String(assignedStaff.role || '').toLowerCase())
    && isValidEmail(assignedStaff.email);
}

// Returns { deliveries: [...], suppressed: [...] }.
// deliveries[]: { recipientKind, recipientEmail, recipientProfileId, eventType, requiresActiveAccessCheck }
// suppressed[]: { recipientKind, recipientEmail, recipientProfileId, reason }
export function planNotificationRecipients({
  eventType,
  senderProfileId = null,
  senderEmail = null,
  assignedStaff = null,   // { profileId, email, role, isActive } | null
  participant = null,     // { profileId, email } | null
  sharedInboxEmail = SHARED_INBOX_EMAIL,
} = {}) {
  const deliveries = [];
  const suppressed = [];
  const senderEmailNorm = normalizeEmail(senderEmail);
  const sharedNorm = normalizeEmail(sharedInboxEmail);

  const isSelf = (email, profileId) =>
    (profileId && senderProfileId && profileId === senderProfileId) ||
    (senderEmailNorm && normalizeEmail(email) === senderEmailNorm);

  const pushOrSuppressSelf = (delivery) => {
    if (isSelf(delivery.recipientEmail, delivery.recipientProfileId)) {
      suppressed.push({ ...pick(delivery), reason: 'sender_self' });
    } else {
      deliveries.push(delivery);
    }
  };

  if (eventType === 'new_conversation') {
    // Staff side, always the shared inbox (new conversations are unassigned).
    pushOrSuppressSelf({
      recipientKind: 'shared_inbox',
      recipientEmail: sharedInboxEmail,
      recipientProfileId: null,
      eventType,
      requiresActiveAccessCheck: false,
    });
  } else if (eventType === 'portal_reply') {
    // Staff side: eligible assignee, else the shared inbox; dedupe if the
    // assignee email is the shared inbox.
    if (isEligibleAssignee(assignedStaff) && normalizeEmail(assignedStaff.email) !== sharedNorm) {
      pushOrSuppressSelf({
        recipientKind: 'assigned_staff',
        recipientEmail: assignedStaff.email,
        recipientProfileId: assignedStaff.profileId || null,
        eventType,
        requiresActiveAccessCheck: false,
      });
    } else {
      pushOrSuppressSelf({
        recipientKind: 'shared_inbox',
        recipientEmail: sharedInboxEmail,
        recipientProfileId: null,
        eventType,
        requiresActiveAccessCheck: false,
      });
    }
  } else if (eventType === 'staff_reply') {
    // Portal side: the participant, gated live for active access downstream.
    if (participant && isValidEmail(participant.email)) {
      pushOrSuppressSelf({
        recipientKind: 'portal_user',
        recipientEmail: participant.email,
        recipientProfileId: participant.profileId || null,
        eventType,
        requiresActiveAccessCheck: true,
      });
    } else {
      // No usable participant; omit (no durable row).
      suppressed.push({
        recipientKind: 'portal_user',
        recipientEmail: participant?.email || null,
        recipientProfileId: participant?.profileId || null,
        reason: 'no_participant',
      });
    }
  } else {
    throw new Error(`planNotificationRecipients: unsupported eventType ${eventType}`);
  }

  return { deliveries, suppressed };
}

function pick(d) {
  return {
    recipientKind: d.recipientKind,
    recipientEmail: d.recipientEmail,
    recipientProfileId: d.recipientProfileId,
  };
}
