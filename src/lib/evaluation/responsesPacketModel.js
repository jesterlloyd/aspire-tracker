// src/lib/evaluation/responsesPacketModel.js
//
// RESPONSES-PACKET-1 (2026-09-19): the pure model behind Evaluation > Responses.
//
// The tab renders a printed results packet: an analysis sheet that states what the numbers
// rest on (the basis line) before it states the finding (a distribution per subscale), then
// a continuous-feed roster of individual responses, each of which opens into a bubble sheet
// of that person's answers item by item. Everything the sheet prints is computed here, from
// the assignments the tab already loads, so a node test can assert every count without a
// browser and no React file carries arithmetic.
//
// WHAT THIS DOES NOT DO. It does not change how a response is collected, stored or scored.
// Casey-Fink's three Section I means are read from the stored score columns. The other
// instruments store no means, so a subscale mean is computed here from the item answers in
// the responses JSONB, at read time, and never written back.
//
// ITEM TEXT. Three instruments keep their prose in the private evaluation-instrument-content
// bucket and one (Student's Feedback on ASPIRE) keeps it in code. Casey-Fink is third-party
// copyrighted, so its bubble sheet shows item NUMBERS only (itemText: 'licensed'). The other
// three resolve the real stem from the stored definition once the tab has loaded it, and fall
// back to the item number until then. No item wording is written into this file.
//
// PAIRING. A student is matched when a completed pre-rotation and a completed post-rotation
// Casey-Fink response both exist with all three Section I scores in range. That decision is
// made once, in caseyFinkComparison.js, and read here.
//
// SCORING (Owner, 2026-09-20: use what is canon in the instruments; create a rule where none
// exists). Each instrument carries its own rule, printed on the sheet:
//   Casey-Fink   its published scoring instructions (2024): a subscale is the mean of its
//                items on the 1 to 4 agreement scale, higher is more agreement, and no
//                individual item is an outcome measure. The sheet compares subscale means.
//   Preceptor    the stored definition's own anchors: 4 and 5 are meeting or exceeding the
//                expected student level, 3 is developing, 2 is needing close support, and 1
//                is "Not Observed / Unable to Assess", which is excluded from every mean and
//                count exactly as an N/A answer is.
//   Student x2   five-point agreement scales with Neutral at 3, no rule on file, so the
//                ASPIRE rule created here is the standard Likert read of a mean: agreed at
//                4.0 or above, neutral from 3.0, disagreed below 3.0. N/A is excluded.

import {
  CASEY_FINK_SLUG,
  CASEY_FINK_SECTION_GROUPS,
  buildCaseyFinkComparison,
  caseyFinkResponsesByStudent,
  isCaseyFinkPreTimepoint,
} from './caseyFinkComparison.js'
import { INSTRUMENT_COMPACT_LABELS, statusSortIndex, timepointSortIndex } from '../evaluationLabels.js'
import { POST_ROTATION_CONTENT } from '../../../lib/server/evaluation/postRotationEvalContent.js'
import { getStudentPreferredFullName } from '../studentNameFormatters.js'
import { shortenProgram } from '../displayFormatters.js'
import { isReissuableAssignment } from './assignmentReissue.js'
import { TIMEPOINT_QUALIFIERS } from './surveyNames.js'

export { CASEY_FINK_SLUG }

// ── Timepoints and statuses ───────────────────────────────────────────────────

// Display labels for the packet. The header block says "Pre-Rotation and Post-Rotation",
// so the roster's filter says the same; "Baseline" is what the database calls it.
export const TIMEPOINT_LABELS = TIMEPOINT_QUALIFIERS
export function timepointLabel(timepoint) {
  return TIMEPOINT_LABELS[timepoint] || timepoint || '–'
}

// Two stored values share one label ("Pre-Rotation" is baseline or early_rotation_baseline;
// "Midpoint" is midpoint or mid_rotation). The roster filter offers one option per LABEL and
// matches every stored value behind it, so the list never shows the same word twice.
const TIMEPOINT_CANON = Object.freeze({ early_rotation_baseline: 'baseline', mid_rotation: 'midpoint' })
export function canonicalTimepoint(timepoint) {
  return TIMEPOINT_CANON[timepoint] || timepoint
}
export function timepointMatches(filter, timepoint) {
  return filter === 'All' || canonicalTimepoint(timepoint) === canonicalTimepoint(filter)
}

export function responseOf(assignment) {
  const r = assignment?.evaluation_responses
  if (!r) return null
  return Array.isArray(r) ? r[0] || null : r
}

