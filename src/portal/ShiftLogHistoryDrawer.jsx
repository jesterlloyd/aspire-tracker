// src/portal/ShiftLogHistoryDrawer.jsx
//
// STUDENT-SHIFT-LOG-MANAGEMENT-1: the student's complete shift history, with
// self-service correction and withdrawal.
//
// Every entry is listed (the home card shows only the four most recent), each
// with its canonical status. Entries the student may still change carry Edit
// and Withdraw; entries the ASPIRE team has already reviewed, or that are
// locked by an issued certificate or a concluded rotation, explain why and
// offer a correction request instead of a control that would fail.
//
// Withdrawing asks for explicit confirmation and states exactly what happens
// to the hours. Nothing here writes the database directly: every action calls
// the authenticated portal endpoint, which resolves the student from the JWT.
//
// Staff internals (exception flags, reviewer identity, admin notes) are not
// fetched, not shown, and not reachable - the portal view excludes them.

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import ShiftNumberBadge from '../components/ShiftNumberBadge'
import { buildStudentShiftOrdinals } from '../lib/shiftOrdinals'
import { portalShiftStatus, isVoided } from '../lib/portalShiftStatus'
import { editMyShiftLog, voidMyShiftLog, fetchMyShiftEligibility, NOT_EDITABLE_COPY } from '../lib/myShiftLogApi'
import { composePortalEmail } from '../lib/outlookCompose'

const SUPPORT = 'aspire@cshs.org'
const SHIFT_TYPES = ['Day', 'Night', 'Mid']

