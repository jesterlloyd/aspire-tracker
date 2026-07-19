import { RefreshCw } from 'lucide-react'
import { useUnreadStudents } from '../hooks/useUnreadStudents'
import { BADGE_COUNT_BG, BADGE_COUNT_FG } from '../lib/badgeTokens'
import Tooltip from './ui/Tooltip'

// A real "Refresh" button (no longer a "Missing data?" warning; no visible keyboard shortcut).
// `loading` spins the icon, disables the button, and swaps the label to "Refreshing…". The refresh
// behavior is the caller's: Connect passes a soft-refetch handler + its `refreshing` flag; with no
// onClick it falls back to a hard browser reload (main nav, unchanged).
export function RefreshHint({ onClick, tooltipLabel, loading = false, disabled = false }) {
  const handleClick = onClick ?? (() => window.location.reload())
  const isDisabled = disabled || loading
  const tipLabel = tooltipLabel ?? 'Refresh app'

  return (
    <div style={{ display:'flex', alignItems:'center', marginLeft:'auto', paddingRight:4, flexShrink:0, alignSelf:'center', fontFamily:'DM Sans, sans-serif' }}>
      <Tooltip label={tipLabel} placement="bottom">
      <button
        onClick={handleClick}
        disabled={isDisabled}
        aria-label="Refresh"
        aria-busy={loading}
        style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 12px', background:'rgba(29,37,103,0.04)', border:'1px solid rgba(29,37,103,0.12)', borderRadius:7, color: loading ? '#1D2567' : '#475467', fontSize:12, fontWeight:600, fontFamily:'DM Sans, sans-serif', cursor: isDisabled ? 'default' : 'pointer', opacity: disabled && !loading ? 0.6 : 1, transition:'all 0.15s ease' }}
        onMouseEnter={e => { if (!isDisabled) { e.currentTarget.style.background='rgba(29,37,103,0.08)'; e.currentTarget.style.color='#1D2567' } }}
        onMouseLeave={e => { if (!isDisabled) { e.currentTarget.style.background='rgba(29,37,103,0.04)'; e.currentTarget.style.color='#475467' } }}
      >
        <RefreshCw size={13} strokeWidth={2.25} aria-hidden="true" style={{ animation: loading ? 'spin 0.8s linear infinite' : undefined }} />
        <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
      </button>
      </Tooltip>
    </div>
  )
}

const TABS = [
  // ASPIRE-MASTHEAD: A-name preserved by owner decision (the A-SP-I-R-E
  // mnemonic stays); 'At a Glance' replaces the database word 'Aggregate'.
  // The route is unchanged: /aggregate.
  { id: 'overview',   label: 'At a Glance',      chip: 'A'  },
  { id: 'profiles',   label: 'Student Profiles', chip: 'SP' },
  { id: 'interviews', label: 'Interviews',        chip: 'I'  },
  { id: 'rotation',   label: 'Rotation',          chip: 'R'  },
  { id: 'evaluation', label: 'Evaluation',        chip: 'E'  },
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
      {TABS.map(({ id, label, chip }) => {
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
            {/* ASPIRE mnemonic chip - quiet, always muted grey; hidden on phones */}
            <span className="chart-nav-chip" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              height: 20, minWidth: chip.length > 1 ? 26 : 20,
              padding: chip.length > 1 ? '0 4px' : 0,
              borderRadius: 4, border: '1px solid #8B8F99',
              fontSize: 10, fontWeight: 600, letterSpacing: '0.01em',
              color: '#8B8F99', background: 'transparent',
              flexShrink: 0, lineHeight: 1,
            }}>
              {chip}
            </span>

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
