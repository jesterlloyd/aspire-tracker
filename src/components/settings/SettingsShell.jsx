// WS2.1: Settings shell - an application-level utility view rendered inside MainApp's
// <main> when the pathname is under /settings (mirrors the ASPIRE Connect pattern).
// It is NOT in UnifiedNav and is NOT a cohort tab. Stays mounted across panel
// navigation; selects the active page by sub-path; sends retired and unknown /settings
// paths to where they live now via REPLACE navigation (no redundant history).
//
// Responsibilities are deliberately narrow: location read, normalization, rail + page
// render, and a Back-to-workspace affordance. It does NOT own auth, account management,
// data fetching, API calls, theme persistence, or cohort/operational state.
//
// SETTINGS-HIERARCHY-1 (2026-09-21), the Apple System Settings pattern:
//   - the rail is the app's left selection canon, the one Evaluation > Review & Release
//     wears (src/styles/selectionRail.css), holding only the top-level destinations;
//   - General and Keith are list pages of drill-in rows;
//   - a drill-in opens in the same right pane, under a breadcrumb back to its parent,
//     with the parent still selected in the rail, at its own route.
// Two panes, never three. Layout lives in settingsShell.css.
//
// SETTINGS-FIX-2 (Owner, 2026-09-21): "Titles the same, aligned. First panes aligned."
// "Settings" heads the rail's column in the same heading spec as the page's own title, so
// the two sit on one baseline, and a list page carries no generic subtitle, so the rail
// card and the list card start on one line. A drill-in's breadcrumb sits ABOVE that line,
// in space the grid reserves, so it never pushes the page title off the baseline.
import { useEffect, Fragment } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Settings, Users, HandCoins, Sparkles, Presentation, Scale, BadgeInfo, Monitor, PenLine, Info,
  FileText, BarChart3, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  visibleSections, routableSections, childSections, SETTINGS_HEADING_STYLE, SETTINGS_GROUPS,
  DEFAULT_SETTINGS_PATH, LEGACY_SETTINGS_REDIRECTS,
} from './settingsSections'
import AppearancePanel from './AppearancePanel'
import SignaturePanel from './SignaturePanel'
import ToursHelpPanel from './ToursHelpPanel'
import AboutPanel from './AboutPanel'
import AccountsAccessPanel from './AccountsAccessPanel'
import KnowledgeCenterPanel from './KnowledgeCenterPanel'
import KeithSkillsPanel from './KeithSkillsPanel'
import KeithUsagePanel from './KeithUsagePanel'
import PreceptorParityPanel from './PreceptorParityPanel'
import DemoModePanel from './DemoModePanel'
import CommunityBenefitPanel from './CommunityBenefitPanel'
import SurfaceCard from '../ui/SurfaceCard'
import WorkspaceBackLink from '../ui/WorkspaceBackLink'
import '../../styles/selectionRail.css'
import './settingsShell.css'

// The icons Settings already used, monochrome and without a tile: the rail's from the
// old rail, the rows' from the old General and Keith lists.
const SECTION_ICONS = {
  general: Settings, accounts: Users, communityBenefit: HandCoins, keith: Sparkles,
  demoMode: Presentation, preceptorParity: Scale,
  about: BadgeInfo, appearance: Monitor, signature: PenLine, tours: Info,
  keithKnowledge: FileText, keithSkills: Sparkles, keithUsage: BarChart3,
}

// The drill-ins that bring no heading of their own. Appearance and the three Keith
// workspaces title themselves.
const TITLED_BY_SHELL = ['signature', 'tours', 'about']

