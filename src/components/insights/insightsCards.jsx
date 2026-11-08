// ASPIRE-INSIGHTS-1: each chart's figures, shaped for its marks and its table. A builder returns
// { table, note, legend, nat, draw }: the same rows build the Table view and the CSV, `nat` is the
// chart's natural height for a card that fills its row, and `draw(width, height)` draws it.
// The full page and the portal At a Glance sections (Phase 2b) share these, so a figure reads the
// same wherever it is shown. Nothing here computes a figure; every number is the API's.
//
// Colour (INSIGHTS-COLOR-1): a school keeps one validated slot (slotsFor); "you" is the first slot
// and the comparison (program, average unit) is the grey every comparison wears.

import { unitPublicName } from '../../lib/unitCatalog'
import { HBar, Funnel, Lines, Columns } from './InsightsCharts'
import { hbarHeight, funnelHeight } from '../../lib/insights/chartGeometry'
import { fmtRate, rateText, shortCohort } from '../../lib/insights/insightsView'

export const CAT_SLOTS = 8

/**
 * One colour per school, by its place in the page's school list (every school in view, sorted,
 * whatever the filters), so a school wears the same colour on every card and a filter never
 * repaints the others. A ninth school onward is the comparison grey: a slot is never reused.
 */
export function slotsFor(schools) {
  const m = new Map((schools || []).map((s, i) => [s, i < CAT_SLOTS ? `var(--ins-c${i + 1})` : 'var(--ins-other)']))
  return s => m.get(s) || 'var(--ins-other)'
}
export const PATHWAY_COLORS = { internal: 'var(--ins-c1)', external: 'var(--ins-c2)' }
// Rank is ordinal, so it reads the ramp: the darker the step, the better the match.
export const CHOICE_COLORS = { top_choice: 'var(--ins-r5)', second_choice: 'var(--ins-r4)', third_choice: 'var(--ins-r2)' }

export const rateItem = (id, label, r, extra = {}) => ({
  id, label, value: r?.rate ?? 0, display: fmtRate(r), n: r?.n ?? 0, suppressed: Boolean(r?.suppressed), ...extra,
})

export function pipelineCard(data) {
  const steps = data.pipeline.steps
  const excluded = data.pipeline.excludedCohortIds.map(id => data.cohorts.find(c => c.id === id)?.name).filter(Boolean)
  const startsAtPlaced = steps[0].count == null
  const rows = steps.filter(s => s.count != null).map(s => ({
    id: s.key, stage: s.label, count: s.count,
    prior: s.ofPrior ? rateText(s.ofPrior) : '', prior__sort: s.ofPrior?.rate ?? -1,
  }))
  const notes = []
  if (startsAtPlaced) notes.push('A unit, service line or shift filter starts the funnel at Placed, because applicants have no unit yet.')
  if (excluded.length) notes.push(`${excluded.join(', ')} ${excluded.length === 1 ? 'is' : 'are'} still in rotation and left out of this funnel.`)
  notes.push('Cohorts imported as completers only join at Completed; Completed is measured against Placed on the cohorts that have both.')
  return {
    table: { columns: [{ key: 'stage', label: 'Stage' }, { key: 'count', label: 'Students' }, { key: 'prior', label: '% of prior' }], rows },
    note: notes.join(' '),
    nat: () => funnelHeight(steps),
    draw: (w, h) => <Funnel steps={steps} width={w} height={h} />,
  }
}

export const TREND_SERIES = [
  { key: 'applied', name: 'Applied', color: 'var(--ins-s1)' },
  { key: 'offered', name: 'Offered', color: 'var(--ins-s2)' },
  { key: 'hired', name: 'Hired', color: 'var(--ins-s3)' },
]

export function trendCard(data) {
  const finished = data.trends.filter(t => t.finished)
  const labels = finished.map(t => shortCohort(t.name))
  const series = TREND_SERIES.map(s => ({
    name: s.name, color: s.color,
    values: finished.map(t => (t[s.key] && !t[s.key].suppressed ? t[s.key].rate : null)),
    ns: finished.map(t => t[s.key]?.n ?? 0),
  }))
  const placed = data.trends.map(t => ({ label: shortCohort(t.name), value: t.placed, tip: t.placed == null ? `${t.name}: no placement record` : `${t.name}: ${t.placed} placed` }))
  return {
    table: {
      columns: [{ key: 'cohort', label: 'Cohort' }, { key: 'placed', label: 'Placed' }, { key: 'applied', label: 'Applied' }, { key: 'offered', label: 'Offered' }, { key: 'hired', label: 'Hired' }],
      rows: data.trends.map((t, i) => ({
        id: t.cohortId, cohort: t.name, cohort__sort: i, placed: t.placed ?? '–',
        applied: t.applied ? rateText(t.applied) : 'In rotation', offered: t.offered ? rateText(t.offered) : 'In rotation', hired: t.hired ? rateText(t.hired) : 'In rotation',
        applied__sort: t.applied?.rate ?? -1, offered__sort: t.offered?.rate ?? -1, hired__sort: t.hired?.rate ?? -1,
      })),
    },
    legend: TREND_SERIES.map(s => [s.name, s.color]),
    note: 'The trend shows every cohort whatever the cohort filter, so one cohort sits in context. A cohort under 5 completers is a gap, not a zero.',
    nat: () => 220 + 34 + 120,
    draw: (w, h) => (
      <>
        <Lines series={series} labels={labels} width={w} height={Math.max(220, h - 34 - 120)} />
        <p className="ins-minihead">Students placed per cohort</p>
        <Columns items={placed} width={w} />
      </>
    ),
  }
}

