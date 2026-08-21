// lib/server/notifications/placementRequestNotifications.js
//
// S-06 ENDPOINT CLOSURE: the placement-request confirmation send, moved off the public
// api/form-received-notification.js route.
//
// The retired route was unauthenticated and took coordinatorEmail, studentEmail, and every display
// value from the request body, so any anonymous caller could send an ASPIRE-branded placement
// confirmation to an arbitrary address. Its only two callers were server-side and already hold
// every value from their own write result: api/school-form-submit.js and
// api/portal/school-placement-requests.js.
//
// This is the SINGLE writer for the notification, shared by both submit paths exactly as
// api/lib/schoolPlacementUpsert.js is the single writer for the placement rows, so the two paths
// can never drift. The defaulting below is carried over verbatim from the retired route.

// The notifications module pulls in Resend, the Supabase client, and every template. It is loaded
// LAZILY, on the first actual send, so the endpoints that host this sender do not pay that import
// at cold start on paths that never send. api/portal/school-placement-requests.js is the reason:
// the same file serves the Academic Partner list (GET), which sends nothing.
async function loadSendNotification() {
  const mod = await import('../../../src/lib/notifications/index.js');
  return mod.sendNotification;
}

// Normalizes one entry into the exact context the 'placement_request_received' templates expect.
// Returns null when the entry is unusable, mirroring the retired route's 400 guard
// (it required studentEmail and school).
export function buildPlacementRequestContext(entry = {}) {
  const studentEmail = typeof entry.studentEmail === 'string' ? entry.studentEmail.trim() : '';
  const school = typeof entry.school === 'string' ? entry.school.trim() : '';
  if (!studentEmail || !school) return null;

  return {
    studentId:        entry.studentId,
    cohortId:         entry.cohortId,
    cohortName:       entry.cohortName || '',
    studentName:      entry.studentName || studentEmail,
    studentFirstName: entry.studentFirstName || studentEmail.split('@')[0],
    studentEmail,
    school,
    programType:      entry.programType || '',
    coordinatorName:  entry.coordinatorName || '',
    coordinatorEmail: entry.coordinatorEmail || '',
  };
}

// Sends one placement-request confirmation per entry, concurrently.
//
// NEVER THROWS and never rejects: a notification problem must not fail or roll back a placement
// request that is already written. The retired route was called fire-and-forget over HTTP, which
// spawned an independent function invocation; in-process we await instead, because an un-awaited
// promise can be frozen when the serverless response returns. The caller's student array is length
// capped (see api/lib/schoolPlacementUpsert.js), which bounds this fan-out.
export async function sendPlacementRequestNotifications(entries = []) {
  const contexts = (Array.isArray(entries) ? entries : [])
    .map(buildPlacementRequestContext)
    .filter(Boolean);
  if (contexts.length === 0) return [];

  let sendNotification;
  try {
    sendNotification = await loadSendNotification();
  } catch (err) {
    console.warn('[placementRequestNotifications] sender unavailable (non-fatal):', err?.message || err);
    return [];
  }

  const settled = await Promise.allSettled(
    contexts.map(ctx => sendNotification('placement_request_received', ctx))
  );

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      console.warn('[placementRequestNotifications] send failed (non-fatal):', outcome.reason?.message || outcome.reason);
    }
  }
  return settled;
}
