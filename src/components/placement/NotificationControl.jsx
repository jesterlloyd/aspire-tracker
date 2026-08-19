import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Mail, Check } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import {
  NOTIFICATION_TARGETS, labelsFor, confirmationPrompt, correctionPrompt,
} from '../../lib/placementNotificationState'

// PLACEMENT-NOTIFICATION-CONTROL-1 - the ONE notification control.
//
// Before this component the board carried two different designs for the same
// idea: a bare green tick that replaced the unit-leader envelope, and a blue
// dated "Sent Aug 18" chip beside the preceptor's - different shapes, different
// sizes, different tooltips (one of them a full sentence), and two different
// meanings of "notified". A reader could not tell what either claimed.
//
// One component now renders both rows, so they cannot drift again:
//
//   unnotified  [✉] [✓]   envelope opens the draft; check asks to confirm
//   confirmed   ✓ Notified   compact, inert, with a two-word tooltip
//
// THE SPLIT IT ENFORCES. The envelope only opens a draft - it writes nothing,
// ever, whatever happens to that draft afterwards. The check is the only path
// to notified state, and it always stops at a dialog first. Sending an email
// and recording that someone was notified are different acts by different
// people, and this control keeps them different.

const ICON_BTN = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 6, border: '1px solid transparent',
  background: 'none', padding: 0, lineHeight: 1, flexShrink: 0,
}

const F = 'DM Sans, sans-serif'

function Dialog({ title, body, children, onCancel }) {
  // Portaled: the unit card transforms on hover and clips its overflow, which
  // would trap and clip a dialog rendered inside it.
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: 22, maxWidth: 460, width: '100%',
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)', fontFamily: F }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1D2567', marginBottom: 8 }}>{title}</div>
        <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, margin: '0 0 14px' }}>{body}</p>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * @param target        'unit_leader' | 'preceptor'
 * @param state         notificationStateFor(...) result
 * @param personName    the unit leader / preceptor being notified
 * @param studentName   the placement's student
 * @param unitName      the placement's unit
 * @param onOpenDraft   opens the existing mailto / Connect handoff. Writes nothing.
 * @param onConfirm     async () => void - records the confirmation
 * @param onCorrect     async (reason) => void - Owner/Admin only; omit to hide
 * @param disabledReason when the envelope cannot be used (e.g. no email on file)
 */
