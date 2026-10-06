// src/lib/ngrp/residencyDigestPreviewFixture.js
//
// RESIDENCY-DIGEST-1: the Automations card's preview of the weekly digest. PREVIEW EQUALS SENT:
// fake alumni go through the SAME model (buildDigestSections) and the SAME email builder the
// Monday cron uses. Nobody here is real, and `now` is fixed so the dates never move.
import { buildDigestSections } from './residencyDigestModel.js'
import { buildResidencyDigestEmail } from '../../../lib/server/email/residencyDigestEmail.js'
import { appBaseUrl } from '../../../lib/server/appUrl.js'

const NOW = Date.parse('2026-10-12T15:00:00Z') // Monday, 8 AM Pacific
const H = 3_600_000
const person = (id, first, last, cohort = 'Summer 2026') => ({ id, first_name: first, last_name: last, school: 'Sample University', aspire_cohort: cohort })
const ROWS = [
  { id: 'c1', student: person('s1', 'Jordan', 'Reyes'), interview_status: 'scheduled', interview_at: new Date(NOW + 50 * H).toISOString(), assigned_unit: '6 NE' },
  { id: 'c2', student: person('s2', 'Avery', 'Chen'), interview_status: 'scheduled', interview_at: new Date(NOW - 70 * H).toISOString(), assigned_unit: '5 North' },
  { id: 'c3', student: person('s3', 'Sam', 'Patel'), outcome: { offer_extended_at: new Date(NOW - 9 * 24 * H).toISOString() }, assigned_unit: '8 SCCT' },
  { id: 'c4', student: person('s4', 'Riley', 'Nguyen', 'Spring 2026'), flagged_for_followup: true },
]
const DOCS = {
  uploads: [{ version_id: 'v1', student_id: 's5', first_name: 'Morgan', last_name: 'Diaz', cohort: 'Summer 2026', uploaded_at: new Date(NOW - 30 * H).toISOString() }],
  completions: [],
}

export const RESIDENCY_DIGEST_PREVIEW = {
  recipientType: 'Talent Acquisition (opted in)',
  render: () => buildResidencyDigestEmail({
    sections: buildDigestSections({ cohorts: [{ cycle: { id: 'sample', name: 'Winter 2027' }, rows: ROWS }], docs: DOCS, now: NOW }),
    recipientName: 'Taylor Brooks', weekOf: 'October 12', baseUrl: appBaseUrl(),
  }),
}
