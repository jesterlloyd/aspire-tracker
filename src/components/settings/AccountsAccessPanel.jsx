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
        ASPIRE has two separate people systems. <strong>Login Accounts</strong> are app users
        (Supabase Auth — roles, activation, and interview permission). The{' '}
        <strong>Interviewer Directory</strong> is a separate roster of people who conduct
        interviews (used by scheduling and rubrics). A directory interviewer is <em>not</em>
        automatically a login account, a login account is <em>not</em> automatically a
        directory record, and their color settings are independent.
      </p>

      {/* Segmented control */}
      <div role="group" aria-label="Accounts &amp; Access views" style={{
        display: 'inline-flex', gap: 4, padding: 3, borderRadius: 10,
        background: 'var(--color-bg-elevated, #f3f4f6)',
        border: '1px solid var(--color-border-default, #e5e7eb)',
      }}>
        {VIEWS.map(v => {
          const active = view === v.key
          return (
            <button
              key={v.key}
              aria-pressed={active}
              onClick={() => setView(v.key)}
              style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: active ? 600 : 500,
                background: active ? 'var(--color-bg-surface, #ffffff)' : 'transparent',
                color: active ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-text-secondary, #6b7280)',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'background 0.15s, color 0.15s',
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