export default function NotificationControl({
  target = NOTIFICATION_TARGETS.UNIT_LEADER,
  state,
  personName = '',
  studentName = '',
  unitName = '',
  onOpenDraft,
  onConfirm,
  onCorrect = null,
  disabledReason = '',
  compact = false,
}) {
  const [dialog, setDialog] = useState(null)   // 'confirm' | 'correct' | null
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const labels = labelsFor(target)
  const confirmed = !!state?.confirmed

  const runConfirm = async () => {
    if (busy) return
    setBusy(true)
    try { await onConfirm?.() ; setDialog(null) } finally { setBusy(false) }
  }

  const runCorrect = async () => {
    if (busy) return
    const r = reason.trim()
    // A correction rewrites what the board claims about a real person. It does
    // not happen without a stated reason, because the reason IS the audit.
    if (r.length < 3) { setReasonError('Please give a brief reason for the correction.'); return }
    setBusy(true)
    try { await onCorrect?.(r); setDialog(null); setReason(''); setReasonError('') } finally { setBusy(false) }
  }

  // ── Confirmed: one compact, inert status ──────────────────────────────────
  if (confirmed) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        <Tooltip label={labels.confirmed} placement="top">
          {/* aria-disabled, not disabled: a natively disabled control is
              unfocusable and shows no tooltip, so the explanation would vanish
              exactly when someone needs it. The handler blocks activation,
              which covers mouse, Enter and Space alike. */}
          <button
            type="button"
            data-testid={`notify-status-${target}`}
            aria-label={labels.confirmed}
            aria-disabled="true"
            onClick={e => { e.stopPropagation(); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation() } }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3,
              background: 'none', border: 'none', padding: '1px 2px', cursor: 'default',
              fontFamily: F, fontSize: 10.5, fontWeight: 700, color: '#166534',
              whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Check size={12} strokeWidth={3} aria-hidden="true" />
            {compact ? '' : 'Notified'}
          </button>
        </Tooltip>

        {/* Owner/Admin correction, out of the way in a secondary control. It
            never touches the match, the unit, or the preceptor assignment. */}
        {onCorrect && (
          <Tooltip label={`Correct this ${labels.noun} notification`} placement="top">
            <button
              type="button"
              data-testid={`notify-correct-${target}`}
              aria-label={`Correct this ${labels.noun} notification`}
              onClick={e => { e.stopPropagation(); setReason(''); setReasonError(''); setDialog('correct') }}
              style={{ background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer',
                fontFamily: F, fontSize: 13, lineHeight: 1, color: '#9ca3af', flexShrink: 0 }}>
              ⋯
            </button>
          </Tooltip>
        )}

        {dialog === 'correct' && (
          <Dialog
            title={`Correct ${labels.confirmed.toLowerCase()}`}
            body={correctionPrompt({ target, personName })}
            onCancel={() => !busy && setDialog(null)}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
              Reason for the correction
            </label>
            <input
              data-testid={`notify-correct-reason-${target}`}
              value={reason}
              autoFocus
              onChange={e => { setReason(e.target.value); setReasonError('') }}
              placeholder="e.g. marked by mistake - the email was never sent"
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
                border: `1px solid ${reasonError ? '#fca5a5' : '#e5e7eb'}`, fontFamily: F, fontSize: 12.5 }} />
            {reasonError && (
              <div data-testid={`notify-correct-error-${target}`}
                style={{ marginTop: 5, fontSize: 11.5, color: '#dc2626', fontFamily: F }}>{reasonError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" disabled={busy} onClick={() => setDialog(null)}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff',
                  fontSize: 12.5, fontWeight: 600, color: '#374151', fontFamily: F, cursor: busy ? 'not-allowed' : 'pointer' }}>
                Cancel
              </button>
              <button type="button" data-testid={`notify-correct-submit-${target}`} disabled={busy} onClick={runCorrect}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: busy ? '#9ca3af' : '#B45309',
                  fontSize: 12.5, fontWeight: 600, color: '#fff', fontFamily: F, cursor: busy ? 'not-allowed' : 'pointer' }}>
                {busy ? 'Recording…' : 'Record Correction'}
              </button>
            </div>
          </Dialog>
        )}
      </span>
    )
  }

  // ── Unnotified: the two actions ───────────────────────────────────────────
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <Tooltip label={disabledReason || labels.envelope} placement="top">
        <button
          type="button"
          data-testid={`notify-envelope-${target}`}
          aria-label={disabledReason || labels.envelope}
          aria-disabled={disabledReason ? 'true' : 'false'}
          disabled={!!disabledReason}
          onClick={e => { e.stopPropagation(); if (!disabledReason) onOpenDraft?.() }}
          style={{ ...ICON_BTN,
            color: disabledReason ? '#d1d5db' : '#475467',
            cursor: disabledReason ? 'not-allowed' : 'pointer' }}>
          <Mail size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </Tooltip>

      <Tooltip label={labels.check} placement="top">
        <button
          type="button"
          data-testid={`notify-check-${target}`}
          aria-label={labels.check}
          onClick={e => { e.stopPropagation(); setDialog('confirm') }}
          style={{ ...ICON_BTN, color: '#475467', cursor: 'pointer' }}>
          <Check size={15} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </Tooltip>

      {dialog === 'confirm' && (
        <Dialog
          title={labels.check}
          body={confirmationPrompt({ target, personName, studentName, unitName })}
          onCancel={() => !busy && setDialog(null)}>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" data-testid={`notify-cancel-${target}`} disabled={busy}
              onClick={() => setDialog(null)}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff',
                fontSize: 12.5, fontWeight: 600, color: '#374151', fontFamily: F, cursor: busy ? 'not-allowed' : 'pointer' }}>
              Cancel
            </button>
            <button type="button" data-testid={`notify-confirm-${target}`} disabled={busy} onClick={runConfirm}
              style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: busy ? '#9ca3af' : '#1D2567',
                fontSize: 12.5, fontWeight: 600, color: '#fff', fontFamily: F, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Recording…' : labels.check}
            </button>
          </div>
        </Dialog>
      )}
    </span>
  )
}
