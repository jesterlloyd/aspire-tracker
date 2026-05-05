import { useState, useRef } from 'react'
import { ASPIRE_STATUSES } from '../lib/constants'
import { displayName, downloadCSV, getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'

const STATUS_CLASS = {
  'Form Sent':       'badge-gray',
  'Pending Outreach':'badge-pending',
  'Interviewed':     'badge-purple',
  'Accepted':        'badge-green',
  'Active Rotation': 'badge-teal',
  'Completed':       'badge-navy',
  'Declined':        'badge-red',
}

const STAGE1_ACTION_LABELS = {
  add_non_employee:  'Add Non-Employee',
  assignment_change: 'Assignment Change',
  extend_end_date:   'Extend Project End Date',
  reactivate:        'Reactivate',
  not_applicable:    'Not Applicable',
}

const CEDARS_STATUS_OPTIONS = [
  { value: 'new',      label: 'New' },
  { value: 'former',   label: 'Former' },
  { value: 'employee', label: 'Employee' },
]

export default function AccessTab({ students, onUpdate, focusStudentId }) {
  const [sortBy,         setSortBy]         = useState('last_name')
  const [sortDir,        setSortDir]        = useState('asc')
  const [filterSchool,   setFilterSchool]   = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')
  const [incompleteOnly, setIncompleteOnly] = useState(false)

  const schools = [...new Set(students.map(s => s.school).filter(Boolean))].sort()

  // Stats using new status model
  const statusCounts = { not_started:0, stage1_pending:0, account_active:0, cslink_pending:0, complete:0 }
  students.forEach(s => { statusCounts[getCsLinkStatus(s)]++ })

  let filtered = students
  if (filterSchool)   filtered = filtered.filter(s => s.school === filterSchool)
  if (filterStatus)   filtered = filtered.filter(s => s.status === filterStatus)
  if (incompleteOnly) filtered = filtered.filter(s => getCsLinkStatus(s) !== 'complete')

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
      'Student Name', 'School', 'Cedars Status', 'Stage 1 Action',
      'Stage 1 Submitted Date', 'Stage 1 Complete Date',
      'CS-Link Requested Date', 'CS-Link Complete Date',
      'CS Access Notes', 'Workflow Status',
    ]
    const rows = sorted.map(s => [
      displayName(s), s.school || '',
      s.cs_cedars_status || '',
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
        <label className="am-incomplete-toggle">
          <input type="checkbox" checked={incompleteOnly} onChange={e => setIncompleteOnly(e.target.checked)} />
          <span>Show incomplete only</span>
        </label>
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
              <th className="am-th">Cedars Status</th>
              <th className="am-th">Stage 1 Action</th>
              <th className="am-th">Stage 1 Done</th>
              <th className="am-th">CS-Link Done</th>
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
  const [data, setData] = useState({ ...student })
  const timerRef = useRef(null)

  const save = (field, value) => {
    setData(p => ({ ...p, [field]: value }))
    onUpdate(student.id, { [field]: value })
  }
  const saveDebounced = (field, value) => {
    setData(p => ({ ...p, [field]: value }))
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onUpdate(student.id, { [field]: value }), 600)
  }

  const status    = getCsLinkStatus(data)
  const statusCfg = CS_LINK_STATUS_CONFIG[status]

  return (
    <tr id={`access-row-${student.id}`} className={`am-row${isHighlighted ? ' am-row-highlight' : ''}`}>
      <td className="am-td am-td-name">{displayName(student)}</td>
      <td className="am-td am-td-school">{student.school || '—'}</td>

      {/* Cedars Status dropdown */}
      <td className="am-td">
        <select className="am-notes-input" style={{ width:100 }} value={data.cs_cedars_status||''}
          onChange={e => {
            const v = e.target.value
            const extras = v === 'employee'
              ? { cs_stage1_action:'not_applicable', cs_stage1_submitted:true, cs_stage1_complete:true }
              : v === 'new' ? { cs_stage1_action:'add_non_employee' } : {}
            setData(p => ({ ...p, cs_cedars_status:v, ...extras }))
            onUpdate(student.id, { cs_cedars_status:v, ...extras })
          }}>
          <option value="">—</option>
          {CEDARS_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>

      {/* Stage 1 Action label */}
      <td className="am-td" style={{ fontSize:12, color:'var(--text-secondary)' }}>
        {data.cs_stage1_action ? (STAGE1_ACTION_LABELS[data.cs_stage1_action] || data.cs_stage1_action) : '—'}
      </td>

      {/* Stage 1 Complete */}
      <td className="am-td">
        <div className="am-access-cell">
          <input type="checkbox" className="am-checkbox" checked={data.cs_stage1_complete||false}
            onChange={e => save('cs_stage1_complete', e.target.checked)} />
          {data.cs_stage1_complete && (
            <input type="text" className="am-date-input" value={data.cs_stage1_complete_date||''}
              onChange={e => saveDebounced('cs_stage1_complete_date', e.target.value)} placeholder="Date" />
          )}
        </div>
      </td>

      {/* CS-Link Complete */}
      <td className="am-td">
        <div className="am-access-cell">
          <input type="checkbox" className="am-checkbox" checked={data.cs_link_complete||false}
            onChange={e => save('cs_link_complete', e.target.checked)} />
          {data.cs_link_complete && (
            <input type="text" className="am-date-input" value={data.cs_link_complete_date||''}
              onChange={e => saveDebounced('cs_link_complete_date', e.target.value)} placeholder="Date" />
          )}
        </div>
      </td>

      {/* Status badge */}
      <td className="am-td">
        <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:statusCfg.bg, color:statusCfg.text, whiteSpace:'nowrap' }}>
          {statusCfg.label}
        </span>
      </td>

      {/* Notes */}
      <td className="am-td">
        <input className="am-notes-input" type="text" value={data.cs_access_notes||''}
          onChange={e => saveDebounced('cs_access_notes', e.target.value)} placeholder="Notes…" />
      </td>
    </tr>
  )
}
