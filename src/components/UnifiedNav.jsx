import { useEffect } from 'react'
import { useUnreadStudents } from '../hooks/useUnreadStudents'

// ── Tab icons ─────────────────────────────────────────────────────────────────
function IconBarChart() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
}
function IconUsers() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
}
function IconCalendar() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 16 11 18 15 14"/></svg>
}
function IconNetwork() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/></svg>
}

// mark: acronym badge text
// id: internal routing key — never changed
const TABS = [
  { id:'overview',   mark:'A',  label:'Aggregate',      sub:'Program overview',      Icon:IconBarChart },
  { id:'profiles',   mark:'SP', label:'Student Profiles',sub:'Records & readiness',   Icon:IconUsers },
  { id:'interviews', mark:'IR', label:'Interview Room',  sub:'Scheduling & scoring',  Icon:IconCalendar },
  { id:'matching',   mark:'E',  label:'Embed',           sub:'Matching board',         Icon:IconNetwork },
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
      background: '#FAFAF7',
      borderBottom: '1px solid rgba(29,37,103,0.08)',
      padding: '0 24px',
      display: 'flex',
      alignItems: 'stretch',
      fontFamily: 'DM Sans, sans-serif',
    }}>
      {TABS.map(({ id, mark, label, sub, Icon }) => {
        const isActive   = activeTab === id
        const tourTarget = { overview:'tab-aggregate', profiles:'tab-student-profiles', interviews:'tab-interview-rubric', matching:'tab-embed' }[id] || `tab-${id}`

        return (
          <button
            key={id}
            onClick={() => onSwitchTab(id)}
            aria-label={`${label} tab`}
            data-tour={tourTarget}
            style={{
              position: 'relative',
              padding: '14px 16px 12px',
              border: 'none',
              borderBottom: isActive ? '2px solid #1D2567' : '2px solid transparent',
              background: 'none',
              color: isActive ? '#1D2567' : '#6B7280',
              fontFamily: 'DM Sans, sans-serif',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 9,
              transition: 'color 0.15s, border-color 0.15s',
              flexShrink: 0,
              marginBottom: -1,
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = '#374151' }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = '#6B7280' }}
          >
            {/* Acronym badge */}
            <span style={{
              width: 22, height: 22, borderRadius: 5, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, letterSpacing: '-0.02em',
              background: isActive ? '#1D2567' : '#EDEEF4',
              color: isActive ? '#fff' : '#1D2567',
              border: isActive ? '1px solid #1D2567' : '1px solid rgba(29,37,103,0.08)',
            }}>
              {mark}
            </span>

            {/* Two-line label */}
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                {label}
                {/* SP unread badge */}
                {id === 'profiles' && spBadge > 0 && (
                  <span style={{
                    background: '#930045', color: '#fff',
                    borderRadius: 999, padding: '1px 7px',
                    fontSize: 11, fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1.4,
                  }}>
                    {spBadge >= 10 ? '9+' : spBadge}
                  </span>
                )}
                {/* IR notification badge */}
                {id === 'interviews' && irBadge > 0 && (
                  <span style={{
                    background: '#930045', color: '#fff',
                    borderRadius: 999, padding: '1px 7px',
                    fontSize: 11, fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1.4,
                  }}>
                    {irBadge >= 10 ? '9+' : irBadge}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10.5, color: isActive ? 'rgba(29,37,103,0.45)' : '#98A2B3', marginTop: 2, fontWeight: 400 }}>
                {sub}
              </div>
            </div>
          </button>
        )
      })}
    </nav>
  )
}
