const FULL_MESSAGES_PREFIXES = Object.freeze([
  '/connect/messages',
  '/portal/messages',
  '/portal/student/messages',
  '/portal/unit/messages',
  '/portal/ap/messages',
  '/portal/academics/messages',
  // PORTAL-CONNECT-1: the NE&L Portal's Messages moved under its Connect; the old path still resolves.
  '/portal/academics/connect/messages',
])

export function isFullMessagesPath(pathname) {
  if (typeof pathname !== 'string') return false
  return FULL_MESSAGES_PREFIXES.some(prefix => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ))
}
