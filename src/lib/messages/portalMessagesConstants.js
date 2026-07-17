// ASPIRE MESSAGES, PHASE 5B-i: student-facing copy, status handling, and safe
// error mapping. Pure, dormant, and reused by the portal workspace components.
//
// Validation, timestamps, unread formatting, and the category list are NOT
// redefined here: they are imported from messagesConstants.js, because the
// portal and staff enforce the same limits and the same approved categories.

import { MESSAGE_CATEGORIES } from './messagesConstants.js';

// The recipient is always the ASPIRE Team. There is no recipient picker.
export const PORTAL_RECIPIENT_LABEL = 'ASPIRE Team';

export const PORTAL_SUBTITLE = 'Contact the ASPIRE Team about your ASPIRE experience.';

export const PORTAL_NO_SELECTION = 'Select a conversation to review your messages with the ASPIRE Team.';

export const PORTAL_EMPTY_TITLE = 'No messages yet';
export const PORTAL_EMPTY_BODY =
  'Messages between you and the ASPIRE Team will appear here.';

// Authoritative confirmation copy. The start and reply endpoints both return
// this exact string in `confirmation`; this constant is the fallback used only
// when a response omits it, so the announcement never differs from the server's.
export const PORTAL_SEND_CONFIRMATION = 'Your message was sent to the ASPIRE Team.';

// Verbatim safety notice. Do not shorten or paraphrase.
export const PORTAL_SAFETY_NOTICE =
  'ASPIRE Messages is not monitored continuously. Do not include patient names, '
  + 'medical record numbers, or other identifying information. For urgent '
  + 'patient-care or safety concerns, follow your unit\'s established escalation process.';

// Shown on a Closed conversation. The backend decides whether a reply reopens;
// the browser only explains the possibility.
export const PORTAL_CLOSED_NOTICE =
  'This conversation is closed. Sending a reply will reopen it if it still needs attention.';

// Category options for the New message form. Uncategorized is the absence of a
// category, which the server validator represents as null, so the option's value
// is null rather than a sentinel string.
export const PORTAL_CATEGORY_OPTIONS = [
  { value: null, label: 'Uncategorized' },
  ...MESSAGE_CATEGORIES.map((c) => ({ value: c, label: c })),
];

// Portal-facing status.
//
// The BACKEND already maps status for the portal: message_portal_status_label()
// returns 'Closed' for resolved and 'Open' for everything else, and both the
// list RPC and the thread v2 RPC project that label rather than the raw workflow
// status. So 'waiting' is already collapsed into 'Open' server-side and the
// staff-only 'Waiting' label can never reach a student.
//
// This function therefore normalizes the value the API already sends rather than
// re-implementing the mapping. Re-mapping raw workflow statuses here would be
// wrong: it would imply the browser receives them, which it does not.
export function portalStatusLabel(apiStatus) {
  return String(apiStatus) === 'Closed' ? 'Closed' : 'Open';
}

export function portalStatusIsClosed(apiStatus) {
  return portalStatusLabel(apiStatus) === 'Closed';
}

// Safe, student-facing error copy. Never exposes SQLSTATE, a function name, a
// stack, a raw response, a provider failure, or an internal identifier.
export function mapPortalMessagesError(status) {
  switch (Number(status)) {
    case 401: return 'Your session expired. Sign in again to continue.';
    case 403: return 'Active Student Portal access is required to use ASPIRE Messages.';
    case 404: return 'That conversation is no longer available.';
    case 409: return 'This conversation changed. Refresh to see the latest state.';
    case 422: return 'Please check the highlighted fields and try again.';
    case 429: return 'You have sent several messages recently. Wait a moment and try again.';
    default:  return 'Something went wrong loading your messages. Try again.';
  }
}

// A 409 from start or reply carries a machine reason. It is never shown
// verbatim, because it names internal state. Only the access-lost case changes
// what the student can do, so only that case is distinguished.
export function portalConflictIsAccessLost(reason) {
  return reason === 'no_active_participant' || reason === 'no_active_access';
}

export function mapPortalConflict(reason) {
  return portalConflictIsAccessLost(reason)
    ? 'Your Student Portal access to this conversation is no longer active, so replies cannot be sent.'
    : 'This conversation changed. Refresh to see the latest state.';
}
