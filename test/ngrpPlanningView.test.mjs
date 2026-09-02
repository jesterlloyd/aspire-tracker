// NGRP-PLANNING-2: Planning stops being a settings form and becomes the
// cohort's operating picture; cohort configuration moves to the header's Edit
// Cohort, where the Internship experience has always kept it.
//
// Two things are guarded here:
//   1. The pure derivations behind the new tab (timeline, seats, funnel), which
//      are the only new LOGIC in the change.
//   2. The relocation itself - that the six configuration cards left Planning
//      intact, that Planning kept exactly one way out to editing, and that the
//      app owns the modal state both entry points open.
//
// Run: node --test test/ngrpPlanningView.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  cycleTimeline, milestoneWhen, capacitySummary, pipelineStages, seatPressure,
  ruleSummaryLines, daysBetweenDateStrings, MILESTONE_DEFS,
} from '../src/lib/ngrp/ngrpPlanningView.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const planning = read('src/components/ngrp/AtAGlanceTab.jsx')
const settings = read('src/components/ngrp/CohortSettingsModal.jsx')
const createDlg = read('src/components/ngrp/CreateCohortDialog.jsx')
const formUi = read('src/components/ngrp/NgrpFormUi.jsx')
const resList = read('src/components/Header/scope/ResidencyCohortList.jsx')
const workspace = read('src/components/ngrp/NgrpWorkspace.jsx')
const app = read('src/App.jsx')

const CYCLE = {
  application_open_date: '2026-09-01',
  application_deadline: '2026-11-15',
  licensure_deadline: '2026-12-01',
  interview_window_start: '2027-01-05',
  interview_window_end: '2027-01-16',
  residency_start_date: '2027-02-02',
}

// ── Timeline ─────────────────────────────────────────────────────────────────

test('the timeline classifies every milestone against today, in calendar order', () => {
  const t = cycleTimeline(CYCLE, '2026-11-20')
  assert.deepEqual(t.map(i => i.key), MILESTONE_DEFS.map(d => d.key), 'calendar order is the definition order')
  assert.deepEqual(t.map(i => i.state), ['past', 'past', 'future', 'future', 'future'])
  // Exactly one "next" - the soonest thing that has not happened.
  assert.deepEqual(t.filter(i => i.isNext).map(i => i.key), ['licensure_deadline'])
})

test('a span is happening NOW for every day inside it, not past on day two', () => {
  // The interview window is the one milestone that is a span rather than a
  // moment. Comparing only against its start date would call an open window
  // "past" from its second day onward.
  const mid = cycleTimeline(CYCLE, '2027-01-10').find(i => i.key === 'interview_window_start')
  assert.equal(mid.state, 'today')
  assert.equal(milestoneWhen(mid), 'Open now')
  assert.equal(cycleTimeline(CYCLE, '2027-01-17').find(i => i.key === 'interview_window_start').state, 'past')
  assert.equal(cycleTimeline(CYCLE, '2027-01-04').find(i => i.key === 'interview_window_start').state, 'future')
})

test('unset dates are reported as unset, never as past', () => {
  // A missing residency start is information (nobody has decided yet), not an
  // event that already happened at the epoch.
  const t = cycleTimeline({ application_deadline: '2026-11-15' }, '2026-12-01')
  assert.equal(t.find(i => i.key === 'residency_start_date').state, 'unset')
  assert.equal(milestoneWhen(t.find(i => i.key === 'residency_start_date')), null)
  assert.equal(t.filter(i => i.isNext).length, 0, 'nothing is "next" when nothing is scheduled')
})

test('milestone phrasing counts whole days in both directions', () => {
  const t = cycleTimeline(CYCLE, '2026-11-14')
  assert.equal(milestoneWhen(t.find(i => i.key === 'application_deadline')), 'Tomorrow')
  assert.equal(milestoneWhen(cycleTimeline(CYCLE, '2026-11-16').find(i => i.key === 'application_deadline')), 'Yesterday')
  assert.equal(milestoneWhen(cycleTimeline(CYCLE, '2026-11-01').find(i => i.key === 'application_deadline')), 'In 14 days')
  assert.equal(milestoneWhen(cycleTimeline(CYCLE, '2026-11-15').find(i => i.key === 'application_deadline')), 'Today')
})