// Render-time effective status. A sent or opened invitation past its expiry reads as
// expired; nothing is written. Applied to every count and every row alike.
export function effectiveStatus(assignment, now = Date.now()) {
  if (
    (assignment?.status === 'sent' || assignment?.status === 'opened') &&
    assignment.expires_at &&
    new Date(assignment.expires_at).getTime() < now
  ) return 'expired'
  return assignment?.status
}

// A live invitation that has not been answered.
export const AWAITING_STATUSES = Object.freeze(['sent', 'opened', 'reminder_due', 'non_responder'])

export const STATUS_GROUPS = Object.freeze([
  { key: 'completed', label: 'Completed' },
  { key: 'awaiting',  label: 'Awaiting' },
  { key: 'expired',   label: 'Expired' },
  { key: 'revoked',   label: 'Revoked' },
])

export function statusGroup(status) {
  if (status === 'completed') return 'completed'
  if (AWAITING_STATUSES.includes(status)) return 'awaiting'
  if (status === 'expired') return 'expired'
  if (status === 'revoked') return 'revoked'
  return 'other'
}

// Status is one word in a pill, four tones (table canon §3.5): green settled, amber waiting
// on someone, blue in progress, grey inactive.
export const STATUS_PILLS = Object.freeze({
  completed:     { tone: 'ok',   label: 'Completed' },
  sent:          { tone: 'info', label: 'Sent' },
  opened:        { tone: 'info', label: 'Opened' },
  reminder_due:  { tone: 'warn', label: 'Reminder due' },
  non_responder: { tone: 'warn', label: 'No response' },
  expired:       { tone: 'off',  label: 'Expired' },
  revoked:       { tone: 'off',  label: 'Revoked' },
  draft:         { tone: 'off',  label: 'Draft' },
})
export function statusPill(status) {
  return STATUS_PILLS[status] || { tone: 'off', label: status || '–' }
}

// ── The four instruments ──────────────────────────────────────────────────────

const ratingIn = (v, max) => Number.isInteger(v) && v >= 1 && v <= max
// A rating the instrument itself says is not an assessment (the preceptor scale's 1).
const isExcluded = (instrument, v) => (instrument.naValues || []).includes(v)

// Rating items of Student's Feedback on ASPIRE, grouped as the instrument groups them.
// The stems are read from the same module the survey renders from; none are copied here.
const ASPIRE_SUBSCALES = POST_ROTATION_CONTENT.sections
  .map((section, i) => ({
    key: section.key,
    label: section.title,
    short: ['OV', 'CG', 'UE', 'RR', 'FR'][i] || section.key.toUpperCase(),
    itemCodes: section.items.filter(item => item.type === 'rating').map(item => item.key),
  }))
  .filter(s => s.itemCodes.length > 0)

const ASPIRE_ITEM_LABELS = Object.fromEntries(
  POST_ROTATION_CONTENT.sections.flatMap(s => s.items).map(item => [item.key, item.label]),
)

// The ASPIRE scoring rule for a five-point agreement scale with Neutral at 3 (created
// 2026-09-20; neither student instrument had a rule on file). A mean is read where it lands
// on the instrument's own anchors: at or above Agree, around Neutral, or below it.
export const LIKERT_BANDS = Object.freeze([
  { key: 'up',   label: 'agreed',    head: 'Agreed',    test: v => v >= 4 },
  { key: 'same', label: 'neutral',   head: 'Neutral',   test: v => v >= 3 },
  { key: 'down', label: 'disagreed', head: 'Disagreed', test: () => true },
])
export const LIKERT_NOTE = 'ASPIRE scoring rule: a mean of 4.0 or above reads as agreed, 3.0 to 3.9 as neutral, below 3.0 as disagreed. N/A answers are excluded from every mean.'

// Student's Feedback on Unit and Preceptor: the stored definition keys its sections
// section1..section4 in this order (StudentEvalResponseDetail reads them the same way).
const STUDENT_FEEDBACK_SECTION = Object.freeze({
  preceptor_support:    'section1',
  learning_environment: 'section2',
  psychological_safety: 'section3',
  overall_experience:   'section4',
})

