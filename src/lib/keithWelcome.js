// KEITH-WELCOME-1: the welcome experience, as pure decisions.
//
// Everything the welcome card says is computed here so it can be tested
// without rendering: the time-of-day greeting, the one-line capability
// sentence (role-aware, never promising what the role cannot do), and the
// suggestion chips (role-aware, capped at four so the empty state stays
// calm). Keith's actual authorization is unchanged - the server decides what
// runs; this module only decides what the FIRST CARD offers to say.

import { normalizeStaffRole } from './permissions.js';

const norm = (role) => normalizeStaffRole(String(role || '').toLowerCase());

/** "Good morning" / "Good afternoon" / "Good evening", from local time. */
export function greetingFor(date = new Date(), firstName = '') {
  const h = date.getHours();
  const part = h < 4 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return firstName ? `${part}, ${firstName}` : part;
}

/**
 * One sentence about what Keith can do for THIS caller right now. Cohort-
 * anchored where the role sees cohort data; never lists a capability the
 * role does not hold (contacts for Co-Lead, placements for Interviewer).
 */
export function capabilityLineFor({ role, isOwner, cohortName } = {}) {
  const r = isOwner ? 'owner' : norm(role);
  const cohort = cohortName ? `${cohortName} ` : '';
  if (r === 'owner' || r === 'admin') {
    return `I can help with ${cohort}students, placements, ASPIRE guidance, contacts, communications, and your Skills.`;
  }
  if (r === 'co-lead') {
    return `I can help with ${cohort}students, placements, and ASPIRE guidance.`;
  }
  if (r === 'interviewer') {
    return `I can help with interviews, candidate preparation, ASPIRE guidance, and contact lookups.`;
  }
  return 'I can help with ASPIRE guidance.';
}

/**
 * Suggestion chips: short, action-oriented, at most four, and only actions
 * the role can actually take (an Interviewer gets no cohort-status or
 * drafting chips; a Co-Lead gets no contacts-routing chip).
 */
export function chipsFor({ role, isOwner } = {}) {
  const r = isOwner ? 'owner' : norm(role);
  if (r === 'owner' || r === 'admin') {
    return [
      'Who needs attention today?',
      'Who is on campus now?',
      'Who handles this request?',
      'Draft a student email',
    ];
  }
  if (r === 'co-lead') {
    return [
      'Who is on campus now?',
      'Summarize this cohort',
      'What are the eligibility requirements?',
    ];
  }
  if (r === 'interviewer') {
    return [
      'Help me prepare for an interview',
      'How does the interview rubric work?',
      'What Skills can I use?',
    ];
  }
  return [];
}

// ── Returning-user memory ────────────────────────────────────────────────────
// The full capability sentence is worth reading once. After that, an
// experienced user gets the greeting and the chips without the re-explanation
// - and never a tour. Per profile, in localStorage; failure to read or write
// degrades to "first time", which only means slightly more words.
const seenKey = (profileId) => `keith-welcomed-${profileId || 'anon'}`;

export function hasSeenWelcome(profileId, storage) {
  try {
    const s = storage || window.localStorage;
    return s.getItem(seenKey(profileId)) === '1';
  } catch { return false; }
}

export function markWelcomeSeen(profileId, storage) {
  try {
    const s = storage || window.localStorage;
    s.setItem(seenKey(profileId), '1');
  } catch { /* private mode: they will simply see the fuller line again */ }
}
