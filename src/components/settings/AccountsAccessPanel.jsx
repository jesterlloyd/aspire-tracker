// ASPIRE-PORTAL-ACCESS-UI: Settings → Accounts & Access. The former role-grouped
// profile-card board is replaced by AccountsDirectory, a scalable access
// directory (Staff Access, Portal Access, Pending Invitations) with its own
// header, summary counts, search, filters, tables, row menus, and details
// drawer. Staff invitations and portal-access grants are distinct workflows.
// This panel is a thin auth guard around the directory; every endpoint still
// authorizes server-side regardless of client visibility.
import { useAuth } from '../../contexts/AuthContext'
import AccountsDirectory from './AccountsDirectory'

export default function AccountsAccessPanel() {
  const { isAdmin } = useAuth() // owner/admin; the section is registry-hidden otherwise

  // Defensive: client visibility is not authorization; the registry already hides
  // this section from non-admins, and every endpoint authorizes server-side.
  if (!isAdmin) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
        You don’t have access to Accounts &amp; Access.
      </div>
    )
  }

  return <AccountsDirectory />
}
