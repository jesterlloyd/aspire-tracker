// SETTINGS-KEITH-NESTED-1: Settings -> Keith is a responsive MASTER-DETAIL hub,
// deliberately the same pattern as Settings -> General rather than the Rotation
// segmented control.
//
// Wide (>1280px): three panes across the Settings page - the primary rail (owned
// by SettingsShell), then this panel's MIDDLE pane (the Keith workspaces: Skills,
// Knowledge Center) and RIGHT pane (the selected workspace).
//
// Compact (<=1280px): the secondary navigation collapses into a horizontal
// destination picker above the workspace, which then takes the full width.
//
// The 1280 breakpoint is KEITH-LOCAL and deliberately higher than the 768 the
// rest of Settings uses. Keith's Skills workspace holds the widest table in
// Settings (eight columns), and a third pane squeezed it enough on a 1440px
// laptop that skill names wrapped across three lines. General's subsettings are
// narrow prose panels with no such pressure, so GeneralPanel keeps its own 768
// and the shared Settings grid is untouched.
//
// The picker is a <nav> of real buttons carrying aria-current, not a select and
// not a segmented control: identical semantics to the wide layout, so keyboard
// order, labelling and active state do not change with viewport width.
//
// Unlike General, Keith has NO display-only default: /settings/keith redirects to
// /settings/keith/skills in SettingsShell, so a subKey is always present and the
// URL always names the workspace on screen. That keeps refresh, back navigation
// and link sharing honest.
//
// KeithSkillsPanel and KnowledgeCenterPanel render unmodified. This file is
// navigation and layout only: it changes no Keith behavior, no skill state, no
// permissions, and no API contract.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Sparkles, FileText } from 'lucide-react'
import KeithSkillsPanel from './KeithSkillsPanel'
import KnowledgeCenterPanel from './KnowledgeCenterPanel'
import SurfaceCard from '../ui/SurfaceCard'
import { SETTINGS_HEADING_STYLE } from './settingsSections'

// Skills first: it is the default landing destination, and the ordering is
// deliberate rather than alphabetical - the workspace an Owner opens Keith to see
// should be the one they land on.
const KEITH_WORKSPACES = [
  {
    key: 'skills',
    path: '/settings/keith/skills',
    icon: Sparkles,
    label: 'Skills',
    description: 'Governed capabilities, lifecycle, and usage',
  },
  {
    key: 'knowledge',
    path: '/settings/keith/knowledge',
    icon: FileText,
    label: 'Knowledge Center',
    description: "Keith's governed knowledge and future Markdown vault",
  },
]

// ANCHORED-NAV-1: the Keith secondary navigation stays put while the workspace
// scrolls, matching Evaluation > Review and Release (.rr-nav): STICKY NAV + PAGE
// SCROLL, never an independently scrolling right pane. That distinction matters -
// a second scroll region would put two vertical scrollbars on one screen, which
// the approved scope rules out. The page remains the single vertical scroll
// owner; overflow-y here only engages if the nav itself ever outgrows the
// viewport, and overscroll-behavior stops it chaining to the page.
//
// `align-self: stretch` on the COLUMN is the load-bearing part. Without it the
// column is sized to the nav card and sticky has no travel room - the same
// latent bug that had silently disabled the main Settings rail.
const KEITH_STICKY_CSS = `
  .keith-nav-col { align-self: stretch; }
  .keith-nav-card {
    position: sticky; top: 120px; align-self: flex-start;
    max-height: calc(100vh - 140px); overflow-y: auto; overscroll-behavior: contain;
  }
  .keith-picker {
    position: sticky; top: 120px; z-index: 4;
    background: var(--color-bg-app, #faf8f4);
  }
`

const KEITH_DEFAULT_WORKSPACE = 'skills'

// KEITH-LOCAL breakpoint. Not shared with GeneralPanel, which keeps 768.
const KEITH_COMPACT_BREAKPOINT = 1280

