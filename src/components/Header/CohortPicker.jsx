// WS2.0: extracted verbatim from App.jsx header (Zone 2 - cohort picker). No behavior
// change. State/handlers remain owned by App.jsx and arrive as props. The header-only
// helpers (status colors, date formatting, chevron) moved here with the JSX.
import Tooltip from '../ui/Tooltip'

const COHORT_STATUS_COLORS = {
  Planning:  { bg:'#dbeafe', color:'#1d4ed8' },
  Active:    { bg:'#dcfce7', color:'#166534' },
  Completed: { bg:'#f3f4f6', color:'#6b7280' },
  Archived:  { bg:'#f3f4f6', color:'#9ca3af' },
}

function fmtCohortDate(d) {
  if (!d) return ''
  const s = typeof d === 'string' ? d : ''
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, day] = s.split('T')[0].split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month:'short', day:'numeric' })
  }
  const p = new Date(s); return isNaN(p.getTime()) ? s.replace(/,?\s*\d{4}/,'').trim() : p.toLocaleDateString('en-US', { month:'short', day:'numeric' })
}
function fmtCohortRange(a, b) {
  if (!a && !b) return ''; if (!b) return fmtCohortDate(a)
  return `${fmtCohortDate(a)} – ${fmtCohortDate(b)}`
}

function HeaderChevron() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
}

export default function CohortPicker({
  cohorts, cohortPickerRef, cohortOpen, setCohortOpen,
  activeCohort, activeCohortId, sortedCohorts, handleCohortSwitch,
  canEdit, setShowManageCohort, setShowNewCohort,
}) {
  if (!(cohorts.length > 0)) return null
  return (
    <div ref={cohortPickerRef} style={{ position:'relative', flexShrink:0 }}>
      <Tooltip label="Switch cohort" placement="bottom">
      <button
        data-tour="cohort-switcher"
        aria-label="Switch cohort"
        onClick={() => setCohortOpen(p => !p)}
        style={{
          display:'flex', alignItems:'center', gap:8,
          background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.10)',
          borderRadius:999, padding:'7px 13px',
          color:'#fff', cursor:'pointer', fontFamily:'DM Sans, sans-serif',
          transition:'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}
        onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.07)'}
      >
        <span style={{ width:6, height:6, borderRadius:'50%', flexShrink:0, background: activeCohort?.accepting_submissions ? '#5DD39E' : '#9ca3af', boxShadow: activeCohort?.accepting_submissions ? '0 0 0 3px rgba(93,211,158,0.2)' : 'none' }} />
        <span style={{ fontSize:10, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginRight:2 }}>Cohort</span>
        <span style={{ fontSize:12.5, fontWeight:600 }}>{activeCohort?.name || 'Select cohort'}</span>
        <span style={{ opacity:0.5, lineHeight:0, marginLeft:2 }}><HeaderChevron /></span>
      </button>
      </Tooltip>

      {cohortOpen && (
        <div style={{
          position:'absolute', top:'calc(100% + 6px)', right:0, width:380,
          background:'var(--pearl)', border:'1px solid #e5e7eb', borderRadius:12,
          boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:400, overflow:'hidden',
        }}>
          <div style={{ padding:'10px 14px 6px', fontSize:11, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Select Cohort</div>
          {sortedCohorts.map(c => {
            const isSel = c.id === activeCohortId
            const sc = COHORT_STATUS_COLORS[c.status] || { bg:'#f3f4f6', color:'#6b7280' }
            return (
              <div key={c.id}
                onClick={() => { handleCohortSwitch(c.id); setCohortOpen(false) }}
                style={{ padding:'14px 16px', cursor:'pointer', background: isSel ? '#e8edf8' : 'transparent', borderLeft: isSel ? '3px solid #1d2567' : '3px solid transparent', transition:'background 0.1s' }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background='var(--sand)' }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background='transparent' }}>
                <div style={{ fontSize:15, fontWeight:600, color:'#374151' }}>{c.name}</div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:3 }}>
                  <span style={{ fontSize:12, color:'#6b7280' }}>{fmtCohortRange(c.start_date, c.end_date) || ' '}</span>
                  <div style={{ display:'flex', gap:4, flexShrink:0, marginLeft:8 }}>
                    {c.status && <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20, background:sc.bg, color:sc.color }}>{c.status}</span>}
                    {c.accepting_submissions && <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20, background:'#dbeafe', color:'#1e40af', border:'1px solid #bfdbfe' }}>Accepting</span>}
                  </div>
                </div>
              </div>
            )
          })}
          {canEdit && (
            <div style={{ display:'flex', gap:8, padding:'10px 14px', borderTop:'1px solid #f3f4f6', background:'var(--sand)' }}>
              {activeCohort && <button onClick={() => { setShowManageCohort(true); setCohortOpen(false) }} style={{ flex:1, padding:'7px', background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, fontFamily:'DM Sans', fontSize:12, cursor:'pointer', color:'#374151' }}>✏ Edit Cohort</button>}
              <button onClick={() => { setShowNewCohort(true); setCohortOpen(false) }} style={{ flex:1, padding:'7px', background:'#1D2567', border:'none', borderRadius:8, fontFamily:'DM Sans', fontSize:12, fontWeight:600, cursor:'pointer', color:'#fff' }}>+ New Cohort</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
