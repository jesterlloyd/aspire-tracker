import { useState } from 'react'
import StudentAvatar from './StudentAvatar'
import ImportStudentsCSV from './ImportStudentsCSV'
import { getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { ASPIRE_STATUSES } from '../lib/statuses'
import StatusLegendPopover from './StatusLegendPopover'
import EmptyState from './EmptyState'
import { Users, Eye } from 'lucide-react'
import { calculateProfileCompletion, getCompletionColor } from '../lib/profileCompletion'
import { useAuth } from '../contexts/AuthContext'
import { useUnreadStudents } from '../hooks/useUnreadStudents'

// ── Small inline chip ─────────────────────────────────────────────────────────
function Chip({ label, bg, color, border }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap',
      background: bg, color, border: border ? `1px solid ${border}` : 'none',
    }}>{label}</span>
  )
}

export default function StudentListPanel({
  students, allStudents, selectedStudentId, onSelect,
  localSearch, setLocalSearch, filterSchool, setFilterSchool,
  filterStatus, setFilterStatus, sortBy, setSortBy,
  cohortId, onRefresh, onExportCSV, onAddStudent,
  units = [],
  compressed = false,
}) {
  const { canEdit } = useAuth()
  const [showImport,  setShowImport]  = useState(false)
  const { data: unreadData } = useUnreadStudents(cohortId)
  const unreadIds = unreadData?.unreadStudentIds || new Set()

  const schools  = [...new Set(allStudents.map(s => s.school).filter(Boolean))].sort()

  return (
    <div className="pl-container">
      {/* Controls */}
      <div className="pl-controls">
        <input className="search-input" style={{ flex:1, minWidth:120 }}
          placeholder="Search by name or email…"
          value={localSearch} onChange={e => setLocalSearch(e.target.value)} />
        <select className="filter-select" value={filterSchool} onChange={e => setFilterSchool(e.target.value)}>
          <option value="">All Schools</option>
          {schools.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
          <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {ASPIRE_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <StatusLegendPopover position="bottom-left" />
        </div>
        <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="last_name_asc">Last Name A–Z</option>
          <option value="last_name_desc">Last Name Z–A</option>
          <option value="school_asc">School A–Z</option>
          <option value="gpa_desc">GPA High–Low</option>
          <option value="status">ASPIRE Status</option>
          <option value="needs_attention">Review Needed First</option>
        </select>
        {canEdit && (
          <button className="btn-import-students" onClick={() => setShowImport(true)} title="Import from CSV">
            ↑ Import
          </button>
        )}
        {canEdit && onAddStudent && (
          <button className="btn-import-students" onClick={onAddStudent} title="Add student">
            + Add
          </button>
        )}
        {canEdit && onExportCSV && (
          <button className="btn-import-students" onClick={onExportCSV} title="Export CSV">
            ↓ Export
          </button>
        )}
      </div>

      {/* Rows */}
      <div className="pl-list">
        {students.length === 0 ? (
          allStudents.length === 0
            ? <EmptyState icon={<Users />}
                heading="No students in this cohort"
                subtext="Students are added when school coordinators submit the school form, or you can add them manually."
                action={canEdit ? onAddStudent : undefined}
                actionLabel="+ Add Student" />
            : <EmptyState compact icon={<Users />}
                heading="No students match this filter"
                subtext="Try a different status, school, or search term." />
        ) : students.map(s => {
          const name     = `${s.last_name||''}${s.last_name&&s.first_name?', ':''}${s.first_name||''}` || s.name || '—'
          const csKey    = getCsLinkStatus(s)
          const acc      = CS_LINK_STATUS_CONFIG[csKey]
          const sel      = s.id === selectedStudentId
          const isUnread = unreadIds.has(s.id)
          const completion = calculateProfileCompletion(s)
          const compColors = getCompletionColor(completion.status)

          // GPA chip
          const gpaVal   = parseFloat(s.cumulative_gpa)
          const gpaOk    = !isNaN(gpaVal) && gpaVal > 0
          const gpaBg    = gpaOk && gpaVal >= 3.5 ? '#dcfce7' : gpaOk && gpaVal >= 3.0 ? '#fef3c7' : 'var(--color-bg-elevated,#f3f4f6)'
          const gpaColor = gpaOk && gpaVal >= 3.5 ? '#166534' : gpaOk && gpaVal >= 3.0 ? '#92400e' : 'var(--text-muted,#6b7280)'

          // ASPIRE status chip
          const sChip = s.status ? (ASPIRE_STATUS_CONFIG[s.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']) : null

          // Placement or preferences
          const matchedUnit = s.matched_unit_id ? units.find(u => u.id === s.matched_unit_id) : null
          const isPlaced    = !!matchedUnit
          const mqLabel     = s.match_quality
            ? (s.match_quality === '1st' ? '1st choice match' : s.match_quality === '2nd' ? '2nd choice match' : s.match_quality === '3rd' ? '3rd choice match' : 'Other unit')
            : null
          const mqBg    = s.match_quality === '1st' ? '#dcfce7' : s.match_quality === '2nd' ? '#fef3c7' : '#f3f4f6'
          const mqColor = s.match_quality === '1st' ? '#166534' : s.match_quality === '2nd' ? '#92400e' : '#6b7280'
          const prefs   = [s.unit_preference_1, s.unit_preference_2, s.unit_preference_3].filter(Boolean)
          const prefLabels = ['1st', '2nd', '3rd']

          // Missing items (show at most 3)
          const missing3 = completion.missing.slice(0, 3).join(', ')

          // avatar size: 48px full list, 44px when compressed (drawer open)
          const avatarSz = compressed ? 44 : 48

          return (
            <div key={s.id}
              className={`pl-row${sel ? ' pl-selected' : ''}`}
              style={{
                alignItems: 'flex-start', padding: '10px 16px',
                display: 'grid',
                gridTemplateColumns: compressed
                  ? '40% 28% 25% 7%'
                  : '32% 14% 27% 20% 7%',
                gap: 8,
              }}
              onClick={() => onSelect(s.id)}>

              {/* COL 1: identity */}
              <div style={{ display:'flex', gap:10, minWidth:0, alignItems:'flex-start' }}>
                <StudentAvatar student={s} size={avatarSz} style={{ flexShrink:0, marginTop:1 }} />
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontWeight:isUnread?800:700, fontSize:compressed?13:14, color:'var(--text-heading,#191919)', display:'flex', alignItems:'center', gap:5, lineHeight:1.2 }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={name}>{name}</span>
                    {isUnread && <span title="New submission" style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, background:'var(--cs-red,#DC1E34)', display:'inline-block' }} />}
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-caption,#6b7280)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {s.school || '—'}{s.program_type ? ` · ${s.program_type}` : ''}
                  </div>
                  {!compressed && (
                    <div style={{ fontSize:10.5, color:'var(--text-muted,#9ca3af)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {s.personal_email || s.school_email
                        ? [s.personal_email||s.school_email, s.phone].filter(Boolean).join(' · ')
                        : <em>No contact info yet</em>}
                    </div>
                  )}
                </div>
              </div>

              {/* COL 2: readiness — compact horizontal bar + percentage */}
              {!compressed && (
                <div style={{ minWidth:0, paddingTop:5 }}>
                  <div style={{ height:4, borderRadius:2, background:'var(--color-bg-elevated,#f3f4f6)', width:'80%', marginBottom:4 }}>
                    <div style={{ width:`${completion.percentage}%`, height:'100%', borderRadius:2, background:'var(--color-accent-primary,#1D2567)', transition:'width 0.3s ease' }} />
                  </div>
                  <span style={{ fontSize:12, fontWeight:600, color:'var(--text-secondary,#4A5560)' }}>
                    {completion.percentage}%
                  </span>
                  {completion.percentage === 100 && (
                    <div style={{ fontSize:10, color:'var(--color-status-success,#166534)', marginTop:1 }}>✓ Complete</div>
                  )}
                </div>
              )}

              {/* COL 3: preferences or placement */}
              <div style={{ minWidth:0, paddingTop:3 }}>
                {isPlaced ? (
                  <>
                    <div style={{ fontSize:compressed?11:11.5, fontWeight:700, color:'var(--text-heading,#191919)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      Placed: {matchedUnit.unit_name}
                    </div>
                    {mqLabel && <Chip label={mqLabel} bg={mqBg} color={mqColor} />}
                  </>
                ) : prefs.length > 0 ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                    {prefs.slice(0,3).map((p, i) => (
                      <div key={i} style={{ display:'flex', gap:4, alignItems:'baseline' }}>
                        <span style={{ fontSize:9, fontWeight:700, color:'var(--text-muted,#9ca3af)', width:20, flexShrink:0 }}>{prefLabels[i]}</span>
                        <span style={{ fontSize:11, fontWeight:600, color:'var(--text-heading,#191919)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize:10, color:'var(--text-muted,#9ca3af)', fontStyle:'italic' }}>No preferences yet</span>
                )}
              </div>

              {/* COL 4: chips */}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:3, paddingTop:3, minWidth:0 }}>
                {gpaOk && <Chip label={`GPA ${gpaVal.toFixed(2)}`} bg={gpaBg} color={gpaColor} />}
                {sChip && <Chip label={s.status} bg={sChip.bg} color={sChip.text} border={sChip.border} />}
                <Chip label={acc.label} bg={acc.bg} color={acc.text} />
              </div>

              {/* COL 5: eye icon */}
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:4 }}>
                <button
                  onClick={e => { e.stopPropagation(); onSelect(s.id) }}
                  title="View profile"
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted,#9ca3af)', display:'flex', alignItems:'center', padding:2 }}
                  onMouseEnter={e => e.currentTarget.style.color='var(--color-accent-primary,#1D2567)'}
                  onMouseLeave={e => e.currentTarget.style.color='var(--text-muted,#9ca3af)'}
                >
                  <Eye size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {showImport && (
        <ImportStudentsCSV cohortId={cohortId} onImported={onRefresh} onClose={() => setShowImport(false)} />
      )}
    </div>
  )
}
