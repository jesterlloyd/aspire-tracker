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
import { Settings, Monitor, Users, FileText, Info, Scale, PenLine, Sparkles } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { visibleSections, routableSections, SETTINGS_HEADING_STYLE } from './settingsSections'
import GeneralPanel from './GeneralPanel'
import AccountsAccessPanel from './AccountsAccessPanel'
import KeithPanel from './KeithPanel'
import PreceptorParityPanel from './PreceptorParityPanel'
import SurfaceCard from '../ui/SurfaceCard'
import WorkspaceBackLink from '../ui/WorkspaceBackLink'

// Rail icons (lucide-react, all already used elsewhere in the project).
// SETTINGS-UNIFIED-DESIGN-1: appearance/signature/tours no longer appear in the rail
// (they render inside GeneralPanel as subsettings) but keep entries here since they
// remain routable and GeneralPanel reuses these icons for its subsettings list.
const SECTION_ICONS = {
  general: Settings, about: Info, appearance: Monitor, signature: PenLine, accounts: Users, knowledge: FileText, keith: Sparkles, preceptorParity: Scale, tours: Info,
}

// SETTINGS-UNIFIED-DESIGN-1: non-rail subsettings fold into General for the purpose of
// rail active-state highlighting. Visiting /settings/appearance, /settings/signature, or
// /settings/tours highlights the General rail entry instead of showing nothing selected.
// SETTINGS-UNIFIED-DESIGN-1B: About joined the General hub (Information group),
// matching the real iOS Settings > General > About placement. Its /settings/about
// deep link still resolves here, with the rail folding onto General.
const NON_RAIL_SUBKEYS = ['appearance', 'signature', 'tours', 'about']

// SETTINGS-KEITH-NESTED-1: Keith's workspaces fold onto the Keith rail entry the
// same way General's subsettings fold onto General. The map's values are the
// subKey KeithPanel reads.
const KEITH_SUBKEYS = { keithSkills: 'skills', keithKnowledge: 'knowledge' }

