// lib/server/notifications/unitFormNotifications.js
//
// S-06 ENDPOINT CLOSURE: the unit participation confirmation send, moved off the public
// api/unit-form-notification.js route.
//
// The retired route was the sharpest of the three relays. It was unauthenticated, its only caller
// was the BROWSER (src/components/UnitFormPage.jsx), and it took submitterEmail plus every free
// text field straight from the request body into an email sent from the ASPIRE address. A
// server-to-server secret was not an option there, because a public form page cannot hold one.
//
// The fix is to send from api/unit-form-submit.js, the endpoint the form already calls immediately
// before this. That endpoint validates every field, resolves the accepting cohort server-side, and
// performs the write, so the recipient and the content now come from the values the server itself
// persisted rather than from a second, unauthenticated request.
//
// The defaulting below is carried over verbatim from the retired route.

// Loaded LAZILY, on the actual send, for the same reason as the placement sender: the notifications
// module pulls in Resend, the Supabase client, and every template, and this keeps that import off
// the cold-start path of any request that does not reach the send.
async function loadSendNotification() {
  const mod = await import('../../../src/lib/notifications/index.js');
  return mod.sendNotification;
}

// NEVER THROWS: the unit response is already written when this runs, and an email problem must not
// fail the submission. Returns the sendNotification results, or [] when the context is unusable
// (mirrors the retired route's 400 guard, which required submitterEmail and unitName).
export async function sendUnitFormReceivedNotification(context = {}) {
  const submitterEmail = typeof context.submitterEmail === 'string' ? context.submitterEmail.trim() : '';
  const unitName = typeof context.unitName === 'string' ? context.unitName.trim() : '';
  if (!submitterEmail || !unitName) {
    console.warn('[unitFormNotifications] missing submitterEmail or unitName, nothing sent');
    return [];
  }

  try {
    const sendNotification = await loadSendNotification();
    return await sendNotification('unit_form_received', {
      cohortId:            context.cohortId,
      cohortName:          context.cohortName || 'Current Cohort',
      unitName,
      submitterName:       context.submitterName,
      submitterEmail,
      submitterRole:       context.submitterRole,
      submitterPreferredName: context.submitterPreferredName || null,
      // UNIT-FORM-CONCERN-1: the portal path sends the team's alert only, and only for a concern.
      internalOnly:        context.internalOnly === true,
      slotsOffered:        context.slotsOffered ?? 0,
      shiftPreference:     context.shiftPreference,
      preferredPreceptors: context.preferredPreceptors,
      considerations:      context.considerations,
      reasonForZero:       context.reasonForZero,
      hiringNgrp:          context.hiringNgrp,
      hiringNgrpReason:    context.hiringNgrpReason,
      hasFiredAlumni:      context.hasFiredAlumni,
      alumniOutcome:       context.alumniOutcome,
      alumniNotes:         context.alumniNotes,
      wouldConsiderAlumni: context.wouldConsiderAlumni,
    });
  } catch (err) {
    console.warn('[unitFormNotifications] send failed (non-fatal):', err?.message || err);
    return [];
  }
}

// UNIT-FORM-CONCERN-1 (Owner, 2026-11-11): a submission from the Unit Leader Portal has never
// emailed anyone, and still does not, EXCEPT when it carries a hiring concern: then the team's
// alert goes out (never a confirmation to the unit leader). Never throws.
export async function sendUnitFormConcernAlert(context = {}) {
  const { hiringConcerns } = await import('../../../src/lib/unitFormResponders.js');
  if (!hiringConcerns(context).length) return [];
  return sendUnitFormReceivedNotification({ ...context, internalOnly: true });
}
