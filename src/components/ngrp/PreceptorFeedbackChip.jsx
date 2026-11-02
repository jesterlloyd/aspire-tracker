// RESIDENCY-PORTAL-2b: the roster's preceptor feedback indicator. It says that feedback is on
// file (or, for the ASPIRE team, that someone asked to see it). FEEDBACK-MODAL-1 (2026-11-02):
// with `onOpen` it is a button that opens PreceptorFeedbackDialog; it stops the click so the row
// it sits in does not open as well.
import Tooltip from '../ui/Tooltip'
import { MessageSquareText } from 'lucide-react'

function feedbackIndicator(entry) {
  if (!entry) return null
  if ((entry.requests || []).some(r => r.status === 'pending')) return 'requested'
  if (entry.available || entry.count > 0) return 'available'
  return null
}

export default function PreceptorFeedbackChip({ entry, onOpen }) {
  const kind = feedbackIndicator(entry)
  if (!kind) return null
  const requested = kind === 'requested'
  const style = {
    display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'top',
    fontSize: 9, fontWeight: 700, borderRadius: 999, padding: '1px 6px', marginTop: 2, marginLeft: 4,
    color: requested ? '#8A5A00' : '#1D2567',
    background: requested ? '#FFF4DB' : '#E8EAF4',
  }
  const body = (
    <>
      <MessageSquareText size={10} aria-hidden="true" />
      {requested ? 'Feedback requested' : 'Preceptor feedback'}
    </>
  )
  if (onOpen) {
    const stop = e => e.stopPropagation()
    return (
      <Tooltip label="Open the latest preceptor feedback" applyAriaLabel={false}>
        <button type="button" className="ngrp-fbchip" style={{ ...style, border: 0, fontFamily: 'inherit', cursor: 'pointer' }}
          onClick={e => { stop(e); onOpen() }} onKeyDown={stop}>
          {body}
        </button>
      </Tooltip>
    )
  }
  return (
    <Tooltip label={requested ? 'Talent Acquisition asked to view the preceptor feedback' : 'Preceptor feedback is on file'} applyAriaLabel={false}>
      <span style={style}>{body}</span>
    </Tooltip>
  )
}
