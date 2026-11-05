// src/lib/studio/keithStudio.js
//
// STUDIO-3 (Phase 2b, 2026-11-05): Keith in Studio. Pure: the server runs these on everything Keith
// returns, and the screen reads the same words. Keith has two Skills (lib/server/keith/skillDefs.js):
//
//   studio-brief   reads the request and the answers so far and returns the NEXT question with its
//                  answer choices, or a finished brief. He is given cohort names, key dates, form
//                  titles and the audience filters with COUNTS ONLY, never a name or an address.
//   studio-design  turns a finished brief into a design (blocks JSON, subject, preheader), or
//                  rewrites one block ("shorter", "warmer").
//
// What Keith may never do, and how it is held here rather than in his instructions:
//   - Invent a link. A URL is kept only when the person typed it in the conversation
//     (allowedUrls); anything else becomes '' and the send blocks until a person fills it in.
//   - Invent a form. A form id is kept only when it is one of the Catalog forms he was shown.
//   - Name an audience outside the catalog. His rule passes sanitizeRule, and ids that were not
//     offered to him are dropped.
//   - Send. Nothing here or in the Skills sends anything; the drawer's review still decides.

import { sanitizeDesign, BLOCKS, THEMES, makeBlock, safeUrl } from './studioBlocks.js'
import { sanitizeRule } from './audienceCatalog.js'
import { LAYOUTS } from './studioLayouts.js'

/** The most questions Keith may ask before he must finish the brief. */
export const MAX_QUESTIONS = 4
export const MAX_CHOICES = 6
export const REQUEST_MAX = 1200
export const ANSWER_MAX = 400

export const LAYOUT_KEYS = Object.freeze(LAYOUTS.map(l => l.key))
export const THEME_KEYS = Object.freeze(Object.keys(THEMES))

/** The one-tap rewrites in the inspector. The words are also what Keith is told. */
export const REWRITES = Object.freeze([
  { key: 'shorter', label: 'Shorter', ask: 'Make it shorter. Keep every fact, date and name.' },
  { key: 'warmer', label: 'Warmer', ask: 'Make it warmer and more personal, still professional.' },
  { key: 'clearer', label: 'Clearer', ask: 'Make it clearer and more direct. Lead with what the reader should do.' },
  { key: 'formal', label: 'More formal', ask: 'Make it more formal, as for leadership or a school.' },
])

/** Block types Keith may rewrite: the ones that hold words. */
export const REWRITABLE = Object.freeze(['hero', 'heading', 'text', 'columns', 'steps', 'quote', 'button', 'event', 'form', 'footer'])

