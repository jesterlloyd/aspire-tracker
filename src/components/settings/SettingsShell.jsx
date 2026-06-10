// WS2.1: Settings shell — an application-level utility view rendered inside MainApp's
// <main> when the pathname is under /settings (mirrors the ASPIRE Connect pattern).
// It is NOT in UnifiedNav and is NOT a cohort tab. Stays mounted across panel
// navigation; selects the active panel by sub-path; normalizes /settings and unknown
// /settings/* to /settings/general via REPLACE navigation (no redundant history).
//
// Responsibilities are deliberately narrow: location read, normalization, rail + panel
// render, and a Back-to-workspace affordance. It does NOT own auth, account management,
// data fetching, API calls, theme persistence, or cohort/operational state.
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { visibleSections } from './settingsSections'
import GeneralPanel from './GeneralPanel'

export default function SettingsShell({ backPath = '/aggregate', backLabel = 'Aggregate' }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { isOwner, isAdmin } = useAuth()

  const sections = visibleSections({ isOwner, isAdmin })
  const path = location.pathname
  const knownPaths = sections.map(s => s.path)
  const matched = sections.find(s => s.path === path)

  // Normalize /settings and any unknown /settings/* subpath → /settings/general (replace).
  useEffect(() => {
    if (path === '/settings' || (path.startsWith('/settings') && !knownPaths.includes(path))) {
      navigate('/settings/general', { replace: true })
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentKey = matched?.key || 'general'

  return (
    <div style={{ padding: '20px 32px 40px', fontFamily: 'DM Sans, sans-serif' }}>
      {/* Back-to-workspace affordance (reuses MainApp's prior-workspace path) */}
      <button
        onClick={() => navigate(backPath)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary, #6b7280)',
          padding: '4px 0', fontFamily: 'DM Sans, sans-serif', transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-accent-primary, #1D2567)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-secondary, #6b7280)'}
      >
        <ChevronLeft size={14} strokeWidth={2.2} />
        Back to {backLabel}
      </button>

      <h1 style={{ margin: '8px 0 18px', fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary, #191919)' }}>
        Settings
      </h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        {/* Navigation rail (WS2.1: General only — no placeholders) */}
        <nav aria-label="Settings sections" style={{ flex: '0 0 220px', minWidth: 200 }}>
          {sections.map(s => {
            const active = s.key === currentKey
            return (
              <button
                key={s.key}
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(s.path)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '9px 12px', marginBottom: 4, borderRadius: 8,
                  border: '1px solid transparent', cursor: 'pointer',
                  fontFamily: 'DM Sans, sans-serif', fontSize: 13.5, fontWeight: active ? 600 : 500,
                  background: active ? 'var(--color-bg-elevated, #eef2fb)' : 'transparent',
                  color: active ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-text-primary, #374151)',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-bg-hover, #f9fafb)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                {s.label}
              </button>
            )
          })}
        </nav>

        {/* Active panel */}
        <div style={{ flex: '1 1 360px', minWidth: 0, maxWidth: 720 }}>
          {currentKey === 'general' && <GeneralPanel />}
        </div>
      </div>
    </div>
  )
}