export function hoursCard(data, colorOf) {
  const list = data.hoursBySchool
  const items = list.map(s => ({
    id: s.school, label: s.school, value: s.pctOfRequirement || 0, display: s.suppressed ? 'Too few' : `${Math.round(s.pctOfRequirement)}%`, n: s.n, suppressed: s.suppressed, color: colorOf(s.school),
    tip: s.suppressed ? `${s.school}: too few to rate (n = ${s.n})` : `${s.school}\n${Math.round(s.meanHours)} of ${Math.round(s.meanRequired)} required hours on average\n${s.n} students`,
  }))
  return {
    table: {
      columns: [{ key: 'school', label: 'School' }, { key: 'n', label: 'Students' }, { key: 'hours', label: 'Mean hours' }, { key: 'required', label: 'Mean required' }, { key: 'pct', label: '% of requirement' }],
      rows: list.map(s => ({
        id: s.school, school: s.school, n: s.n,
        hours: s.suppressed ? 'Too few' : Math.round(s.meanHours), required: s.suppressed ? 'Too few' : Math.round(s.meanRequired),
        pct: s.suppressed ? `Too few to rate (n = ${s.n})` : `${Math.round(s.pctOfRequirement)}%`, pct__sort: s.pctOfRequirement ?? -1,
      })),
    },
    note: 'Approved hours against each student\'s required hours, capped at 100% per student. A student still in rotation counts with the hours logged so far.',
    nat: () => (list.length ? hbarHeight(items) : 40),
    draw: (w, h) => list.length ? <HBar items={items} width={w} height={h} cap={100} /> : <p className="ins-emptyline">No required hours on file for placed students in this view.</p>,
  }
}

// ── The portal At a Glance cards (Phase 2b) ──────────────────────────────────

const YOU = 'var(--ins-c1)'
const OTHER = 'var(--ins-other)'
/** For a card over one school (a partner's own), every bar is "you". */
export const youColor = () => YOU

/** A school's colour from its slot in the program's school list, as slotsFor gives the full page. */
export const slotColor = slot => (Number.isInteger(slot) && slot >= 0 && slot < CAT_SLOTS ? `var(--ins-c${slot + 1})` : OTHER)

/** Academic Partner: their students' hire rate beside the program's, or theirs alone. */
export function partnerVsProgramCard(data) {
  const { you, program, programHidden } = data.youVsProgram
  const items = [rateItem('you', 'Your students', you, { color: YOU, tip: `Your students: ${you.count} of ${you.n} completed hired into NGRP` })]
  if (program) items.push(rateItem('program', 'Program average', program, { color: OTHER, tip: `Every school: ${program.count} of ${program.n} completed hired into NGRP` }))
  return {
    table: {
      columns: [{ key: 'group', label: 'Group' }, { key: 'rate', label: 'Hired into NGRP' }, { key: 'count', label: 'Hired' }, { key: 'n', label: 'Completed' }],
      rows: items.map(i => ({ id: i.id, group: i.label, rate: rateText(i.id === 'you' ? you : program), rate__sort: i.suppressed ? -1 : i.value, count: (i.id === 'you' ? you : program).count, n: i.n })),
    },
    legend: program ? [['Your students', YOU], ['Program average', OTHER]] : null,
    note: programHidden
      ? 'The program average is hidden while fewer than 3 schools are in view, so no other school\'s figure can be worked out.'
      : 'The program average counts every school\'s completed students in finished cohorts. No other school is named.',
    nat: () => hbarHeight(items),
    draw: (w, h) => <HBar items={items} width={w} height={h} cap={100} />,
  }
}

