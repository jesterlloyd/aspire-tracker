const INTERNAL_ORIGIN = 'https://aspire.internal'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function studentDestination(studentId) {
  return UUID_PATTERN.test(studentId || '') ? `/students?student=${studentId}` : null
}

// Fail-closed allowlist for durable staff notification destinations. It accepts only the two
// application routes authored by Phase 2C and rejects external, protocol-relative, script, hash,
// credential, malformed, and route-confused values.
export function allowedStaffNotificationDestination(destUrl, studentId = null) {
  if (destUrl == null || String(destUrl).trim() === '') return studentDestination(studentId)
  const candidate = String(destUrl).trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return null

  let parsed
  try {
    parsed = new URL(candidate, INTERNAL_ORIGIN)
  } catch {
    return null
  }
  if (parsed.origin !== INTERNAL_ORIGIN || parsed.hash || parsed.username || parsed.password) return null

  if (parsed.pathname === '/rotation/preceptors' && parsed.search === '') {
    return '/rotation/preceptors'
  }
  if (parsed.pathname !== '/students') return null

  const keys = [...parsed.searchParams.keys()]
  const destinationStudentId = parsed.searchParams.get('student')
  if (keys.length !== 1 || keys[0] !== 'student' || !UUID_PATTERN.test(destinationStudentId || '')) return null
  if (studentId && destinationStudentId !== studentId) return null
  return `/students?student=${destinationStudentId}`
}

// Shared activation behavior used directly by the component and by node:test. Unread rows remain
// keyboard-actionable even when their durable destination is invalid: activation marks only that
// row read and never navigates to an unapproved location.
export function createStaffNotificationActivation(row, { onMarkRead, onNavigate } = {}) {
  const unread = !row?.in_app_read_at
  const destination = allowedStaffNotificationDestination(row?.dest_url, row?.student_id)
  const interactive = unread || !!destination

  const activate = () => {
    if (unread) onMarkRead?.([row.id])
    if (destination) onNavigate?.(destination)
  }
  const onKeyDown = (event) => {
    if (!interactive || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    activate()
  }

  return { destination, interactive, activate, onKeyDown }
}
