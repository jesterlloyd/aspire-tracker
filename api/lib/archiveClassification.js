// api/lib/archiveClassification.js
//
// ARCHIVE-SNAPSHOT-1 FAMILY 3 (registry only): which archive path owns which
// notification type.
//
// The shared sender must not decide "archive everything it renders". Some types
// carry a per-recipient secret and belong to the Family 4 gate; some are already
// archived by a specialised sender and must not be archived twice; a couple are
// not archivable at all. So ownership is declared here, once, and the sender
// consults it rather than defaulting.
//
// THE DEFAULT IS DELIBERATELY "NOTHING". An unlisted type returns null and is
// NOT archived. A new template therefore fails the registry test rather than
// silently archiving under a generic kind - which is exactly how a secure-link
// template would otherwise leak into the ordinary path.

/** Ordinary templates: rendered, sent, archived by the shared notification path. */
export const TEMPLATE_NOTIFICATION_TYPES = Object.freeze([
  'placement_request_received',
  'unit_form_received',
  'teams_invite_reminder',
  'teams_invite_reminder_escalation',
  'interview_reminder',
  'midpoint_checkin',
  'clockout_reminder',
  'unit_leader_alert',
  'birthday_greeting',
]);

/** Carry a per-recipient secret. Archived only by their specialized, gated senders. */
export const SECURE_LINK_TYPES = Object.freeze([
  'evaluation_invitation_sent',
  'evaluation_invitation_test',
  'evaluation_survey_test_sent',
  'casey_fink_post_rotation_request_sent',
  'post_rotation_evaluation_request_sent',
  'student_preceptor_eval_request_sent',
  'preceptor_feedback_request_sent',
  'preceptor_certificate_ready',
]);

/** Already archived by their own sender. The shared path must not touch them. */
export const SPECIALIZED_OWNERS = Object.freeze({
  direct_message_sent:            'manual_direct_email',        // api/connect-send-direct-email.js
  bulk_message_sent:              'manual_bulk_email',          // api/connect-send-bulk-message.js
  coordinator_weekly_digest:      'coordinator_weekly_digest',  // api/cron/coordinator-weekly-digest.js
  coordinator_weekly_digest_test: 'coordinator_weekly_digest',  // same cron, test send
});

/** Never archived, each with the reason it is not an oversight. */
export const NOT_ARCHIVED = Object.freeze({
  form_received:
    'Retired for sending (AP-SCHOOL-CANONICALIZATION-1). It stays registered only so historical '
    + 'previews can still be reconstructed; it can never send again, so there is nothing to snapshot.',
});

/** Ownership outcomes. */
export const OWNER = Object.freeze({
  TEMPLATE: 'template_notification',
  SECURE_LINK: 'secure_link_email',
  SPECIALIZED: 'specialized',
  NOT_ARCHIVED: 'not_archived',
});

/**
 * Who owns archiving for this notification type?
 *
 * @returns {{ owner, contentKind }} or null when the type is unknown - and an
 *          unknown type is never archived, by design.
 */
export function classifyForArchive(notificationType) {
  const t = String(notificationType || '');
  if (TEMPLATE_NOTIFICATION_TYPES.includes(t)) return { owner: OWNER.TEMPLATE, contentKind: 'template_notification' };
  if (SECURE_LINK_TYPES.includes(t)) return { owner: OWNER.SECURE_LINK, contentKind: 'secure_link_email' };
  if (SPECIALIZED_OWNERS[t]) return { owner: OWNER.SPECIALIZED, contentKind: SPECIALIZED_OWNERS[t] };
  if (NOT_ARCHIVED[t]) return { owner: OWNER.NOT_ARCHIVED, contentKind: null };
  return null;
}

/**
 * May the SHARED notification path archive this type itself?
 * True only for ordinary templates: everything else is someone else's job, or
 * nobody's.
 */
export function sharedSenderMayArchive(notificationType) {
  const c = classifyForArchive(notificationType);
  return !!c && c.owner === OWNER.TEMPLATE;
}