test('day counting survives a DST boundary (dates are date-only, never wall clocks)', () => {
  // Nov 1 2026 is the US fall-back. A naive ms/86400000 over Date objects that
  // carry a time-of-day would come back 24.5 days here.
  assert.equal(daysBetweenDateStrings('2026-10-25', '2026-11-15'), 21)
  assert.equal(daysBetweenDateStrings('2027-03-01', '2027-03-31'), 30, 'and the spring-forward too')
  assert.equal(daysBetweenDateStrings(null, '2026-11-15'), null)
})

// ── Seats ────────────────────────────────────────────────────────────────────

test('only ACTIVE units are seats - the form never offers an inactive one', () => {
  const cap = capacitySummary([
    { unit_name: '5 SCCT', is_active: true, capacity: 4 },
    { unit_name: '6 NT', is_active: true, capacity: 3 },
    { unit_name: 'NICU', is_active: false, capacity: 10 },
  ])
  assert.equal(cap.activeCount, 2)
  assert.equal(cap.inactiveCount, 1)
  assert.equal(cap.seats, 7, 'the inactive unit\'s 10 seats are not seats')
  assert.equal(cap.exact, true)
  assert.equal(cap.unpriced, 0)
})

test('a partly-priced unit list is reported as incomplete rather than totalled', () => {
  const cap = capacitySummary([
    { unit_name: '5 SCCT', is_active: true, capacity: 4 },
    { unit_name: '6 NT', is_active: true, capacity: null },
  ])
  assert.equal(cap.exact, false)
  assert.equal(cap.unpriced, 1)
  // And no ratio is offered from it: 8 confirmed against "4 seats" would read
  // as double-booked when the real total is simply unknown.
  assert.equal(seatPressure(cap, 8), null)
})

test('seat pressure reports remaining seats, and says so plainly when over', () => {
  const cap = capacitySummary([{ unit_name: 'A', is_active: true, capacity: 10 }])
  const under = seatPressure(cap, 4)
  assert.equal(under.remaining, 6)
  assert.equal(under.over, false)
  assert.equal(under.pct, 40)
  const over = seatPressure(cap, 13)
  assert.equal(over.over, true)
  assert.equal(over.remaining, -3)
  assert.equal(over.pct, 100, 'the bar caps; the sentence carries the overage')
  assert.equal(seatPressure(capacitySummary([]), 0), null, 'no units, no ratio')
})

// ── Funnel ───────────────────────────────────────────────────────────────────

test('the funnel counts the SAME rows the Applicants roster renders', () => {
  const eff = r => r.eligibility_effective || r.eligibility_calculated || 'pending'
  const rows = [
    { form_status: 'not_sent', eligibility_calculated: 'pending', application_status: 'not_confirmed' },
    { form_status: 'sent', eligibility_calculated: 'pending', application_status: 'not_confirmed' },
    { form_status: 'submitted', eligibility_calculated: 'eligible', application_status: 'confirmed' },
    { form_status: 'revised', eligibility_calculated: 'not_eligible', eligibility_effective: 'eligible', application_status: 'not_confirmed' },
    { form_status: 'submitted', eligibility_calculated: 'conditionally_eligible', application_status: 'not_confirmed' },
  ]
  const by = Object.fromEntries(pipelineStages(rows, { effectiveEligibility: eff }).map(s => [s.key, s.count]))
  assert.equal(by.alumni, 5)
  assert.equal(by.sent, 4, 'everything past not_sent has been reached')
  assert.equal(by.submitted, 3, 'revisions count as submitted')
  assert.equal(by.eligible, 2, 'a staff override is the effective result')
  assert.equal(by.cond, 1)
  assert.equal(by.confirmed, 1, 'submitted and eligible is NOT an application')
  assert.deepEqual(pipelineStages([], { effectiveEligibility: eff }).map(s => s.count), [0, 0, 0, 0, 0, 0])
})

test('rule summaries state every rule that is on, and omit the ones that are off', () => {
  const lines = ruleSummaryLines({ gpa_min: 3.2, max_paid_rn_months: 9, completion_window_months: 12, nclex_exception_enabled: true, require_accreditation: false })
  assert.match(lines.join(' | '), /GPA 3\.2/)
  assert.match(lines.join(' | '), /under 9 months/)
  assert.match(lines.join(' | '), /within 12 months/)
  assert.match(lines.join(' | '), /NCLEX exception on/)
  assert.doesNotMatch(lines.join(' | '), /accredited/, 'an off rule is not stated as a requirement')
  assert.match(ruleSummaryLines({ ...{ gpa_min: 3, max_paid_rn_months: 9, completion_window_months: 12 }, nclex_exception_enabled: false, require_accreditation: true }).join(' | '), /NCLEX exception off[\s\S]*accredited/)
  assert.deepEqual(ruleSummaryLines(null), [])
})

