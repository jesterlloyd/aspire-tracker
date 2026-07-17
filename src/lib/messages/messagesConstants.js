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

// Phase 4B2b-i: client-side validation bounds, mirroring the Phase 1 CHECK
// constraints and the Phase 3 server validation exactly. These give the staff a
// clean inline error before a request is made; the server remains authoritative.
export const MESSAGE_MAX_BODY_CHARS = 5000;
export const SUBJECT_MIN_CHARS = 3;
export const SUBJECT_MAX_CHARS = 120;

// Messages are plain text. Normalize line endings only; never treat input as
// HTML and never sanitize or render rich text.
export function normalizeBody(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// Subject: required, trimmed, 3 to 120 characters, never whitespace only.
export function validateSubjectValue(input) {
  if (typeof input !== 'string') return { ok: false, error: 'Enter a subject.' };
  const value = input.trim();
  if (value.length < SUBJECT_MIN_CHARS) return { ok: false, error: `Use at least ${SUBJECT_MIN_CHARS} characters.` };
  if (value.length > SUBJECT_MAX_CHARS) return { ok: false, error: `Use at most ${SUBJECT_MAX_CHARS} characters.` };
  return { ok: true, value };
}

// Body: trimmed content must be at least 1 character, at most 5000.
export function validateBodyValue(input) {
  const value = normalizeBody(input);
  if (value.trim().length < 1) return { ok: false, error: 'Enter a message.' };
  if (value.length > MESSAGE_MAX_BODY_CHARS) {
    return { ok: false, error: `Use at most ${MESSAGE_MAX_BODY_CHARS} characters.` };
  }
  return { ok: true, value };
}

export const PARTICIPANT_ACCESS_LABEL = {
  active: 'Active portal access',
  inactive: 'Portal access inactive',
};

export function participantAccessLabel(isActive) {
  return isActive ? PARTICIPANT_ACCESS_LABEL.active : PARTICIPANT_ACCESS_LABEL.inactive;
}

// Compact unread display: 1 through 99, then 99+.
// Every ASPIRE count badge, Messages or not, comes from src/lib/badgeTokens.js.
// These aliases keep the existing Messages call sites reading naturally while
// there remains exactly ONE definition of the color.
export { BADGE_COUNT_BG as UNREAD_BADGE_BG, BADGE_COUNT_FG as UNREAD_BADGE_FG } from '../badgeTokens.js';

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
