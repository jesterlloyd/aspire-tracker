const DAY = 86_400_000

export const ACTION_CENTER_GROUPS = Object.freeze([
  { key: 'signatures', label: 'Signatures', icon: 'S' },
  { key: 'messages', label: 'Messages', icon: 'M' },
  { key: 'review-release', label: 'Review & Release', icon: 'R' },
  { key: 'forms', label: 'Forms and documents', icon: 'F' },
  { key: 'interviews', label: 'Interviews', icon: 'I' },
  { key: 'placement', label: 'Placement and rotation', icon: 'P' },
])

export const ACTION_CENTER_GROUP_ORDER = Object.freeze(
  Object.fromEntries(ACTION_CENTER_GROUPS.map((g, index) => [g.key, index])),
)

export function firstNameFirst(person) {
  const first = String(person?.preferred_first_name || person?.first_name || '').trim()
  const last = String(person?.last_name || '').trim()
  return [first, last].filter(Boolean).join(' ') || String(person?.name || person?.full_name || '').trim()
}

export function agePill(age, now = Date.now()) {
  const time = typeof age === 'number' ? age : new Date(age || 0).getTime()
  if (!Number.isFinite(time) || time <= 0) return ''
  const days = Math.floor(Math.max(0, now - time) / DAY)
  return days < 1 ? 'Today' : `${days}d`
}

function isoFromAgeMs(ageMs, now) {
  const wait = Number(ageMs)
  return new Date(now - (Number.isFinite(wait) && wait > 0 ? wait : 0)).toISOString()
}

function homeGroupKey(key) {
  if (key === 'reviewRelease') return 'review-release'
  if (key === 'formsDocs') return 'forms'
  return key
}

function stateText(row) {
  const text = row?.pill?.text || ''
  return /^(Your turn|Blocked|No slot|Unplaced)$/i.test(text) || /^\d+ ready$/i.test(text) ? text : null
}

function actionsFor({ group, row, conversation, student }) {
  if (group === 'signatures') return [
    { key: 'open', label: 'Sign', primary: true },
    { key: 'snooze', label: 'Snooze' },
  ]
  if (group === 'messages') {
    if (row.id.startsWith('support:')) {
      return row.classification === 'needs_look'
        ? [{ key: 'support_open', label: 'Open as request', primary: true }, { key: 'support_close', label: 'Close: no help needed' }]
        : [{ key: 'open', label: 'Reply', primary: true }, { key: 'support_close', label: 'Close: no help needed' }, { key: 'snooze', label: 'Snooze' }]
    }
    const out = []
    if (!conversation?.assigned_staff_profile_id) out.push({ key: 'assign', label: 'Assign to me', primary: true })
    out.push({ key: 'reply', label: 'Reply', primary: out.length === 0 })
    out.push({ key: 'resolve', label: 'Close: no help needed' })
    out.push({ key: 'snooze', label: 'Snooze' })
    return out
  }
  if (group === 'review-release') {
    return row?.pill?.text === 'Blocked'
      ? [{ key: 'open', label: 'Open', primary: true }]
      : [{ key: 'open', label: 'Release', primary: true }, { key: 'snooze', label: 'Snooze' }]
  }
  if (group === 'forms') return [
    { key: 'reminder', label: 'Send reminder', primary: true },
    { key: 'snooze', label: 'Snooze' },
  ]
  if (group === 'interviews') {
    return row.id.startsWith('iv-open:')
      ? [{ key: 'booking', label: 'Send booking link', primary: true, student }, { key: 'snooze', label: 'Snooze' }]
      : [{ key: 'open', label: 'Open', primary: true }]
  }
  return [{ key: 'open', label: 'Open', primary: true }]
}

