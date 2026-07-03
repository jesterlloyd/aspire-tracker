// WS2.2 / ACCOUNTS-ACCESS-PEOPLE-MODEL-2A1: Settings → Accounts & Access, a single account-centered
// workspace. There is NO page-level People / Interviewers selector — the primary card is the
// Login Accounts list, and "Interviewers" is simply the existing filter chip inside it (users with
// Can Interview enabled). Interviewer participation + color are managed once per account via Manage
// Access. The legacy interviewers directory table is untouched; it is just not maintained here.
import { useAuth } from '../../contexts/AuthContext'
import { UserManagementContent } from '../UserManagement'

export default function AccountsAccessPanel() {
  const { isAdmin } = useAuth() // owner/admin; the section is registry-hidden otherwise

  // Defensive: client visibility is not authorization; the registry already hides this
  // section from non-admins, and every endpoint authorizes server-side regardless.
  if (!isAdmin) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
        You don’t have access to Accounts &amp; Access.
      </div>
    )
  }

  return (
    <section aria-labelledby="settings-accounts-heading">
      <h2 id="settings-accounts-heading" style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--color-text-primary, #191919)' }}>
        Accounts &amp; Access
      </h2>
      {/* Header copy spans with the full-width content below (ACCOUNTS-ACCESS-REDESIGN-1A rhythm) —
          a generous max width keeps lines readable on presentation screens without a narrow column. */}
      <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--color-text-secondary, #6b7280)', lineHeight: 1.55, maxWidth: 1040 }}>
        Manage sign-in access, roles, and interview permissions. Everyone who conducts interviews should
        have a login account. To make someone an interviewer, open <strong>Manage Access</strong> and turn
        on <strong>Can Interview</strong>.
      </p>

      {/* Single primary card — the Login Accounts list (Interviewers is a filter chip within it). */}
      <div style={{
        borderRadius: 12, overflow: 'hidden',
        border: '1px solid var(--color-border-default, #e5e7eb)',
        background: 'var(--color-bg-surface, #ffffff)',
      }}>
        <UserManagementContent />
      </div>
    </section>
  )
}
