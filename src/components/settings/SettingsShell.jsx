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
// SETTINGS-FIX-2 and SETTINGS-BAND-1 (Owner, 2026-09-21): every page, and the rail's own
// column, opens with the same header band (SettingsPageHeader): a title line and ONE
// reserved subtitle line. Equal bands mean "Settings" and the page title share a baseline
// and the rail card and the page's first card start on one line, on every page. A
// drill-in's breadcrumb rides the back link's row, over the page column, so the titles
// sit right under it.
import { useEffect, Fragment } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Settings, Users, HandCoins, Sparkles, Presentation, Scale, BadgeInfo, Monitor, PenLine, Info, Building2,
  FileText, BarChart3, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  visibleSections, routableSections, childSections, SETTINGS_GROUPS,
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
import OrganizationPanel from './OrganizationPanel'
import SurfaceCard from '../ui/SurfaceCard'
import WorkspaceBackLink from '../ui/WorkspaceBackLink'
import SettingsPageHeader from './SettingsPageHeader'
import BackButton from '../BackButton'
import '../../styles/selectionRail.css'
import './settingsShell.css'

// The icons Settings already used, monochrome and without a tile: the rail's from the
// old rail, the rows' from the old General and Keith lists.
const SECTION_ICONS = {
  general: Settings, accounts: Users, organization: Building2, communityBenefit: HandCoins, keith: Sparkles,
  demoMode: Presentation, preceptorParity: Scale,
  about: BadgeInfo, appearance: Monitor, signature: PenLine, tours: Info,
  keithKnowledge: FileText, keithSkills: Sparkles, keithUsage: BarChart3,
}

// What a list page says on its subtitle line: one sentence, one line.
const LIST_PAGE_COPY = {
  general: 'Settings that are yours alone. They follow you to any device.',
  keith: 'Govern what Keith knows, what Keith can do, and what it costs.',
}

// The drill-ins that bring no heading of their own; the shell titles them with their
// row's name and line. Every other page renders its own SettingsPageHeader.
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

// A list page: the parent's header band and one grouped list of drill-in rows.
function SettingsListPage({ section, rows, navigate }) {
  const headingId = `settings-${section.key}-heading`
  return (
    <section aria-labelledby={headingId}>
      <SettingsPageHeader id={headingId} title={section.label} subtitle={LIST_PAGE_COPY[section.key]} />
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
      <BackButton label={`Back to ${parent.label}`} onClick={() => navigate(parent.path)} />
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
      {/* The back link over the rail's column; a drill-in's breadcrumb on the same row,
          over the page column. */}
      <div className="settings-top">
        <WorkspaceBackLink path={backPath} label={backLabel} />
        {parent && <SettingsCrumb parent={parent} here={current} navigate={navigate} />}
      </div>

      <div className="settings-grid">
        {/* The rail's column: its header band, then the rail. Stretched to the row so the
            rail has room to stay pinned (ANCHORED-NAV-1). */}
        <div className="settings-side">
          <SettingsPageHeader as="h1" title="Settings" />
          <SettingsRail sections={sections} activeKey={railActiveKey} navigate={navigate} />
        </div>

        {/* The active page. EVERY page uses the full canonical workspace width,
            bounded only by the .app-main 1580px shell. */}
        <div className="settings-content">
          {isListPage && (
            <SettingsListPage section={current} rows={childSections(currentKey, roleFlags)} navigate={navigate} />
          )}
          {shellTitle && <SettingsPageHeader title={shellTitle} subtitle={current.sub} />}
          {currentKey === 'appearance' && <AppearancePanel />}
          {currentKey === 'signature'  && <SignaturePanel />}
          {currentKey === 'tours'      && <ToursHelpPanel onRestartTour={onRestartTour} />}
          {currentKey === 'about'      && <AboutPanel />}
          {currentKey === 'accounts'   && <AccountsAccessPanel />}
          {currentKey === 'organization' && <OrganizationPanel />}
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