function useIsCompact(bp = KEITH_COMPACT_BREAKPOINT) {
  const [compact, setCompact] = useState(typeof window !== 'undefined' ? window.innerWidth <= bp : false)
  useEffect(() => {
    const on = () => setCompact(window.innerWidth <= bp)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [bp])
  return compact
}

// Mirrors GeneralPanel's SubsettingsList exactly: a rounded SurfaceCard holding
// INSET pill rows, no full-bleed rows and no divider lines.
function WorkspaceList({ activeKey }) {
  const navigate = useNavigate()
  return (
    <SurfaceCard as="nav" aria-label="Keith workspaces" radius={14} padding={10} className="keith-nav-card">
      {KEITH_WORKSPACES.map((row, ri) => {
        const Icon = row.icon
        const active = row.key === activeKey
        return (
          <button
            key={row.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label={`${row.label}: ${row.description}`}
            onClick={() => navigate(row.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              padding: '10px 12px', border: 'none', cursor: 'pointer',
              borderRadius: 10, marginBottom: ri === KEITH_WORKSPACES.length - 1 ? 0 : 4,
              background: active ? 'var(--color-accent-primary, #1D2567)' : 'transparent',
              boxShadow: active ? '0 1px 3px rgba(29,37,103,0.30)' : 'none',
              fontFamily: 'DM Sans, sans-serif',
              transition: 'background 0.12s, box-shadow 0.12s',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-bg-hover, #f1efe9)' }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
          >
            <Icon size={17} strokeWidth={2} style={{ flexShrink: 0, color: active ? '#ffffff' : 'var(--color-accent-primary, #1D2567)' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: active ? '#ffffff' : 'var(--color-text-primary, #191919)' }}>
                {row.label}
              </span>
              <span style={{ display: 'block', fontSize: 12.5, color: active ? 'rgba(255,255,255,0.75)' : 'var(--color-text-secondary, #6b7280)', marginTop: 1 }}>
                {row.description}
              </span>
            </span>
            <ChevronRight size={16} strokeWidth={2} style={{ flexShrink: 0, color: active ? 'rgba(255,255,255,0.8)' : 'var(--color-text-secondary, #9ca3af)' }} />
          </button>
        )
      })}
    </SurfaceCard>
  )
}

// The compact destination picker. Same <nav> landmark, same buttons, same
// aria-current as the wide list - only the layout changes, so nothing about
// keyboard order or screen-reader output shifts when the viewport does. The
// description becomes the accessible name only; showing it would defeat "compact".
function CompactWorkspacePicker({ activeKey }) {
  const navigate = useNavigate()
  return (
    <SurfaceCard as="nav" aria-label="Keith workspaces" radius={12} padding={6}
      className="keith-picker" style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
      {KEITH_WORKSPACES.map(row => {
        const Icon = row.icon
        const active = row.key === activeKey
        return (
          <button
            key={row.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label={`${row.label}: ${row.description}`}
            onClick={() => navigate(row.path)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              flex: '1 1 0', minWidth: 0, minHeight: 44, padding: '10px 14px',
              border: 'none', cursor: 'pointer', borderRadius: 9,
              background: active ? 'var(--color-accent-primary, #1D2567)' : 'transparent',
              boxShadow: active ? '0 1px 3px rgba(29,37,103,0.30)' : 'none',
              fontFamily: 'DM Sans, sans-serif', fontSize: 13.5, fontWeight: active ? 700 : 500,
              color: active ? '#ffffff' : 'var(--color-text-primary, #374151)',
              transition: 'background 0.12s, color 0.12s, box-shadow 0.12s',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-bg-hover, #f1efe9)' }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
          >
            <Icon size={16} strokeWidth={active ? 2.4 : 2}
              style={{ flexShrink: 0, color: active ? '#ffffff' : 'var(--color-accent-primary, #1D2567)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
          </button>
        )
      })}
    </SurfaceCard>
  )
}

function WorkspaceContent({ subKey }) {
  if (subKey === 'knowledge') return <KnowledgeCenterPanel />
  return <KeithSkillsPanel />
}

export default function KeithPanel({ subKey }) {
  const compact = useIsCompact()
  const selectedKey = subKey || KEITH_DEFAULT_WORKSPACE

  // Compact: picker above, workspace at full width. One column, so the Skills
  // table gets the room it needs instead of competing with a third pane.
  if (compact) {
    return (
      <section aria-label="Keith">
        <style>{KEITH_STICKY_CSS}</style>
        <h2 id="settings-keith-heading" style={SETTINGS_HEADING_STYLE}>Keith</h2>
        <CompactWorkspacePicker activeKey={selectedKey} />
        <WorkspaceContent subKey={selectedKey} />
      </section>
    )
  }

  // Wide master-detail: middle list + right content, side by side. The middle
  // column's width matches GeneralPanel's so the two hubs sit on the same grid.
  return (
    <section aria-label="Keith" style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <style>{KEITH_STICKY_CSS}</style>
      <div className="keith-nav-col" style={{ flex: '0 0 248px', minWidth: 220 }}>
        <h2 id="settings-keith-heading" style={SETTINGS_HEADING_STYLE}>Keith</h2>
        <WorkspaceList activeKey={selectedKey} />
      </div>
      <div style={{ flex: '1 1 420px', minWidth: 0 }}>
        <WorkspaceContent subKey={selectedKey} />
      </div>
    </section>
  )
}
