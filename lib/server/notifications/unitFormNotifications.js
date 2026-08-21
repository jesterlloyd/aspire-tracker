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

import { sendNotification } from '../../../src/lib/notifications/index.js';

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
    return await sendNotification('unit_form_received', {
      cohortId:            context.cohortId,
      cohortName:          context.cohortName || 'Current Cohort',
      unitName,
      submitterName:       context.submitterName,
      submitterEmail,
      submitterRole:       context.submitterRole,
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
