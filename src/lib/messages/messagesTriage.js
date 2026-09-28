// src/lib/messages/messagesTriage.js
//
// MESSAGES-SIMPLIFY-1: the staff Messages rules, pure and shared by the inbox
// rows, the chips, the thread banner, At a Glance > Needs you and the Action
// Center. These are derived states, never stored flags.
//
// Needs reply = not Done AND (flagged for follow-up OR a participant wrote last
// and no staff member reacted to that message). The server computes it
// (messages_staff_triage, migration 20261014000000) and sends `needs_reply` and
// `is_done` on every row. Before that migration is applied the row carries
// neither, and the legacy fields decide the same question as closely as they
// can: a reaction cannot be seen there, so a reacted thread still reads as
// needing a reply until the migration lands.

export function isDone(item) {
  if (typeof item?.is_done === 'boolean') return item.is_done
  return item?.status === 'resolved' || item?.is_archived === true
}

export function needsReply(item) {
  if (typeof item?.needs_reply === 'boolean') return item.needs_reply
  if (isDone(item)) return false
  if (item?.follow_up_flagged === true) return true
  return Boolean(item?.latest_author_role) && item.latest_author_role !== 'staff'
}

// "Krystal Rodriguez" -> "K. Rodriguez". One word stays whole.
export function shortName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts[0][0]}. ${parts[parts.length - 1]}`
}

export function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || ''
}

// The row preview's lead-in: who wrote the latest message, from the viewer's
// point of view.
export function previewPrefix(row, viewerId) {
  if (!row?.latest_author_role || row.latest_author_role !== 'staff') return 'They wrote · '
  if (!row.latest_author_profile_id || row.latest_author_profile_id === viewerId) return 'You replied · '
  const name = shortName(row.latest_author_name)
  return name ? `${name} replied · ` : 'You replied · '
}

// The one chip a row shows: Needs reply, else who handled it last.
export function rowChip(row) {
  if (needsReply(row)) return { kind: 'needs', label: 'Needs reply' }
  const name = shortName(row?.handled_by_name)
  return name ? { kind: 'by', label: `Replied by ${name}` } : null
}

export function ageInDays(value, now = new Date()) {
  const then = value instanceof Date ? value : new Date(value)
  const current = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(then.getTime()) || Number.isNaN(current.getTime())) return null
  return Math.max(0, Math.floor((current.getTime() - then.getTime()) / 86400000))
}

function ago(days) {
  if (!days) return 'today'
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

// A staff reaction on a message: an identified staff reactor (thread v5), or
// the viewer's own reaction (the viewer on this surface is always staff).
export function hasStaffReaction(message) {
  if (Array.isArray(message?.reactors) && message.reactors.some((r) => r?.is_staff)) return true
  return Array.isArray(message?.reactions) && message.reactions.some((r) => r?.mine && r.count > 0)
}

// A participant wrote last and no staff member has reacted to it.
export function participantWaiting(latestMessage) {
  if (!latestMessage) return false
  if (latestMessage.author_role === 'staff') return false
  return !hasStaffReaction(latestMessage)
}

// Who handled the thread last. The server's answer, except where the viewer has
// just reacted to the latest participant message and the refetch has not
// landed yet.
export function handledByName(conversation, latestMessage, viewer) {
  const viewerReacted = latestMessage
    && latestMessage.author_role !== 'staff'
    && ((latestMessage.reactions || []).some((r) => r?.mine)
      || (latestMessage.reactors || []).some((r) => viewer?.id && r?.profile_id === viewer.id))
  if (viewerReacted && viewer?.full_name) return viewer.full_name
  return conversation?.handled_by_name || null
}

// The status banner above the thread. Updates itself from the loaded messages,
// so a reaction or a reply changes it without waiting for a refetch.
export function threadBanner(conversation, latestMessage, viewer, now = new Date()) {
  if (isDone(conversation)) {
    // `short` is the compact header's one line (MESSAGES-REFINE-2).
    return {
      kind: 'done',
      label: 'Done · moved out of your list. It reopens if the student writes again.',
      short: 'Done · reopens if they write again',
    }
  }
  if (participantWaiting(latestMessage)) {
    const days = ageInDays(latestMessage.created_at, now)
    return { kind: 'needs', label: `Needs reply · they wrote ${ago(days)}` }
  }
  if (conversation?.follow_up_flagged) {
    return { kind: 'needs', label: 'Needs reply · flagged for follow-up' }
  }
  const name = handledByName(conversation, latestMessage, viewer)
  return {
    kind: 'answered',
    label: name ? `Answered by ${name} · no reply needed` : 'Answered · no reply needed',
  }
}

// Who may react to what: staff react to participant messages, participants to
// staff messages, and nobody to their own. `perspective` is the surface.
export function canReactTo(message, perspective) {
  const role = message?.author_role || message?.author_type || null
  if (!role || role === 'system') return false
  const fromStaff = role === 'staff'
  return perspective === 'staff' ? !fromStaff : fromStaff
}