// ── The relocation ───────────────────────────────────────────────────────────

test('the six configuration cards left Planning INTACT - not dropped in transit', () => {
  for (const card of [
    'Residency cohort basics', 'ASPIRE cohorts participating', 'Participating units',
    'Eligibility rules', 'Required application checklist', 'Retention benchmarks',
  ]) {
    assert.match(settings, new RegExp(`title="${card}"`), `${card} survived the move`)
    assert.doesNotMatch(planning, new RegExp(`title="${card}"`), `${card} does not ALSO remain in Planning`)
  }
  // Every write action came along with them.
  for (const act of ['cycle_update', 'sources_set', 'units_set', 'cycle_set_active']) {
    assert.match(settings, new RegExp(`'${act}'`), `${act} moved with the cards`)
  }
  // And Planning writes nothing at all now.
  assert.doesNotMatch(planning, /postNgrpManage/, 'Planning is read-only')
})

test('Planning has exactly one way out to editing, and it is the same modal', () => {
  assert.match(planning, /onEditCohort/)
  assert.match(planning, /Edit cohort/)
  assert.match(planning, /Fix in cohort settings/, 'a failing readiness check offers the fix')
  // The tab does not grow its own second copy of the editor or the create dialog
  // (the header comment names both files; only an IMPORT would be a second copy).
  assert.doesNotMatch(planning, /^import .*(CohortSettingsModal|CreateCohortDialog)/m)
  // App owns both, because the header and the tab both open them.
  assert.match(app, /const \[showNgrpCohortSettings, setShowNgrpCohortSettings\] = useState\(false\)/)
  assert.match(app, /const \[showNgrpNewCohort,      setShowNgrpNewCohort\]      = useState\(false\)/)
  assert.match(app, /onManageCycle: \(\) => setShowNgrpCohortSettings\(true\)/)
  assert.match(app, /onNewCycle: \(\) => setShowNgrpNewCohort\(true\)/)
  assert.match(workspace, /onEditCohort=\{onEditCohort\}/)
  assert.match(workspace, /onAddCohort=\{onAddCohort\}/)
})

test('the residency footer is gated on ngrp_manage, not on ASPIRE cohort rights', () => {
  // canEdit (the ASPIRE gate) governs ASPIRE cohorts; residency configuration is
  // a different capability and must not ride along on it.
  assert.match(app, /canManage: canManageNgrp\(currentUserProfile\)/)
  assert.match(resList, /canManage = false/)
  assert.match(settings, /if \(!canManage\) \{/)
  assert.match(settings, /requires NGRP management access/)
})

test('the settings dialog leaves the header tree, and a stray backdrop click cannot discard work', () => {
  // The Scope dropdown lives inside a positioned, clipped header band: a fixed
  // child of it is still clipped, so the dialog portals to the body instead.
  assert.match(formUi, /createPortal\(/)
  assert.match(formUi, /document\.body,/)
  // Escape closes and focus returns to whatever opened it.
  assert.match(formUi, /if \(e\.key === 'Escape'\)/)
  assert.match(formUi, /opener\.focus\(\)/)
  // Half-typed configuration is not thrown away by a click on the scrim.
  assert.match(settings, /dismissOnBackdrop=\{false\}/)
  assert.match(formUi, /onClick=\{dismissOnBackdrop \? onClose : undefined\}/)
})

test('a new cohort lands in its settings, because it is never usable as created', () => {
  assert.match(createDlg, /status: 'Planning'/)
  assert.match(app, /selectNgrpCycle\(created\.id\)\n\s*\/\/ Straight into its settings/)
  assert.match(app, /setShowNgrpCohortSettings\(true\)/)
})

test('the form shapers have exactly one definition each', () => {
  // Dirty-checking compares form state against a shaper run over the server row.
  // A second copy that drifts would leave a card permanently, invisibly dirty.
  const shared = read('src/lib/ngrp/ngrpCohortForm.js')
  for (const fn of ['cycleBasics', 'rulesOf', 'checklistOf', 'benchmarksOf', 'unitsOf']) {
    assert.match(shared, new RegExp(`export const ${fn} =`), `${fn} is defined in the shared module`)
    assert.doesNotMatch(settings, new RegExp(`(const|function) ${fn}\\\\b`), `${fn} is not redefined in the modal`)
    assert.doesNotMatch(planning, new RegExp(`(const|function) ${fn}\\\\b`), `${fn} is not redefined in Planning`)
  }
})
