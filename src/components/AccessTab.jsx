import { useState, useRef, useEffect } from 'react'
import { ASPIRE_STATUSES } from '../lib/constants'
import { displayName, downloadCSV, getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'

const STAGE1_ACTION_LABELS = {
  add_non_employee:  'Add Non-Employee',
  assignment_change: 'Assignment Change',
  extend_end_date:   'Extend Project End Date',
  reactivate:        'Reactivate',
  not_applicable:    'Not Applicable',
}

const CEDARS_STATUS_OPTIONS = [
  { value: 'new',      label: 'New to Cedars-Sinai' },
  { value: 'former',   label: 'Former Student or Rotation' },
  { value: 'employee', label: 'Current Cedars-Sinai Employee or Volunteer' },
]

export default function AccessTab({ students, onUpdate, focusStudentId }) {
  const [sortBy,       setSortBy]       = useState('last_name')
  const [sortDir,      setSortDir]      = useState('asc')
  const [filterSchool, setFilterSchool] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const schools = [...new Set(students.map(s => s.school).filter(Boolean))].sort()

  const statusCounts = { not_started:0, stage1_pending:0, account_active:0, cslink_pending:0, complete:0 }
  students.forEach(s => { statusCounts[getCsLinkStatus(s)]++ })

  let filtered = students
  if (filterSchool) filtered = filtered.filter(s => s.school === filterSchool)
  if (filterStatus) filtered = filtered.filter(s => s.status === filterStatus)

  const sorted = [...filtered].sort((a, b) => {
    const av = (sortBy === 'last_name' ? (a.last_name || a.name || '') : (a.school || '')).toLowerCase()
    const bv = (sortBy === 'last_name' ? (b.last_name || b.name || '') : (b.school || '')).toLowerCase()
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const toggleSort = field => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }

  const exportCSV = () => {
    const headers = [
      'Student Name', 'School', 'Cedars-Sinai Status', 'Step 2 Action',
      'Step 2 Submitted Date', 'Step 3 Complete Date',
      'CS-Link Requested Date', 'CS-Link Complete Date',
      'CS Access Notes', 'Workflow Status',
    ]
    const rows = sorted.map(s => [
      displayName(s), s.school || '',
      CEDARS_STATUS_OPTIONS.find(o => o.value === s.cs_cedars_status)?.label || s.cs_cedars_status || '',
      STAGE1_ACTION_LABELS[s.cs_stage1_action] || s.cs_stage1_action || '',
      s.cs_stage1_submitted_date || '',
      s.cs_stage1_complete_date  || '',
      s.cs_link_requested_date   || '',
      s.cs_link_complete_date    || '',
      s.cs_access_notes          || '',
      CS_LINK_STATUS_CONFIG[getCsLinkStatus(s)]?.label || '',
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    downloadCSV(csv, `aspire-cslink-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div className="access-tab">

      {/* Compact stats */}
      <div className="am-compact-stats">
        {Object.entries(CS_LINK_STATUS_CONFIG).map(([key, cfg]) => (
          <span key={key} className="am-stat-pill"
            style={{ color: cfg.text, fontWeight: statusCounts[key] > 0 ? 700 : 400 }}>
            {cfg.label}: <strong>{statusCounts[key]}</strong>
          </span>
        ))}
      </div>

      {/* Filter row */}
      <div className="am-filter-row">
        <select className="filter-select" value={filterSchool} onChange={e => setFilterSchool(e.target.value)}>
          <option value="">All Schools</option>
          {schools.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All ASPIRE Statuses</option>
          {ASPIRE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={exportCSV}>
          ↓ Export Access Log CSV
        </button>
      </div>

      {/* Table */}
      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              <th className="am-th am-sortable" onClick={() => toggleSort('last_name')}>
                Student Name&nbsp;{sortBy === 'last_name' ? (sortDir === 'asc' ? '↑' : '↓') : <span className="am-sort-icon">↕</span>}
              </th>
              <th className="am-th am-sortable" onClick={() => toggleSort('school')}>
                School&nbsp;{sortBy === 'school' ? (sortDir === 'asc' ? '↑' : '↓') : <span className="am-sort-icon">↕</span>}
              </th>
              <th className="am-th">Cedars-Sinai Status</th>
              <th className="am-th">Step 2 — Service Center</th>
              <th className="am-th">Step 3 — Account Active</th>
              <th className="am-th">Step 4 — CS-Link</th>
              <th className="am-th">Status</th>
              <th className="am-th">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={8} className="am-empty">No students match the current filters.</td></tr>
            ) : sorted.map(s => (
              <AccessRow key={s.id} student={s} onUpdate={onUpdate} isHighlighted={focusStudentId === s.id} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AccessRow({ student, onUpdate, isHighlighted }) {
  const [data,   setData]   = useState({ ...student })
  const [imgErr, setImgErr] = useState(false)
  const timerRef = useRef(null)

  // Re-sync whenever the student prop changes (e.g. side panel updated a field)
  useEffect(() => { setData({ ...student }) }, [student])

  const save = (field, value) => {
    setData(p => ({ ...p, [field]: value }))
    onUpdate(student.id, { [field]: value })
  }
  const saveDebounced = (field, value) => {
    setData(p => ({ ...p, [field]: value }))
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onUpdate(student.id, { [field]: value }), 500)
  }

  const status    = getCsLinkStatus(data)
  const statusCfg = CS_LINK_STATUS_CONFIG[status]

  return (
    <tr id={`access-row-${student.id}`} className={`am-row${isHighlighted ? ' am-row-highlight' : ''}`}>

      {/* Col 1: Student Name — avatar + name */}
      <td className="am-td am-td-name">
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {student.headshot_url && !imgErr
            ? <img src={student.headshot_url} alt="" onError={() => setImgErr(true)}
                style={{ width:32, height:32, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
            : <div style={{ width:32, height:32, borderRadius:'50%', background:'#1d2567', color:'#fff',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:11, fontWeight:700, flexShrink:0 }}>
                {`${(student.first_name||'')[0]||''}${(student.last_name||'')[0]||''}`.toUpperCase()||'?'}
              </div>
          }
          <span>{displayName(student)}</span>
        </div>
      </td>

      {/* Col 2: School */}
      <td className="am-td am-td-school">{student.school || '—'}</td>

      {/* Col 3: Cedars-Sinai Status */}
      <td className="am-td">
        <select className="am-select" value={data.cs_cedars_status || ''}
          onChange={e => {
            const v = e.target.value
            const extras = v === 'employee'
              ? { cs_stage1_action:'not_applicable', cs_stage1_submitted:true, cs_stage1_complete:true }
              : v === 'new' ? { cs_stage1_action:'add_non_employee', cs_stage1_submitted:false, cs_stage1_complete:false }
              : { cs_stage1_action:'', cs_stage1_submitted:false, cs_stage1_complete:false }
            setData(p => ({ ...p, cs_cedars_status:v, ...extras }))
            onUpdate(student.id, { cs_cedars_status:v, ...extras })
          }}>
          <option value="">—</option>
          {CEDARS_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>

      {/* Col 4: Step 2 — Service Center Request */}
      <td className="am-td">
        {data.cs_stage1_action
          ? <div style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', marginBottom:5 }}>
              {STAGE1_ACTION_LABELS[data.cs_stage1_action] || data.cs_stage1_action}
            </div>
          : <div style={{ fontSize:11, color:'#9ca3af', marginBottom:5 }}>—</div>
        }
        {data.cs_stage1_action && data.cs_stage1_action !== 'not_applicable' && (
          <div className="am-access-cell">
            <label style={{ fontSize:11, color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
              <input type="checkbox" className="am-checkbox" checked={data.cs_stage1_submitted || false}
                onChange={e => save('cs_stage1_submitted', e.target.checked)} />
              Submitted
            </label>
            {data.cs_stage1_submitted && (
              <input type="text" className="am-date-input" value={data.cs_stage1_submitted_date || ''}
                onChange={e => saveDebounced('cs_stage1_submitted_date', e.target.value)} placeholder="Date" />
            )}
          </div>
        )}
      </td>

      {/* Col 5: Step 3 — Account Active */}
      <td className="am-td">
        <div className="am-access-cell">
          <input type="checkbox" className="am-checkbox" checked={data.cs_stage1_complete || false}
            onChange={e => save('cs_stage1_complete', e.target.checked)} />
          {data.cs_stage1_complete && (
            <input type="text" className="am-date-input" value={data.cs_stage1_complete_date || ''}
              onChange={e => saveDebounced('cs_stage1_complete_date', e.target.value)} placeholder="Date" />
          )}
        </div>
      </td>

      {/* Col 6: Step 4 — CS-Link (Requested + Complete stacked) */}
      <td className="am-td">
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div className="am-access-cell">
            <label style={{ fontSize:11, color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
              <input type="checkbox" className="am-checkbox" checked={data.cs_link_requested || false}
                onChange={e => save('cs_link_requested', e.target.checked)} />
              Requested
            </label>
            {data.cs_link_requested && (
              <input type="text" className="am-date-input" value={data.cs_link_requested_date || ''}
                onChange={e => saveDebounced('cs_link_requested_date', e.target.value)} placeholder="Date" />
            )}
          </div>
          <div className="am-access-cell">
            <label style={{ fontSize:11, color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
              <input type="checkbox" className="am-checkbox" checked={data.cs_link_complete || false}
                onChange={e => save('cs_link_complete', e.target.checked)} />
              Complete
            </label>
            {data.cs_link_complete && (
              <input type="text" className="am-date-input" value={data.cs_link_complete_date || ''}
                onChange={e => saveDebounced('cs_link_complete_date', e.target.value)} placeholder="Date" />
            )}
          </div>
        </div>
      </td>

      {/* Col 7: Status badge */}
      <td className="am-td">
        <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20,
          background:statusCfg.bg, color:statusCfg.text, whiteSpace:'nowrap' }}>
          {statusCfg.label}
        </span>
      </td>

      {/* Col 8: Notes */}
      <td className="am-td">
        <input className="am-notes-input" type="text" value={data.cs_access_notes || ''}
          onChange={e => saveDebounced('cs_access_notes', e.target.value)} placeholder="Notes…" />
      </td>
    </tr>
  )
}
