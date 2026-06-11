// WS2.1: Settings shell — an application-level utility view rendered inside MainApp's
// <main> when the pathname is under /settings (mirrors the ASPIRE Connect pattern).
// It is NOT in UnifiedNav and is NOT a cohort tab. Stays mounted across panel
// navigation; selects the active panel by sub-path; normalizes /settings and unknown
// /settings/* to /settings/general via REPLACE navigation (no redundant history).
//
// Responsibilities are deliberately narrow: location read, normalization, rail + panel
// render, and a Back-to-workspace affordance. It does NOT own auth, account management,
// data fetching, API calls, theme persistence, or cohort/operational state.
import { useEffect, Fragment } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, Settings, Monitor, Users, FileText, Info } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { visibleSections } from './settingsSections'
import GeneralPanel from './GeneralPanel'
import AppearancePanel from './AppearancePanel'
import AccountsAccessPanel from './AccountsAccessPanel'
import ToursHelpPanel from './ToursHelpPanel'
import KnowledgeCenterPanel from './KnowledgeCenterPanel'

// Rail icons (lucide-react, all already used elsewhere in the project).
const SECTION_ICONS = {
  general: Settings, appearance: Monitor, accounts: Users, knowledge: FileText, tours: Info,
}

export default function SettingsShell({ backPath = '/aggregate', backLabel = 'Aggregate', onRestartTour }) {
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
        {/* Navigation rail — workspace-grade: icons, grouping, active/hover states.
            Sections come from the registry (role-filtered); no placeholders. */}
        <nav aria-label="Settings sections" style={{
          flex: '0 0 236px', minWidth: 212,
          padding: 10, borderRadius: 14,
          background: 'var(--color-bg-surface, #ffffff)',
          boxShadow: '0 1px 3px rgba(16,24,40,0.06)',
        }}>
          {sections.map((s, i) => {
            const Icon = SECTION_ICONS[s.key]
            const active = s.key === currentKey
            const prevGroup = i > 0 ? sections[i - 1].group : null
            const showGroup = s.group && s.group !== prevGroup
            return (
              <Fragment key={s.key}>
                {showGroup && (
                  <div style={{
                    padding: '10px 10px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
                    textTransform: 'uppercase', color: 'var(--color-text-secondary, #9ca3af)',
                  }}>
                    {s.group}
                  </div>
                )}
                <button
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigate(s.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                    padding: '9px 11px', marginBottom: 2, borderRadius: 9,
                    borderLeft: `3px solid ${active ? 'var(--color-accent-primary, #1D2567)' : 'transparent'}`,
                    border: 'none', cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif', fontSize: 13.5, fontWeight: active ? 600 : 500,
                    background: active ? 'var(--color-bg-elevated, #eef2fb)' : 'transparent',
                    color: active ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-text-primary, #374151)',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-bg-hover, #f9fafb)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  {Icon && <Icon size={16} strokeWidth={2} style={{ flexShrink: 0 }} />}
                  {s.label}
                </button>
              </Fragment>
            )
          })}
        </nav>

        {/* Active panel. Knowledge Center is wider (table); existing panels keep
            their established max width and render unchanged. */}
        <div style={{ flex: '1 1 360px', minWidth: 0, maxWidth: currentKey === 'knowledge' ? 1040 : 720 }}>
          {currentKey === 'general'    && <GeneralPanel />}
          {currentKey === 'appearance' && <AppearancePanel />}
          {currentKey === 'accounts'   && <AccountsAccessPanel />}
          {currentKey === 'knowledge'  && <KnowledgeCenterPanel />}
          {currentKey === 'tours'      && <ToursHelpPanel onRestartTour={onRestartTour} />}
        </div>
      </div>
    </div>
  )
}
