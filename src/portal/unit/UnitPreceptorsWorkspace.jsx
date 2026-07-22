import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EmptyState, ErrorState, Pill, SectionHeading, TableSkeleton,
} from './UnitLeaderChrome'
import UnitPreceptorCreateModal from './UnitPreceptorCreateModal'
import UnitLeaderPreceptorManager from './UnitLeaderPreceptorManager'
import {
  ALL_UNITS, getNominations, getUnitPreceptors, orDash, sentenceCase,
} from './unitLeaderApi'

function useResource(loader) {
  const [state, setState] = useState({ data: null, error: null, resolved: -1 })
  const [nonce, setNonce] = useState(0)
  const refreshWaiters = useRef([])
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    loader(controller.signal).then(result => {
      if (!live || result.error === 'aborted') return
      setState(result.ok
        ? { data: result.data, error: null, resolved: nonce }
        : { data: null, error: result, resolved: nonce })
      const waiters = refreshWaiters.current.splice(0)
      waiters.forEach(resolve => resolve(result))
    })
    return () => { live = false; controller.abort() }
  }, [loader, nonce])
  return {
    data: state.data,
    error: state.error,
    loading: state.resolved !== nonce,
    refresh: () => new Promise(resolve => {
      refreshWaiters.current.push(resolve)
      setNonce(value => value + 1)
    }),
  }
}

const lower = value => String(value || '').toLowerCase()

function associatedWithUnit(preceptor, unitKey) {
  if (!unitKey || unitKey === ALL_UNITS) return true
  return preceptor.home_unit?.name === unitKey ||
    preceptor.assignments.some(assignment => assignment.student_unit === unitKey)
}

function sortRows(rows, sortBy) {
  return [...rows].sort((a, b) => {
    if (sortBy === 'count') {
      return b.active_assignment_count - a.active_assignment_count ||
        lower(a.full_name).localeCompare(lower(b.full_name))
    }
    const av = sortBy === 'unit' ? lower(a.home_unit?.name) : lower(a.full_name)
    const bv = sortBy === 'unit' ? lower(b.home_unit?.name) : lower(b.full_name)
    return av.localeCompare(bv) || lower(a.full_name).localeCompare(lower(b.full_name))
  })
}

function AssignmentList({ assignments, onManage }) {
  if (!assignments.length) return <span className="ptl-muted">None</span>
  return (
    <span className="ptl-prec-list">
      {assignments.map(assignment => (
        <span className="ptl-prec-line" key={assignment.id}>
          <span className="ptl-prec-name">{assignment.student_name}</span>
          <span className={`ptl-prec-pill ptl-prec-${assignment.role.toLowerCase()}`}>
            {assignment.role}
          </span>
          {assignment.student_unit && assignment.student_unit !== '' && (
            <span className="ptl-muted">{assignment.student_unit}</span>
          )}
          <button type="button" className="ptl-linklike ptl-prec-manage"
            aria-label={`Manage assignments for ${assignment.student_name}`}
            onClick={event => onManage(assignment, event.currentTarget)}>
            Manage student assignments
          </button>
        </span>
      ))}
    </span>
  )
}

