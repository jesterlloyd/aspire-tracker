// src/lib/studio/studioBlocks.js
//
// STUDIO-1 (2026-11-05): the rules of a Studio design, pure. ASPIRE Connect > Studio stores a
// design as blocks (JSON), never as HTML; this module says which blocks exist, which properties
// and styles each one may carry, what a theme is, and what a design must have before it may be
// sent. The browser (canvas, inspector) and the server (the send path) read the SAME module, so
// the editor cannot offer what the sender would refuse.
//
// Explicit .js extensions: imported by the Vite client and by the Node test runner.

import { validateButtonUrl } from '../connect/buttonUrl.js'
import { sanitizeRule } from './audienceCatalog.js'

export const STUDIO_VERSION = 1
export const MAX_BLOCKS = 40
export const SUBJECT_MAX = 200
export const PREHEADER_MAX = 140
export const NAME_MAX = 120

// ── Themes ──────────────────────────────────────────────────────────────────────
// A theme is a palette, two typefaces and spacing. Every pair a theme puts text on is held at
// 4.5:1 or better by test/studio.test.mjs. Fonts are email-safe stacks: a webfont never loads in
// Outlook, and the canvas must show what the inbox shows.
export const FONT_STACKS = Object.freeze({
  serif: "Georgia, 'Times New Roman', Times, serif",
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
})

export const THEMES = Object.freeze({
  navy: Object.freeze({
    id: 'navy', label: 'ASPIRE Navy',
    page: '#F4F1EC', surface: '#FFFFFF', ink: '#2B2F3A', muted: '#5B6472',
    heading: '#1D2567', accent: '#1D2567', accentInk: '#FFFFFF',
    rule: '#C9B27A', panel: '#F7F5F0', panelInk: '#2B2F3A',
    heroBg: '#1D2567', heroInk: '#FFFFFF', heroMuted: '#DDE1F0', heroEyebrow: '#C9B27A',
    button: '#DC1E34', buttonInk: '#FFFFFF', link: '#1D2567',
    headingFont: 'serif', bodyFont: 'sans',
  }),
  forest: Object.freeze({
    id: 'forest', label: 'Residency Forest',
    page: '#EEF2EC', surface: '#FFFFFF', ink: '#26302A', muted: '#55625A',
    heading: '#2F5D50', accent: '#2F5D50', accentInk: '#FFFFFF',
    rule: '#B9C9A8', panel: '#F3F6F1', panelInk: '#26302A',
    heroBg: '#2F5D50', heroInk: '#FFFFFF', heroMuted: '#DCE8E1', heroEyebrow: '#E3EBCF',
    button: '#2F5D50', buttonInk: '#FFFFFF', link: '#2F5D50',
    headingFont: 'serif', bodyFont: 'sans',
  }),
  paper: Object.freeze({
    id: 'paper', label: 'Warm Paper',
    page: '#EFE9DF', surface: '#FFFDF9', ink: '#33302B', muted: '#635C52',
    heading: '#6B3F1F', accent: '#6B3F1F', accentInk: '#FFFFFF',
    rule: '#D9C7A6', panel: '#F6F0E6', panelInk: '#33302B',
    heroBg: '#F6F0E6', heroInk: '#33302B', heroMuted: '#5A5248', heroEyebrow: '#8A5A2B',
    button: '#1D2567', buttonInk: '#FFFFFF', link: '#6B3F1F',
    headingFont: 'serif', bodyFont: 'sans',
  }),
})
export const DEFAULT_THEME = 'navy'
export const themeFor = (id) => THEMES[id] || THEMES[DEFAULT_THEME]

// The swatches the inspector offers. A block may also keep 'theme' (follow the theme).
export const SWATCHES = Object.freeze([
  '#1D2567', '#141A4D', '#2F5D50', '#6B3F1F', '#DC1E34', '#C9B27A',
  '#F4F1EC', '#F7F5F0', '#EEF2FB', '#FFFFFF', '#2B2F3A', '#5B6472',
])

// ── Block catalog ───────────────────────────────────────────────────────────────
// props: the words and links (Content tab). style: the look (Style tab). Each style key lists its
// legal values; 'color' means a #RRGGBB hex or 'theme'. Anything not listed is dropped.
const COLOR = 'color'
const enumOf = (...v) => Object.freeze(v)

