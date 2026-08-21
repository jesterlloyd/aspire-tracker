// lib/server/email/interviewBooked.js
//
// S-06 ENDPOINT CLOSURE: the "new interview booked" internal notice, moved off the public
// api/notify-interview-booked.js route and into a shared server module.
//
// The retired route was unauthenticated and took its recipients (ownerEmail, interviewerEmail) and
// its whole body from the request, so any anonymous caller could send ASPIRE-branded mail to an
// arbitrary address. Its only caller was api/interview-book.js, which already holds every value
// from server state (the booked slot, the resolved student, the interviewer email it looked up).
// Rendering here and sending from that endpoint removes the public surface without changing the
// recipients, the subject, or the body.
//
// Pattern matches the other modules in this directory (portalInvitation.js, staffInvitation.js):
// PURE RENDER, no sends, no DB, no tokens. The caller owns the Resend client.

import { aspireEmailShell } from './aspireShell.js';
import { renderEmailHeading, renderEmailDetailsCard, renderEmailNote } from './emailPrimitives.js';

// Carried over verbatim from the retired route: in-memory deduplication, per function instance,
// 60-second window. Defense-in-depth against accidental retries. The booking write itself is an
// atomic compare-and-set on is_booked, so a duplicate notice was already unlikely.
const recentSends = new Map();
const DEDUP_WINDOW_MS = 60 * 1000;

export function shouldSkipDuplicateBookingNotice(key) {
  const now = Date.now();
  for (const [k, ts] of recentSends.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) recentSends.delete(k);
  }
  if (recentSends.has(key)) return true;
  recentSends.set(key, now);
  return false;
}

// Every interpolated value below is rendered by the shared email primitives, which escape their
// own inputs. Nothing here builds raw HTML from a caller value.
export function interviewBookedEmail({
  studentName,
  studentSchool,
  studentProgram,
  studentEmail,
  interviewDate,
  interviewTime,
  duration,
  interviewerName,
} = {}) {
  const preheader = `${studentName} self-scheduled an ASPIRE interview for ${interviewDate}.`;

  const body =
    renderEmailHeading({ level: 2, text: 'New ASPIRE interview booked' })
    + '<p style="margin:0 0 16px;">A student has self-scheduled an ASPIRE interview.</p>'
    + renderEmailDetailsCard({ rows: [
        { label: 'Student',       value: studentName },
        { label: 'School',        value: studentSchool || 'N/A' },
        { label: 'Program',       value: studentProgram || 'N/A' },
        { label: 'Student Email', value: studentEmail || 'N/A' },
        { label: 'Date',          value: interviewDate },
        { label: 'Time',          value: `${interviewTime} Pacific Time` },
        { label: 'Duration',      value: `${duration} minutes` },
        { label: 'Interviewer',   value: interviewerName || 'TBD' },
      ] })
    + renderEmailNote({
        title: 'Action needed',
        body: `Create the Microsoft Teams meeting, send the link to the student at ${studentEmail || 'their school email'}, then mark this booking as Teams invite sent in ASPIRE Intelligence.`,
        tone: 'warning',
      });

  return {
    subject: `New ASPIRE interview: ${studentName}, ${interviewDate} at ${interviewTime}`,
    html: aspireEmailShell({ body, preheader }),
  };
}
