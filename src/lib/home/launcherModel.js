// HOME-1 (2026-09-24): the launcher, "What do you want to do today?"
//
// The field is the top-bar search in larger form. As the person types it offers three
// groups: ACTIONS (matched on name, location and everyday words, at most five), PEOPLE (students,
// preceptors, unit leaders and academic partners, at most three, each with one
// qualifier), and KEITH (always the last row: "Ask Keith: '...'"). Every action and
// person is filtered by the viewer's permissions before matching, so the list never
// offers something the viewer cannot complete. The six quick-action chips are a fixed
// list (no personalization, by the brief), topped up from a fixed fallback. Pure.

// `need` is what the viewer must hold: 'manage' (active Owner or Admin), 'interview'
// (Owner, Admin or Interviewer), 'match' (Owner, Admin, Co-Lead), 'catalog' (anyone who
// can open the Catalog: Owner, Admin, Interviewer), 'budget' (the Owner: every Budget
// Tracker write is Owner-only), or 'any'.
//
// LAUNCHER-2 (Owner, 2026-09-30): `words` is what a person might TYPE for the action
// besides its title, so "I need to upload a receipt from Resend" or "look up a phone
// number" still finds it (matchActions below). Keep them plain and specific: a word that
// belongs to three actions finds all three.
import { greetingText } from './greetings.js'

export const ACTIONS = Object.freeze([
  { key: 'sign', title: 'Send for signature', where: 'Catalog · Signatures', to: '/catalog/signatures?tab=prepare', need: 'signatures', icon: 'sign',
    words: 'sign signed signing esign e-sign docusign agreement contract consent' },
  { key: 'form', title: 'Build a form', where: 'Catalog · Forms', to: '/catalog?new=form', need: 'forms', icon: 'form',
    words: 'create make questionnaire parking scrubex' },
  { key: 'outreach', title: 'Send outreach', where: 'Connect · Outreach', to: '/connect/outreach', need: 'manage', icon: 'out',
    words: 'email emails bulk blast announce announcement newsletter mass everyone cohort students schools' },
  { key: 'interview', title: 'Schedule an interview', where: 'Interviews', to: '/interviews?filter=not_scheduled', need: 'interview', icon: 'cal',
    words: 'book booking appointment slot availability' },
  { key: 'receipt', title: 'Upload a receipt', where: 'Budget Tracker · Receipts', to: '/settings/budget?tab=receipts', need: 'budget', icon: 'receipt',
    words: 'expense expenses reimburse reimbursement concur spend spent purchase invoice subscription budget' },
  { key: 'budget', title: 'Budget Tracker', where: 'Settings · Program', to: '/settings/budget', need: 'manage', icon: 'receipt',
    words: 'budget tracker program finances money expenses expense' },
  { key: 'skills', title: 'Skills', where: 'Settings · Administration · Keith AI', to: '/settings/keith/skills', need: 'manage', icon: 'find',
    words: 'skill skills keith ai capabilities governed' },
  { key: 'findfile', title: 'Find a file', where: 'Catalog', to: '/catalog?find=1', need: 'catalog', icon: 'find',
    words: 'search look open view document documents pdf resource handout template' },
  { key: 'findcontact', title: 'Find a contact', where: 'Connect · Contacts', to: '/connect/contacts?find=1', need: 'any', icon: 'person',
    words: 'search look lookup phone number directory address' },
  { key: 'file', title: 'Send a file', where: 'Catalog', to: '/catalog?send=1', need: 'manage', icon: 'file',
    words: 'share attach document pdf resource' },
  { key: 'contact', title: 'Add a contact', where: 'Connect · Contacts', to: '/connect/contacts?new=1', need: 'manage', icon: 'add',
    words: 'new create person' },
  { key: 'release', title: 'Release surveys', where: 'Evaluation · Review & Release', to: '/evaluation?workflow=caseyFinkPreRotation', need: 'manage', icon: 'rel',
    words: 'survey casey fink feedback evaluations' },
  { key: 'shift', title: 'Log a shift', where: 'Rotation · Shift Log', to: '/rotation/activity', need: 'any', icon: 'clock',
    words: 'hours clinical rotation' },
  { key: 'board', title: 'Open Placement Board', where: 'Rotation', to: '/rotation/matrix', need: 'any', icon: 'board',
    words: 'place match matching unit units' },
  { key: 'message', title: 'Message a student', where: 'Connect · Messages', to: '/connect/messages?new=1', need: 'manage', icon: 'msg',
    words: 'text chat dm students' },
  { key: 'event', title: 'Add an event', where: 'Calendar', to: '/interviews?event=new', need: 'manage', icon: 'cal',
    words: 'town hall meeting bootcamp orientation' },
  { key: 'support', title: 'Reply to support messages', where: 'Connect · Messages', to: '/connect/messages', need: 'manage', icon: 'help',
    words: 'inbox questions' },
].map(Object.freeze))