export default function SettingsShell({ backPath = '/aggregate', backLabel = 'At a Glance', onRestartTour }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { isOwner, isAdmin } = useAuth()

  const roleFlags = { isOwner, isAdmin }
  const sections = visibleSections(roleFlags)
  const routable = routableSections(roleFlags)
  const path = location.pathname
  const knownPaths = routable.map(s => s.path)
  const matched = routable.find(s => s.path === path)

  // Normalize /settings and any unknown /settings/* subpath → /settings/general (replace).
  // Uses `routable` (not the rail-only `sections`) so non-rail deep links like
  // /settings/appearance are recognized as known paths and never bounced to General.
  useEffect(() => {
    // Keith is a parent destination with no content of its own: land on Skills.
    if (path === '/settings/keith') {
      navigate('/settings/keith/skills', { replace: true })
      return
    }
    // Legacy top-level Knowledge Center now lives under Keith. Redirect rather
    // than 404 or bounce to General, so old links and bookmarks still arrive
    // where the user meant to go.
    if (path === '/settings/knowledge') {
      navigate('/settings/keith/knowledge', { replace: true })
      return
    }
    if (path === '/settings' || (path.startsWith('/settings') && !knownPaths.includes(path))) {
      navigate('/settings/general', { replace: true })
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  const matchedKey = matched?.key || 'general'
  // The active panel key (drives which component renders below).
  const currentKey = matchedKey
  // The rail highlight key: non-rail subsettings fold into `general`, and Keith's
  // workspaces fold into `keith`, so the rail always shows exactly one selected
  // top-level destination.
  const railActiveKey = NON_RAIL_SUBKEYS.includes(matchedKey)
    ? 'general'
    : (KEITH_SUBKEYS[matchedKey] ? 'keith' : matchedKey)
  // Non-rail subsettings render inside GeneralPanel with a subKey so it can show the
  // right nested panel plus a back-to-General affordance.
  const subKey = NON_RAIL_SUBKEYS.includes(matchedKey) ? matchedKey : undefined
  // The Keith workspace on screen. Undefined until the redirect above lands.
  const keithSubKey = KEITH_SUBKEYS[matchedKey]

  return (
    // SETTINGS-VISUAL-DENSITY-1: no extra top padding - the back breadcrumb sits at
    // .app-main's 20px top offset, matching the Interview Rubric's spacing.
    // SETTINGS-VISUAL-DENSITY-1B (measured): the 20px HORIZONTAL padding is the
    // canonical card-column inset every main tab applies inside .app-main (cards at
    // container +20/-20, verified by bounding-box measurement at 1792/2000/1280).
    // Removing it entirely in the first density pass put Settings cards 20px wide of
    // the A/S/I/R/E column and into the Keith launcher's protected right gutter.
    <div style={{ padding: '0 20px 40px', fontFamily: 'DM Sans, sans-serif' }}>
      {/* ACCOUNTS-ACCESS-REDESIGN-1B: keep the Settings nav rail visible during long panel scrolling
          (e.g. Accounts & Access → Activity Log). Sticky within the layout, offset ~120px to clear the
          global sticky .top-section (header ~64 + cohort bar ~48). max-height + overflow so a tall rail
          scrolls internally. Disabled at ≤768px, where the rail stacks above content (no page lock,
          no nested-scroll friction, the panel itself keeps page-scrolling). */}
      <style>{`
        /* ANCHORED-NAV-1 root cause: this rule was already here and had never
           worked. A position:sticky element can only travel inside its
           CONTAINING BLOCK, and the rail's column was sized to its own content
           (315px measured) inside a 1346px row, because the row uses
           align-items:flex-start. With ~315px of travel the rail unpinned almost
           immediately and left with the page - which is exactly the reported
           "the Settings navigation disappears". Stretching the COLUMN to the row
           height gives the sticky card the full content height to travel. */
        .settings-nav-col { align-self: stretch; }
        .settings-nav-rail { position: sticky; top: 120px; align-self: flex-start; max-height: calc(100vh - 140px); overflow-y: auto; overscroll-behavior: contain; }
        @media (max-width: 768px) { .settings-nav-col { align-self: auto; } .settings-nav-rail { position: static; max-height: none; overflow: visible; } }
      `}</style>
      {/* Back-to-workspace affordance - shared component (reuses MainApp's prior-workspace path) */}
      <WorkspaceBackLink path={backPath} label={backLabel} />

      {/* SETTINGS-VISUAL-DENSITY-1: no page-level header block. "Settings" is the first
          column's heading, sharing SETTINGS_HEADING_STYLE with the panel headings so
          Settings | General | <subsetting> (and the primary section titles) sit on one
          baseline. The generic page subtitle is gone. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start', marginTop: 18 }}>
        {/* Column 1: the Settings heading + navigation rail. */}
        <div className="settings-nav-col" style={{ flex: '0 0 236px', minWidth: 212 }}>
        <h1 style={SETTINGS_HEADING_STYLE}>Settings</h1>
        <SurfaceCard as="nav" aria-label="Settings sections" radius={14} padding={10}
          className="settings-nav-rail">
          {sections.map((s, i) => {
            const Icon = SECTION_ICONS[s.key]
            const active = s.key === railActiveKey
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
        </div>

        {/* Active panel. SETTINGS-UNIFIED-DESIGN-1/1B: appearance/signature/tours/about render
            through GeneralPanel (master-detail hub + passthrough to the unchanged panels) via
            `subKey`. SETTINGS-VISUAL-DENSITY-1: EVERY section now uses the full canonical
            workspace width (no 720/1040 caps) - the same width Accounts & Access already used,
            bounded only by the .app-main 1580px shell. */}
        <div style={{ flex: '1 1 360px', minWidth: 0 }}>
          {['general', 'appearance', 'signature', 'tours', 'about'].includes(currentKey) &&
            <GeneralPanel subKey={subKey} onRestartTour={onRestartTour} />}
          {currentKey === 'accounts'   && <AccountsAccessPanel />}
          {/* SETTINGS-KEITH-NESTED-1: one parent panel owns both Keith workspaces.
              `keith` and `knowledge` are transient here - the shell redirects them
              to a workspace route - but they render the hub rather than nothing so
              there is no blank frame during the redirect. */}
          {(keithSubKey || currentKey === 'keith' || currentKey === 'knowledge') &&
            <KeithPanel subKey={keithSubKey} />}
          {currentKey === 'preceptorParity' && <PreceptorParityPanel />}
        </div>
      </div>
    </div>
  )
}
