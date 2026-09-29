// src/lib/keith/checkinSortModel.js
//
// KEITH-CHECKIN-1 (2026-09-29): the rules for Keith sorting support check-in replies, pure and
// shared by the server (lib/server/keith/checkinSorting.js) and the Action Center.
//
// The order is fixed and Keith is last (Owner, 2026-09-28):
//   1. Safety terms -> Urgent. classify_support_checkin, in the database trigger. Never Keith.
//   2. Clear declines -> closed by the decline patterns. Same function. Never Keith.
//   3. Everything else -> Keith, replacing the old keyword rules (question_or_problem, ambiguous).
// Keith never labels Urgent (its schema has no such label), never sees a reply rule 1 or 2 handled,
// and never closes a reply that contains a safety term: SAFETY_RE is rule 1's own pattern, checked
// again in code before Keith runs and again before anything closes.

export const SKILL_KEY = 'sort-checkin-reply'
export const SHADOW_DAYS = 14
export const LABELS = Object.freeze(['thank_you', 'needs_a_look', 'request'])
export const REQUEST_TYPES = Object.freeze(['parking', 'schedule', 'badge_access', 'clearance', 'other'])
export const REQUEST_TYPE_LABEL = Object.freeze({ parking: 'Parking', schedule: 'Schedule', badge_access: 'Badge access', clearance: 'Clearance', other: 'Other' })

/** The rule keys Keith may sort: rules 3 and 4 of the original classifier. */
export const KEITH_SORTS_RULES = Object.freeze(['question_or_problem', 'ambiguous'])

// Rule 1, word for word from classify_support_checkin (20261005000000). A test holds them equal.
export const SAFETY_RE = /\b(harm|injur(y|ed|ies)|unsafe|harass(ment|ed|ing)?|needlestick|needle[ -]?stick|exposure|exposed|ill(ness)?|sick)\b/i
export const hasSafetyTerm = (reply) => SAFETY_RE.test(String(reply || ''))

/** Keith's output, held to the rules: low confidence is always Needs a look; a type only on a request. */
export function normalizeSort(o) {
  const confidence = ['high', 'medium', 'low'].includes(o?.confidence) ? o.confidence : 'low'
  let label = LABELS.includes(o?.label) ? o.label : 'needs_a_look'
  if (confidence === 'low') label = 'needs_a_look'
  const request_type = label === 'request' ? (REQUEST_TYPES.includes(o?.request_type) ? o.request_type : 'other') : null
  return { label, request_type, confidence, reason: String(o?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300) }
}

/** Would Keith close it? Only a thank-you at high or medium confidence, and never with a safety term. */
export const wouldClose = (sort, reply) => sort?.label === 'thank_you' && sort.confidence !== 'low' && !hasSafetyTerm(reply)

/** The support_checkin_events row Keith writes when its skill is ON. */
export function eventFor(sort, reply) {
  if (wouldClose(sort, reply)) return { classification: 'thank_you', status: 'closed_auto', rule_key: 'keith_thank_you' }
  if (sort.label === 'request') return { classification: 'request', status: 'open', rule_key: `keith_request:${sort.request_type || 'other'}` }
  return { classification: 'needs_look', status: 'open', rule_key: 'keith_needs_a_look' }
}

export const isKeithRule = (rule) => String(rule || '').startsWith('keith_')
export const isKeithClose = (rule) => String(rule || '').startsWith('keith_thank_you')
export const requestTypeOfRule = (rule) => {
  const m = String(rule || '').match(/^keith_request:([a-z_]+)$/)
  return m && REQUEST_TYPES.includes(m[1]) ? m[1] : null
}

/**
 * A person's decision on a reply, as the label it amounts to (Owner, 2026-09-28): closed as no help
 * is a thank-you; opened as a request, or reopened, is a request. Anything else is no decision.
 */
export function humanLabelOf(ruleKey) {
  if (ruleKey === 'staff_close_no_help') return 'thank_you'
  if (ruleKey === 'staff_open_request' || ruleKey === 'staff_reopen') return 'request'
  return null
}

/**
 * Agreement: a thank-you agrees with "closed as no help"; Needs a look and Request both agree with
 * "opened as a request", because both put the reply in front of a person.
 */
export const agrees = (keith, human) => (human === 'thank_you' ? keith === 'thank_you' : human === 'request' ? keith === 'request' || keith === 'needs_a_look' : false)

/** "Replies Keith would close that you kept open": the one figure that holds auto-close shut. */
export const keptOpenCount = (rows) => (rows || []).filter(r => r.keith === 'thank_you' && r.human === 'request').length

/** Whether the Owner may turn auto-close on, and why not. */
export function gateState({ firstShadowAt, keptOpen, now = Date.now() }) {
  const days = firstShadowAt ? Math.floor((now - new Date(firstShadowAt).getTime()) / 86400000) : 0
  const daysLeft = Math.max(0, SHADOW_DAYS - days)
  const ok = !!firstShadowAt && daysLeft === 0 && keptOpen === 0
  const message = !firstShadowAt ? 'Shadow mode has not started: Keith has not sorted a reply yet.'
    : daysLeft > 0 ? `Shadow mode runs ${SHADOW_DAYS} days. ${daysLeft} ${daysLeft === 1 ? 'day is' : 'days are'} left.`
      : keptOpen > 0 ? `You kept open ${keptOpen} ${keptOpen === 1 ? 'reply' : 'replies'} Keith would have closed.` : ''
  return { ok, day: Math.min(days + 1, SHADOW_DAYS), days, daysLeft, message }
}

/** The label as the queue shows it. */
export function labelText(sort) {
  if (!sort) return ''
  if (sort.label === 'thank_you') return 'Thank-you'
  if (sort.label === 'request') return `Request · ${REQUEST_TYPE_LABEL[sort.request_type ?? sort.requestType] || 'Other'}`
  return 'Needs a look'
}

/** The shadow-mode line on an item: what Keith would have done, never done. */
export function wouldLine(sort, reply) {
  if (!sort) return ''
  if (wouldClose(sort, reply)) return 'Keith would close this'
  return `Keith would label this: ${labelText(sort)}`
}

/** The primary action a Keith request offers: relabel only (Owner, 2026-09-28). */
export const openRequestLabel = (type) => (type && type !== 'other' ? `Open as ${REQUEST_TYPE_LABEL[type].toLowerCase()} request` : 'Open as request')