// LAUNCHER-2 (Owner, 2026-09-30): the six chips. Build a form, Send a file and Add a
// contact left the chips (a file goes out through Outreach too, and the chips are for what
// is done most); they are still found by typing. A viewer who cannot use a chip gets the
// next one from the fallback list, in this fixed order, so the grid stays full.
export const QUICK_ACTION_KEYS = Object.freeze(['sign', 'outreach', 'interview', 'receipt', 'findfile', 'findcontact'])
export const QUICK_ACTION_FALLBACK = Object.freeze(['form', 'file', 'contact', 'release', 'shift', 'board'])

/**
 * What the viewer may do, from the app's own flags.
 * @param {{ isAdmin, isOwner, canInterview, canMatch, signatures, forms, isActive }} caps
 */
export function allowedActions(caps = {}, actions = ACTIONS) {
  const active = caps.isActive !== false
  return actions.filter(a => {
    if (!active) return false
    if (a.need === 'any') return true
    if (a.need === 'manage') return !!caps.isAdmin
    if (a.need === 'interview') return !!caps.canInterview
    if (a.need === 'match') return !!caps.canMatch
    if (a.need === 'catalog') return !!caps.isAdmin || !!caps.canInterview
    if (a.need === 'budget') return !!caps.isOwner
    if (a.need === 'signatures') return !!caps.isAdmin && !!caps.signatures
    if (a.need === 'forms') return !!caps.isAdmin && !!caps.forms
    return false
  })
}

export function quickActions(allowed, max = 6) {
  return [...QUICK_ACTION_KEYS, ...QUICK_ACTION_FALLBACK]
    .map(k => allowed.find(a => a.key === k)).filter(Boolean).slice(0, max)
}

// Words that carry no request: "I need to", "can you", "please". Dropped before matching,
// so a sentence and its two keywords find the same action.
const FILLER = new Set(('a an the to for of on in at and or with from by about my me i im we our us you your ' +
  'please pls can could would will should want wanna need needs let lets help how do does is are it this that ' +
  'some just go take get into up').split(' '))

const tokens = (text) => norm(text).split(/[^a-z0-9$@.-]+/).filter(Boolean)

/**
 * The actions a typed request asks for, best first. Each word that is not filler counts
 * when it begins one of the action's words (so "rec" finds receipt while typing) or, for
 * longer words, when one of them begins it ("receipts" finds receipt). An action is
 * offered when at least half of those words land; `strong` when every one does.
 * @returns {Array<{ action, hits, strong }>}
 */
export function matchActions(query, actions = []) {
  const words = tokens(query).filter(w => !FILLER.has(w) && w.length >= 2)
  if (!words.length) return []
  const scored = []
  actions.forEach((a, order) => {
    const vocab = tokens(`${a.title} ${a.where} ${a.words || ''}`).filter(t => !FILLER.has(t))
    const title = tokens(a.title)
    const lands = (w, list) => list.some(t => t.startsWith(w) || (t.length >= 4 && w.startsWith(t)))
    const hits = words.filter(w => lands(w, vocab)).length
    if (!hits || hits / words.length < 0.5) return
    scored.push({ action: a, hits, inTitle: words.filter(w => lands(w, title)).length, order, strong: hits === words.length })
  })
  return scored
    .sort((x, y) => y.hits - x.hits || y.inTitle - x.inTitle || x.order - y.order)
    .map(({ action, hits, strong }) => ({ action, hits, strong }))
}

