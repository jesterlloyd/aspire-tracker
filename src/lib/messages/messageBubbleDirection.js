export function messageAuthorRole(message) {
  return message?.author_role || message?.author_type || null
}

export function messageBubbleDirection(message, perspective = 'portal') {
  const role = messageAuthorRole(message)
  if (role === 'system') return 'neutral'
  const fromStaff = role === 'staff'
  if (perspective === 'staff') return fromStaff ? 'outgoing' : 'incoming'
  return fromStaff ? 'incoming' : 'outgoing'
}
