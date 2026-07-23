import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import '../portal.css'
import { getUnitPreceptors, mutateUnitPreceptorAssignment, orDash, studentName } from './unitLeaderApi'
import {
  assignmentErrorMessage,
  assignmentSuccessMessage,
  assignmentWindowIsClosed,
  buildAssignmentMutationPayload,
  collectStudentAssignments,
  createUnitAssignmentMutationController,
  mutationIntentKey,
} from './unitPreceptorAssignments'
import { ErrorState, LoadingState } from './UnitLeaderChrome'

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

const ROLE_LABEL = { primary: 'Primary', secondary: 'Secondary', coverage: 'Coverage' }

function initialIntent(action) {
  if (action === 'change_primary') return { action: 'change_primary', role: 'primary' }
  if (action === 'add_secondary') return { action: 'set_secondary', op: 'add', role: 'secondary' }
  if (action === 'add_coverage') return { action: 'set_secondary', op: 'add', role: 'coverage' }
  return null
}

function fmtDate(value) {
  if (!value) return '-'
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return '-'
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function actionTitle(intent, assignment) {
  if (intent.action === 'change_primary') return assignment ? 'Change Primary preceptor' : 'Assign Primary preceptor'
  if (intent.op === 'add') return `Add ${ROLE_LABEL[intent.role]} preceptor`
  if (intent.op === 'replace') return `Replace ${ROLE_LABEL[intent.role]} assignment`
  return `End ${ROLE_LABEL[intent.role]} assignment`
}

function AssignmentIdentity({ assignment }) {
  return (
    <div className="ptl-asn-identity">
      <strong>{assignment.preceptor.full_name}</strong>
      <span>{orDash(assignment.preceptor.home_unit?.name)} · {orDash(assignment.preceptor.shift)}</span>
      <span>Started {fmtDate(assignment.start_date)}</span>
    </div>
  )
}

export default function UnitLeaderPreceptorManager({
  student,
  initialAction = null,
  onClose,
  onCommitted,
  returnFocusRef,
  loadPreceptors = getUnitPreceptors,
  mutateAssignment = mutateUnitPreceptorAssignment,
  readOnlyMessage = 'Assignments are read-only because this completed rotation is outside the 90-day Unit Leader window.',
}) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const mountedRef = useRef(true)
  const submitGuardRef = useRef(false)
  const [resource, setResource] = useState({ status: 'loading', data: null })
  const [intent, setIntent] = useState(() => initialIntent(initialAction))
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState('all')
  const [shiftFilter, setShiftFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [closeAfterRefresh, setCloseAfterRefresh] = useState(false)
  const [committedRefresh, setCommittedRefresh] = useState(null)
  const focused = initialAction !== null
  const readOnly = assignmentWindowIsClosed(student)

  const controller = useMemo(() => createUnitAssignmentMutationController({
    mutate: mutateAssignment,
  }), [mutateAssignment])

  const load = useCallback(async (signal) => {
    const result = await loadPreceptors(signal)
    if (!mountedRef.current || result.error === 'aborted') return result
    setResource(result.ok
      ? { status: 'ready', data: result.data }
      : { status: 'error', data: null })
    return result
  }, [loadPreceptors])

  useEffect(() => {
    mountedRef.current = true
    const abort = new AbortController()
    load(abort.signal)
    return () => { mountedRef.current = false; abort.abort() }
  }, [load])

  useEffect(() => {
    const returnTo = returnFocusRef?.current || null
    const timer = setTimeout(() => closeRef.current?.focus?.(), 20)
    return () => {
      clearTimeout(timer)
      returnTo?.focus?.()
    }
  }, [returnFocusRef])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (saving) return
        if (intent?.op === 'end') setIntent(null)
        else onClose?.()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const nodes = [...panelRef.current.querySelectorAll(FOCUSABLE)]
        .filter(node => node.offsetParent !== null)
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [intent, onClose, saving])

  const roster = useMemo(() => resource.data?.roster || [], [resource.data])
  const candidates = useMemo(() => resource.data?.candidates || [], [resource.data])
  const assignments = useMemo(
    () => collectStudentAssignments(roster, student.id),
    [roster, student.id],
  )
  const primary = assignments.find(row => row.role === 'primary') || null
  const selectedAssignment = intent?.assignmentId
    ? assignments.find(row => row.id === intent.assignmentId) || intent.assignment || null
    : primary
  const assignedPreceptorIds = useMemo(
    () => new Set(assignments.map(row => row.preceptor.id)),
    [assignments],
  )
  const unitOptions = useMemo(
    () => [...new Set(candidates.map(row => row.home_unit?.name).filter(Boolean))].sort(),
    [candidates],
  )
  const selectableCandidates = useMemo(() => {
    const query = search.trim().toLowerCase()
    return candidates.filter(candidate => {
      if (assignedPreceptorIds.has(candidate.id)) return false
      if (query && !String(candidate.full_name || '').toLowerCase().includes(query)) return false
      if (unitFilter !== 'all' && candidate.home_unit?.name !== unitFilter) return false
      if (shiftFilter !== 'all' && candidate.shift !== shiftFilter) return false
      return true
    })
  }, [assignedPreceptorIds, candidates, search, shiftFilter, unitFilter])

  const resetFlow = () => {
    controller.reset()
    setIntent(null)
    setSelectedId('')
    setSearch('')
    setUnitFilter('all')
    setShiftFilter('all')
    setError(null)
  }

  const start = (nextIntent) => {
    controller.reset()
    setIntent(nextIntent)
    setSelectedId('')
    setSearch('')
    setUnitFilter('all')
    setShiftFilter('all')
    setError(null)
    setSuccess(null)
  }

  const close = () => {
    if (saving) return
    controller.reset()
    onClose?.()
  }

  const refresh = async () => {
    setResource(current => ({ ...current, status: 'loading' }))
    const [result, externalRefreshed] = await Promise.all([
      load(),
      committedRefresh
        ? onCommitted?.(committedRefresh.result, committedRefresh.message)
        : true,
    ])
    if (!result.ok || externalRefreshed === false) {
      setRefreshFailed(true)
      return false
    }
    setRefreshFailed(false)
    setCommittedRefresh(null)
    if (closeAfterRefresh) onClose?.()
    setCloseAfterRefresh(false)
    return true
  }

  const submit = async () => {
    if (!intent || saving || readOnly || submitGuardRef.current) return
    if (intent.op !== 'end' && !selectedId) {
      setError('Select an active preceptor first.')
      return
    }
    const operation = {
      ...intent,
      studentId: student.id,
      preceptorId: intent.op === 'end' ? null : selectedId,
    }
    const intentKey = mutationIntentKey(operation)
    submitGuardRef.current = true
    setSaving(true)
    setError(null)
    const result = await controller.submit(intentKey, requestId =>
      buildAssignmentMutationPayload(operation, requestId))
    if (!result.ok) {
      submitGuardRef.current = false
      setSaving(false)
      setError(assignmentErrorMessage(result))
      return
    }

    const committed = result.data?.result || {}
    const message = assignmentSuccessMessage(committed, intent.role)
    setSuccess(message)
    setCommittedRefresh({ result: committed, message })
    const externalRefreshed = await onCommitted?.(committed, message)
    const refreshed = await load()
    submitGuardRef.current = false
    setSaving(false)
    if (!refreshed.ok || externalRefreshed === false) {
      setRefreshFailed(true)
      setCloseAfterRefresh(focused)
      setIntent(null)
      setSelectedId('')
      return
    }
    setCommittedRefresh(null)
    if (focused) {
      onClose?.()
      return
    }
    resetFlow()
    setSuccess(message)
  }

  const cancelFlow = () => {
    if (saving) return
    if (focused) close()
    else resetFlow()
  }

  const renderFlow = () => {
    const ending = intent.op === 'end'
    return (
      <section className="ptl-asn-flow" aria-labelledby="ptl-asn-action-title">
        <div className="ptl-asn-flow-head">
          <div>
            <h3 id="ptl-asn-action-title">{actionTitle(intent, selectedAssignment)}</h3>
            {selectedAssignment && intent.op !== 'add' && (
              <AssignmentIdentity assignment={selectedAssignment} />
            )}
          </div>
          <button type="button" className="ptl-linklike" disabled={saving} onClick={cancelFlow}>Back</button>
        </div>

        {ending ? (
          <div className="ptl-notice ptl-notice-warn" role="alert">
            <p>
              End the {ROLE_LABEL[intent.role]} assignment for{' '}
              <strong>{selectedAssignment?.preceptor.full_name || 'this preceptor'}</strong>?
              Only assignment <code>{intent.assignmentId}</code> will end.
            </p>
          </div>
        ) : (
          <>
            <div className="ptl-asn-filters">
              <label className="ptl-field ptl-asn-search">
                <span className="ptl-label">Search active preceptors</span>
                <input className="ptl-input" type="search" value={search} disabled={saving}
                  onChange={event => setSearch(event.target.value)} placeholder="Search by name" />
              </label>
              <label className="ptl-field">
                <span className="ptl-label">Home unit</span>
                <select className="ptl-input" value={unitFilter} disabled={saving}
                  onChange={event => setUnitFilter(event.target.value)}>
                  <option value="all">All units</option>
                  {unitOptions.map(unit => <option key={unit}>{unit}</option>)}
                </select>
              </label>
              <label className="ptl-field">
                <span className="ptl-label">Shift</span>
                <select className="ptl-input" value={shiftFilter} disabled={saving}
                  onChange={event => setShiftFilter(event.target.value)}>
                  <option value="all">All shifts</option>
                  {['Day', 'Night', 'Mid', 'Variable'].map(shift => <option key={shift}>{shift}</option>)}
                </select>
              </label>
            </div>
            <div className="ptl-asn-candidates" role="radiogroup" aria-label="Active preceptors">
              {selectableCandidates.length === 0 ? (
                <p className="ptl-muted">No eligible active preceptors match this view.</p>
              ) : selectableCandidates.map(candidate => (
                <button key={candidate.id} type="button" role="radio"
                  aria-checked={selectedId === candidate.id}
                  disabled={saving}
                  className={`ptl-asn-candidate${selectedId === candidate.id ? ' ptl-asn-candidate-selected' : ''}`}
                  onClick={() => { setSelectedId(candidate.id); setError(null) }}>
                  <strong>{candidate.full_name}</strong>
                  <span>{orDash(candidate.home_unit?.name)} · {orDash(candidate.shift)}</span>
                  {candidate.home_unit?.name && candidate.home_unit.name !== student.unit_key && (
                    <span className="ptl-asn-cross">Cross-unit choice</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {error && <p className="ptl-notice ptl-notice-error" role="alert">{error}</p>}
        <div className="ptl-modal-actions ptl-asn-actions">
          <button type="button" className="ptl-btn-outline" disabled={saving} onClick={cancelFlow}>Cancel</button>
          <button type="button" className={ending ? 'ptl-btn-danger' : 'ptl-btn'}
            disabled={saving || (!ending && !selectedId)} onClick={submit}>
            {saving ? 'Saving' : ending ? `End ${ROLE_LABEL[intent.role]}` : actionTitle(intent, selectedAssignment)}
          </button>
        </div>
      </section>
    )
  }

  const renderRole = (role) => {
    const rows = assignments.filter(row => row.role === role)
    const label = ROLE_LABEL[role]
    return (
      <section className="ptl-asn-section" aria-labelledby={`ptl-asn-${role}`}>
        <div className="ptl-asn-section-head">
          <h3 id={`ptl-asn-${role}`}>{label}</h3>
          <button type="button" className="ptl-btn-outline ptl-btn-small" disabled={readOnly}
            onClick={() => start({ action: 'set_secondary', op: 'add', role })}>
            Add {label}
          </button>
        </div>
        {rows.length === 0 ? <p className="ptl-muted">No active {label.toLowerCase()} assignments.</p> : (
          <ul className="ptl-asn-rows">
            {rows.map(row => (
              <li key={row.id}>
                <AssignmentIdentity assignment={row} />
                <div className="ptl-asn-row-actions">
                  <button type="button" className="ptl-linklike" disabled={readOnly}
                    aria-label={`Replace ${label} assignment for ${row.preceptor.full_name}`}
                    onClick={() => start({ action: 'set_secondary', op: 'replace', role, assignmentId: row.id, assignment: row })}>
                    Replace
                  </button>
                  <button type="button" className="ptl-linklike ptl-link-danger" disabled={readOnly}
                    aria-label={`End ${label} assignment for ${row.preceptor.full_name}`}
                    onClick={() => start({ action: 'set_secondary', op: 'end', role, assignmentId: row.id, assignment: row })}>
                    End
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <div className="ptl-modal-backdrop ptl-asn-backdrop" role="presentation" onMouseDown={close}>
      <div ref={panelRef} className="ptl-modal ptl-asn-manager" role="dialog" aria-modal="true"
        aria-labelledby="ptl-asn-title" onMouseDown={event => event.stopPropagation()}>
        <div className="ptl-modal-head">
          <div>
            <h2 id="ptl-asn-title">Manage preceptor assignments</h2>
            <p className="ptl-muted">{studentName(student)} · {orDash(student.unit_key)}</p>
          </div>
          <button ref={closeRef} type="button" className="ptl-icon-btn" disabled={saving}
            aria-label="Close assignment manager" onClick={close}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="ptl-modal-body ptl-asn-body">
          {readOnly && (
            <p className="ptl-notice ptl-notice-warn">
              {readOnlyMessage}
            </p>
          )}
          {success && <p className="ptl-notice ptl-notice-ok" role="status">{success}</p>}
          {refreshFailed && (
            <div className="ptl-notice ptl-notice-warn" role="status">
              <p>The assignment changed, but the current assignment list could not be refreshed.</p>
              <button type="button" className="ptl-btn-outline ptl-btn-small" onClick={refresh}>Retry refresh</button>
            </div>
          )}

          {resource.status === 'loading' && <LoadingState label="Loading assignments and active preceptors" />}
          {resource.status === 'error' && !refreshFailed && (
            <ErrorState detail="Assignments and active preceptors could not be loaded." onRetry={refresh} />
          )}
          {resource.status === 'ready' && !refreshFailed && (
            intent ? renderFlow() : (
              <div className="ptl-asn-sections">
                <section className="ptl-asn-section" aria-labelledby="ptl-asn-primary">
                  <div className="ptl-asn-section-head">
                    <h3 id="ptl-asn-primary">Primary</h3>
                    <button type="button" className="ptl-btn-outline ptl-btn-small" disabled={readOnly}
                      onClick={() => start({ action: 'change_primary', role: 'primary' })}>
                      {primary ? 'Change Primary' : 'Assign Primary'}
                    </button>
                  </div>
                  {primary ? <AssignmentIdentity assignment={primary} /> : <p className="ptl-muted">No active Primary assignment.</p>}
                </section>
                {renderRole('secondary')}
                {renderRole('coverage')}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
