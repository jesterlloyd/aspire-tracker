// WS2.2 / ACCOUNTS-ACCESS-PROFILE-BOARD-2B: Settings → Accounts & Access — a single account-centered
// people board. The header carries the title/copy on the left and a compact "Invite New User" button
// on the right (opens the InviteUserModal). The board itself (UserManagementContent) renders login
// accounts as cozy profile cards; clicking a card opens the Account Profile modal. There is no
// page-level People/Interviewers selector and no separate editable Interviewer Directory.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { UserManagementContent } from '../UserManagement'
import InviteUserModal from './InviteUserModal'

export default function AccountsAccessPanel() {
  const { isAdmin } = useAuth() // owner/admin; the section is registry-hidden otherwise
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)

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
      {/* Header — title/copy left, compact Invite New User right; wraps on narrow screens. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ minWidth: 0, flex: '1 1 420px' }}>
          <h2 id="settings-accounts-heading" style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--color-text-primary, #191919)' }}>
            Accounts &amp; Access
          </h2>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-text-secondary, #6b7280)', lineHeight: 1.55, maxWidth: 1040 }}>
            Manage sign-in access, roles, and interview permissions. Everyone who conducts interviews
            should have a login account. To make someone an interviewer, open a profile and enable
            <strong> interviewer access</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', background: 'var(--color-accent-primary, #1D2567)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 13, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <UserPlus size={15} /> Invite New User
        </button>
      </div>

      {/* People board */}
      <div style={{
        borderRadius: 12, overflow: 'hidden',
        border: '1px solid var(--color-border-default, #e5e7eb)',
        background: 'var(--color-bg-surface, #ffffff)',
      }}>
        <UserManagementContent />
      </div>

      {inviteOpen && (
        <InviteUserModal
          onClose={() => setInviteOpen(false)}
          onInvited={() => queryClient.invalidateQueries({ queryKey: ['people_access_users'] })}
        />
      )}
    </section>
  )
}
