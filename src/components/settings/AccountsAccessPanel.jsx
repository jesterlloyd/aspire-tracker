// WS2.2: Settings → Accounts & Access. Frames TWO separate people systems and renders
// the reusable inline content of each. This component owns NO data/API logic — it only
// provides the heading, the separate-system explanation, and the segmented control;
// each view's behavior lives in its reusable content component (server authorization
// for every mutation is unchanged and remains the real gate).
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { UserManagementContent } from '../UserManagement'
import { InterviewersContent } from '../InterviewersModal'

const VIEWS = [
  { key: 'accounts',  label: 'Login Accounts' },
  { key: 'directory', label: 'Interviewer Directory' },
]

export default function AccountsAccessPanel() {
  const { isAdmin } = useAuth() // owner/admin; the section is registry-hidden otherwise
  const [view, setView] = useState('accounts') // default: Login Accounts

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
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)', lineHeight: 1.55, maxWidth: 640 }}>
        ASPIRE manages app access and interview participation from this workspace.{' '}
        <strong>Login Accounts</strong> are people who can sign in. Users with interview permission
        can participate in interview workflows. The <strong>Interviewer Directory</strong> currently
        supports scheduling and rubric dropdowns while account and interviewer records remain
        technically separate. In practice, every interviewer should also have a login account, but
        not every login account is an interviewer.
      </p>

      {/* Nested tab selector — matches the Rotation (Matrix / Preceptors / Activity) segmented group:
          flush buttons sharing one outer border, active tab filled Nightfall. Same `view`/`setView`
          state and switching behavior (ACCOUNTS-ACCESS-REDESIGN-1A). */}
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

      {/* Active view — reusable inline content (no modal chrome) */}
      <div style={{
        marginTop: 16, borderRadius: 12, overflow: 'hidden',
        border: '1px solid var(--color-border-default, #e5e7eb)',
        background: 'var(--color-bg-surface, #ffffff)',
      }}>
        {view === 'accounts' ? <UserManagementContent /> : <InterviewersContent />}
      </div>
    </section>
  )
}
