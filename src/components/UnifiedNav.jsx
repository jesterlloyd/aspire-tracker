import { useMemo } from 'react'
import { useUnreadStudents } from '../hooks/useUnreadStudents'

function RefreshHint() {
  const shortcut = useMemo(() => {
    if (typeof navigator === 'undefined') return '⌘R'
    const p = navigator.platform || '', ua = navigator.userAgent || ''
    return /Mac|iPhone|iPad|iPod/.test(p) || /Mac OS/.test(ua) ? '⌘R' : 'Ctrl+R'
  }, [])

  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'#98A2B3', fontFamily:'DM Sans, sans-serif', lineHeight:1, marginLeft:'auto', paddingRight:4, flexShrink:0 }}>
      <span style={{ whiteSpace:'nowrap' }}>Missing data? Refresh</span>
      <button
        onClick={() => window.location.reload()}
        title={`Refresh the app (${shortcut})`}
        aria-label="Refresh app"
        style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 8px', background:'rgba(29,37,103,0.04)', border:'1px solid rgba(29,37,103,0.10)', borderRadius:6, color:'#475467', fontSize:11, fontWeight:500, fontFamily:'DM Sans, sans-serif', cursor:'pointer', transition:'all 0.15s ease' }}
        onMouseEnter={e => { e.currentTarget.style.background='rgba(29,37,103,0.08)'; e.currentTarget.style.color='#1D2567' }}
        onMouseLeave={e => { e.currentTarget.style.background='rgba(29,37,103,0.04)'; e.currentTarget.style.color='#475467' }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
        <span>{shortcut}</span>
      </button>
    </div>
  )
}

const TABS = [
  { id: 'overview',   label: 'Aggregate' },
  { id: 'profiles',   label: 'Student Profiles' },
  { id: 'interviews', label: 'Interviews' },
  { id: 'rotation',   label: 'Rotation' },
  { id: 'evaluation', label: 'Evaluation' },
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
    <nav style={{
      background: 'var(--bg-card,#FAFAF7)',
      borderBottom: '1px solid var(--border-divider,rgba(29,37,103,0.08))',
      padding: '0 32px',
      display: 'flex',
      alignItems: 'stretch',
      fontFamily: 'DM Sans, sans-serif',
    }}>
      {TABS.map(({ id, label }) => {
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
            data-tour={tourTarget}
            style={{
              position: 'relative',
              padding: '0 16px',
              height: '100%',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--color-accent-primary,#1D2567)' : '2px solid transparent',
              background: 'none',
              color: isActive ? 'var(--color-accent-primary,#1D2567)' : 'var(--text-muted,#6B7280)',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'color 0.15s, border-color 0.15s',
              flexShrink: 0,
              marginBottom: -1,
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-caption,#374151)' }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-muted,#6B7280)' }}
          >
            {label}
            {id === 'profiles' && spBadge > 0 && (
              <span style={{
                background: '#930045', color: '#fff',
                borderRadius: 999, padding: '1px 7px',
                fontSize: 11, fontWeight: 700,
                fontVariantNumeric: 'tabular-nums', lineHeight: 1.4,
              }}>
                {spBadge >= 10 ? '9+' : spBadge}
              </span>
            )}
            {id === 'interviews' && irBadge > 0 && (
              <span style={{
                background: '#930045', color: '#fff',
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

      <RefreshHint />
    </nav>
  )
}
