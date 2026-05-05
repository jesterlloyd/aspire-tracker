import { useState, useRef } from 'react'
import { ASPIRE_STATUSES } from '../lib/constants'
import { displayName, downloadCSV } from '../lib/utils'

const STATUS_CLASS = {
  'Form Sent':       'badge-gray',
  'Pending Outreach':'badge-pending',
  'Interviewed':     'badge-purple',
  'Accepted':        'badge-green',
  'Active Rotation': 'badge-teal',
  'Completed':       'badge-navy',
  'Declined':        'badge-red',
}

const ACCESS_COLS = [
  { boolKey: 'access_non_employee',      dateKey: 'access_non_employee_date',       label: 'Non-Employee Access',   datePlaceholder: 'Date' },
  { boolKey: 'access_hybrid_student',    dateKey: 'access_hybrid_student_date',     label: 'Hybrid Student Nurse',  datePlaceholder: 'Date' },
  { boolKey: 'access_extended_end_date', dateKey: 'access_extended_end_date_value', label: 'Extended End Date',     datePlaceholder: 'New end date' },
  { boolKey: 'access_reactivated',       dateKey: 'access_reactivated_date',        label: 'Reactivated CW Access', datePlaceholder: 'Date' },
]

const allComplete = s => ACCESS_COLS.every(c => s[c.boolKey])