export const PACKET_INSTRUMENTS = Object.freeze([
  Object.freeze({
    slug: CASEY_FINK_SLUG,
    name: INSTRUMENT_COMPACT_LABELS[CASEY_FINK_SLUG],
    paired: true,
    timepointsLabel: 'Pre-Rotation and Post-Rotation',
    scaleMax: 4,
    respondentNoun: 'student',
    title: 'Readiness: Pre-to-Post Change',
    scaleLabel: 'Section I mean score (1 to 4)',
    anchors: ['Strongly Disagree', 'Disagree', 'Agree', 'Strongly Agree'],
    naValues: [],
    bands: null,
    scoringNote: 'Scored per the Casey-Fink scoring instructions (2024): each subscale is the mean of its items on the 1 to 4 agreement scale, and a higher mean is more agreement. No individual item is an outcome measure.',
    // A5: this wording stays. It is the honest frame for a self-report instrument.
    caveat: 'Observed change in student-reported readiness. This does not independently measure retention, objective competence, or financial savings.',
    itemText: 'licensed',
    subscales: CASEY_FINK_SECTION_GROUPS.map(g => Object.freeze({
      key: g.key, label: g.label, short: g.shortLabel, scoreKey: g.scoreKey, itemCodes: g.itemCodes,
    })),
    readItem: (responses, code) => responses?.[code],
    itemLabel: () => null,
    sectionTitle: (content, subscale) => subscale.label,
  }),
  Object.freeze({
    slug: 'preceptor_progress',
    name: INSTRUMENT_COMPACT_LABELS.preceptor_progress,
    paired: false,
    timepointsLabel: 'Midpoint and End of Rotation',
    scaleMax: 5,
    respondentNoun: 'preceptor',
    title: 'Preceptor Ratings of Student Readiness',
    scaleLabel: 'Competency rating (2 to 5; 1 is not observed)',
    anchors: ['Not Observed / Unable to Assess', 'Needs Close Support', 'Developing', 'Meeting Expected Student Level', 'Exceeding Expected Student Level'],
    naValues: [1],
    bands: Object.freeze([
      { key: 'up',   label: 'meeting or exceeding expected level', head: 'Meeting or above', test: v => v >= 4 },
      { key: 'same', label: 'developing',                          head: 'Developing',       test: v => v >= 3 },
      { key: 'down', label: 'needing close support',               head: 'Close support',    test: () => true },
    ]),
    scoringNote: "Read on the instrument's own scale: 4 and 5 are meeting or exceeding the expected student level, 3 is developing, 2 is needing close support. A rating of 1, Not Observed / Unable to Assess, is excluded from every mean and count.",
    caveat: "Preceptor ratings of student progress at the midpoint and the end of the rotation. Each rating is one preceptor's judgement of one student.",
    itemText: 'stored',
    // One competency is one rated item; the sheet shows each competency as a row.
    subscales: [
      ['clinical_judgment',                    'Clinical Judgment',                  'CJ'],
      ['patient_centered_care',                'Patient-Centered Care',              'PCC'],
      ['safety_quality',                       'Safety and Quality',                 'SQ'],
      ['teamwork_communication_collaboration', 'Teamwork and Communication',         'TCC'],
      ['professionalism_accountability',       'Professionalism and Accountability', 'PA'],
      ['advanced_beginner_readiness',          'Advanced Beginner Readiness',        'ABR'],
    ].map(([key, label, short]) => Object.freeze({ key, label, short, itemCodes: [key] })),
    readItem: (responses, code) => responses?.developmental_feedback?.competency?.[code]?.rating,
    itemLabel: (content, code) => content?.section2?.items?.[code]?.label || null,
    sectionTitle: (content, subscale) => content?.section2?.items?.[subscale.key]?.label || subscale.label,
  }),
  Object.freeze({
    slug: 'student_preceptor_eval',
    name: INSTRUMENT_COMPACT_LABELS.student_preceptor_eval,
    paired: false,
    timepointsLabel: 'Post-Rotation',
    scaleMax: 5,
    respondentNoun: 'student',
    title: 'Experience of Unit and Preceptor',
    scaleLabel: 'Domain mean score (1 to 5)',
    anchors: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
    naValues: [],
    bands: LIKERT_BANDS,
    scoringNote: LIKERT_NOTE,
    caveat: 'Student-reported experience of the unit and preceptor. Responses reach unit leaders only through Review & Release.',
    itemText: 'stored',
    subscales: [
      ['preceptor_support',    'Preceptor Support',     'PS',  ['approachable_available', 'clear_explanations', 'useful_feedback', 'skill_development']],
      ['learning_environment', 'Learning Environment',  'LE',  ['included_in_care', 'welcoming_unit', 'practice_opportunities', 'workflow_supported_learning']],
      ['psychological_safety', 'Psychological Safety',  'PSY', ['comfortable_questions', 'comfortable_speaking_up', 'comfortable_raising_concerns', 'treated_with_respect']],
      ['overall_experience',   'Overall Experience',    'OE',  ['valuable_experience', 'would_recommend']],
    ].map(([key, label, short, itemCodes]) => Object.freeze({ key, label, short, itemCodes })),
    readItem: (responses, code, subscale) => responses?.[subscale.key]?.[code],
    itemLabel: (content, code, subscale) => content?.[STUDENT_FEEDBACK_SECTION[subscale.key]]?.items?.[code] || null,
    sectionTitle: (content, subscale) => content?.[STUDENT_FEEDBACK_SECTION[subscale.key]]?.title || subscale.label,
  }),
  Object.freeze({
    slug: 'post_rotation_evaluation',
    name: INSTRUMENT_COMPACT_LABELS.post_rotation_evaluation,
    paired: false,
    timepointsLabel: 'Post-Rotation',
    scaleMax: 5,
    respondentNoun: 'student',
    title: 'Experience of ASPIRE',
    scaleLabel: 'Item mean score (1 to 5)',
    anchors: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
    naValues: [],
    bands: LIKERT_BANDS,
    scoringNote: LIKERT_NOTE,
    caveat: 'Program-level feedback. It gates no certificate, so a low response rate holds nothing else up.',
    itemText: 'inline',
    subscales: ASPIRE_SUBSCALES.map(s => Object.freeze(s)),
    readItem: (responses, code) => responses?.[code],
    itemLabel: (content, code) => ASPIRE_ITEM_LABELS[code] || null,
    sectionTitle: (content, subscale) => subscale.label,
  }),
])

