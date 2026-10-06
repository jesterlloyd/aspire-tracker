// src/lib/ngrp/residencyDigestModel.js
//
// RESIDENCY-DIGEST-1 (Owner, 2026-10-05): Talent Acquisition's weekly digest is Residency's
// Needs you, by email. Nothing here decides what needs attention: the sections are the SAME
// groups At a Glance shows (residencyNeedsModel.js and residencyDocsGroup), built from the same
// rows, so the email and the screen cannot disagree. Pure, so the cron, the Automations preview
// and the tests read one rule.
import { interviewsGroup, offersGroup, flaggedGroup } from './residencyNeedsModel.js'
import { residencyDocsGroup } from '../home/needsYouModel.js'
import { RESIDENCY_PORTAL_BASE } from './ngrpTabs.js'

export const DIGEST_NOTIFICATION_TYPE = 'residency_weekly_digest'
// A section lists this many rows in the email; the rest are counted and linked.
export const DIGEST_ROWS_PER_GROUP = 8
// Cohorts a digest covers: the ones being worked, never a finished or archived one.
export const DIGEST_CYCLE_STATUSES = Object.freeze(['Planning', 'Active'])

export function digestCycles(cycles = []) {
  return (cycles || []).filter(c => DIGEST_CYCLE_STATUSES.includes(c.status))
}

/**
 * One section per residency cohort, each holding the Needs you groups that have something in
 * them. Documents come from the Student Portal across all alumni, as on screen, so they are
 * listed once, under the first cohort.
 * @param cohorts [{ cycle, rows }] rows from deriveApplicantRows
 * @param docs { uploads, completions } from documentActivity
 */
export function buildDigestSections({ cohorts = [], docs = null, now = Date.now(), base = RESIDENCY_PORTAL_BASE } = {}) {
  const sections = cohorts.map(({ cycle, rows }, i) => {
    const groups = [
      interviewsGroup(rows, { now, base }),
      offersGroup(rows, { now, base }),
      flaggedGroup(rows, { base }),
      i === 0 && docs ? residencyDocsGroup({ uploads: docs.uploads, completions: docs.completions, now, base }) : null,
    ].filter(Boolean).map(g => ({
      key: g.key, name: g.name, sub: g.sub, open: g.open, total: g.total,
      rows: g.allRows.slice(0, DIGEST_ROWS_PER_GROUP),
      more: Math.max(0, g.total - DIGEST_ROWS_PER_GROUP),
    }))
    return { cycleId: cycle.id, cycleName: cycle.name, groups }
  }).filter(s => s.groups.length > 0)
  return sections
}

/** How many items the digest names, across every section. A quiet week (0) sends nothing. */
export function digestItemCount(sections = []) {
  return sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.total, 0), 0)
}