export const BLOCKS = Object.freeze({
  header: {
    label: 'Header', group: 'Layout', hint: 'Wordmark or logo',
    // STUDIO-LOGO-1 (Owner, 2026-11-05): every header opens on the Cedars-Sinai logo and the institute's full name.
    props: { title: 'ASPIRE · CEDARS-SINAI', tagline: 'Geri & Richard Brawerman Nursing Institute', showLogo: true },
    style: { bg: 'theme', align: 'split' },
    styleRules: { bg: COLOR, align: enumOf('split', 'center', 'left') },
  },
  hero: {
    label: 'Hero', group: 'Content', hint: 'Headline on colour or photo',
    props: { eyebrow: 'ASPIRE', headline: 'Your headline goes here', subhead: 'One sentence that says why this matters.', imageUrl: '', imageAlt: '' },
    style: { bg: 'theme', ink: 'theme', rule: 'theme', align: 'left', font: 'theme', pad: 'l' },
    styleRules: { bg: COLOR, ink: COLOR, rule: COLOR, align: enumOf('left', 'center'), font: enumOf('theme', 'serif', 'sans'), pad: enumOf('s', 'm', 'l') },
  },
  heading: {
    label: 'Heading', group: 'Content', hint: 'A section title',
    props: { text: 'Section title' },
    style: { align: 'left', font: 'theme', size: 'm', ink: 'theme' },
    styleRules: { align: enumOf('left', 'center'), font: enumOf('theme', 'serif', 'sans'), size: enumOf('s', 'm', 'l'), ink: COLOR },
  },
  text: {
    label: 'Text', group: 'Content', hint: 'Paragraphs, bold, links',
    props: { text: 'Hi [First Name],\n\nWrite your message here. Use **bold**, *italic* and [a link](https://www.cedars-sinai.org).' },
    style: { align: 'left', size: 'm', bg: 'theme', ink: 'theme' },
    styleRules: { align: enumOf('left', 'center'), size: enumOf('s', 'm', 'l'), bg: COLOR, ink: COLOR },
  },
  image: {
    label: 'Image', group: 'Content', hint: 'A photo or graphic',
    props: { url: '', alt: '', link: '', caption: '' },
    style: { width: 'full', radius: 'none' },
    styleRules: { width: enumOf('full', 'inset'), radius: enumOf('none', 'soft') },
  },
  columns: {
    label: 'Two columns', group: 'Content', hint: 'Side by side, stacks on a phone',
    props: {
      left: { imageUrl: '', imageAlt: '', title: 'Left title', text: 'A short paragraph.' },
      right: { imageUrl: '', imageAlt: '', title: 'Right title', text: 'A short paragraph.' },
    },
    style: { bg: 'theme', ink: 'theme' },
    styleRules: { bg: COLOR, ink: COLOR },
  },
  steps: {
    label: 'Steps', group: 'Content', hint: 'Numbered cards',
    props: { items: [
      { title: 'First step', text: 'What to do first.' },
      { title: 'Second step', text: 'What comes next.' },
      { title: 'Third step', text: 'How to finish.' },
    ] },
    style: { bg: 'theme', accent: 'theme' },
    styleRules: { bg: COLOR, accent: COLOR },
  },
  quote: {
    label: 'Quote', group: 'Content', hint: 'A voice worth hearing',
    props: { text: 'A sentence from a student, preceptor or leader.', cite: 'Name, Role' },
    style: { accent: 'theme', font: 'theme' },
    styleRules: { accent: COLOR, font: enumOf('theme', 'serif', 'sans') },
  },
  button: {
    label: 'Button', group: 'Action', hint: 'One clear action',
    props: { label: 'Learn more', url: '' },
    style: { bg: 'theme', ink: 'theme', align: 'center', shape: 'rounded', width: 'auto' },
    styleRules: { bg: COLOR, ink: COLOR, align: enumOf('left', 'center'), shape: enumOf('rounded', 'pill', 'square'), width: enumOf('auto', 'full') },
  },
  event: {
    label: 'Event card', group: 'Action', hint: 'Date, time and place',
    props: { title: 'Event title', date: '', time: '', location: '', details: '' },
    style: { accent: 'theme' },
    styleRules: { accent: COLOR },
  },
  form: {
    label: 'Catalog form', group: 'Action', hint: 'A personal link for each person',
    props: { formId: '', formTitle: '', label: 'Sign up', dueAt: '', reminders: '' },
    style: { bg: 'theme', ink: 'theme', align: 'center', shape: 'rounded', width: 'auto' },
    styleRules: { bg: COLOR, ink: COLOR, align: enumOf('left', 'center'), shape: enumOf('rounded', 'pill', 'square'), width: enumOf('auto', 'full') },
  },
  divider: {
    label: 'Divider', group: 'Layout', hint: 'A quiet rule',
    props: {},
    style: { color: 'theme', width: 'full' },
    styleRules: { color: COLOR, width: enumOf('full', 'short') },
  },
  spacer: {
    label: 'Spacer', group: 'Layout', hint: 'Breathing room',
    props: {},
    style: { size: 'm' },
    styleRules: { size: enumOf('s', 'm', 'l') },
  },
  signature: {
    label: 'Signature', group: 'Layout', hint: 'Your Connect signature',
    props: { signOff: 'Kind regards,' },
    style: {},
    styleRules: {},
  },
  footer: {
    label: 'Footer', group: 'Layout', hint: 'Why they received it',
    props: { text: 'You are receiving this because you are part of ASPIRE at Cedars-Sinai.\nQuestions? Email aspire@cshs.org.' },
    style: { align: 'center' },
    styleRules: { align: enumOf('center', 'left') },
  },
})
export const BLOCK_TYPES = Object.freeze(Object.keys(BLOCKS))
export const BLOCK_GROUPS = Object.freeze(['Content', 'Action', 'Layout'])