export const PACKET_SLUGS = Object.freeze(PACKET_INSTRUMENTS.map(i => i.slug))
export const DEFAULT_PACKET_SLUG = PACKET_SLUGS[0]

export function instrumentBySlug(slug) {
  return PACKET_INSTRUMENTS.find(i => i.slug === slug) || null
}

export function rowsForInstrument(assignments, slug) {
  return (assignments || []).filter(a => a?.evaluation_instruments?.slug === slug)
}

// Unique timepoints present for one instrument, one per label, in canonical order, for the
// roster filter.
export function timepointOptions(rows) {
  return [...new Set(rows.map(a => canonicalTimepoint(a.timepoint)).filter(Boolean))]
    .sort((a, b) => timepointSortIndex(a) - timepointSortIndex(b))
}

// ── Scores ────────────────────────────────────────────────────────────────────

// One response's mean on one subscale. Casey-Fink reads the stored Section I score; the
// others average the subscale's rated items ('na' and blanks are skipped, never zero).
export function subscaleMean(instrument, subscale, response) {
  if (!response) return null
  if (subscale.scoreKey) {
    const v = Number(response[subscale.scoreKey])
    return Number.isFinite(v) && v >= 1 && v <= instrument.scaleMax ? v : null
  }
  const values = []
  for (const code of subscale.itemCodes) {
    const v = instrument.readItem(response.responses, code, subscale)
    if (ratingIn(v, instrument.scaleMax) && !isExcluded(instrument, v)) values.push(v)
  }
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function sectionTitle(instrument, subscale, content) {
  return instrument.sectionTitle(content, subscale) || subscale.label
}

// ── Instrument tabs ───────────────────────────────────────────────────────────

export function buildInstrumentTabs(assignments, now = Date.now()) {
  return PACKET_INSTRUMENTS.map(instrument => {
    const rows = rowsForInstrument(assignments, instrument.slug)
    const completed = rows.filter(a => effectiveStatus(a, now) === 'completed').length
    const assigned = rows.length
    return {
      slug: instrument.slug,
      name: instrument.name,
      assigned,
      completed,
      pct: assigned > 0 ? Math.round((completed / assigned) * 100) : 0,
    }
  })
}

// ── The basis line: what the numbers rest on, before the finding ─────────────

// Tones. Assigned and the pairing count are the denominators and render in navy ('key').
// Nonzero unfinished work (Awaiting, Baseline only, Expired) renders amber ('warn'). Any
// zero renders muted at normal weight ('zero') so dead states stop competing for attention.
function basisEntry(key, value, label, role = '') {
  const n = Number(value) || 0
  return { key, value: n, label, tone: n === 0 ? 'zero' : role }
}

export function countStatuses(rows, now = Date.now()) {
  const counts = { assigned: rows.length, completed: 0, awaiting: 0, expired: 0, revoked: 0 }
  for (const a of rows) {
    const g = statusGroup(effectiveStatus(a, now))
    if (g in counts) counts[g] += 1
  }
  return counts
}

export function buildBasis(instrument, rows, comparison, now = Date.now()) {
  const counts = countStatuses(rows, now)
  const out = [
    basisEntry('assigned',  counts.assigned,  'Assigned', 'key'),
    basisEntry('completed', counts.completed, 'Completed'),
    basisEntry('awaiting',  counts.awaiting,  'Awaiting', 'warn'),
  ]
  if (instrument.paired) {
    out.push(
      basisEntry('pairs',        comparison?.matchedCount,      'Matched pairs', 'key'),
      basisEntry('baselineOnly', comparison?.baselineOnlyCount, 'Baseline only', 'warn'),
      basisEntry('postOnly',     comparison?.postOnlyCount,     'Post only'),
    )
    // Not among the spec's six for a paired instrument, but a denominator that hides an
    // expired or revoked invitation misleads; they appear only when nonzero.
    if (counts.expired) out.push(basisEntry('expired', counts.expired, 'Expired', 'warn'))
    if (counts.revoked) out.push(basisEntry('revoked', counts.revoked, 'Revoked'))
  } else {
    const scored = rows.filter(a =>
      effectiveStatus(a, now) === 'completed' &&
      instrument.subscales.some(s => subscaleMean(instrument, s, responseOf(a)) != null)).length
    out.push(
      basisEntry('scored',  scored,         'Scored', 'key'),
      basisEntry('expired', counts.expired, 'Expired', 'warn'),
      basisEntry('revoked', counts.revoked, 'Revoked'),
    )
  }
  return out
}

// ── The finding: distribution first, means second ────────────────────────────

export const PAIR_LABELS = Object.freeze({ up: 'higher post score', same: 'no change', down: 'lower post score' })
export const PAIR_HEADS = Object.freeze({ up: 'Higher', same: 'Same', down: 'Lower' })

// Which band a subscale mean falls in, by the instrument's own rule (first band whose
// test passes). null when the instrument has no bands (a paired instrument) or no mean.
export function bandOf(mean, instrument) {
  if (mean == null || !Number.isFinite(mean) || !instrument?.bands) return null
  return instrument.bands.find(b => b.test(mean))?.key || null
}
export function bandLabels(instrument) {
  return Object.fromEntries((instrument.bands || []).map(b => [b.key, b.label]))
}
export function bandHeads(instrument) {
  return Object.fromEntries((instrument.bands || []).map(b => [b.key, b.head]))
}

const plural = (n, one, many) => (n === 1 ? one : many)

export function buildDistribution(instrument, rows, comparison, content = null, now = Date.now()) {
  if (instrument.paired) {
    const n = comparison?.matchedCount || 0
    return {
      paired: true,
      title: instrument.title,
      subtitle: `Matched student responses · ${n} paired ${plural(n, 'student', 'students')} · Section I mean, scale 1 ${instrument.anchors[0]} to ${instrument.scaleMax} ${instrument.anchors[instrument.scaleMax - 1]}`,
      scaleLabel: instrument.scaleLabel,
      scoringNote: instrument.scoringNote,
      labels: PAIR_LABELS,
      heads: PAIR_HEADS,
      total: n,
      subscales: (comparison?.metrics || []).map(m => {
        const up = m.changeCounts?.higherPost || 0
        const same = m.changeCounts?.same || 0
        const down = m.changeCounts?.lowerPost || 0
        return {
          key: m.key, label: m.label, short: m.shortLabel, itemCount: m.itemCodes.length,
          up, same, down, total: up + same + down, net: up - down,
          preMean: m.preMean, postMean: m.postMean, delta: m.delta, mean: null,
        }
      }),
    }
  }

  const completed = rows
    .filter(a => effectiveStatus(a, now) === 'completed')
    .map(responseOf)
    .filter(Boolean)
  const subscales = instrument.subscales.map(s => {
    const means = completed.map(r => subscaleMean(instrument, s, r)).filter(v => v != null)
    let up = 0, same = 0, down = 0
    for (const m of means) {
      const band = bandOf(m, instrument)
      if (band === 'up') up += 1
      else if (band === 'same') same += 1
      else down += 1
    }
    return {
      key: s.key, label: sectionTitle(instrument, s, content), short: s.short, itemCount: s.itemCodes.length,
      up, same, down, total: means.length, net: null,
      preMean: null, postMean: null, delta: null,
      mean: means.length ? means.reduce((sum, v) => sum + v, 0) / means.length : null,
    }
  })
  const n = completed.length
  return {
    paired: false,
    title: instrument.title,
    subtitle: `Single timepoint · ${n} ${instrument.respondentNoun} ${plural(n, 'response', 'responses')} · no baseline to compare against · scale 1 ${instrument.anchors[0]} to ${instrument.scaleMax} ${instrument.anchors[instrument.scaleMax - 1]}`,
    scaleLabel: instrument.scaleLabel,
    scoringNote: instrument.scoringNote,
    labels: bandLabels(instrument),
    heads: bandHeads(instrument),
    total: n,
    subscales,
  }
}

// The text a segment speaks: "12 of 21 higher post score".
export function segmentText(count, total, label) {
  return `${count} of ${total} ${label}`
}

// ── Follow-up: who still owes a response ─────────────────────────────────────

export function buildFollowUp(instrument, rows, comparison, byStudent, now = Date.now()) {
  if (instrument.paired) {
    const ids = [...(byStudent || new Map()).entries()]
      .filter(([, entry]) => entry.pre && !entry.post)
      .map(([id]) => id)
    if (ids.length === 0) return null
    const n = ids.length
    return {
      kind: 'baselineOnly',
      text: `${n} ${plural(n, 'student', 'students')} submitted a baseline and no post-rotation response.`,
      action: 'See who',
      chip: 'Baseline only',
      studentIds: ids,
    }
  }
  const awaiting = rows.filter(a => statusGroup(effectiveStatus(a, now)) === 'awaiting').length
  if (awaiting === 0) return null
  return {
    kind: 'awaiting',
    text: `${awaiting} ${instrument.respondentNoun} ${plural(awaiting, 'survey has', 'surveys have')} been sent and not returned.`,
    action: 'See who',
    chip: 'Awaiting',
    status: 'awaiting',
  }
}

// ── The roster ────────────────────────────────────────────────────────────────

// The date a row shows is the timestamp of its status (Owner, 2026-09-20): a Completed row
// shows when it was submitted, Sent when it was sent, Opened when it was opened, Expired
// when the window closed, Revoked when it was recalled. Status sits before Date in the
// roster so the pair reads as one fact.
export function statusDate(assignment, status, response) {
  switch (status) {
    case 'completed': return { kind: 'Submitted', date: response?.submitted_at || assignment?.completed_at || null }
    case 'opened':    return { kind: 'Opened',    date: assignment?.opened_at || assignment?.sent_at || null }
    case 'expired':   return { kind: 'Expired',   date: assignment?.expires_at || null }
    case 'revoked':   return { kind: 'Revoked',   date: assignment?.revoked_at || null }
    case 'sent':
    case 'reminder_due':
    case 'non_responder':
      return { kind: 'Sent', date: assignment?.sent_at || assignment?.invited_at || null }
    default:          return { kind: 'Invited',   date: assignment?.invited_at || assignment?.sent_at || null }
  }
}

export function rosterRow(instrument, assignment, now = Date.now()) {
  const student = assignment?.students || {}
  const response = responseOf(assignment)
  const status = effectiveStatus(assignment, now)
  const { kind: dateKind, date } = statusDate(assignment, status, response)
  const scores = {}
  for (const s of instrument.subscales) {
    scores[s.key] = status === 'completed' ? subscaleMean(instrument, s, response) : null
  }
  return {
    id: assignment.id,
    assignment,
    studentId: student.id || assignment.student_id || null,
    name: getStudentPreferredFullName(student) || 'Student',
    sortName: `${student.last_name || ''} ${student.first_name || ''}`.trim().toLowerCase(),
    program: shortenProgram(student.program_type) || '',
    school: student.school || '',
    submittedAt: response?.submitted_at || null,
    date,
    dateKind,
    status,
    pill: statusPill(status),
    timepoint: assignment.timepoint,
    respondent: assignment.respondent_type === 'preceptor' ? (assignment.respondent_name || null) : null,
    scores,
  }
}

export function buildRosterRows(instrument, rows, { timepoint = 'All', status = null, focusStudentIds = null } = {}, now = Date.now()) {
  return rows
    .filter(a => timepointMatches(timepoint, a.timepoint))
    .filter(a => status == null || statusGroup(effectiveStatus(a, now)) === status)
    .filter(a => !focusStudentIds || focusStudentIds.has(a?.students?.id || a?.student_id))
    .map(a => rosterRow(instrument, a, now))
}

// Column descriptors, JSX-free. The component attaches a renderer per `kind`. The first
// column is name · qualifier; every figure has its own right-aligned column (table canon).
// Widths are a minimum plus a share of the spare width (the weighted spread): the name
// column grows most, the school next, the date and status less, and the figures least.
// A preceptor-answered instrument also names the respondent (Owner, 2026-09-20): who
// answered, or who a pending survey is waiting on. Its six figures tighten to make room.
export function rosterColumns(instrument) {
  const askedOfPreceptor = instrument.respondentNoun === 'preceptor'
  return [
    { key: 'student', label: 'Student', kind: 'name',   min: 150, grow: 2.2, priority: 1 },
    { key: 'school',  label: 'School',  kind: 'school', min: 118, grow: 1.4, priority: 4 },
    ...(askedOfPreceptor ? [{ key: 'respondent', label: 'Respondent', kind: 'text', min: 120, grow: 1.3, priority: 2 }] : []),
    { key: 'status',  label: 'Status',  kind: 'pill',   min: 92,  grow: 1,   priority: 2 },
    { key: 'date',    label: 'Date',    kind: 'date',   min: 104, grow: 1,   priority: 2 },
    ...instrument.subscales.map(s => ({
      key: `score:${s.key}`, label: s.short, title: s.label, kind: 'num', align: 'right',
      min: askedOfPreceptor ? 48 : 58, grow: askedOfPreceptor ? 0.55 : 0.7, priority: 3, scoreKey: s.key,
      decimals: s.itemCodes.length === 1 ? 0 : 2,
    })),
  ]
}

export function rosterSortValue(row, column) {
  switch (column.kind) {
    case 'name':   return row.sortName
    case 'school': return (row.school || '').toLowerCase() || null
    case 'date':   return row.date || null
    case 'text':   return (row[column.key] || '').toLowerCase() || null
    case 'pill':   return statusSortIndex(row.status)
    case 'num':    return row.scores[column.scoreKey] ?? null
    default:       return row[column.key] ?? null
  }
}

// ── Sending an expired survey again ───────────────────────────────────────────
//
// SURVEY-REISSUE-2 (Owner, 2026-09-20): a row whose link expired or was revoked can be sent
// again, but not from here. The table canon says a row action may only open something
// elsewhere, and a release is a decision that belongs on the Review & Release clipboard,
// under its guards and on its Sent log. So the roster hands the reader to that student's
// slip on the workflow that administers this instrument at this timepoint, where the
// Reissue button is. The workflow keys and item ids are the queue's own (surveyCatalog.js,
// reviewQueueAdapters.js); the rule for "may be sent again" is the shared one every
// detector and endpoint reads (assignmentReissue.js). Returns null when there is nothing
// to send again: a completed, live or draft row, or a preceptor period the queue does not
// release (Other / Interim is a manual send).
export function reissueTarget(assignment, now = Date.now()) {
  if (!isReissuableAssignment(assignment, now)) return null
  const studentId = assignment?.students?.id || assignment?.student_id
  if (!studentId) return null
  const slug = assignment?.evaluation_instruments?.slug
  const tp = assignment?.timepoint
  if (slug === CASEY_FINK_SLUG) {
    if (isCaseyFinkPreTimepoint(tp)) return { workflowId: 'caseyFinkPreRotation', itemId: `q:${studentId}` }
    if (tp === 'post_rotation') return { workflowId: 'caseyFinkPostRotation', itemId: `q:${studentId}` }
    return null
  }
  if (slug === 'preceptor_progress') {
    const period = tp === 'midpoint' ? 'midpoint' : tp === 'post_rotation' ? 'end_of_rotation' : null
    return period ? { workflowId: 'preceptor', itemId: `q:${studentId}:${period}` } : null
  }
  if (slug === 'student_preceptor_eval') return { workflowId: 'student', itemId: `q:${studentId}` }
  if (slug === 'post_rotation_evaluation') return { workflowId: 'postRotation', itemId: `q:${studentId}` }
  return null
}

// ── The bubble sheet: one person's answers, item by item ─────────────────────

export function itemNumber(instrument, code) {
  let n = 0
  for (const s of instrument.subscales) {
    for (const c of s.itemCodes) {
      n += 1
      if (c === code) return n
    }
  }
  return null
}

export const LICENSED_NOTE = 'Item text is licensed and is not reproduced here. Open the response to read each item in full.'
// The Casey-Fink scoring instructions: no individual item is an outcome measure.
export const ITEM_NOT_OUTCOME_NOTE = 'Per the Casey-Fink scoring instructions, no individual item is an outcome measure; the subscale mean is the score.'

// Which submitted responses a row opens. A Casey-Fink row opens its own side and the
// student's other side from the pairing map, so a pending post-rotation row still shows
// what the student said at baseline (the subtitle says which sides are present).
function sidesFor(instrument, row, byStudent) {
  const own = row.status === 'completed' ? row.assignment : null
  if (!instrument.paired) return { pre: null, post: own }
  const entry = (byStudent && byStudent.get(row.studentId)) || {}
  if (own && isCaseyFinkPreTimepoint(own.timepoint)) return { pre: own, post: entry.post || null }
  if (own && own.timepoint === 'post_rotation') return { pre: entry.pre || null, post: own }
  return { pre: entry.pre || null, post: entry.post || null }
}

export function buildBubbleSheet(instrument, row, byStudent, content = null) {
  const { pre, post } = sidesFor(instrument, row, byStudent)
  const preAnswers = responseOf(pre)?.responses || null
  const postAnswers = responseOf(post)?.responses || null
  const hasPre = !!preAnswers
  const hasPost = !!postAnswers

  const subtitle = instrument.paired
    ? `${instrument.name} · ${hasPre && hasPost ? 'Pre-Rotation and Post-Rotation' : hasPre ? 'Pre-Rotation only' : hasPost ? 'Post-Rotation only' : 'no submitted response'}`
    : `${instrument.name} · ${timepointLabel(row.timepoint)}${row.respondent ? ` · completed by ${row.respondent}` : ''}`

  if (!hasPre && !hasPost) {
    // An unanswered row says why, in the status's own words (SURVEY-REISSUE-2).
    const why = row.status === 'expired' ? 'This link expired before an answer was submitted.'
      : row.status === 'revoked' ? 'This link was revoked before an answer was submitted.'
      : row.status === 'non_responder' ? 'The response window closed without an answer.'
      : null
    return { empty: true, paired: false, hasPre, hasPost, scaleMax: instrument.scaleMax, subtitle, groups: [], note: null,
      message: why ? `No submitted answers to show for this row. ${why}` : 'No submitted answers to show for this row.' }
  }

  const groups = instrument.subscales.map(s => ({
    key: s.key,
    label: sectionTitle(instrument, s, content),
    items: s.itemCodes.map(code => {
      const rawPre = hasPre ? instrument.readItem(preAnswers, code, s) : null
      const rawPost = hasPost ? instrument.readItem(postAnswers, code, s) : null
      const p = ratingIn(rawPre, instrument.scaleMax) ? rawPre : null
      const q = ratingIn(rawPost, instrument.scaleMax) ? rawPost : null
      const n = itemNumber(instrument, code)
      const stem = instrument.itemText === 'licensed' ? null : instrument.itemLabel(content, code, s)
      const excluded = isExcluded(instrument, q) || isExcluded(instrument, p)
      return {
        code,
        number: n,
        label: stem || `Item ${n}`,
        pre: p,
        post: q,
        na: rawPost === 'na' || rawPre === 'na',
        excluded,
        shift: p != null && q != null && !excluded ? q - p : null,
      }
    }),
  }))

  return {
    empty: false,
    paired: hasPre && hasPost,
    hasPre,
    hasPost,
    scaleMax: instrument.scaleMax,
    subtitle,
    groups,
    note: instrument.itemText === 'licensed' ? `${LICENSED_NOTE} ${ITEM_NOT_OUTCOME_NOTE}` : (instrument.naValues?.length ? `A rating of 1 (${instrument.anchors[0]}) is shown but excluded from every mean.` : null),
    message: null,
  }
}

// ── One call for the whole sheet ──────────────────────────────────────────────

export function buildPacket(assignments, slug, { content = null, now = Date.now() } = {}) {
  const instrument = instrumentBySlug(slug) || PACKET_INSTRUMENTS[0]
  const rows = rowsForInstrument(assignments, instrument.slug)
  const comparison = instrument.paired ? buildCaseyFinkComparison(assignments) : null
  const byStudent = instrument.paired ? caseyFinkResponsesByStudent(assignments) : null
  return {
    instrument,
    rows,
    comparison,
    byStudent,
    basis: buildBasis(instrument, rows, comparison, now),
    distribution: buildDistribution(instrument, rows, comparison, content, now),
    followUp: buildFollowUp(instrument, rows, comparison, byStudent, now),
    columns: rosterColumns(instrument),
    timepoints: timepointOptions(rows),
  }
}
