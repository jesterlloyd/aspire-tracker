// ACCOUNTS-KPI-SORT-1: pure sorting for the Portal Access table.
//
// No React, no I/O - the directory component and the tests import the same source of
// truth. Sorting is CLIENT-SIDE over the server-filtered result set (the endpoint
// returns at most its MAX_LIMIT rows; at ASPIRE's account scale the full set fits in
// one page), applied after the expiring-soon client filter and before pagination
// slicing, so it composes with search and every filter.
//
// Rules (Owner-approved design):
//   - One active sort at a time; a deterministic secondary sort (name A-Z, then
//     email) breaks every tie, so equal values never jitter between renders.
//   - Each column has a RECOMMENDED initial direction (dates open on their useful
//     end: Last Login newest first, Expiration soonest first); clicking the active
//     column toggles the direction.
//   - Null dates sort LAST in both directions: 'Never logged in' is a null
//     last_login_at, and no-expiration grants are a null expires_at. A missing value
//     is an absence, not a very small date.

// Explicit .js extension so node-based tests can import this module directly.
import { PORTAL_ROLE_LABELS, summarizeScope } from './portalAccessStatus.js'

// SETTINGS-UNIFIED-DESIGN-1: the alphabetical-by-name comparator shared by both Accounts &
// Access directories (staff and portal), and this module's deterministic secondary sort.
// Moved here (ACCOUNTS-KPI-SORT-1) from accountsShared.jsx, which re-exports it, so node
// tests import the real function instead of regex-extracting it from a JSX file. Falls back
// to email when a display name is missing, then ties on email, so ordering is always
// deterministic.
export function compareAccountsByName(a, b) {
  const nameA = (a.full_name || a.email || '').trim().toLocaleLowerCase()
  const nameB = (b.full_name || b.email || '').trim().toLocaleLowerCase()
  const nameCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
  if (nameCmp !== 0) return nameCmp
  const emailA = (a.email || '').toLowerCase()
  const emailB = (b.email || '').toLowerCase()
  return emailA.localeCompare(emailB)
}

// Meaningful status order (documented choice): operational urgency first -
// Pending needs staff action, Active is live access, Scheduled is future access,
// Expired and Revoked are closed states.
export const STATUS_SORT_ORDER = ['pending', 'active', 'scheduled', 'expired', 'revoked']

// The six sortable columns and each one's recommended initial direction.
export const PORTAL_SORT_COLUMNS = {
  name:        { label: 'Name',           initialDir: 'asc' },
  portal_role: { label: 'Portal role',    initialDir: 'asc' },
  scope:       { label: 'Assigned scope', initialDir: 'asc' },
  status:      { label: 'Status',         initialDir: 'asc' },
  last_login:  { label: 'Last login',     initialDir: 'desc' },
  expiration:  { label: 'Expiration',     initialDir: 'asc' },
}

export const DEFAULT_PORTAL_SORT = { key: 'name', dir: 'asc' }

// The next sort state after clicking a column header: a new column opens on its
// recommended initial direction; the active column toggles.
export function nextPortalSort(current, key) {
  if (!PORTAL_SORT_COLUMNS[key]) return current
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: PORTAL_SORT_COLUMNS[key].initialDir }
}

const text = (v) => (v || '').toString().trim().toLocaleLowerCase()

// Comparable value per column. Date columns return epoch ms or null.
function sortValue(record, key) {
  switch (key) {
    case 'portal_role': return text(PORTAL_ROLE_LABELS[record.portal_role] || record.portal_role)
    case 'scope':       return text(summarizeScope(record))
    case 'status': {
      const i = STATUS_SORT_ORDER.indexOf(record.status)
      return i === -1 ? STATUS_SORT_ORDER.length : i
    }
    case 'last_login':  return record.last_login_at ? Date.parse(record.last_login_at) : null
    case 'expiration':  return record.expires_at ? Date.parse(record.expires_at) : null
    default:            return null // 'name' is handled wholly by the secondary comparator
  }
}

const DATE_KEYS = new Set(['last_login', 'expiration'])

/**
 * Sort a copy of `accounts` by the active column and direction.
 * Null dates go last in BOTH directions; ties fall through to name A-Z (then email).
 */
export function sortPortalAccounts(accounts, key = DEFAULT_PORTAL_SORT.key, dir = DEFAULT_PORTAL_SORT.dir) {
  const mult = dir === 'desc' ? -1 : 1
  return [...(accounts || [])].sort((a, b) => {
    if (key !== 'name') {
      const va = sortValue(a, key)
      const vb = sortValue(b, key)
      if (DATE_KEYS.has(key)) {
        // Nulls last regardless of direction.
        if (va === null && vb !== null) return 1
        if (va !== null && vb === null) return -1
      }
      if (va !== null && vb !== null && va !== vb) {
        if (typeof va === 'string') {
          const c = va.localeCompare(vb, undefined, { sensitivity: 'base' })
          if (c !== 0) return c * mult
        } else {
          return (va < vb ? -1 : 1) * mult
        }
      }
    }
    // Primary 'name' sort, and the deterministic secondary for every other column.
    const nameCmp = compareAccountsByName(a, b)
    return key === 'name' ? nameCmp * mult : nameCmp
  })
}
