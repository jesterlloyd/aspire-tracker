import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EmptyState, ErrorState, SectionHeading, TableSkeleton,
} from './UnitLeaderChrome'
import PreceptorDirectoryTable from '../../components/shared/PreceptorDirectoryTable'
import { sortPreceptorDirectoryRows } from '../../lib/preceptorDirectory'
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
  const [sortDir, setSortDir] = useState('asc')
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
    return sortPreceptorDirectoryRows(filtered, { sortBy, sortDir })
  }, [active, crossUnit, search, shift, sortBy, sortDir, unitRoster])

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

  const openManager = (row, triggerEl) => {
    const assignment = row?.assignments?.[0]
    if (!assignment) {
      setNotice({ tone: 'warn', text: 'No active assignments are available for this preceptor.' })
      triggerEl?.focus?.()
      return
    }
    managerTriggerRef.current = triggerEl || null
    setManager({
      id: assignment.student_id,
      first_name: assignment.student_name,
      last_name: '',
      unit_key: assignment.student_unit,
      shift: assignment.student_shift,
    })
  }

  const handleSort = (key) => {
    const nextKey = key === 'unit_name' ? 'unit' : key
    if (sortBy === nextKey) setSortDir(current => current === 'asc' ? 'desc' : 'asc')
    else { setSortBy(nextKey); setSortDir('asc') }
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
      </div>
      <p className="ptl-muted">
        Preceptors whose home unit is in your scope or who currently work with one of your students.
      </p>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}

      <div className="ptl-prec-toolbar" aria-label="Preceptor directory controls">
        <button type="button" className="ptl-btn ptl-prec-add" onClick={() => setCreateOpen(true)}>+ Add Preceptor</button>
        <label className="ptl-field ptl-prec-search">
          <span className="ptl-visually-hidden">Search preceptors</span>
          <input className="ptl-input" type="search" value={search}
            onChange={event => setSearch(event.target.value)} placeholder="Name or email" />
        </label>
        <details className="ptl-prec-filter-menu">
          <summary className="ptl-btn ptl-btn-quiet">Filters</summary>
          <div className="ptl-prec-filter-panel">
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
          </div>
        </details>
        <span className="ptl-prec-count">
          {preceptors.loading ? 'Loading…' : `${rows.length} preceptor${rows.length !== 1 ? 's' : ''}`}
        </span>
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
        <div className="am-table-wrap">
          <PreceptorDirectoryTable
            rows={rows}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
            onManagePreceptorAssignments={openManager}
            showAssignmentCount
            showAssociation
            caption="Preceptors associated with authorized units"
          />
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