const clip = (v, n) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, n)
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+|mailto:[^\s<>"')\]]+/gi

/** Every link the person typed in the conversation: the only links Keith may use. */
export function urlsFromConversation(request, turns = []) {
  const text = [request, ...(turns || []).map(t => t?.answer)].join('\n')
  const out = new Set()
  for (const m of String(text).match(URL_IN_TEXT) || []) {
    const u = safeUrl(m.replace(/[.,;:!?]+$/, ''))
    if (u) out.add(u)
  }
  return out
}

/** The conversation as the server accepts it: a request and at most MAX_QUESTIONS answered turns. */
export function cleanConversation(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const turns = (Array.isArray(r.turns) ? r.turns : []).slice(0, MAX_QUESTIONS).map(t => ({
    question: clip(t?.question, 300), answer: clip(t?.answer, ANSWER_MAX),
  })).filter(t => t.question && t.answer)
  return { request: clip(r.request, REQUEST_MAX), turns }
}

const choiceOf = (c) => {
  const label = clip(c?.label, 120)
  if (!label) return null
  const n = Number(c?.count)
  return { label, count: Number.isInteger(n) && n >= 0 ? n : null }
}

/**
 * Keith's brief answer, made safe. `offered` is what he was shown: { cohortIds, cycleIds, formIds }.
 * Returns { kind: 'question', question, why, choices, multi, allowOther }
 *      or { kind: 'brief', brief }.
 * A question past the limit is refused (the caller asks him again with the limit stated).
 */
export function parseBrief(json, { offered = {}, allowedUrls = new Set(), asked = 0 } = {}) {
  const j = json && typeof json === 'object' ? json : {}
  if (j.kind === 'question') {
    if (asked >= MAX_QUESTIONS) throw Object.assign(new Error('Keith asked past the limit.'), { code: 'too_many_questions' })
    const question = clip(j.question, 300)
    if (!question) throw Object.assign(new Error('Keith asked nothing.'), { code: 'empty_question' })
    return {
      kind: 'question', question, why: clip(j.why, 300) || null,
      choices: (Array.isArray(j.choices) ? j.choices : []).map(choiceOf).filter(Boolean).slice(0, MAX_CHOICES),
      multi: j.multi === true, allowOther: j.allow_other !== false,
    }
  }
  const b = j.brief && typeof j.brief === 'object' ? j.brief : {}
  const a = b.audience && typeof b.audience === 'object' ? b.audience : {}
  const cohortIds = new Set(offered.cohortIds || [])
  const cycleIds = new Set(offered.cycleIds || [])
  const formIds = new Set(offered.formIds || [])
  const rule = sanitizeRule({
    population: a.population,
    cohortIds: (Array.isArray(a.cohort_ids) ? a.cohort_ids : []).filter(id => cohortIds.has(id)),
    statuses: a.statuses, schools: a.schools, emailRoute: a.email_route,
    cycleId: cycleIds.has(a.cycle_id) ? a.cycle_id : null,
    form: a.form, license: a.license, hired: a.hired, categories: a.categories,
  })
  const act = b.action && typeof b.action === 'object' ? b.action : {}
  const url = safeUrl(act.url)
  const kind = ['link', 'form', 'none'].includes(act.kind) ? act.kind : 'none'
  return {
    kind: 'brief',
    brief: {
      purpose: clip(b.purpose, 400) || 'An email from ASPIRE.',
      layout: LAYOUT_KEYS.includes(b.layout) ? b.layout : 'announcement',
      theme: THEME_KEYS.includes(b.theme) ? b.theme : (rule.population === 'alumni' ? 'forest' : 'navy'),
      audience: rule,
      audienceLabel: clip(b.audience_label, 300),
      action: {
        kind,
        label: clip(act.label, 80) || null,
        // A link only if the person typed it; a form only if it was offered. Never invented.
        url: kind === 'link' && url && allowedUrls.has(url) ? url : '',
        formId: kind === 'form' && formIds.has(act.form_id) ? act.form_id : '',
      },
      points: (Array.isArray(b.points) ? b.points : []).map(p => clip(p, 300)).filter(Boolean).slice(0, 8),
      dates: (Array.isArray(b.dates) ? b.dates : []).map(d => ({ label: clip(d?.label, 120), date: clip(d?.date, 40) })).filter(d => d.label && d.date).slice(0, 6),
      tone: clip(b.tone, 120) || 'warm and professional',
    },
  }
}

/** The words of a brief, for the screen. */
export function briefLines(brief) {
  const b = brief || {}
  const lines = [
    ['What', b.purpose],
    ['Who', b.audienceLabel],
    ['Layout', LAYOUTS.find(l => l.key === b.layout)?.label],
    ['Theme', THEMES[b.theme]?.label],
  ]
  if (b.action?.kind === 'link') lines.push(['Button', b.action.url ? `${b.action.label || 'Button'} → ${b.action.url}` : `${b.action.label || 'Button'} (you add the link)`])
  if (b.action?.kind === 'form') lines.push(['Form', b.action.formId ? (b.action.label || 'Catalog form') : 'You choose the form'])
  if (b.dates?.length) lines.push(['Dates', b.dates.map(d => `${d.label}: ${d.date}`).join(' · ')])
  return lines.filter(([, v]) => v)
}

// ── Links and forms inside a design ──────────────────────────────────────────────────────────────

const MD_LINK = /\[([^\]]{1,200})\]\(([^)\s]{1,2000})\)/g

/** Text with every link Keith was not given taken out (a markdown link keeps its words). */
export function stripUnknownLinks(text, allowed) {
  return String(text || '')
    .replace(MD_LINK, (m, label, url) => (allowed.has(safeUrl(url)) ? m : label))
    .replace(URL_IN_TEXT, (u) => (allowed.has(safeUrl(u.replace(/[.,;:!?]+$/, ''))) ? u : ''))
}

function scrubBlock(block, allowed, formIds) {
  const p = { ...block.props }
  for (const k of ['text', 'subhead', 'details', 'caption']) if (typeof p[k] === 'string') p[k] = stripUnknownLinks(p[k], allowed)
  for (const k of ['left', 'right']) if (p[k]) p[k] = { ...p[k], text: stripUnknownLinks(p[k].text, allowed), imageUrl: '' }
  if (Array.isArray(p.items)) p.items = p.items.map(i => ({ ...i, text: stripUnknownLinks(i.text, allowed) }))
  if ('url' in p) p.url = block.type === 'image' ? '' : (allowed.has(p.url) ? p.url : '')
  if ('link' in p) p.link = allowed.has(p.link) ? p.link : ''
  if ('imageUrl' in p) p.imageUrl = '' // Keith never picks an image: uploads and Catalog files only.
  if ('formId' in p && !formIds.has(p.formId)) { p.formId = ''; p.formTitle = '' }
  return { ...block, props: p }
}

/**
 * Keith's design, made safe and complete: sanitizeDesign drops what is not a block, a link he was
 * not given becomes '' (a required gap the send stops on), a header leads and the signature and
 * footer close. `forms` maps an offered form id to its title.
 */
