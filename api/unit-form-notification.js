// api/unit-form-notification.js
// Called fire-and-forget from UnitFormPage.jsx after upsert succeeds.
// No auth token required - the unit form is publicly accessible.

import { sendNotification } from '../src/lib/notifications/index.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    cohortId,
    cohortName,
    unitName,
    submitterName,
    submitterEmail,
    submitterRole,
    slotsOffered,
    shiftPreference,
    preferredPreceptors,
    considerations,
    reasonForZero,
    hiringNgrp,
    hiringNgrpReason,
    hasFiredAlumni,
    alumniOutcome,
    alumniNotes,
    wouldConsiderAlumni,
  } = req.body || {};

  if (!submitterEmail || !unitName) {
    return res.status(400).json({ error: 'submitterEmail and unitName are required' });
  }

  try {
    const results = await sendNotification('unit_form_received', {
      cohortId,
      cohortName:        cohortName || 'Current Cohort',
      unitName,
      submitterName,
      submitterEmail,
      submitterRole,
      slotsOffered:      slotsOffered ?? 0,
      shiftPreference,
      preferredPreceptors,
      considerations,
      reasonForZero,
      hiringNgrp,
      hiringNgrpReason,
      hasFiredAlumni,
      alumniOutcome,
      alumniNotes,
      wouldConsiderAlumni,
    });
    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('[unit-form-notification] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
