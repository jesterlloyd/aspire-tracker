// WS2.2 / ACCOUNTS-ACCESS-PEOPLE-MODEL-2A: Settings → Accounts & Access, now account-centered.
// One primary People list (login accounts). The second tab, "Interviewers", is simply a filtered
// view of that same account list where Can Conduct Interviews is enabled — NOT a separate editable
// directory. Both tabs render the reusable UserManagementContent; interviewer participation + color
// are managed once per account via Manage Access. The legacy interviewers directory table is
// untouched (still read by scheduling/rubrics); it is just no longer maintained from Settings.
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { UserManagementContent } from '../UserManagement'

const VIEWS = [
  { key: 'people',       label: 'People' },
  { key: 'interviewers', label: 'Interviewers' },
]

export default function AccountsAccessPanel() {
  const { isAdmin } = useAuth() // owner/admin; the section is registry-hidden otherwise
  const [view, setView] = useState('people') // default: primary People list

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
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)', lineHeight: 1.55, maxWidth: 660 }}>
        ASPIRE manages people and access from one place. <strong>Login accounts</strong> are the
        people who can sign in. Turn on <strong>Can Conduct Interviews</strong> for anyone who runs
        interviews — they’ll appear in interview scheduling, rubrics, and availability, with their own
        calendar color set once from their account. The <strong>Interviewers</strong> tab is simply
        the accounts that can conduct interviews. To add an interviewer, invite them as a login
        account, then enable Can Conduct Interviews.
      </p>

      {/* Nested tab selector — Rotation-style flush segmented group, active tab filled Nightfall
          (ACCOUNTS-ACCESS-REDESIGN-1A). Same view/setView switching behavior. */}
      <div role="group" aria-label="Accounts &amp; Access views" style={{
        display: 'flex', borderRadius: 7, overflow: 'hidden', width: 'fit-content',
        border: '1px solid var(--border-input, rgba(29,37,103,0.10))',
      }}>
        {VIEWS.map(v => {
          const active = view === v.key
          return (
            <button
              key={v.key}
              aria-pressed={active}
              onClick={() => setView(v.key)}
              style={{
                height: 32, padding: '0 13px', display: 'flex', alignItems: 'center',
                border: 'none', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap',
                fontFamily: 'DM Sans, sans-serif', fontWeight: 500,
                background: active ? 'var(--color-accent-primary, #1D2567)' : 'var(--bg-input, #fff)',
                color: active ? '#fff' : 'var(--text-secondary, #4A5560)',
                transition: 'all 0.12s',
              }}
            >
              {v.label}
            </button>
          )
        })}
      </div>

      {/* Active view — both tabs render the SAME account list; the Interviewers tab is a filtered
          view (can_conduct_interviews). key={view} remounts so the filtered layout applies cleanly. */}
      <div style={{
        marginTop: 16, borderRadius: 12, overflow: 'hidden',
        border: '1px solid var(--color-border-default, #e5e7eb)',
        background: 'var(--color-bg-surface, #ffffff)',
      }}>
        <UserManagementContent key={view} interviewersView={view === 'interviewers'} />
      </div>
    </section>
  )
}