/** One row per person, with the qualifier the brief asks for ("Student · Cal State LA · 4 South"). */
export function personRows({ students = [], contacts = [], preceptors = [], unitNameFor = () => '', displayName = (s) => s?.first_name || '' } = {}) {
  const rows = []
  for (const s of students || []) {
    if (!s?.id) continue
    const unit = unitNameFor(s.matched_unit_id)
    rows.push({
      id: `student:${s.id}`, kind: 'student', name: displayName(s),
      cohort_id: s.cohort_id || null,
      qualifier: ['Student', s.school, unit || (s.status === 'Interviewed' ? 'Unplaced' : null)].filter(Boolean).join(' · '),
      to: `/students?student=${encodeURIComponent(s.id)}`,
      message: `/connect/messages?new=1&student=${encodeURIComponent(s.id)}`,
      form: `/catalog?send=form&student=${encodeURIComponent(s.id)}`,
    })
  }
  const kindOf = (c) => {
    const cat = String(c?.category || '').toLowerCase()
    if (cat.includes('preceptor')) return 'Preceptor'
    if (cat.includes('unit leader')) return 'Unit leader'
    if (cat.includes('academic')) return 'Academic partner'
    return c?.category || 'Contact'
  }
  for (const c of contacts || []) {
    if (!c?.id || c.is_active === false) continue
    rows.push({
      id: `contact:${c.id}`, kind: 'contact', name: c.full_name || '',
      qualifier: [kindOf(c), c.unit_name || c.organization || c.school || null].filter(Boolean).join(' · '),
      to: `/connect/contacts?contactId=${encodeURIComponent(c.id)}`,
      message: null,
      form: c.email ? `/catalog?send=form&contact=${encodeURIComponent(c.id)}` : null,
    })
  }
  for (const p of preceptors || []) {
    if (!p?.id || !p?.full_name) continue
    rows.push({
      id: `preceptor:${p.id}`, kind: 'preceptor', name: p.full_name,
      qualifier: ['Preceptor', p.unit_name || null, p.shift_type || null].filter(Boolean).join(' · '),
      to: p.contact_id
        ? `/connect/contacts?contactId=${encodeURIComponent(p.contact_id)}`
        : '/rotation/preceptors',
      message: p.contact_id ? `/connect/messages?new=1&contactId=${encodeURIComponent(p.contact_id)}` : null,
      form: p.contact_id ? `/catalog?send=form&contact=${encodeURIComponent(p.contact_id)}` : null,
    })
  }
  return rows
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * The results for what was typed.
 * @returns {{ options: Array, groups: { actions, people, keith } }} options in listbox order
 */
export function searchLauncher(query, { actions = [], people = [], canAskKeith = true, maxActions = 5, maxPeople = 3 } = {}) {
  const q = norm(query).trim()
  if (!q) return { options: [], groups: { actions: [], people: [], keith: null } }
  const words = q.split(/\s+/)
  const hit = (text) => { const t = norm(text); return words.every(w => t.includes(w)) }
  const acts = matchActions(query, actions).slice(0, maxActions).map(m => m.action)
    .map(a => ({ id: `act:${a.key}`, kind: 'action', title: a.title, where: a.where, to: a.to, action: a }))
  const ppl = people.filter(p => hit(`${p.name} ${p.qualifier}`)).slice(0, maxPeople)
    .map(p => ({ id: p.id, kind: 'person', title: p.name, where: p.qualifier, to: p.to, person: p }))
  const keith = canAskKeith ? { id: 'keith', kind: 'keith', title: `Ask Keith: “${String(query).trim()}”`, text: String(query).trim() } : null
  return { options: [...acts, ...ppl, ...(keith ? [keith] : [])], groups: { actions: acts, people: ppl, keith } }
}

/** Up and Down wrap; the model never lets the index leave the list. */
export function moveSelection(index, delta, length) {
  if (!length) return -1
  return ((index + delta) % length + length) % length
}

/**
 * The banner's greeting, by the VIEWER's clock. GREETINGS-1 (Owner, 2026-10-04):
 * a rotating set adapted from Claude's, by part of the day and weekday; the rule
 * is ./greetings.js, which is the same file as Skyline's src/lib/greetings.js.
 */
export function greetingFor(now = new Date(), firstName = '') {
  return greetingText(now, firstName)
}

/** "Thursday, Sep 24 · 8:46 PM", by the viewer's clock and zone. */
export function dateTimeLine(now = new Date()) {
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

// The launcher follows the place shown by Skyline when the service tells the host
// which city is active. Until that event arrives, the viewer's clock is the honest
// fallback. Keep the copy short because it is also used in compact taskbar fields.
export function launcherPromptFor(now = new Date(), timeZone = null) {
  let hour = now.getHours()
  if (timeZone) {
    const hourText = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(now)
    hour = Number(hourText)
  }
  const period = hour < 5 ? 'tonight'
    : hour < 12 ? 'this morning'
    : hour < 17 ? 'this afternoon'
    : hour < 21 ? 'this evening'
    : 'tonight'
  return `What do you want to do ${period}?`
}