export function parseKeithDesign(json, { brief, allowedUrls = new Set(), forms = new Map() } = {}) {
  const j = json && typeof json === 'object' ? json : {}
  const base = sanitizeDesign({
    theme: THEME_KEYS.includes(j.theme) ? j.theme : brief?.theme,
    subject: j.subject, preheader: j.preheader,
    blocks: (Array.isArray(j.blocks) ? j.blocks : []).filter(b => b && b.type !== 'image'),
  })
  const formIds = new Set(forms.keys())
  let blocks = base.blocks.map(b => scrubBlock(b, allowedUrls, formIds))
  blocks = blocks.map(b => (b.type === 'form' && b.props.formId ? { ...b, props: { ...b.props, formTitle: forms.get(b.props.formId) || b.props.formTitle } } : b))
  if (brief?.action?.kind === 'form' && brief.action.formId && !blocks.some(b => b.type === 'form')) {
    blocks.splice(Math.max(1, blocks.length), 0, makeBlock('form', { props: { formId: brief.action.formId, formTitle: forms.get(brief.action.formId) || '', label: brief.action.label || 'Open the form' } }))
  }
  if (brief?.action?.kind === 'link' && !blocks.some(b => b.type === 'button')) {
    blocks.push(makeBlock('button', { props: { label: brief.action.label || 'Learn more', url: brief.action.url || '' } }))
  }
  // A header first; one signature and one footer last, in that order.
  blocks = blocks.filter(b => b.type !== 'header' && b.type !== 'signature' && b.type !== 'footer')
  const keep = (type) => base.blocks.find(b => b.type === type) || makeBlock(type)
  blocks = [keep('header'), ...blocks, keep('signature'), keep('footer')]
  return sanitizeDesign({ ...base, blocks, audience: brief?.audience || null })
}

/** One rewritten block, made safe: same type and id, only its words may change. */
export function parseRewrite(json, original, { allowedUrls = new Set() } = {}) {
  const j = json && typeof json === 'object' ? json : {}
  const got = j.block && typeof j.block === 'object' ? j.block : j
  if (!original || !BLOCKS[original.type]) throw Object.assign(new Error('No block to rewrite.'), { code: 'no_block' })
  const allowed = new Set([...allowedUrls, ...linksOf(original)])
  const merged = { ...original, props: { ...original.props, ...(got.props && typeof got.props === 'object' ? got.props : {}) } }
  // Links, the form and images are the person's: a rewrite keeps the original's, whatever came back.
  for (const k of ['url', 'link', 'imageUrl', 'formId', 'formTitle', 'date', 'dueAt', 'reminders', 'showLogo']) if (k in original.props) merged.props[k] = original.props[k]
  for (const k of ['left', 'right']) if (original.props[k]) merged.props[k] = { ...original.props[k], ...(merged.props[k] || {}), imageUrl: original.props[k].imageUrl, imageAlt: original.props[k].imageAlt }
  const out = sanitizeDesign({ blocks: [scrubBlock({ ...merged, props: { ...merged.props } }, allowed, new Set([original.props.formId].filter(Boolean)))] }).blocks[0]
  // scrubBlock clears images; put the person's own back.
  if ('imageUrl' in original.props) out.props.imageUrl = original.props.imageUrl
  for (const k of ['left', 'right']) if (original.props[k]) out.props[k].imageUrl = original.props[k].imageUrl
  return { ...out, id: original.id, style: original.style }
}

/** Links already in a block (a rewrite may keep them). */
export function linksOf(block) {
  const p = block?.props || {}
  const set = new Set()
  for (const k of ['url', 'link']) if (p[k]) set.add(p[k])
  const texts = [p.text, p.subhead, p.details, p.caption, p.left?.text, p.right?.text, ...(Array.isArray(p.items) ? p.items.map(i => i.text) : [])]
  for (const t of texts) {
    for (const m of String(t || '').matchAll(MD_LINK)) { const u = safeUrl(m[2]); if (u) set.add(u) }
    for (const m of String(t || '').match(URL_IN_TEXT) || []) { const u = safeUrl(m); if (u) set.add(u) }
  }
  return set
}

/** The block catalog as Keith reads it: each type, what it is for, and its word fields. */
export function blockCatalogForKeith() {
  const words = {
    hero: { eyebrow: 'short label above', headline: 'the headline', subhead: 'one sentence' },
    heading: { text: 'a section title' },
    text: { text: 'paragraphs; **bold**, *italic*, [label](url) only for links you were given; [First Name] merges' },
    columns: { left: '{ title, text }', right: '{ title, text }' },
    steps: { items: '2 to 4 of { title, text }' },
    quote: { text: 'the quote', cite: 'who said it' },
    button: { label: 'the button words', url: 'ONLY a link the person gave; else ""' },
    event: { title: 'event name', date: 'YYYY-MM-DD or ""', time: 'e.g. 5:30 to 6:30 PM', location: 'place or "Virtual"', details: 'one or two sentences' },
    form: { label: 'the button words', formId: 'ONLY an offered form id; else ""' },
    divider: {}, spacer: {},
  }
  return Object.entries(words).map(([type, props]) => ({ type, label: BLOCKS[type].label, purpose: BLOCKS[type].hint, props }))
}
