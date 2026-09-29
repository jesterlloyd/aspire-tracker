const FULL_MESSAGES_PREFIXES = Object.freeze([
  '/connect/messages',
  '/portal/messages',
  '/portal/student/messages',
  '/portal/unit/messages',
  '/portal/ap/messages',
  '/portal/academics/messages',
])

export function isFullMessagesPath(pathname) {
  if (typeof pathname !== 'string') return false
  return FULL_MESSAGES_PREFIXES.some(prefix => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ))
}
