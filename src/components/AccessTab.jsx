import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { displayName, getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'
import { isIsoDateString, isLegacyNonIsoDateValue, dateInputValue } from '../lib/csLinkDateUtils'
import StudentAvatar from './StudentAvatar'
import SortHeader from './shared/SortHeader'
import ServiceNowLink from './shared/ServiceNowLink'
import { SERVICENOW_LINKS, STAGE1_REQUESTS, stage1RequestsFor, tickedStage1Request, isLegacyNotApplicable, stage1ResetFor, tickPatch } from '../lib/csLinkServiceNow'

// CSLINK-DATE-PICKER-DATA-RECOVERY: the four CS-Link date columns are TEXT and may hold legacy
// non-ISO values. We only ever WRITE a date field the user actually touched. CSLINK-SERVICENOW-1:
// every change now autosaves as a patch of exactly the fields that changed, so an untouched legacy
// value is never sent at all.

const CEDARS_STATUS_OPTIONS = [
  { value: 'new',      label: 'New to Cedars-Sinai' },
  { value: 'former',   label: 'Former Student or Rotation' },
  { value: 'employee', label: 'Current Cedars-Sinai Employee or Volunteer' },
]

export default function AccessTab({ students, onUpdate, focusStudentId, toast }) {
  const [sortBy,       setSortBy]       = useState('last_name')
  const [sortDir,      setSortDir]      = useState('asc')

  const sorted = [...students].sort((a, b) => {
    const av = (sortBy === 'last_name' ? (a.last_name || a.name || '') : (a.school || '')).toLowerCase()
    const bv = (sortBy === 'last_name' ? (b.last_name || b.name || '') : (b.school || '')).toLowerCase()
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const toggleSort = field => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }

  return (
    <div className="access-tab">

      {/* CSLINK-SERVICENOW-1: the status strip that stood here is retired; the five KPI cards
          above the toolbar carry the same counts and filter the table. */}

      {/* Table */}
      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              {/* UI-CONSISTENCY-3: the shared sort header. Arrow only on the sorted column;
                  no resting glyph, matching the Evaluation table. */}
              <SortHeader sortKey="last_name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>Student Name</SortHeader>
              <SortHeader sortKey="school" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>School</SortHeader>
              <th className="am-th">Cedars-Sinai Status</th>
              <th className="am-th">Step 2, Service Center</th>
              <th className="am-th">Step 3, Account Active</th>
              <th className="am-th">Step 4, CS-Link</th>
              <th className="am-th">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={7} className="am-empty">No students match the current filters.</td></tr>
            ) : sorted.map(s => (
              <AccessRow key={s.id} student={s} onUpdate={onUpdate} isHighlighted={focusStudentId === s.id} toast={toast} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AccessRow({ student, onUpdate, isHighlighted, toast }) {
  const queryClient = useQueryClient()

  // null until student data is confirmed present - prevents rendering inputs
  // before fields arrive and prevents empty-string saves on uninitialized state.
  const [formData, setFormData] = useState(null)

  // Sync from server ONLY when:
  //   1. student.id is known
  //   2. formData hasn't been built for this student (_sourceStudentId differs)
  // Field-level deps catch deferred column arrivals (e.g., background refetch
  // that fills in a previously-null column after the row first mounted).
  useEffect(() => {
    if (!student?.id) return
    if (formData?._sourceStudentId === student.id) return
    setFormData({
      _sourceStudentId:         student.id,
      cs_cedars_status:         student.cs_cedars_status         ?? '',
      cs_stage1_action:         student.cs_stage1_action         ?? '',
      cs_stage1_submitted:      student.cs_stage1_submitted      ?? false,
      cs_stage1_submitted_date: student.cs_stage1_submitted_date ?? '',
      cs_stage1_complete:       student.cs_stage1_complete       ?? false,
      cs_stage1_complete_date:  student.cs_stage1_complete_date  ?? '',
      cs_link_requested:        student.cs_link_requested        ?? false,
      cs_link_requested_date:   student.cs_link_requested_date   ?? '',
      cs_link_complete:         student.cs_link_complete         ?? false,
      cs_link_complete_date:    student.cs_link_complete_date    ?? '',
    })
  }, [
    student?.id,
    student?.cs_cedars_status,
    student?.cs_stage1_action,
    student?.cs_stage1_submitted,
    student?.cs_stage1_submitted_date,
    student?.cs_stage1_complete,
    student?.cs_stage1_complete_date,
    student?.cs_link_requested,
    student?.cs_link_requested_date,
    student?.cs_link_complete,
    student?.cs_link_complete_date,
    formData?._sourceStudentId,
  ]) // eslint-disable-line react-hooks/exhaustive-deps

  // CSLINK-SERVICENOW-1 (Owner, 2026-09-10): every change saves itself; there is no Save button.
  // A tick or a status change saves at once; a typed date waits 800ms so a half-typed year is never
  // sent. Pending fields merge into ONE patch and saves run one at a time, in order, so a quick
  // tick-untick can never land out of order. Each save confirms with a toast; a failed one says so
  // and puts the stored values back on the row. The app has no CS-Link realtime channel, so the
  // row's own state stays the truth between saves.
  const pendingRef = useRef({})
  const timerRef   = useRef(null)
  const chainRef   = useRef(Promise.resolve())
  const studentRef = useRef(student)
  useEffect(() => { studentRef.current = student })

  const flush = () => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    const patch = pendingRef.current
    if (!Object.keys(patch).length) return
    pendingRef.current = {}
    chainRef.current = chainRef.current.then(async () => {
      const err = await onUpdate(student.id, patch)
      if (err) {
        const stored = studentRef.current
        setFormData(prev => {
          const back = { ...prev }
          for (const k of Object.keys(patch)) back[k] = stored?.[k] ?? (typeof prev[k] === 'boolean' ? false : '')
          return back
        })
        toast?.error('CS-Link not saved', `${displayName(student)}: the change did not save. Please try again.`)
        return
      }
      toast?.success('CS-Link saved', displayName(student))
      // Keep students_in_cohort cache fresh for Keith and other consumers
      queryClient.invalidateQueries({ queryKey: ['students_in_cohort', student.cohort_id] })
    })
  }
  const queueSave = (patch, { debounce = false } = {}) => {
    pendingRef.current = { ...pendingRef.current, ...patch }
    if (!debounce) return flush()
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 800)
  }
  // A date still waiting when the row unmounts (a filter change, a tab switch) is sent, not dropped.
  useEffect(() => () => flush(), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle a boolean field. Ticking fills the paired date with today (tickPatch) and saves box and
  // date together. Unticking keeps the date hidden but intact, so a re-tick restores it.
  const handleToggleBox = (boolField, extra = {}) => {
    const patch = { ...extra, ...tickPatch(formData, boolField, !formData[boolField]) }
    setFormData(prev => ({ ...prev, ...patch }))
    queueSave(patch)
  }

  // A Step 2 request tick. The first tick records which request went out; ticking the other
  // request switches it (date kept); ticking the ticked one clears Submitted.
  const handleToggleRequest = (action) => {
    if (tickedStage1Request(formData) === action) return handleToggleBox('cs_stage1_submitted')
    if (formData.cs_stage1_submitted) {
      setFormData(prev => ({ ...prev, cs_stage1_action: action }))
      return queueSave({ cs_stage1_action: action })
    }
    handleToggleBox('cs_stage1_submitted', { cs_stage1_action: action })
  }

  // A date edit shows at once and saves after the pause: a valid pick as ISO, a cleared picker as null.
  const handleChangeDate = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    queueSave({ [field]: isIsoDateString(value) ? value : null }, { debounce: true })
  }

  // Cedars-Sinai status cascades: setting the status also resets Steps 2 and 3; every status,
  // employees included, starts at Step 2 unticked (stage1ResetFor).
  const handleChangeCedarsStatus = (v) => {
    const reset = stage1ResetFor(v)
    setFormData(prev => ({ ...prev, cs_cedars_status: v, ...reset }))
    queueSave({ cs_cedars_status: v || null, ...reset, cs_stage1_action: reset.cs_stage1_action || null })
  }

  // Hold off rendering inputs until formData is ready
  if (!formData) {
    return (
      <tr id={`access-row-${student.id}`} className={`am-row${isHighlighted ? ' am-row-highlight' : ''}`}>
        <td className="am-td am-td-name">
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <StudentAvatar student={student} size={32} />
            <span>{displayName(student)}</span>
          </div>
        </td>
        <td className="am-td am-td-school">{student.school || '-'}</td>
        <td className="am-td" colSpan={5} />
      </tr>
    )
  }

  const status    = getCsLinkStatus(formData)
  const statusCfg = CS_LINK_STATUS_CONFIG[status]

  // The date a tick fills: editable, with the legacy free-text hint when one is stored.
  const dateFor = (field) => (
    <>
      <input type="date" className="am-date-input" aria-label="Date"
        value={dateInputValue(formData[field])}
        onChange={e => handleChangeDate(field, e.target.value)}
        placeholder="Date" />
      {isLegacyNonIsoDateValue(formData[field]) && (
        <span className="am-date-legacy" style={{ fontSize:9, color:'#92400e' }} title="Legacy value, re-enter to update">was: {formData[field]}</span>
      )}
    </>
  )
  const requests = stage1RequestsFor(formData.cs_cedars_status)
  const ticked   = tickedStage1Request(formData)

  return (
    <tr id={`access-row-${student.id}`} className={`am-row${isHighlighted ? ' am-row-highlight' : ''}`}>

      {/* Col 1: Student Name */}
      <td className="am-td am-td-name">
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <StudentAvatar student={student} size={32} />
          <span>{displayName(student)}</span>
        </div>
      </td>

      {/* Col 2: School */}
      <td className="am-td am-td-school">{student.school || '-'}</td>

      {/* Col 3: Cedars-Sinai Status */}
      <td className="am-td">
        <select className="am-select" value={formData.cs_cedars_status || ''}
          onChange={e => handleChangeCedarsStatus(e.target.value)}>
          <option value="">-</option>
          {CEDARS_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>

      {/* Col 4: Step 2 - Service Center request. CSLINK-SERVICENOW-1: each request is a tickbox
          beside its ServiceNow link. The link only opens the form; the tick records it was sent. */}
      <td className="am-td">
        {isLegacyNotApplicable(formData) ? (
          <div className="am-step-note">Not Applicable</div>
        ) : requests.length === 0 ? (
          <div style={{ fontSize:11, color:'#9ca3af' }}>-</div>
        ) : (
          <div className="am-request-stack">
            {requests.map(action => (
              <div key={action} className="am-access-cell am-request">
                <span className="am-request-head">
                  <input type="checkbox" className="am-checkbox"
                    aria-label={`${STAGE1_REQUESTS[action].label} submitted`}
                    checked={ticked === action}
                    onChange={() => handleToggleRequest(action)} />
                  <ServiceNowLink href={STAGE1_REQUESTS[action].href}>{STAGE1_REQUESTS[action].label}</ServiceNowLink>
                </span>
                {ticked === action && dateFor('cs_stage1_submitted_date')}
              </div>
            ))}
          </div>
        )}
      </td>

      {/* Col 5: Step 3 - Account Active */}
      <td className="am-td">
        <div className="am-access-cell am-request">
          <input type="checkbox" className="am-checkbox" aria-label="Account active"
            checked={formData.cs_stage1_complete || false}
            onChange={() => handleToggleBox('cs_stage1_complete')} />
          {formData.cs_stage1_complete && dateFor('cs_stage1_complete_date')}
        </div>
      </td>

      {/* Col 6: Step 4 - CS-Link. Unticked, Requested is a Request link to the ServiceNow cart;
          ticked, it reads Requested with today's date. */}
      <td className="am-td">
        <div className="am-request-stack">
          <div className="am-access-cell am-request">
            <span className="am-request-head">
              <input type="checkbox" className="am-checkbox" id={`cs-req-${student.id}`}
                aria-label="CS-Link requested"
                checked={formData.cs_link_requested || false}
                onChange={() => handleToggleBox('cs_link_requested')} />
              {formData.cs_link_requested
                ? <label htmlFor={`cs-req-${student.id}`} style={{ cursor:'pointer' }}>Requested</label>
                : <ServiceNowLink href={SERVICENOW_LINKS.csLinkRequest}>Request</ServiceNowLink>}
            </span>
            {formData.cs_link_requested && dateFor('cs_link_requested_date')}
          </div>
          <div className="am-access-cell am-request">
            <label className="am-request-head" style={{ cursor:'pointer' }}>
              <input type="checkbox" className="am-checkbox"
                checked={formData.cs_link_complete || false}
                onChange={() => handleToggleBox('cs_link_complete')} />
              Complete
            </label>
            {formData.cs_link_complete && dateFor('cs_link_complete_date')}
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

    </tr>
  )
}
