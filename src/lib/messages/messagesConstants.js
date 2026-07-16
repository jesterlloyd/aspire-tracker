// src/lib/messages/messagesConstants.js
//
// ASPIRE MESSAGES, PHASE 4A: shared constants, labels, and pure formatting for
// the staff interface. No new date or state library: timestamps use Intl, which
// is the app's existing convention (see src/lib/portalDates.js).

// The seven approved categories, matching the Phase 1 CHECK constraint and the
// Phase 3 validation allowlist exactly.
export const MESSAGE_CATEGORIES = [
  'Placement and matching',
  'Scheduling',
  'Onboarding requirements',
  'Clinical rotation support',
  'Preceptor support',
  'Portal or account help',
  'General question',
];

// Database status values and their staff-facing labels. The staff interface shows
// the real operational status; only the PORTAL collapses waiting into Open.
export const STAFF_STATUSES = ['open', 'waiting', 'resolved'];
export const STAFF_STATUS_LABEL = {
  open: 'Open',
  waiting: 'Waiting',
  resolved: 'Resolved',
};

export const PARTICIPANT_ACCESS_LABEL = {
  active: 'Active portal access',
  inactive: 'Portal access inactive',
};

export function participantAccessLabel(isActive) {
  return isActive ? PARTICIPANT_ACCESS_LABEL.active : PARTICIPANT_ACCESS_LABEL.inactive;
}

// Compact unread display: 1 through 99, then 99+.
export function formatUnread(count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

// Accessible unread text, so unread is never conveyed by color alone.
export function unreadLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  return n === 1 ? '1 unread message' : `${n} unread messages`;
}

// Concise inbox timestamp: time today, weekday this week, else a short date.
// Uses Intl only. Returns '' for a missing or unparsable value.
export function formatInboxTimestamp(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return '';
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
  }
  const days = Math.floor((now - d) / 86400000);
  if (days >= 0 && days < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

// Full readable timestamp for an accessible title or the thread view.
export function formatFullTimestamp(value) {
  const d = toDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(d);
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Map an HTTP status to a safe, actionable staff message. Never surfaces
// SQLSTATE, database function names, provider errors, or raw response objects.
export function mapMessagesError(status) {
  switch (Number(status)) {
    case 401: return 'Your session expired. Sign in again to continue.';
    case 403: return 'Active Owner or Admin access is required for ASPIRE Messages.';
    case 404: return 'That conversation is no longer available.';
    case 409: return 'This conversation changed. Refresh to see the latest state.';
    case 422: return 'Please check the highlighted fields and try again.';
    case 429: return 'Too many requests. Wait a moment and try again.';
    default:  return 'Something went wrong loading messages. Try again.';
  }
}