const fmtDate = (ymd) => {
  if (!ymd) return 'Date pending'
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return String(ymd)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function correctionBody({ name, log }) {
  return `Hello ASPIRE Team,\n\nI would like to request a correction to a shift I logged.\n\nName: ${name || 'not available'}\nShift date: ${log?.shift_date || ''}\nUnit: ${log?.unit_name || ''}\nHours recorded: ${log?.total_hours ?? ''}\n\nWhat should change:\n\n\nThank you.`
}

export default function ShiftLogHistoryDrawer({
  open, logs = [], student, loginEmail = '', onClose, onChanged, returnFocusRef,
}) {
  const panelRef = useRef(null)
  const [editingId, setEditingId] = useState(null)
  const [confirmVoidId, setConfirmVoidId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [form, setForm] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  // AUTHORITATIVE per-entry verdicts from the server, keyed by shift id. The
  // drawer never decides eligibility locally: certificate-issued,
  // rotation-concluded and terminal locks are invisible in the shift row
  // itself, so only the server's verdict can explain them correctly.
  const [verdicts, setVerdicts] = useState({})
  // Distinct from a per-entry lock: until 20260819000000 is applied the
  // endpoint answers 'migration_required' for every entry. Saying "this can no
  // longer be changed" there would be untrue - the feature simply is not on
  // yet - so the drawer says exactly that instead, once, at the top.
  const [featureOff, setFeatureOff] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      returnFocusRef?.current?.focus?.()
    }
  }, [open, onClose, returnFocusRef])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    const candidates = (logs || []).filter(l => (l.lifecycle_state || 'completed') !== 'voided')
    Promise.all(candidates.map(l =>
      fetchMyShiftEligibility(l.id).then(r => [l.id, r.ok ? r.eligibility : null, r.error])
    )).then(rows => {
      if (cancelled) return
      setFeatureOff(rows.some(([, , err]) => err === 'migration_required'))
      setVerdicts(Object.fromEntries(rows.map(([id, v]) => [id, v])))
    })
    return () => { cancelled = true }
  }, [open, logs])

  if (!open) return null

  const ordinals = buildStudentShiftOrdinals(logs)
  const name = [student?.preferred_first_name || student?.first_name, student?.last_name].filter(Boolean).join(' ')

  const requestCorrection = (log) => {
    composePortalEmail({
      to: SUPPORT,
      subject: 'ASPIRE Shift Log Correction Request',
      body: correctionBody({ name, log }),
      loginEmail,
    })
  }

  const startEdit = (log) => {
    setConfirmVoidId(null)
    setNotice(null)
    setEditingId(log.id)
    setForm({
      shift_date: log.shift_date || '',
      total_hours: String(log.total_hours ?? ''),
      unit_name: log.unit_name || '',
      is_assigned_unit: log.is_assigned_unit !== false,
      unit_override_reason: log.unit_override_reason || '',
      preceptor_name: log.preceptor_name || '',
      is_assigned_preceptor: log.is_assigned_preceptor !== false,
      preceptor_override_note: log.preceptor_override_note || '',
      shift_type: SHIFT_TYPES.includes(log.shift_type) ? log.shift_type : 'Day',
      learning_highlight: log.learning_highlight || '',
      support_needed: log.support_needed || '',
      reason: '',
    })
  }

  const submitEdit = async (log) => {
    setBusy(true); setNotice(null)
    const r = await editMyShiftLog({
      shift_id: log.id,
      shift_date: form.shift_date,
      total_hours: Number(form.total_hours),
      unit_name: form.unit_name.trim(),
      is_assigned_unit: form.is_assigned_unit,
      unit_override_reason: form.unit_override_reason.trim(),
      preceptor_name: form.preceptor_name.trim(),
      is_assigned_preceptor: form.is_assigned_preceptor,
      preceptor_override_note: form.preceptor_override_note.trim(),
      shift_type: form.shift_type,
      learning_highlight: form.learning_highlight,
      support_needed: form.support_needed,
      reason: form.reason.trim() || undefined,
    })
    setBusy(false)
    if (!r.ok) {
      setNotice(r.error === 'not_editable'
        ? (NOT_EDITABLE_COPY[r.reason] || NOT_EDITABLE_COPY.not_editable)
        : r.error === 'migration_required'
          ? 'Shift corrections are not switched on yet. Please contact the ASPIRE team.'
          : r.error === 'invalid_field'
            ? 'Please check the date, hours (1-13), unit, and shift type.'
            : 'That change could not be saved. Please try again.')
      return
    }
    setEditingId(null)
    setNotice('Your shift was updated. Your hours have been recalculated.')
    onChanged?.(r.result)
  }

  const submitVoid = async (log) => {
    setBusy(true); setNotice(null)
    const r = await voidMyShiftLog({ shift_id: log.id, reason: voidReason.trim() || undefined })
    setBusy(false)
    if (!r.ok) {
      setNotice(r.error === 'not_editable'
        ? (NOT_EDITABLE_COPY[r.reason] || NOT_EDITABLE_COPY.not_editable)
        : 'That entry could not be withdrawn. Please try again.')
      return
    }
    setConfirmVoidId(null); setVoidReason('')
    setNotice('That entry was withdrawn and its hours were removed from your totals. It stays in your history.')
    onChanged?.(r.result)
  }

  // The SERVER's verdict is the only source of truth. Until it arrives the row
  // shows no action at all, so a student is never offered a control that would
  // fail (or denied one that would have worked).
  const editable = (log) => {
    if (isVoided(log)) return { ok: false, reason: 'already_voided', ready: true }
    const v = verdicts[log.id]
    if (v === undefined) return { ok: false, reason: null, ready: false }
    if (v === null) return { ok: false, reason: 'not_editable', ready: true }
    return { ok: v.editable === true, reason: v.reason, ready: true }
  }

  return (
    <>
      <div className="ptl-drawer-backdrop" onMouseDown={onClose} />
      <aside
        className="ptl-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Shift log history"
        data-testid="shift-history-drawer"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="ptl-drawer-head">
          <h2 className="ptl-drawer-title">Shift log history</h2>
          <button className="ptl-icon-btn" onClick={onClose} aria-label="Close shift log history">
            <X size={18} />
          </button>
        </div>

        <div className="ptl-drawer-body">
          {notice && (
            <div data-testid="shift-history-notice" style={{
              fontSize: 13, lineHeight: 1.5, padding: '10px 12px', borderRadius: 10, marginBottom: 12,
              background: '#fdf6ec', border: '1px solid #f0c9b0', color: '#8B5E1A',
            }}>{notice}</div>
          )}

          {featureOff && (
            <div data-testid="shift-history-feature-off" style={{
              fontSize: 13, lineHeight: 1.5, padding: '10px 12px', borderRadius: 10, marginBottom: 12,
              background: '#eef0f8', border: '1px solid #c3cdf0', color: '#1D2567',
            }}>
              Editing and withdrawing your own shifts is not switched on yet. Your full history is
              below. To correct anything now, use Request a correction and the ASPIRE team will
              take care of it.
            </div>
          )}

          {logs.length === 0 && (
            <p style={{ fontSize: 14, color: '#6b7280' }}>You have not logged any shifts yet.</p>
          )}

          {logs.map(log => {
            const st = portalShiftStatus(log)
            const can = editable(log)
            const voided = isVoided(log)
            return (
              <div
                key={log.id}
                data-testid="shift-history-row"
                className="ptl-slh-row"
                style={{
                  padding: '12px 14px', borderRadius: 12, marginBottom: 10,
                  border: '1px solid #f0ece3', background: voided ? '#fbfaf8' : '#fff',
                  opacity: voided ? 0.75 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <ShiftNumberBadge ordinal={ordinals.get(log.id)} size={20} />
                  <span style={{
                    fontSize: 14, fontWeight: 700, color: '#191919',
                    textDecoration: voided ? 'line-through' : 'none',
                  }}>
                    {fmtDate(log.shift_date)}
                  </span>
                  <span className={`ptl-chip ptl-chip-soft ptl-chip-${st.tone}`}>{st.label}</span>
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                  {[log.unit_name, log.preceptor_name, log.total_hours != null ? `${log.total_hours}h` : null, log.shift_type]
                    .filter(Boolean).join(' · ') || '-'}
                </div>
                {voided && (
                  <div style={{ fontSize: 12.5, color: '#8B5E1A', marginTop: 4 }}>
                    Withdrawn. These hours do not count toward your totals; the entry is kept in your history.
                  </div>
                )}

                {/* Actions */}
                {!voided && !can.ready && (
                  <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 9 }}>Checking…</div>
                )}
                {!voided && can.ready && can.ok && editingId !== log.id && confirmVoidId !== log.id && (
                  <div className="ptl-slh-actions" style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                    <button className="ptl-btn ptl-btn-sm" data-testid="shift-edit-btn"
                      onClick={() => startEdit(log)}>Edit</button>
                    <button className="ptl-slh-ghost" data-testid="shift-void-btn"
                      onClick={() => { setEditingId(null); setNotice(null); setVoidReason(''); setConfirmVoidId(log.id) }}>
                      Withdraw
                    </button>
                  </div>
                )}

                {!voided && can.ready && !can.ok && (
                  <div data-testid="shift-locked-note" style={{ marginTop: 9 }}>
                    {!featureOff && (
                      <div style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.5 }}>
                        {NOT_EDITABLE_COPY[can.reason] || NOT_EDITABLE_COPY.not_editable}
                      </div>
                    )}
                    {can.reason !== 'shift_in_progress' && (
                      <button className="ptl-slh-ghost" style={{ marginTop: 7 }}
                        data-testid="shift-correction-btn"
                        onClick={() => requestCorrection(log)}>
                        Request a correction
                      </button>
                    )}
                  </div>
                )}

                {/* Withdraw confirmation - explicit, with the hours consequence */}
                {confirmVoidId === log.id && (
                  <div data-testid="shift-void-confirm" style={{
                    marginTop: 10, padding: '11px 12px', borderRadius: 10,
                    border: '1px solid #f0c9b0', background: '#fdf6ec',
                  }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#191919', marginBottom: 4 }}>
                      Withdraw this shift?
                    </div>
                    <div style={{ fontSize: 12.5, color: '#4b5563', lineHeight: 1.5, marginBottom: 9 }}>
                      {log.total_hours != null ? `Its ${log.total_hours} hours ` : 'Its hours '}
                      will be removed from your{' '}
                      {log.status === 'Pending Review' || log.status === 'needs_review' ? 'pending' : 'approved'}
                      {' '}hours. The entry stays in your history marked withdrawn, and nothing is deleted.
                      If you only need to fix a detail, use Edit instead.
                    </div>
                    <input
                      type="text" value={voidReason} placeholder="Reason (optional)"
                      data-testid="shift-void-reason"
                      onChange={e => setVoidReason(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 8,
                        border: '1.5px solid #e5e7eb', fontSize: 13, marginBottom: 9 }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="ptl-slh-ghost" disabled={busy}
                        onClick={() => setConfirmVoidId(null)}>Cancel</button>
                      <button className="ptl-btn ptl-btn-sm" disabled={busy}
                        data-testid="shift-void-confirm-btn"
                        onClick={() => submitVoid(log)}>Yes, withdraw it</button>
                    </div>
                  </div>
                )}

                {/* Edit form */}
                {editingId === log.id && form && (
                  <div data-testid="shift-edit-form" style={{
                    marginTop: 10, padding: '11px 12px', borderRadius: 10,
                    border: '1px solid #c3cdf0', background: '#f8faff',
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 9 }}>
                      <label style={lbl}>Date
                        <input type="date" value={form.shift_date} data-testid="edit-date"
                          onChange={e => setForm(f => ({ ...f, shift_date: e.target.value }))} style={inp} />
                      </label>
                      <label style={lbl}>Hours
                        <input type="number" step="0.25" min="1" max="13" value={form.total_hours}
                          data-testid="edit-hours"
                          onChange={e => setForm(f => ({ ...f, total_hours: e.target.value }))} style={inp} />
                      </label>
                      <label style={lbl}>Unit
                        <input type="text" value={form.unit_name} data-testid="edit-unit"
                          onChange={e => setForm(f => ({ ...f, unit_name: e.target.value }))} style={inp} />
                      </label>
                      <label style={lbl}>Preceptor
                        <input type="text" value={form.preceptor_name}
                          onChange={e => setForm(f => ({ ...f, preceptor_name: e.target.value }))} style={inp} />
                      </label>
                      <label style={lbl}>Shift type
                        <select value={form.shift_type}
                          onChange={e => setForm(f => ({ ...f, shift_type: e.target.value }))} style={inp}>
                          {SHIFT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                    </div>

                    <label style={{ ...chk, marginTop: 9 }}>
                      <input type="checkbox" checked={form.is_assigned_unit}
                        onChange={e => setForm(f => ({ ...f, is_assigned_unit: e.target.checked }))} />
                      This was my assigned unit
                    </label>
                    {!form.is_assigned_unit && (
                      <input type="text" value={form.unit_override_reason}
                        placeholder="Why were you on a different unit? (required)"
                        data-testid="edit-unit-reason"
                        onChange={e => setForm(f => ({ ...f, unit_override_reason: e.target.value }))}
                        style={{ ...inp, width: '100%', boxSizing: 'border-box', marginTop: 6 }} />
                    )}
                    <label style={{ ...chk, marginTop: 7 }}>
                      <input type="checkbox" checked={form.is_assigned_preceptor}
                        onChange={e => setForm(f => ({ ...f, is_assigned_preceptor: e.target.checked }))} />
                      This was my assigned preceptor
                    </label>
                    {/* Kept as its own field rather than tied to the checkbox: a
                        note the student already wrote must never be erased by
                        toggling something else. */}
                    <input type="text" value={form.preceptor_override_note}
                      placeholder="Note about your preceptor (optional)"
                      data-testid="edit-preceptor-note"
                      onChange={e => setForm(f => ({ ...f, preceptor_override_note: e.target.value }))}
                      style={{ ...inp, width: '100%', boxSizing: 'border-box', marginTop: 6 }} />

                    <label style={{ ...lbl, marginTop: 9 }}>What I learned (optional)
                      <textarea rows={2} value={form.learning_highlight}
                        data-testid="edit-learning"
                        onChange={e => setForm(f => ({ ...f, learning_highlight: e.target.value }))}
                        style={{ ...inp, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
                    </label>
                    <label style={{ ...lbl, marginTop: 7 }}>Support I need (optional)
                      <textarea rows={2} value={form.support_needed}
                        data-testid="edit-support"
                        onChange={e => setForm(f => ({ ...f, support_needed: e.target.value }))}
                        style={{ ...inp, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
                    </label>

                    <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, margin: '9px 0' }}>
                      Saving re-checks your shift against your unit assignment and dates. Depending on what
                      you change, it may move between counted and awaiting review, and your totals update
                      straight away.
                    </div>

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="ptl-slh-ghost" disabled={busy}
                        onClick={() => setEditingId(null)}>Cancel</button>
                      <button className="ptl-btn ptl-btn-sm" disabled={busy} data-testid="edit-save-btn"
                        onClick={() => submitEdit(log)}>Save changes</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>
    </>
  )
}

const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#374151' }
const inp = { padding: '7px 9px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: 13, color: '#191919', background: '#fff' }
const chk = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151' }