// Field caps. A design is words, not a document; these keep a send well under the endpoint's limit.
const CAP = { short: 160, long: 4000, url: 2000 }
const PROP_CAPS = {
  title: CAP.short, tagline: CAP.short, eyebrow: CAP.short, headline: 240, subhead: 600,
  text: CAP.long, label: 80, cite: CAP.short, location: 240, details: 1200, time: 80,
  caption: 300, alt: 240, imageAlt: 240, signOff: 80, formTitle: CAP.short, reminders: 40,
}

const HEX = /^#[0-9a-f]{6}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const str = (v, cap) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').slice(0, cap)

/** A safe https: or mailto: link, or '' when it cannot be made safe. */
export function safeUrl(raw) {
  const v = String(raw == null ? '' : raw).trim()
  if (!v) return ''
  const r = validateButtonUrl(v)
  return r.ok ? r.url.slice(0, CAP.url) : ''
}

/** A safe image address: https only (an email cannot show anything else). */
export function safeImageUrl(raw) {
  const v = String(raw == null ? '' : raw).trim()
  return /^https:\/\/[^\s"'<>]+$/i.test(v) ? v.slice(0, CAP.url) : ''
}

let seq = 0
export function newBlockId() {
  seq = (seq + 1) % 1e6
  return `b${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A fresh block of a type with its defaults (a deep copy). */
export function makeBlock(type, overrides = {}) {
  const def = BLOCKS[type]
  if (!def) throw new Error(`Unknown block type: ${type}`)
  return {
    id: newBlockId(), type,
    props: { ...structuredCloneSafe(def.props), ...(overrides.props || {}) },
    style: { ...def.style, ...(overrides.style || {}) },
  }
}

function structuredCloneSafe(v) { return JSON.parse(JSON.stringify(v ?? {})) }

function cleanColumn(c) {
  const o = c && typeof c === 'object' ? c : {}
  return {
    imageUrl: safeImageUrl(o.imageUrl), imageAlt: str(o.imageAlt, PROP_CAPS.imageAlt),
    title: str(o.title, CAP.short), text: str(o.text, 1200),
  }
}

function cleanProps(type, raw) {
  const def = BLOCKS[type]
  const p = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const key of Object.keys(def.props)) {
    const v = p[key]
    switch (key) {
      case 'url':
        out.url = type === 'image' ? safeImageUrl(v) : safeUrl(v); break
      case 'imageUrl': out.imageUrl = safeImageUrl(v); break
      case 'link': out.link = safeUrl(v); break
      case 'showLogo': out.showLogo = v === true; break
      case 'date': out.date = DATE.test(String(v || '')) ? String(v) : ''; break
      case 'dueAt': out.dueAt = DATE.test(String(v || '')) ? String(v) : ''; break
      case 'formId': out.formId = UUIDISH.test(String(v || '')) ? String(v) : ''; break
      case 'left': case 'right': out[key] = cleanColumn(v); break
      case 'items':
        out.items = (Array.isArray(v) ? v : []).slice(0, 4).map(i => ({
          title: str(i?.title, CAP.short), text: str(i?.text, 600),
        }))
        break
      default:
        out[key] = str(v ?? def.props[key], PROP_CAPS[key] || CAP.long)
    }
  }
  return out
}

function cleanStyle(type, raw) {
  const def = BLOCKS[type]
  const s = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const [key, rule] of Object.entries(def.styleRules)) {
    const v = s[key]
    if (rule === COLOR) out[key] = (v === 'theme' || HEX.test(String(v || ''))) ? String(v) : def.style[key]
    else out[key] = rule.includes(v) ? v : def.style[key]
  }
  return out
}

/**
 * The one gate every design passes, in the browser and on the server. Unknown blocks, keys and
 * unsafe links are dropped, never guessed. Returns a new object; the input is not changed.
 */
export function sanitizeDesign(raw) {
  const d = raw && typeof raw === 'object' ? raw : {}
  const blocks = (Array.isArray(d.blocks) ? d.blocks : [])
    .filter(b => b && BLOCKS[b.type])
    .slice(0, MAX_BLOCKS)
    .map(b => ({
      id: /^[a-z0-9]{4,40}$/i.test(String(b.id || '')) ? String(b.id) : newBlockId(),
      type: b.type,
      props: cleanProps(b.type, b.props),
      style: cleanStyle(b.type, b.style),
    }))
  return {
    version: STUDIO_VERSION,
    theme: THEMES[d.theme] ? d.theme : DEFAULT_THEME,
    subject: str(d.subject, SUBJECT_MAX).replace(/\n/g, ' '),
    preheader: str(d.preheader, PREHEADER_MAX).replace(/\n/g, ' '),
    blocks,
    // STUDIO-3: Keith's proposed audience and his provenance ride with the design when present.
    // The audience is only a proposal: the send drawer shows it and the person approves it.
    ...(d.audience && typeof d.audience === 'object' ? { audience: sanitizeRule(d.audience) } : {}),
    ...(d.keith && /^[0-9a-f-]{36}$/i.test(String(d.keith.provenanceId || '')) ? { keith: { provenanceId: String(d.keith.provenanceId) } } : {}),
  }
}

/** Parse a stored or posted design (object or JSON string). Throws on unreadable input. */
export function parseDesign(input) {
  const obj = typeof input === 'string' ? JSON.parse(input) : input
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.blocks)) throw new Error('This is not a Studio design.')
  return sanitizeDesign(obj)
}

/**
 * What stops a send, and what only deserves a look. `blocking` disables Send (client) and refuses
 * the request (server); `warnings` are shown and never block. A link is never invented: a button
 * with no link blocks the send, which is how a missing application link stays visible.
 */
// Names for the swatches, shown on hover and read by screen readers (STUDIO-PANES-2).
export const SWATCH_NAMES = Object.freeze({
  '#1D2567': 'ASPIRE Navy', '#141A4D': 'Nightfall', '#2F5D50': 'Forest', '#6B3F1F': 'Cognac',
  '#DC1E34': 'Cedars Red', '#C9B27A': 'Gold', '#F4F1EC': 'Sand', '#F7F5F0': 'Pearl',
  '#EEF2FB': 'Mist', '#FFFFFF': 'White', '#2B2F3A': 'Charcoal', '#5B6472': 'Slate',
})

/**
 * What one block still needs before it can be sent, short enough to print on the canvas
 * ("Needs a link") and long enough to stand alone in the list. level 'blocking' stops the send.
 */
export function blockIssues(block) {
  const b = block
  const out = []
  if (!b || !BLOCKS[b.type]) return out
  const p = b.props || {}
  const add = (level, short, text) => out.push({ level, short, text })
  if (b.type === 'button' && !p.url) add('blocking', 'Needs a link', 'needs a link.')
  if (b.type === 'button' && !String(p.label || '').trim()) add('blocking', 'Needs a label', 'needs a label.')
  if (b.type === 'form' && !p.formId) add('blocking', 'Needs a form', 'needs a Catalog form.')
  if (b.type === 'image' && !p.url) add('blocking', 'Needs an image', 'needs an image.')
  if (b.type === 'image' && p.url && !String(p.alt || '').trim()) add('warning', 'No alt text', 'has no alt text. Screen readers and blocked images show nothing.')
  if (b.type === 'hero' && p.imageUrl && !String(p.imageAlt || '').trim()) add('warning', 'No alt text', 'has a photo with no alt text.')
  if (b.type === 'event' && !p.date) add('warning', 'No date', 'has no date.')
  return out
}

/**
 * Everything to fix before a send. blocking and warnings are the sentences (the server refuses
 * a send with any blocking one); items carries the same list with what each one points at, so
 * the editor can jump to the block or the field.
 */
export function designProblems(design) {
  const d = sanitizeDesign(design)
  const items = []
  if (!d.subject.trim()) items.push({ level: 'blocking', text: 'Add a subject line.', field: 'subject' })
  if (!d.blocks.length) items.push({ level: 'blocking', text: 'Add at least one block.' })
  d.blocks.forEach((b, i) => {
    const n = `${BLOCKS[b.type].label} (block ${i + 1})`
    for (const it of blockIssues(b)) items.push({ level: it.level, text: `${n} ${it.text}`, blockId: b.id })
  })
  if (!d.blocks.some(b => b.type === 'footer')) items.push({ level: 'warning', text: 'There is no footer saying why people received this.' })
  if (d.preheader.trim() === '') items.push({ level: 'warning', text: 'There is no preview text. Inboxes will show the first words instead.', field: 'preheader' })
  const blocking = items.filter(x => x.level === 'blocking').map(x => x.text)
  const warnings = items.filter(x => x.level === 'warning').map(x => x.text)
  return { blocking, warnings, items }
}

// ── Contrast (WCAG 2.1) ─────────────────────────────────────────────────────────
function channel(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
export function luminance(hex) {
  const h = String(hex || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(h)) return 1
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100
}

/** The colour a block actually paints, resolving 'theme' to the theme's value. */
export function resolveColor(value, fallback) {
  return value && value !== 'theme' ? value : fallback
}

/** The text-on-ground pairs a block paints, for the inspector's Readability line. */
export function blockColorPairs(block, themeId) {
  const t = themeFor(themeId)
  const s = block?.style || {}
  switch (block?.type) {
    case 'hero': return [{ label: 'Headline', ink: resolveColor(s.ink, t.heroInk), bg: resolveColor(s.bg, t.heroBg) }]
    case 'text': return [{ label: 'Text', ink: resolveColor(s.ink, t.ink), bg: resolveColor(s.bg, t.surface) }]
    case 'heading': return [{ label: 'Heading', ink: resolveColor(s.ink, t.heading), bg: t.surface }]
    case 'columns': return [{ label: 'Text', ink: resolveColor(s.ink, t.ink), bg: resolveColor(s.bg, t.surface) }]
    case 'steps': return [{ label: 'Step text', ink: t.panelInk, bg: resolveColor(s.bg, t.panel) }]
    case 'button': case 'form': return [{ label: 'Label', ink: resolveColor(s.ink, t.buttonInk), bg: resolveColor(s.bg, t.button) }]
    default: return []
  }
}

/** A starting point for a blank design. */
export function blankDesign(theme = DEFAULT_THEME) {
  return sanitizeDesign({ theme, subject: '', preheader: '', blocks: [makeBlock('header'), makeBlock('text'), makeBlock('signature'), makeBlock('footer')] })
}
