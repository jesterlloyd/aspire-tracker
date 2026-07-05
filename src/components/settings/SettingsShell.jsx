// WS2.1: Settings shell - an application-level utility view rendered inside MainApp's
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
import { Settings, Monitor, Users, FileText, Info, Scale, PenLine } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { visibleSections } from './settingsSections'
import GeneralPanel from './GeneralPanel'
import AppearancePanel from './AppearancePanel'
import SignaturePanel from './SignaturePanel'
import AccountsAccessPanel from './AccountsAccessPanel'
import ToursHelpPanel from './ToursHelpPanel'
import KnowledgeCenterPanel from './KnowledgeCenterPanel'
import PreceptorParityPanel from './PreceptorParityPanel'
import SurfaceCard from '../ui/SurfaceCard'
import WorkspaceBackLink from '../ui/WorkspaceBackLink'

// Rail icons (lucide-react, all already used elsewhere in the project).
const SECTION_ICONS = {
  general: Settings, appearance: Monitor, signature: PenLine, accounts: Users, knowledge: FileText, preceptorParity: Scale, tours: Info,
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
      {/* ACCOUNTS-ACCESS-REDESIGN-1B: keep the Settings nav rail visible during long panel scrolling
          (e.g. Accounts & Access → Activity Log). Sticky within the layout, offset ~120px to clear the
          global sticky .top-section (header ~64 + cohort bar ~48). max-height + overflow so a tall rail
          scrolls internally. Disabled at ≤768px, where the rail stacks above content (no page lock,
          no nested-scroll friction, the panel itself keeps page-scrolling). */}
      <style>{`
        .settings-nav-rail { position: sticky; top: 120px; align-self: flex-start; max-height: calc(100vh - 140px); overflow-y: auto; }
        @media (max-width: 768px) { .settings-nav-rail { position: static; max-height: none; overflow: visible; } }
      `}</style>
      {/* Back-to-workspace affordance - shared component (reuses MainApp's prior-workspace path) */}
      <WorkspaceBackLink path={backPath} label={backLabel} />

      {/* Header - title + subtitle for a clearer, more polished page hierarchy. */}
      <div style={{ margin: '10px 0 24px' }}>
        <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, color: 'var(--color-text-primary, #191919)', letterSpacing: '-0.01em' }}>
          Settings
        </h1>
        <p style={{ margin: '5px 0 0', fontSize: 14, color: 'var(--color-text-secondary, #6b7280)', lineHeight: 1.5 }}>
          Manage your ASPIRE Intelligence workspace, preferences, access, and resources.
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
        {/* Navigation rail - workspace-grade: icons, grouping, active/hover states.
            Sections come from the registry (role-filtered); no placeholders.
            UI-1: the rail surface is the shared SurfaceCard primitive (same pixels). */}
        <SurfaceCard as="nav" aria-label="Settings sections" radius={14} padding={10}
          className="settings-nav-rail"
          style={{ flex: '0 0 236px', minWidth: 212 }}>
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
                    padding: '10px 12px', marginBottom: 4, borderRadius: 10, border: 'none', cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif', fontSize: 13.5, fontWeight: active ? 700 : 500,
                    // Active = solid navy pill with white text/icon (unmistakable). Inactive = quiet.
                    background: active ? 'var(--color-accent-primary, #1D2567)' : 'transparent',
                    boxShadow: active ? '0 1px 3px rgba(29,37,103,0.30)' : 'none',
                    color: active ? '#ffffff' : 'var(--color-text-primary, #374151)',
                    transition: 'background 0.15s, color 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-bg-hover, #f1efe9)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  {Icon && <Icon size={16} strokeWidth={active ? 2.4 : 2}
                    style={{ flexShrink: 0, color: active ? '#ffffff' : 'var(--color-accent-primary, #1D2567)' }} />}
                  {s.label}
                </button>
              </Fragment>
            )
          })}
        </SurfaceCard>

        {/* Active panel. Knowledge Center is wider (table); Accounts & Access uses the FULL workspace
            width (ACCOUNTS-ACCESS-REDESIGN-1A, no cap, bounded only by the .app-main 1580px shell);
            all other panels keep their established max width and render unchanged. */}
        <div style={{ flex: '1 1 360px', minWidth: 0, maxWidth: currentKey === 'accounts' ? 'none' : ['knowledge', 'preceptorParity'].includes(currentKey) ? 1040 : 720 }}>
          {currentKey === 'general'    && <GeneralPanel />}
          {currentKey === 'appearance' && <AppearancePanel />}
          {currentKey === 'signature'  && <SignaturePanel />}
          {currentKey === 'accounts'   && <AccountsAccessPanel />}
          {currentKey === 'knowledge'  && <KnowledgeCenterPanel />}
          {currentKey === 'preceptorParity' && <PreceptorParityPanel />}
          {currentKey === 'tours'      && <ToursHelpPanel onRestartTour={onRestartTour} />}
        </div>
      </div>
    </div>
  )
}
