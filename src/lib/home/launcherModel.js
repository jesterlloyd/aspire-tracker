// HOME-1 (2026-09-24): the launcher, "What do you want to do today?"
//
// The field is the top-bar search in larger form. As the person types it offers three
// groups: ACTIONS (name and location matched, at most five), PEOPLE (students,
// preceptors, unit leaders and academic partners, at most three, each with one
// qualifier), and KEITH (always the last row: "Ask Keith: '...'"). Every action and
// person is filtered by the viewer's permissions before matching, so the list never
// offers something the viewer cannot complete. The six quick-action chips are the first
// six actions, in a fixed order (no personalization, by the brief). Pure.

// `need` is what the viewer must hold: 'manage' (active Owner or Admin), 'interview'
// (Owner, Admin or Interviewer), 'match' (Owner, Admin, Co-Lead), or 'any'.
export const ACTIONS = Object.freeze([
  { key: 'sign', title: 'Send for signature', where: 'Catalog · Signatures', to: '/catalog/signatures?tab=prepare', need: 'signatures', icon: 'sign' },
  { key: 'form', title: 'Build a form', where: 'Catalog · Forms', to: '/catalog?new=form', need: 'forms', icon: 'form' },
  { key: 'outreach', title: 'Send outreach', where: 'Connect · Outreach', to: '/connect/outreach', need: 'manage', icon: 'out' },
  { key: 'interview', title: 'Schedule an interview', where: 'Interviews', to: '/interviews?schedule=1', need: 'interview', icon: 'cal' },
  { key: 'file', title: 'Send a file', where: 'Catalog', to: '/catalog?send=1', need: 'manage', icon: 'file' },
  { key: 'contact', title: 'Add a contact', where: 'Connect · Contacts', to: '/connect/contacts?new=1', need: 'manage', icon: 'person' },
  { key: 'release', title: 'Release surveys', where: 'Evaluation · Review & Release', to: '/evaluation?workflow=caseyFinkPreRotation', need: 'manage', icon: 'rel' },
  { key: 'shift', title: 'Log a shift', where: 'Rotation · Activity', to: '/rotation/activity', need: 'any', icon: 'clock' },
  { key: 'board', title: 'Open Placement Board', where: 'Rotation', to: '/rotation/matrix', need: 'any', icon: 'board' },
  { key: 'message', title: 'Message a student', where: 'Connect · Messages', to: '/connect/messages?new=1', need: 'manage', icon: 'msg' },
  { key: 'event', title: 'Add an event', where: 'Calendar', to: '/interviews?event=new', need: 'manage', icon: 'cal' },
  { key: 'support', title: 'Reply to support messages', where: 'Connect · Messages', to: '/connect/messages', need: 'manage', icon: 'help' },
].map(Object.freeze))

export const QUICK_ACTION_KEYS = Object.freeze(['sign', 'form', 'outreach', 'interview', 'file', 'contact'])

/**
 * What the viewer may do, from the app's own flags.
 * @param {{ isAdmin, canInterview, canMatch, signatures, forms, isActive }} caps
 */
export function allowedActions(caps = {}, actions = ACTIONS) {
  const active = caps.isActive !== false
  return actions.filter(a => {
    if (!active) return false
    if (a.need === 'any') return true
    if (a.need === 'manage') return !!caps.isAdmin
    if (a.need === 'interview') return !!caps.canInterview
    if (a.need === 'match') return !!caps.canMatch
    if (a.need === 'signatures') return !!caps.isAdmin && !!caps.signatures
    if (a.need === 'forms') return !!caps.isAdmin && !!caps.forms
    return false
  })
}

export function quickActions(allowed) {
  return QUICK_ACTION_KEYS.map(k => allowed.find(a => a.key === k)).filter(Boolean)
}

/** One row per person, with the qualifier the brief asks for ("Student · Cal State LA · 4 South"). */
export function personRows({ students = [], contacts = [], unitNameFor = () => '', displayName = (s) => s?.first_name || '' } = {}) {
  const rows = []
  for (const s of students || []) {
    if (!s?.id) continue
    const unit = unitNameFor(s.matched_unit_id)
    rows.push({
      id: `student:${s.id}`, kind: 'student', name: displayName(s),
      qualifier: ['Student', s.school, unit || (s.status === 'Interviewed' ? 'Unplaced' : null)].filter(Boolean).join(' · '),
      to: `/students?student=${encodeURIComponent(s.id)}`,
      message: `/connect/messages?new=1&student=${encodeURIComponent(s.id)}`,
      form: `/catalog?send=1&student=${encodeURIComponent(s.id)}`,
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
      form: c.email ? `/catalog?send=1&contact=${encodeURIComponent(c.id)}` : null,
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
  const acts = actions.filter(a => hit(`${a.title} ${a.where}`)).slice(0, maxActions)
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

/** "Good morning", "Good afternoon", "Good evening", by the VIEWER's clock. */
export function greetingFor(now = new Date(), firstName = '') {
  const h = now.getHours()
  const word = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return firstName ? `${word}, ${firstName}` : word
}

/** "Thursday, Sep 24 · 8:46 PM", by the viewer's clock and zone. */
export function dateTimeLine(now = new Date()) {
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}
