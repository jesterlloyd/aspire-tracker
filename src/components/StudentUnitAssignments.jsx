// src/components/StudentUnitAssignments.jsx
//
// MULTI-UNIT-STUDENT-PLACEMENTS-2: the Units section of the student side panel.
//
// Shows every unit assignment - primary and additional, planned, active, and
// history - and gives Owners/Admins the management surface: add an additional
// unit, change the primary (atomic via the server RPC), edit dates and notes,
// end, and remove. Distinctions the eye needs are explicit: PRIMARY vs
// ADDITIONAL badges, and status chips for planned/active/ended/removed with
// dates.
//
// Every consequential action (change primary, end, remove) requires an
// EXPLICIT inline confirmation that states exactly what will happen before
// anything is sent. Edit covers dates and notes - including on ENDED rows,
// because an ended assignment's period still decides which shift logs it
// validates, so a wrong date range must be correctable.
//
// Writes go only through the management endpoint (RLS grants the browser no
// write); reads come through the Owner/Admin SELECT policy. If the sync
// migration is not yet applied the endpoint answers 'migration_required' and
// this component surfaces exactly that instead of pretending.
//
// Single-unit students see one active-primary row - the same information the
// old read-only "Matched Unit" field carried, now with history beneath it.

import { useState, useEffect, useCallback } from 'react'
import { listStudentUnitAssignments, manageStudentUnitAssignment } from '../lib/studentUnitAssignmentsApi'
import { canonicalUnitName } from '../lib/unitNameCanon'

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'

