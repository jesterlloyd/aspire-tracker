// src/lib/ngrp/transitionDisclaimer.js
//
// TRANSITION-PORTAL-1 (Owner, 2026-11-02): what the Transition Form is NOT, in one sentence set
// read by the email (lib/server/email/ngrpTransitionEmail.js) and the Residency tab, so the two
// never say different things. opensText is the application's open date, already formatted.
export const transitionDisclaimer = (opensText = null) =>
  'This form and any documents you upload are not your residency application. ' +
  `You will still need to apply when the application opens${opensText ? ` on ${opensText}` : ''}. ` +
  'The form only helps the ASPIRE team assess your readiness for the residency.'