function SettingsRail({ sections, activeKey, navigate }) {
  const groups = SETTINGS_GROUPS
    .map(group => ({ group, items: sections.filter(s => s.group === group) }))
    .filter(g => g.items.length > 0)
  // Flat, as Review & Release builds it: a label, then its rows, so the canon's divider
  // (every label but the first) lands between groups.
  return (
    <nav className="rr-nav settings-rail" aria-label="Settings sections">
      {groups.map(({ group, items }) => (
        <Fragment key={group}>
          <p className="rr-nav-group">{group}</p>
          {items.map(s => {
            const Icon = SECTION_ICONS[s.key]
            const active = s.key === activeKey
            return (
              <button
                key={s.key}
                type="button"
                className={`rr-row-select settings-rail-row${active ? ' sel' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(s.path)}
              >
                {Icon && <Icon size={16} strokeWidth={2} aria-hidden="true" className="settings-rail-ic" />}
                <span className="rr-row-label">{s.label}</span>
              </button>
            )
          })}
        </Fragment>
      ))}
    </nav>
  )
}

// A list page: the parent's title and one grouped list of drill-in rows. No subtitle: a
// generic one would push the list below the rail card (SETTINGS-VISUAL-DENSITY-1 removed
// them for the same reason).
function SettingsListPage({ section, rows, navigate }) {
  const headingId = `settings-${section.key}-heading`
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} style={SETTINGS_HEADING_STYLE}>{section.label}</h2>
      <SurfaceCard as="ul" className="settings-list" padding={0} aria-label={section.label}>
        {rows.map(row => {
          const Icon = SECTION_ICONS[row.key]
          return (
            <li key={row.key}>
              <button type="button" className="settings-list-row" onClick={() => navigate(row.path)}>
                {Icon && <Icon size={16} strokeWidth={2} aria-hidden="true" className="settings-list-ic" />}
                <span className="settings-list-text">
                  {row.label}
                  {row.sub && <small>{row.sub}</small>}
                </span>
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className="settings-list-chev" />
              </button>
            </li>
          )
        })}
      </SurfaceCard>
    </section>
  )
}

// "‹ General / Appearance": the way back to the list the page was opened from.
function SettingsCrumb({ parent, here, navigate }) {
  return (
    <nav className="settings-crumb" aria-label="Breadcrumb">
      <button type="button" className="settings-crumb-back" onClick={() => navigate(parent.path)}>
        <ChevronLeft size={15} strokeWidth={2.4} aria-hidden="true" />
        {parent.label}
      </button>
      <span className="settings-crumb-sep" aria-hidden="true">/</span>
      <span className="settings-crumb-here" aria-current="page">{here.label}</span>
    </nav>
  )
}

export default function SettingsShell({ backPath = '/aggregate', backLabel = 'At a Glance', onRestartTour }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { isOwner, isAdmin } = useAuth()

  const roleFlags = { isOwner, isAdmin }
  const sections = visibleSections(roleFlags)
  const routable = routableSections(roleFlags)
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const knownPaths = routable.map(s => s.path)
  const matched = routable.find(s => s.path === path)

  // Retired paths go where they live now; anything else unknown (or not this role's)
  // falls to the default. Replace, so Back never lands on a redirect.
  useEffect(() => {
    const moved = LEGACY_SETTINGS_REDIRECTS[path]
    if (moved) {
      navigate(moved, { replace: true })
      return
    }
    if (path.startsWith('/settings') && !knownPaths.includes(path)) {
      navigate(DEFAULT_SETTINGS_PATH, { replace: true })
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentKey = matched?.key || 'general'
  const current = matched || routable.find(s => s.key === 'general')
  // The rail always shows exactly one selected destination: a drill-in selects its parent.
  const railActiveKey = current.parent || current.key
  const parent = current.parent ? routable.find(s => s.key === current.parent) : null
  const shellTitle = TITLED_BY_SHELL.includes(currentKey) ? current.label : null
  const isListPage = currentKey === 'general' || currentKey === 'keith'

  return (
    // SETTINGS-VISUAL-DENSITY-1B (measured): the 20px horizontal padding is the
    // canonical card-column inset every main tab applies inside .app-main.
    <div className="settings-shell">
      {/* Back-to-workspace affordance - shared component (reuses MainApp's prior-workspace path) */}
      <WorkspaceBackLink path={backPath} label={backLabel} />

      <div className="settings-grid">
        {/* The rail's column: its title, then the rail. Stretched to the row so the rail
            has room to stay pinned (ANCHORED-NAV-1). */}
        <div className="settings-side">
          <h1 style={SETTINGS_HEADING_STYLE}>Settings</h1>
          <SettingsRail sections={sections} activeKey={railActiveKey} navigate={navigate} />
        </div>

        {/* The active page. EVERY page uses the full canonical workspace width,
            bounded only by the .app-main 1580px shell. */}
        <div className="settings-content">
          {parent && <SettingsCrumb parent={parent} here={current} navigate={navigate} />}
          {isListPage && (
            <SettingsListPage section={current} rows={childSections(currentKey, roleFlags)} navigate={navigate} />
          )}
          {shellTitle && <h2 style={SETTINGS_HEADING_STYLE}>{shellTitle}</h2>}
          {currentKey === 'appearance' && <AppearancePanel />}
          {currentKey === 'signature'  && <SignaturePanel />}
          {currentKey === 'tours'      && <ToursHelpPanel onRestartTour={onRestartTour} />}
          {currentKey === 'about'      && <AboutPanel />}
          {currentKey === 'accounts'   && <AccountsAccessPanel />}
          {/* SETTINGS-KEITH-NESTED-1's three workspaces, unmodified. */}
          {currentKey === 'keithKnowledge' && <KnowledgeCenterPanel />}
          {currentKey === 'keithSkills'    && <KeithSkillsPanel />}
          {currentKey === 'keithUsage'     && <KeithUsagePanel />}
          {currentKey === 'communityBenefit' && <CommunityBenefitPanel />}
          {currentKey === 'preceptorParity' && <PreceptorParityPanel />}
          {currentKey === 'demoMode' && <DemoModePanel />}
        </div>
      </div>
    </div>
  )
}