export default function UnitPreceptorsWorkspace({ unitKey, unitKeys, onAssignmentsChanged }) {
  const loadPreceptors = useCallback(signal => getUnitPreceptors(signal), [])
  const loadHistory = useCallback(signal => getNominations(unitKey, signal), [unitKey])
  const preceptors = useResource(loadPreceptors)
  const history = useResource(loadHistory)
  const [search, setSearch] = useState('')
  const [shift, setShift] = useState('all')
  const [active, setActive] = useState('active')
  const [crossUnit, setCrossUnit] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [createOpen, setCreateOpen] = useState(false)
  const [manager, setManager] = useState(null)
  const [notice, setNotice] = useState(null)
  const managerTriggerRef = useRef(null)

  const roster = useMemo(() => preceptors.data?.roster || [], [preceptors.data])
  const unitRoster = useMemo(
    () => roster.filter(row => associatedWithUnit(row, unitKey)),
    [roster, unitKey],
  )
  const rows = useMemo(() => {
    const query = lower(search.trim())
    const filtered = unitRoster.filter(row => {
      if (query && !lower(row.full_name).includes(query) && !lower(row.email).includes(query)) return false
      if (shift !== 'all' && row.shift !== shift) return false
      if (active === 'active' && !row.is_active) return false
      if (active === 'inactive' && row.is_active) return false
      if (crossUnit === 'cross' && !row.cross_unit_association) return false
      return true
    })
    return sortRows(filtered, sortBy)
  }, [active, crossUnit, search, shift, sortBy, unitRoster])

  const legacyRows = history.data?.nominations || []
  const hasFilters = search.trim() || shift !== 'all' || active !== 'active' || crossUnit !== 'all'

  const created = () => {
    setCreateOpen(false)
    setNotice({
      tone: 'ok',
      text: 'Preceptor created and active. Owner/Admin reviewers were notified for follow-up.',
    })
    preceptors.refresh()
  }

  const openManager = (assignment, triggerEl) => {
    managerTriggerRef.current = triggerEl || null
    setManager({
      id: assignment.student_id,
      first_name: assignment.student_name,
      last_name: '',
      unit_key: assignment.student_unit,
    })
  }

  const assignmentCommitted = async (_result, message) => {
    setNotice({ tone: 'ok', text: message })
    const [workspaceResult, rosterResult] = await Promise.all([
      preceptors.refresh(),
      onAssignmentsChanged?.(),
    ])
    return workspaceResult?.ok !== false && rosterResult?.ok !== false
  }

  return (
    <>
      <div className="ptl-section-headrow">
        <SectionHeading focusKey="preceptors">Preceptors</SectionHeading>
        <button type="button" className="ptl-btn" onClick={() => setCreateOpen(true)}>Add preceptor</button>
      </div>
      <p className="ptl-muted">
        Preceptors whose home unit is in your scope or who currently work with one of your students.
      </p>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}

      <div className="ptl-card ptl-prec-controls" aria-label="Filter preceptors">
        <label className="ptl-field ptl-prec-search">
          <span className="ptl-label">Search</span>
          <input className="ptl-input" type="search" value={search}
            onChange={event => setSearch(event.target.value)} placeholder="Name or email" />
        </label>
        <label className="ptl-field">
          <span className="ptl-label">Shift</span>
          <select className="ptl-input" value={shift} onChange={event => setShift(event.target.value)}>
            <option value="all">All shifts</option>
            {['Day', 'Night', 'Mid', 'Variable'].map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="ptl-field">
          <span className="ptl-label">Status</span>
          <select className="ptl-input" value={active} onChange={event => setActive(event.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All statuses</option>
          </select>
        </label>
        <label className="ptl-field">
          <span className="ptl-label">Association</span>
          <select className="ptl-input" value={crossUnit} onChange={event => setCrossUnit(event.target.value)}>
            <option value="all">All associations</option>
            <option value="cross">Cross-unit only</option>
          </select>
        </label>
        <label className="ptl-field">
          <span className="ptl-label">Sort</span>
          <select className="ptl-input" value={sortBy} onChange={event => setSortBy(event.target.value)}>
            <option value="name">Name</option>
            <option value="unit">Home unit</option>
            <option value="count">Assignment count</option>
          </select>
        </label>
      </div>

      {preceptors.loading ? (
        <TableSkeleton label="Loading preceptors" />
      ) : preceptors.error ? (
        <ErrorState detail="Preceptors could not be loaded." onRetry={preceptors.refresh} />
      ) : unitRoster.length === 0 ? (
        <EmptyState title="No associated preceptors"
          detail="Preceptors connected to the selected unit will appear here." />
      ) : rows.length === 0 ? (
        <EmptyState title="No matching preceptors"
          detail={hasFilters ? 'Clear or change the filters to see more preceptors.' : 'No preceptors match this view.'} />
      ) : (
        <div className="ptl-table-wrap">
          <table className="ptl-table ptl-prec-table">
            <caption className="ptl-visually-hidden">Preceptors associated with authorized units</caption>
            <thead>
              <tr>
                <th scope="col">Name</th><th scope="col">Contact</th><th scope="col">Home unit</th>
                <th scope="col">Shift</th><th scope="col">Status</th><th scope="col">Current students</th>
                <th scope="col">Assignments</th><th scope="col">Association</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td data-label="Name"><b>{row.full_name}</b></td>
                  <td data-label="Contact">
                    {row.email ? <a className="ptl-detail-link" href={`mailto:${row.email}`}>{row.email}</a> : '-'}
                    {row.phone && <span className="ptl-prec-phone">{row.phone}</span>}
                  </td>
                  <td data-label="Home unit">{orDash(row.home_unit?.name)}</td>
                  <td data-label="Shift">{orDash(row.shift)}</td>
                  <td data-label="Status"><Pill tone={row.is_active ? 'ok' : 'neutral'}>{row.is_active ? 'Active' : 'Inactive'}</Pill></td>
                  <td data-label="Current students">
                    <AssignmentList assignments={row.assignments} onManage={openManager} />
                  </td>
                  <td data-label="Assignments">{row.active_assignment_count}</td>
                  <td data-label="Association">
                    {row.cross_unit_association ? <Pill tone="warn">Cross-unit</Pill> : <span className="ptl-muted">Home unit</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!history.loading && !history.error && legacyRows.length > 0 && (
        <details className="ptl-card ptl-legacy-history">
          <summary>Legacy nomination history ({legacyRows.length})</summary>
          <div className="ptl-table-wrap">
            <table className="ptl-table">
              <thead><tr><th scope="col">Unit</th><th scope="col">Preceptor</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {legacyRows.map(row => (
                  <tr key={row.id}>
                    <td data-label="Unit">{orDash(row.unit_key)}</td>
                    <td data-label="Preceptor">{orDash(row.preceptor_name)}</td>
                    <td data-label="Status">{sentenceCase(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {createOpen && (
        <UnitPreceptorCreateModal unitKeys={unitKeys} onClose={() => setCreateOpen(false)} onCreated={created} />
      )}
      {manager && (
        <UnitLeaderPreceptorManager student={manager} returnFocusRef={managerTriggerRef}
          onCommitted={assignmentCommitted} onClose={() => setManager(null)} />
      )}
    </>
  )
}