const STATUS_CHIP = {
  active:  { label: 'Active',  bg: '#dcfce7', color: '#166534', border: '#86efac' },
  planned: { label: 'Planned', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  ended:   { label: 'Ended',   bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' },
  removed: { label: 'Removed', bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
}

const ROLE_BADGE = {
  primary:    { label: 'Primary',    bg: '#EEF2FB', color: NAVY, border: '#c3cdf0' },
  additional: { label: 'Additional', bg: '#FEF3C7', color: '#92400e', border: '#fde68a' },
}

function chip(cfg) {
  return {
    display: 'inline-block', fontSize: 9, fontWeight: 700, padding: '1px 7px',
    borderRadius: 9, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
    fontFamily: F, whiteSpace: 'nowrap',
  }
}

function fmtRange(a) {
  const f = (d) => (d ? d : null)
  const s = f(a.start_date); const e = f(a.end_date)
  if (s && e) return `${s} → ${e}`
  if (s) return `from ${s}`
  if (e) return `until ${e}`
  return 'no dates recorded'
}

// The consequence each confirmation must spell out BEFORE the action runs.
function confirmCopy(type, a) {
  const unit = canonicalUnitName(a.unit_key)
  if (type === 'set_primary') {
    return {
      title: `Make ${unit} the primary unit?`,
      body: 'The current primary assignment is ended and kept as history, and the '
        + "student's matched unit changes to this unit - both in one atomic operation.",
      confirmLabel: 'Change primary',
    }
  }
  if (type === 'end') {
    return {
      title: `End the ${unit} assignment?`,
      body: 'The record is kept as history: it stops granting portal access, but shift '
        + 'logs dated within its assignment period still validate against it.'
        + (a.role === 'primary' ? " Ending the primary also clears the student's matched unit." : ''),
      confirmLabel: 'End assignment',
    }
  }
  return {
    title: `Remove the ${unit} assignment?`,
    body: 'Remove means this record was entered in error. It is kept for audit but '
      + 'never grants access and never validates any shift log.',
    confirmLabel: 'Remove assignment',
  }
}

export default function StudentUnitAssignments({ studentId, units = [], canManage = false, onChanged }) {
  const [assignments, setAssignments] = useState(null)   // null = loading
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addUnitId, setAddUnitId] = useState('')
  const [addRole, setAddRole] = useState('additional')   // 'additional' | 'primary'
  const [addStatus, setAddStatus] = useState('active')
  const [addStart, setAddStart] = useState('')
  const [addEnd, setAddEnd] = useState('')

  // Inline edit (dates + notes) - one row at a time.
  const [editingId, setEditingId] = useState(null)
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [editNotes, setEditNotes] = useState('')

  // Pending confirmation: { type: 'set_primary' | 'end' | 'remove', a }.
  // NOTHING is sent to the server until the user confirms.
  const [confirming, setConfirming] = useState(null)

  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey(k => k + 1), [])

  // Endorsed effect shape: all setState lives in the async resolution.
  useEffect(() => {
    if (!studentId) return undefined
    let cancelled = false
    listStudentUnitAssignments(studentId).then(r => {
      if (cancelled) return
      if (!r.ok) { setError(r.error); setAssignments([]) } else { setError(null); setAssignments(r.assignments) }
    })
    return () => { cancelled = true }
  }, [studentId, reloadKey])

  const act = useCallback(async (payload, okNotice) => {
    setBusy(true); setNotice(null)
    const r = await manageStudentUnitAssignment(payload)
    setBusy(false)
    if (!r.ok) {
      setNotice(r.error === 'migration_required'
        ? 'The assignment sync migration (20260817000000) is not applied yet. Ask the Owner to run it before managing units.'
        : `Action failed: ${r.error}`)
      return false
    }
    setNotice(okNotice)
    load()
    onChanged?.()
    return true
  }, [load, onChanged])

  const live = (assignments || []).filter(a => a.status === 'active' || a.status === 'planned')
  const history = (assignments || []).filter(a => a.status === 'ended' || a.status === 'removed')

  const resetAdd = () => {
    setAdding(false); setAddUnitId(''); setAddStart(''); setAddEnd('')
    setAddRole('additional'); setAddStatus('active')
  }

  const submitAdd = async () => {
    if (!addUnitId) return
    if (addRole === 'primary') {
      // Changing the primary is consequential: stage the SAME explicit
      // confirmation the row action uses. Nothing is sent until confirmed.
      const unitName = units.find(u => u.id === addUnitId)?.unit_name || 'this unit'
      setConfirming({
        type: 'set_primary',
        a: { id: null, unit_id: addUnitId, unit_key: unitName, role: 'additional' },
        start_date: addStart || undefined,
        fromAdd: true,
      })
      return
    }
    const ok = await act({ action: 'add', student_id: studentId, unit_id: addUnitId, status: addStatus, start_date: addStart || undefined, end_date: addEnd || undefined }, 'Unit assignment added.')
    if (ok) resetAdd()
  }

  const openEdit = (a) => {
    setConfirming(null)
    setEditingId(a.id)
    setEditStart(a.start_date || '')
    setEditEnd(a.end_date || '')
    setEditNotes(a.notes || '')
  }

  const submitEdit = async (a) => {
    const ok = await act({
      action: 'update',
      assignment_id: a.id,
      start_date: editStart || null,
      end_date: editEnd || null,
      notes: editNotes,
    }, 'Assignment updated.')
    if (ok) setEditingId(null)
  }

  const runConfirmed = async () => {
    const c = confirming
    setConfirming(null)
    if (c.type === 'set_primary') {
      const ok = await act({ action: 'set_primary', student_id: studentId, unit_id: c.a.unit_id, start_date: c.start_date }, 'Primary unit updated.')
      if (ok && c.fromAdd) resetAdd()
    } else if (c.type === 'end') {
      await act({ action: 'end', assignment_id: c.a.id }, 'Assignment ended.')
    } else {
      await act({ action: 'remove', assignment_id: c.a.id }, 'Assignment removed.')
    }
  }

  const editForm = (a) => (
    <div data-testid="sua-edit-form" style={{
      marginTop: 6, padding: '7px 8px', borderRadius: 6,
      border: '1px solid #c3cdf0', background: '#F8FAFF',
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <label style={dateLabel()}>Start <input type="date" value={editStart} onChange={e => setEditStart(e.target.value)} style={selStyle()} /></label>
        <label style={dateLabel()}>End <input type="date" value={editEnd} onChange={e => setEditEnd(e.target.value)} style={selStyle()} /></label>
      </div>
      <input
        type="text" value={editNotes} placeholder="Notes"
        onChange={e => setEditNotes(e.target.value)}
        style={{ ...selStyle(), width: '100%', boxSizing: 'border-box', marginBottom: 6 }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button disabled={busy} onClick={() => setEditingId(null)} style={btnStyle('#fff', '#6b7280')}>Cancel</button>
        <button disabled={busy} onClick={() => submitEdit(a)} style={btnStyle(NAVY, '#fff')}>Save changes</button>
      </div>
      {a.status === 'ended' && (
        <div style={{ fontSize: 10, color: '#8B5E1A', fontFamily: F, marginTop: 5, lineHeight: 1.4 }}>
          This assignment has ended. Its dates still decide which shift logs it validates.
        </div>
      )}
    </div>
  )

  const confirmPanel = () => {
    const { type, a } = confirming
    const copy = confirmCopy(type, a)
    return (
      <div data-testid="sua-confirm" style={{
        marginTop: 6, padding: '8px 9px', borderRadius: 6,
        border: `1px solid ${type === 'remove' ? '#fca5a5' : '#f0c9b0'}`,
        background: type === 'remove' ? '#FEF2F2' : '#FBF5E8',
      }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#191919', fontFamily: F, marginBottom: 3 }}>
          {copy.title}
        </div>
        <div style={{ fontSize: 10.5, color: '#4b5563', fontFamily: F, lineHeight: 1.45, marginBottom: 7 }}>
          {copy.body}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button disabled={busy} onClick={() => setConfirming(null)} style={btnStyle('#fff', '#6b7280')}>Cancel</button>
          <button disabled={busy} onClick={runConfirmed}
            style={btnStyle(type === 'remove' ? '#b91c1c' : NAVY, '#fff')}>
            {copy.confirmLabel}
          </button>
        </div>
      </div>
    )
  }

  const row = (a) => {
    const role = ROLE_BADGE[a.role] || ROLE_BADGE.additional
    const status = STATUS_CHIP[a.status] || STATUS_CHIP.ended
    const isLive = a.status === 'active' || a.status === 'planned'
    const editable = canManage && a.status !== 'removed'
    return (
      <div key={a.id} data-testid="unit-assignment-row" style={{
        padding: '7px 8px', borderRadius: 7, border: '1px solid #eef0f4',
        marginBottom: 5, background: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#191919', fontFamily: F }}>
                {canonicalUnitName(a.unit_key)}
              </span>
              <span style={chip(role)}>{role.label}</span>
              <span style={chip(status)}>{status.label}</span>
            </div>
            <div style={{ fontSize: 10.5, color: '#6b7280', fontFamily: F, marginTop: 2 }}>{fmtRange(a)}</div>
            {a.notes ? <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 2 }}>{a.notes}</div> : null}
          </div>
          {editable && (
            <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button disabled={busy} onClick={() => openEdit(a)}
                title="Edit dates and notes"
                style={btnStyle('#fff', NAVY)}>Edit</button>
              {isLive && a.role !== 'primary' && (
                <button disabled={busy} onClick={() => { setEditingId(null); setConfirming({ type: 'set_primary', a }) }}
                  title="Make this the primary unit"
                  style={btnStyle('#fff', NAVY)}>Make primary</button>
              )}
              {isLive && (
                <>
                  <button disabled={busy} onClick={() => { setEditingId(null); setConfirming({ type: 'end', a }) }}
                    title="End this assignment (kept as history)"
                    style={btnStyle('#fff', '#6b7280')}>End</button>
                  <button disabled={busy} onClick={() => { setEditingId(null); setConfirming({ type: 'remove', a }) }}
                    title="Remove: the record was entered in error"
                    style={btnStyle('#fff', '#b91c1c')}>Remove</button>
                </>
              )}
            </div>
          )}
        </div>
        {editingId === a.id && editForm(a)}
        {confirming && confirming.a.id === a.id && confirmPanel()}
      </div>
    )
  }

  return (
    <div data-testid="student-unit-assignments" style={{ fontFamily: F }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Unit assignments
        </span>
        {canManage && (
          <button disabled={busy} onClick={() => setAdding(v => !v)} style={{ ...btnStyle('#fff', NAVY), marginLeft: 'auto' }}>
            {adding ? 'Cancel' : 'Add unit'}
          </button>
        )}
      </div>

      {notice && (
        <div data-testid="sua-notice" style={{
          fontSize: 11, fontFamily: F, padding: '7px 9px', borderRadius: 7, marginBottom: 6,
          background: '#FBF5E8', border: '1px solid #f0c9b0', color: '#8B5E1A', lineHeight: 1.45,
        }}>{notice}</div>
      )}

      {adding && (
        <div data-testid="sua-add-form" style={{ padding: '8px 9px', borderRadius: 7, border: '1px solid #c3cdf0', background: '#F8FAFF', marginBottom: 7 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <select value={addUnitId} onChange={e => setAddUnitId(e.target.value)} style={selStyle()}>
              <option value="">Choose a unit…</option>
              {units.filter(u => u.is_participating !== false).map(u => (
                <option key={u.id} value={u.id}>{u.unit_name}</option>
              ))}
            </select>
            <select value={addRole} onChange={e => setAddRole(e.target.value)} style={selStyle()}>
              <option value="additional">Additional unit</option>
              <option value="primary">Change primary to this unit</option>
            </select>
            {addRole === 'additional' && (
              <select value={addStatus} onChange={e => setAddStatus(e.target.value)} style={selStyle()}>
                <option value="active">Active now</option>
                <option value="planned">Planned</option>
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={dateLabel()}>Start <input type="date" value={addStart} onChange={e => setAddStart(e.target.value)} style={selStyle()} /></label>
            {addRole === 'additional' && (
              <label style={dateLabel()}>End <input type="date" value={addEnd} onChange={e => setAddEnd(e.target.value)} style={selStyle()} /></label>
            )}
            <button disabled={busy || !addUnitId} onClick={submitAdd} style={{ ...btnStyle(NAVY, '#fff'), marginLeft: 'auto', opacity: (!addUnitId || busy) ? 0.6 : 1 }}>
              {addRole === 'primary' ? 'Set primary' : 'Add assignment'}
            </button>
          </div>
          {addRole === 'primary' && !confirming?.fromAdd && (
            <div style={{ fontSize: 10, color: '#8B5E1A', fontFamily: F, marginTop: 5, lineHeight: 1.4 }}>
              Changing the primary ends the current primary assignment and updates the matched unit atomically.
            </div>
          )}
          {confirming?.fromAdd && confirmPanel()}
        </div>
      )}

      {assignments === null ? (
        <div style={{ fontSize: 11, color: '#9ca3af' }}>Loading unit assignments…</div>
      ) : error ? (
        <div style={{ fontSize: 11, color: '#b91c1c' }}>Could not load assignments ({error}).</div>
      ) : (
        <>
          {live.length === 0 && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 5 }}>No live unit assignment.</div>
          )}
          {live.map(row)}
          {history.length > 0 && (
            <button onClick={() => setShowHistory(v => !v)} style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: 10.5, fontWeight: 600, color: '#6b7280', fontFamily: F, marginTop: 2,
            }}>
              {showHistory ? 'Hide' : 'Show'} history ({history.length})
            </button>
          )}
          {showHistory && history.map(row)}
        </>
      )}
    </div>
  )
}

function btnStyle(bg, color) {
  return {
    padding: '3px 9px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${color === '#fff' ? bg : color}`, background: bg, color, fontFamily: F,
  }
}
function selStyle() {
  return {
    padding: '4px 7px', border: '1.5px solid #e5e7eb', borderRadius: 6,
    fontSize: 11, fontFamily: F, color: '#191919', background: '#fff',
  }
}
function dateLabel() {
  return { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#374151', fontFamily: F }
}
