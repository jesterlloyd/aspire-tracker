import { useUnreadStudents } from '../hooks/useUnreadStudents'
import { BADGE_COUNT_BG, BADGE_COUNT_FG } from '../lib/badgeTokens'
import Tooltip from './ui/Tooltip'
import { NAV_ICONS, NAV_LABELS } from '../lib/navigationCanon'
import { RefreshPill } from './ui/NavigationPill'

// A real "Refresh" button (no longer a "Missing data?" warning; no visible keyboard shortcut).
// `loading` spins the icon, disables the button, and swaps the label to "Refreshing…". The refresh
// behavior is the caller's: Connect passes a soft-refetch handler + its `refreshing` flag; with no
// onClick it falls back to a hard browser reload (main nav, unchanged).
export function RefreshHint({ onClick, tooltipLabel, loading = false, disabled = false }) {
  const handleClick = onClick ?? (() => window.location.reload())
  const isDisabled = disabled || loading
  const tipLabel = tooltipLabel ?? 'Refresh app'

  return (
    <div style={{ display:'flex', alignItems:'center', marginLeft:'auto', paddingRight:4, flexShrink:0, alignSelf:'center', fontFamily:'Plus Jakarta Sans, sans-serif' }}>
      <Tooltip label={tipLabel} placement="bottom">
      <RefreshPill onClick={handleClick} disabled={isDisabled} loading={loading} />
      </Tooltip>
    </div>
  )
}

const TABS = [
  { id: 'overview',   label: NAV_LABELS.atAGlance,       Icon: NAV_ICONS.atAGlance },
  { id: 'profiles',   label: NAV_LABELS.studentProfiles, Icon: NAV_ICONS.studentProfiles },
  { id: 'interviews', label: NAV_LABELS.interviews,      Icon: NAV_ICONS.interviews },
  { id: 'rotation',   label: NAV_LABELS.rotation,        Icon: NAV_ICONS.rotation },
  { id: 'evaluation', label: NAV_LABELS.evaluation,      Icon: NAV_ICONS.evaluation },
]

export default function UnifiedNav({
  activeTab, ivSessions = [], onSwitchTab, activeCohortId,
  // kept in signature for backward compat with App.jsx call site:
  cohorts, cohortId, activeCohort, onSelectCohort, onNewCohort, onEditCohort,
  students, units, matches, onSelectStudent, onSelectUnit,
}) {
  const irBadge = ivSessions.filter(s => s.self_scheduled && !s.teams_meeting_booked).length
  const { data: unreadData } = useUnreadStudents(activeCohortId)
  const spBadge = unreadData?.count || 0

  return (
    // ASPIRE-CHART: layout moved to .chart-nav (chartTokens.css). The tab row
    // scrolls horizontally on narrow screens instead of overflowing the page.
    <nav className="chart-nav" aria-label="Workspaces">
      {TABS.map(({ id, label, Icon }) => {
        const isActive   = activeTab === id
        const tourTarget = {
          overview:   'tab-aggregate',
          profiles:   'tab-student-profiles',
          interviews: 'tab-interview-rubric',
          rotation:   'tab-embed',
          evaluation: 'tab-evaluation',
        }[id] || `tab-${id}`

        return (
          <button
            key={id}
            onClick={() => onSwitchTab(id)}
            aria-label={`${label} tab`}
            aria-current={isActive ? 'page' : undefined}
            data-tour={tourTarget}
            className="chart-nav-tab"
            style={{
              borderBottom: isActive ? '2px solid var(--color-accent-primary,#1D2567)' : '2px solid transparent',
              color: isActive ? 'var(--color-accent-primary,#1D2567)' : 'var(--text-muted,#6B7280)',
              fontWeight: isActive ? 600 : 500,
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-caption,#374151)' }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-muted,#6B7280)' }}
          >
            <Icon size={16} aria-hidden="true" />

            {label}

            {id === 'profiles' && spBadge > 0 && (
              <span style={{
                background: BADGE_COUNT_BG, color: BADGE_COUNT_FG,
                borderRadius: 999, padding: '1px 7px',
                fontSize: 11, fontWeight: 700,
                fontVariantNumeric: 'tabular-nums', lineHeight: 1.4,
              }}>
                {spBadge >= 10 ? '9+' : spBadge}
              </span>
            )}
            {id === 'interviews' && irBadge > 0 && (
              <span style={{
                background: BADGE_COUNT_BG, color: BADGE_COUNT_FG,
                borderRadius: 999, padding: '1px 7px',
                fontSize: 11, fontWeight: 700,
                fontVariantNumeric: 'tabular-nums', lineHeight: 1.4,
              }}>
                {irBadge >= 10 ? '9+' : irBadge}
              </span>
            )}
          </button>
        )
      })}

      <div className="chart-nav-refresh">
        <RefreshHint />
      </div>
    </nav>
  )
}