export default function AccessTab({ students, onUpdate, focusStudentId }) {
  const [sortBy,         setSortBy]         = useState('last_name')
  const [sortDir,        setSortDir]        = useState('asc')
  const [filterSchool,   setFilterSchool]   = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')
  const [incompleteOnly, setIncompleteOnly] = useState(false)

  const totalCount = students.length
  const nonEmpDone = students.filter(s => s.access_non_employee).length
  const hybridDone = students.filter(s => s.access_hybrid_student).length
  const allDone    = students.filter(allComplete).length

  let filtered = students
  if (filterSchool)   filtered = filtered.filter(s => s.school === filterSchool)
  if (filterStatus)   filtered = filtered.filter(s => s.status === filterStatus)
  if (incompleteOnly) filtered = filtered.filter(s => !allComplete(s))

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

  const schools = [...new Set(students.map(s => s.school).filter(Boolean))].sort()

  const exportCSV = () => {
    const headers = [
      'Student Name', 'School', 'Personal Email',
      'Non-Employee Access', 'Non-Employee Date',
      'Hybrid Student Access', 'Hybrid Student Date',
      'Extended End Date', 'Extended End Date Value',
      'Reactivated CW Access', 'Reactivated Date',
      'Access Notes',
    ]
    const rows = sorted.map(s => [
      displayName(s), s.school || '', s.personal_email || '',
      s.access_non_employee      ? 'Yes' : 'No', s.access_non_employee_date       || '',
      s.access_hybrid_student    ? 'Yes' : 'No', s.access_hybrid_student_date     || '',
      s.access_extended_end_date ? 'Yes' : 'No', s.access_extended_end_date_value || '',
      s.access_reactivated       ? 'Yes' : 'No', s.access_reactivated_date        || '',
      s.access_notes || '',
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    downloadCSV(csv, `aspire-access-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div className="access-tab">

      {/* ── Compact stats pills ── */}
      <div className="am-compact-stats">
        <span className="am-stat-pill">Non-Employee Done: <strong>{nonEmpDone}</strong></span>
        <span className="am-stat-pill">Hybrid Done: <strong>{hybridDone}</strong></span>
        <span className="am-stat-pill am-stat-pill-green">All Complete: <strong>{allDone}</strong></span>
      </div>

      {/* ── Filter row ── */}
      <div className="am-filter-row">
        <select className="filter-select" value={filterSchool} onChange={e => setFilterSchool(e.target.value)}>
          <option value="">All Schools</option>
          {schools.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
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

      {/* ── Table ── */}
      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              <th className="am-th am-sortable" onClick={() => toggleSort('last_name')}>
                Student Name&nbsp;
                {sortBy === 'last_name' ? (sortDir === 'asc' ? '↑' : '↓') : <span className="am-sort-icon">↕</span>}
              </th>
              <th className="am-th am-sortable" onClick={() => toggleSort('school')}>
                School&nbsp;
                {sortBy === 'school' ? (sortDir === 'asc' ? '↑' : '↓') : <span className="am-sort-icon">↕</span>}
              </th>
              <th className="am-th">Status</th>
              {ACCESS_COLS.map(c => (
                <th key={c.boolKey} className="am-th">{c.label}</th>
              ))}
              <th className="am-th">Access Notes</th>
              <th className="am-th">Progress</th>
              <th className="am-th"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="am-empty">No students match the current filters.</td>
              </tr>
            ) : (
              sorted.map(s => (
                <AccessRow
                  key={s.id}
                  student={s}
                  onUpdate={onUpdate}
                  isHighlighted={focusStudentId === s.id}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AccessRow({ student, onUpdate, isHighlighted }) {
  const [data,   setData]   = useState(student)
  const timerRef = useRef(null)

  const saveImmediate = (field, value) => {
    setData(prev => ({ ...prev, [field]: value }))
    onUpdate(student.id, { [field]: value })
  }
  const saveDebounced = (field, value) => {
    setData(prev => ({ ...prev, [field]: value }))
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onUpdate(student.id, { [field]: value }), 600)
  }

  const done = ACCESS_COLS.every(c => data[c.boolKey])

  return (
    <tr
      id={`access-row-${student.id}`}
      className={`am-row${isHighlighted ? ' am-row-highlight' : ''}`}
    >
      <td className="am-td am-td-name">{displayName(student)}</td>
      <td className="am-td am-td-school">{student.school || '—'}</td>
      <td className="am-td">
        {student.status && (
          <span className={`badge ${STATUS_CLASS[student.status] || 'badge-gray'}`}>
            {student.status}
          </span>
        )}
      </td>
      {ACCESS_COLS.map(c => (
        <td key={c.boolKey} className="am-td">
          <AccessCell
            checked={data[c.boolKey] || false}
            dateValue={data[c.dateKey] || ''}
            datePlaceholder={c.datePlaceholder}
            onCheck={v => saveImmediate(c.boolKey, v)}
            onDate={v  => saveDebounced(c.dateKey, v)}
          />
        </td>
      ))}
      <td className="am-td">
        <input
          className="am-notes-input"
          type="text"
          value={data.access_notes || ''}
          onChange={e => saveDebounced('access_notes', e.target.value)}
          placeholder="Notes…"
        />
      </td>
      <td className="am-td">
        {(() => {
          const n = ACCESS_COLS.filter(c => data[c.boolKey]).length
          const bg    = n === 4 ? '#dcfce7' : n === 0 ? '#f3f4f6' : '#fef3c7'
          const color = n === 4 ? '#166534' : n === 0 ? '#9ca3af' : '#92400e'
          const label = n === 4 ? '✓ Done' : `${n}/4`
          return <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:bg, color }}>{label}</span>
        })()}
      </td>
      <td className="am-td">
        {done && <span className="am-done-pill">All Done</span>}
      </td>
    </tr>
  )
}

function AccessCell({ checked, dateValue, datePlaceholder, onCheck, onDate }) {
  return (
    <div className="am-access-cell">
      <input
        type="checkbox"
        className="am-checkbox"
        checked={checked}
        onChange={e => onCheck(e.target.checked)}
      />
      {checked && (
        <input
          type="text"
          className="am-date-input"
          value={dateValue}
          onChange={e => onDate(e.target.value)}
          placeholder={datePlaceholder}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, bg, color, border }) {
  return (
    <div className="am-stat-card" style={{ background: bg, borderColor: border }}>
      <div className="am-stat-value" style={{ color }}>{value}</div>
      <div className="am-stat-label" style={{ color }}>{label}</div>
    </div>
  )
}
