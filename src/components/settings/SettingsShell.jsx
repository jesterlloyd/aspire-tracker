// WS2.1: Settings shell - an application-level utility view rendered inside MainApp's
// <main> when the pathname is under /settings (mirrors the ASPIRE Connect pattern).
// It is NOT in UnifiedNav and is NOT a cohort tab. Stays mounted across panel
// navigation; selects the active panel by sub-path; normalizes /settings and unknown
// /settings/* to DEFAULT_SETTINGS_PATH via REPLACE navigation (no redundant history).
//
// Responsibilities are deliberately narrow: location read, normalization, rail + panel
// render, and a Back-to-workspace affordance. It does NOT own auth, account management,
// data fetching, API calls, theme persistence, or cohort/operational state.
//
// APPEARANCE-STYLE-1 (2026-09-21): two panes. A 240px rail of grouped destinations
// (You, Workspace, Diagnostics), each with an icon and, where it helps, a grey second
// line, and the page beside it. The General hub and its middle pane are gone; its four
// pages render here directly. Below 860px the rail stacks above the page. The layout
// lives in settingsShell.css.
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Contrast, PenLine, CircleHelp, Users, HandCoins, Sparkles, Presentation, Scale, Info } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  visibleSections, routableSections, SETTINGS_HEADING_STYLE, SETTINGS_GROUPS, DEFAULT_SETTINGS_PATH,
} from './settingsSections'
import AppearancePanel from './AppearancePanel'
import SignaturePanel from './SignaturePanel'
import ToursHelpPanel from './ToursHelpPanel'
import AboutPanel from './AboutPanel'
import AccountsAccessPanel from './AccountsAccessPanel'
import KeithPanel from './KeithPanel'
import PreceptorParityPanel from './PreceptorParityPanel'
import DemoModePanel from './DemoModePanel'
import CommunityBenefitPanel from './CommunityBenefitPanel'
import WorkspaceBackLink from '../ui/WorkspaceBackLink'
import './settingsShell.css'

// Rail icons (lucide-react). One per rail destination.
const SECTION_ICONS = {
  appearance: Contrast, signature: PenLine, tours: CircleHelp,
  accounts: Users, communityBenefit: HandCoins, keith: Sparkles,
  demoMode: Presentation, preceptorParity: Scale, about: Info,
}

// SETTINGS-KEITH-NESTED-1: Keith's workspaces fold onto the Keith rail entry. The map's
// values are the subKey KeithPanel reads. KEITH-USAGE-1 adds Usage & Cost.
const KEITH_SUBKEYS = { keithSkills: 'skills', keithKnowledge: 'knowledge', keithUsage: 'usage' }

// The pages that bring no heading of their own used to borrow the General hub's. They
// get one here; every other panel titles itself.
const TITLED_BY_SHELL = ['signature', 'tours', 'about']

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

  // Normalize /settings, the retired /settings/general, and any unknown /settings/*
  // subpath to the default page (replace). Uses `routable` (not the rail-only
  // `sections`) so Keith's workspace deep links are recognized as known paths.
  useEffect(() => {
    // Keith is a parent destination with no content of its own. KEITH-USAGE-1:
    // it lands on Knowledge Center, the first workspace in the now-alphabetical
    // order (Knowledge Center, Skills, Usage & Cost).
    if (path === '/settings/keith') {
      navigate('/settings/keith/knowledge', { replace: true })
      return
    }
    // Legacy top-level Knowledge Center now lives under Keith. Redirect rather
    // than 404 or bounce to the default, so old links and bookmarks still arrive
    // where the user meant to go.
    if (path === '/settings/knowledge') {
      navigate('/settings/keith/knowledge', { replace: true })
      return
    }
    if (path === '/settings' || (path.startsWith('/settings') && !knownPaths.includes(path))) {
      navigate(DEFAULT_SETTINGS_PATH, { replace: true })
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentKey = matched?.key || 'appearance'
  // The rail highlight: Keith's workspaces fold into `keith`, so the rail always shows
  // exactly one selected destination.
  const railActiveKey = KEITH_SUBKEYS[currentKey] ? 'keith' : currentKey
  // The Keith workspace on screen. Undefined until the redirect above lands.
  const keithSubKey = KEITH_SUBKEYS[currentKey]
  const shellTitle = TITLED_BY_SHELL.includes(currentKey) ? matched?.label : null

  const groups = SETTINGS_GROUPS
    .map(group => ({ group, items: sections.filter(s => s.group === group) }))
    .filter(g => g.items.length > 0)

  return (
    // SETTINGS-VISUAL-DENSITY-1B (measured): the 20px horizontal padding is the
    // canonical card-column inset every main tab applies inside .app-main.
    <div className="settings-shell">
      {/* Back-to-workspace affordance - shared component (reuses MainApp's prior-workspace path) */}
      <WorkspaceBackLink path={backPath} label={backLabel} />
      <h1 className="settings-title">Settings</h1>

      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">
          {groups.map(({ group, items }) => (
            <div key={group} className="settings-nav-group" role="group" aria-labelledby={`settings-group-${group}`}>
              <span id={`settings-group-${group}`} className="settings-nav-group-label">{group}</span>
              {items.map(s => {
                const Icon = SECTION_ICONS[s.key]
                const active = s.key === railActiveKey
                return (
                  <button
                    key={s.key}
                    type="button"
                    className="settings-nav-item"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => navigate(s.path)}
                  >
                    <span className="settings-nav-ic" aria-hidden="true">
                      {Icon && <Icon size={15} strokeWidth={2} />}
                    </span>
                    <span className="settings-nav-text">
                      {s.label}
                      {s.sub && <small>{s.sub}</small>}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* The active page. EVERY section uses the full canonical workspace width,
            bounded only by the .app-main 1580px shell. */}
        <div className="settings-content">
          {shellTitle && <h2 style={SETTINGS_HEADING_STYLE}>{shellTitle}</h2>}
          {currentKey === 'appearance' && <AppearancePanel />}
          {currentKey === 'signature'  && <SignaturePanel />}
          {currentKey === 'tours'      && <ToursHelpPanel onRestartTour={onRestartTour} />}
          {currentKey === 'about'      && <AboutPanel />}
          {currentKey === 'accounts'   && <AccountsAccessPanel />}
          {/* SETTINGS-KEITH-NESTED-1: one parent panel owns both Keith workspaces.
              `keith` and `knowledge` are transient here - the shell redirects them
              to a workspace route - but they render the hub rather than nothing so
              there is no blank frame during the redirect. */}
          {(keithSubKey || currentKey === 'keith' || currentKey === 'knowledge') &&
            <KeithPanel subKey={keithSubKey} />}
          {currentKey === 'communityBenefit' && <CommunityBenefitPanel />}
          {currentKey === 'preceptorParity' && <PreceptorParityPanel />}
          {currentKey === 'demoMode' && <DemoModePanel />}
        </div>
      </div>
    </div>
  )
}
