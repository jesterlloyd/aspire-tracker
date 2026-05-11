import { useState, useEffect } from 'react'
import ImportStudentsCSV from './ImportStudentsCSV'
import { getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { ASPIRE_STATUSES } from '../lib/statuses'
import StatusLegendPopover from './StatusLegendPopover'

function gpaBadge(gpa) {
  if (gpa == null) return { text: 'GPA: N/A', bg: 'var(--sand)', color: 'var(--raven)' }
  const v = parseFloat(gpa)
  if (v >= 3.5) return { text: `GPA: ${v.toFixed(2)}`, bg: '#dcfce7', color: '#166534' }
  if (v >= 3.0) return { text: `GPA: ${v.toFixed(2)}`, bg: '#fef3c7', color: '#92400e' }
  return { text: `GPA: ${v.toFixed(2)}`, bg: 'var(--sand)', color: 'var(--raven)' }
}

export default function StudentListPanel({
  students, allStudents, selectedStudentId, onSelect,
  localSearch, setLocalSearch, filterSchool, setFilterSchool,
  filterStatus, setFilterStatus, sortBy, setSortBy,
  needsAttention, setNeedsAttention,
  cohortId, onRefresh, onExportCSV, onAddStudent,
  compressed = false,
}) {
  const [showImport,  setShowImport]  = useState(false)
  const [imgErrors,   setImgErrors]   = useState({})

  // Clear all image errors when the underlying student list changes (cohort switch, import, etc.)
  useEffect(() => { setImgErrors({}) }, [allStudents])

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
        <button className={`pl-needs-btn${needsAttention ? ' pl-needs-active' : ''}`}
          onClick={() => setNeedsAttention(p => !p)}>
          ⚠ Review Needed
        </button>
        <button className="btn-import-students" onClick={() => setShowImport(true)} title="Import from CSV">
          ↑ Import
        </button>
        {onAddStudent && (
          <button className="btn-import-students" onClick={onAddStudent} title="Add student">
            + Add
          </button>
        )}
        {onExportCSV && (
          <button className="btn-import-students" onClick={onExportCSV} title="Export CSV">
            ↓ Export
          </button>
        )}
      </div>

      <div className="pl-meta">{students.length} of {allStudents.length} students</div>

      {/* Rows */}
      <div className="pl-list">
        {students.length === 0 ? (
          <div className="pl-empty">No students match the current filters.</div>
        ) : students.map(s => {
          const initials = `${(s.first_name||'')[0]||''}${(s.last_name||'')[0]||''}`.toUpperCase() || '?'
          const name = `${s.last_name||''}${s.last_name&&s.first_name?', ':''}${s.first_name||''}` || s.name || '—'
          const gpa    = gpaBadge(s.cumulative_gpa)
          const csKey  = getCsLinkStatus(s)
          const acc    = CS_LINK_STATUS_CONFIG[csKey]
          const sel = s.id === selectedStudentId
          const hasContact = s.personal_email?.trim() || s.phone?.trim()

          return (
            <div key={s.id}
              className={`pl-row${sel ? ' pl-selected' : ''}`}
              onClick={() => onSelect(s.id)}>
              {/* Avatar */}
              {s.headshot_url && !imgErrors[s.id]
                ? <img src={s.headshot_url} alt={`${s.first_name} ${s.last_name}`} className="pl-avatar-img"
                    onError={() => setImgErrors(p => ({ ...p, [s.id]: true }))} />
                : <div className="pl-avatar-initials">{initials}</div>
              }
              {/* Center */}
              <div className="pl-center">
                <div className="pl-name">{name}</div>
                <div className="pl-school">
                  {s.school || '—'}{s.program_type ? ` · ${s.program_type}` : ''}
                </div>
                {!compressed && (hasContact ? (
                  <div className="pl-contact">
                    {s.personal_email}{s.personal_email && s.phone ? ' · ' : ''}{s.phone}
                  </div>
                ) : (
                  <div className="pl-contact pl-contact-missing">Personal info not yet submitted</div>
                ))}
              </div>
              {/* Right badges */}
              <div className="pl-right">
                <span style={{ fontSize:11, fontWeight:600, padding:'1px 6px', borderRadius:4, background:gpa.bg, color:gpa.color }}>
                  {gpa.text}
                </span>
                {s.status && (() => { const cfg = ASPIRE_STATUS_CONFIG[s.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']; return <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}` }}>{s.status}</span> })()}
                <span style={{ fontSize:11, fontWeight:600, padding:'1px 6px', borderRadius:4, background:acc.bg, color:acc.text }}>
                  {acc.label}
                </span>
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