export function normalizeHomeQueue({ groups = [], conversations = [], students = [], cohortId = null, now = Date.now() } = {}) {
  const conversationById = new Map(conversations.map(c => [String(c.id), c]))
  const studentById = new Map(students.map(s => [String(s.id), s]))
  const items = []
  for (const source of groups.filter(Boolean)) {
    const group = homeGroupKey(source.key)
    for (const row of source.allRows || source.rows || []) {
      const rawId = String(row.id || '')
      const entityId = rawId.replace(/^[^:]+:/, '')
      const conversation = group === 'messages' ? conversationById.get(entityId) : null
      const student = group === 'interviews' && rawId.startsWith('iv-open:') ? studentById.get(entityId) : null
      const personal = group === 'messages' || group === 'signatures'
      const chip = group === 'signatures' ? 'Sign'
        : group === 'messages' ? 'Reply'
          : group === 'review-release' ? 'Release'
            : group === 'forms' ? 'Overdue'
              : group === 'interviews' ? 'Schedule' : 'Placement'
      const tag = conversation?.assigned_staff_profile_id ? 'reply'
        : group === 'messages' ? 'unassigned'
          : String(row.pill?.text || '').toLowerCase()
      const title = conversation?.participant_name || String(row.title || '').split(' · ')[0]
      const qualifier = conversation?.subject || String(row.title || '').split(' · ').slice(1).join(' · ')
      const unread = Number(conversation?.unread_count) || 1
      const meta = conversation
        ? `${unread} message${unread === 1 ? '' : 's'} · ${conversation.subject || 'No subject'}`
        : row.meta || ''
      const age = conversation?.last_message_at || isoFromAgeMs(row.ageMs, now)
      items.push({
        key: rawId, entityId, group, chip, tag, title, qualifier, meta,
        quote: conversation?.latest_preview || null,
        age, ageLabel: stateText(row) || agePill(age, now),
        personal, cohort: personal ? null : cohortId,
        actions: actionsFor({ group, row, conversation, student }),
        href: row.to, urgent: false, source: row, conversation, student,
      })
    }
  }
  return sortQueue(items)
}

export function normalizeSupportQueue({ logs = [], events = [], students = [], now = Date.now() } = {}) {
  const latest = new Map()
  for (const event of events) {
    const prior = latest.get(event.shift_log_id)
    if (!prior || new Date(event.created_at) > new Date(prior.created_at)
      || (event.created_at === prior.created_at && String(event.id) > String(prior.id))) {
      latest.set(event.shift_log_id, event)
    }
  }
  const studentById = new Map(students.map(s => [s.id, s]))
  const open = []
  const closed = []
  for (const log of logs) {
    const event = latest.get(log.id)
    if (!event) continue
    const student = studentById.get(log.student_id)
    const name = firstNameFirst(student) || 'Student'
    const reply = String(log.support_needed || '').trim()
    const row = {
      id: `support:${log.id}`, classification: event.classification,
      title: name, pill: { text: event.classification === 'needs_look' ? 'Needs a look' : null },
    }
    if (event.status === 'closed_auto') {
      if (now - new Date(event.created_at).getTime() <= 7 * DAY) closed.push({
        key: row.id, shiftLogId: log.id, title: name, reply, createdAt: event.created_at,
      })
      continue
    }
    if (event.status === 'closed_staff') continue
    const urgent = event.classification === 'urgent'
    open.push({
      key: row.id, group: 'messages', chip: 'Reply',
      tag: urgent ? 'urgent' : event.classification === 'needs_look' ? 'needs a look' : 'reply',
      title: name, qualifier: log.unit_name || '',
      meta: log.shift_date ? `Check-in reply · ${new Date(`${log.shift_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Check-in reply',
      quote: reply, age: event.created_at, ageLabel: agePill(event.created_at, now),
      personal: true, cohort: null, urgent,
      actions: actionsFor({ group: 'messages', row }),
      href: `/rotation/activity?student=${encodeURIComponent(log.student_id)}&shift=${encodeURIComponent(log.id)}`,
      studentId: log.student_id, shiftLogId: log.id, source: row,
    })
  }
  return { open: sortQueue(open), closed: closed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) }
}

export function sortQueue(items = []) {
  return items.slice().sort((a, b) => {
    if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1
    const group = (ACTION_CENTER_GROUP_ORDER[a.group] ?? 99) - (ACTION_CENTER_GROUP_ORDER[b.group] ?? 99)
    if (group) return group
    return new Date(a.age || 0) - new Date(b.age || 0) || String(a.title).localeCompare(String(b.title))
  })
}

export function applySnoozes(items = [], snoozes = [], now = Date.now()) {
  const hidden = new Set(snoozes
    .filter(s => new Date(s.snoozed_until).getTime() > now)
    .map(s => s.item_key))
  return items.filter(item => !hidden.has(item.key))
}

export function groupQueue(items = []) {
  return ACTION_CENTER_GROUPS.map(group => ({
    ...group,
    items: items.filter(item => item.group === group.key),
  })).filter(group => group.items.length)
}

export function chipCounts(items = []) {
  const order = ['Sign', 'Reply', 'Release', 'Overdue', 'Schedule', 'Placement']
  return order.map(chip => ({ chip, count: items.filter(item => item.chip === chip).length })).filter(x => x.count)
}