/** Academic Partner: the units their placed students rotated on. */
export function whereRotatedCard(data) {
  // AP-UNIT-NAMES-1 (Owner, 2026-11-08): a school reads "Neuroscience ICU", not "8 SCCT".
  const list = (data.whereRotated || []).map(u => ({ ...u, label: unitPublicName(u.unit) }))
  const items = list.map(u => ({ id: u.unit, label: u.label, value: u.total, display: String(u.total), color: YOU, tip: `${u.label}: ${u.total} ${u.total === 1 ? 'student' : 'students'}` }))
  return {
    table: { columns: [{ key: 'unit', label: 'Unit' }, { key: 'total', label: 'Students' }], rows: list.map(u => ({ id: u.unit, unit: u.label, total: u.total })) },
    note: list.length ? 'A student placed on two units counts on each.' : '',
    nat: () => (list.length ? hbarHeight(items) : 40),
    draw: (w, h) => list.length ? <HBar items={items} width={w} height={h} /> : <p className="ins-emptyline">No placed students in this view.</p>,
  }
}

const unitName = data => (data.units?.length === 1 ? data.units[0] : 'Your units')

/** Unit Leader: students their unit hosts beside the average of every other unit, unnamed. */
export function unitHostedCard(data) {
  const { you, averageUnit } = data.hosted
  const name = unitName(data)
  const items = [{ id: 'you', label: name, value: you, display: String(you), color: YOU, tip: `${name}: ${you} placed ${you === 1 ? 'student' : 'students'}` }]
  if (averageUnit != null) items.push({ id: 'avg', label: 'Average unit', value: averageUnit, display: averageUnit.toFixed(1), color: OTHER, tip: `Every other unit: ${averageUnit.toFixed(1)} students on average` })
  return {
    table: { columns: [{ key: 'group', label: 'Group' }, { key: 'students', label: 'Students' }], rows: items.map(i => ({ id: i.id, group: i.label, students: i.display, students__sort: i.value })) },
    legend: averageUnit != null ? [[name, YOU], ['Average unit', OTHER]] : null,
    note: (data.units?.length > 1 ? 'Your units are counted together; choose one in the header to see it alone. ' : '')
      + 'The average is every other unit that hosted a student, never named.',
    nat: () => hbarHeight(items),
    draw: (w, h) => <HBar items={items} width={w} height={h} />,
  }
}

/** Unit Leader: students hired into NGRP onto the unit where they rotated, beside the program. */
export function unitHiredBackCard(data) {
  const { you, program } = data.hiredBack
  const name = unitName(data)
  const items = [
    rateItem('you', name, you, { color: YOU, tip: `${name}: hired back ${you.count} of ${you.n} hosted` }),
    rateItem('program', 'Program', program, { color: OTHER, tip: `Every unit: hired back ${program.count} of ${program.n} hosted` }),
  ]
  return {
    table: {
      columns: [{ key: 'group', label: 'Group' }, { key: 'yield', label: 'Hired back' }, { key: 'count', label: 'Hired' }, { key: 'n', label: 'Hosted' }],
      rows: [['you', name, you], ['program', 'Program', program]].map(([id, group, r]) => ({ id, group, yield: rateText(r), yield__sort: r.rate ?? -1, count: r.count, n: r.n })),
    },
    legend: [[name, YOU], ['Program', OTHER]],
    note: 'Students hosted in finished cohorts who were hired into NGRP on the same unit.',
    nat: () => hbarHeight(items),
    draw: (w, h) => <HBar items={items} width={w} height={h} cap={100} />,
  }
}

/** Unit Leader: the schools their placed students came from. Schools may be named here. */
export function feedersCard(data) {
  const list = data.schoolsFeeding || []
  const items = list.map(s => ({ id: s.school, label: s.school, value: s.count, display: String(s.count), color: slotColor(s.slot), tip: `${s.school}: ${s.count} ${s.count === 1 ? 'student' : 'students'}` }))
  return {
    table: { columns: [{ key: 'school', label: 'School' }, { key: 'count', label: 'Students' }], rows: list.map(s => ({ id: s.school, school: s.school, count: s.count })) },
    nat: () => (list.length ? hbarHeight(items) : 40),
    draw: (w, h) => list.length ? <HBar items={items} width={w} height={h} /> : <p className="ins-emptyline">No placed students on your unit in this view.</p>,
  }
}

/** Unit Leader: how the students they hosted ranked the unit they were placed on. */
export function unitChoiceCard(data) {
  const buckets = data.choice || []
  const items = buckets.map(b => rateItem(b.key, b.label, b, { other: b.key === 'other', color: CHOICE_COLORS[b.key], tip: `${b.label}: ${b.count} of ${b.n} placed` }))
  const any = buckets.some(b => b.n)
  return {
    table: {
      columns: [{ key: 'match', label: 'Match' }, { key: 'count', label: 'Students' }, { key: 'share', label: 'Share' }],
      rows: buckets.map(b => ({ id: b.key, match: b.label, count: b.count, share: rateText(b), share__sort: b.rate ?? -1 })),
    },
    nat: () => (any ? hbarHeight(items) : 40),
    draw: (w, h) => any ? <HBar items={items} width={w} height={h} cap={100} /> : <p className="ins-emptyline">No match rank recorded for students on your unit.</p>,
  }
}
