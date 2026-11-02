// FEEDBACK-MODAL-1 (Owner, 2026-11-02): the roster's Preceptor feedback chip opens the latest
// feedback in a dialog: End of Rotation, else Midpoint (latestFeedback). The dialog is the Candidate
// Score dialog's shell and the binder's own FeedbackEntry, so the two read the same.
//
// The ASPIRE team opens it outright (no event is written). Talent Acquisition opens it under the
// Transition Form's consent, and each open is logged as the binder's View Feedback is
// (FEEDBACK-CONSENT-1); before they submit, the dialog says why it is closed and fetches nothing.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogKeys } from './useDialogKeys'
import { FeedbackEntry } from './ApplicantDrawer'
import { latestFeedback, feedbackTarget } from '../../lib/ngrp/feedbackPick'

const PERIOD_LINE = {
  'End of Rotation': 'The latest end-of-rotation feedback.',
  Midpoint: 'The latest midpoint feedback; no end-of-rotation feedback is on file yet.',
}
const muted = { margin: '4px 0 10px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-caption)' }

export default function PreceptorFeedbackDialog({ row, name, entry, audience, onLoad, onClose }) {
  const ref = useRef(null)
  useDialogKeys(ref, onClose)
  const target = feedbackTarget(row, entry, audience)
  const [state, setState] = useState(target ? 'loading' : 'closed') // loading | ready | error | closed
  const [shown, setShown] = useState(null)
  const key = target ? JSON.stringify(target) : ''

  useEffect(() => {
    if (!key) return
    // One fetch per open (onLoad is stable): a Talent Acquisition open is logged.
    let live = true
    Promise.resolve(onLoad?.(JSON.parse(key))).then(res => {
      if (!live) return
      if (res?.ok) { setShown(latestFeedback(res.feedback || [])); setState('ready') } else setState('error')
    }).catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [key, onLoad])

  const ta = audience === 'talent_acquisition'
  return createPortal(
    <div className="ngrp-scoredlg-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className="ngrp-scoredlg" role="dialog" aria-modal="true" aria-labelledby="ngrp-fbdlg-title">
        <div className="ngrp-scoredlg-head">
          <div>
            <h2 id="ngrp-fbdlg-title">Preceptor Feedback</h2>
            {name && <p>{name}</p>}
          </div>
          <button type="button" className="ngrp-scoredlg-close" aria-label="Close" data-autofocus onClick={onClose}>×</button>
        </div>
        {state === 'closed' && (
          <p style={muted}>
            A preceptor submitted feedback for this alumnus. It opens here once they submit the Transition Form,
            where they agree to share their record with Talent Acquisition.
          </p>
        )}
        {state === 'loading' && <p style={muted}>Opening…</p>}
        {state === 'error' && <p style={{ ...muted, color: 'var(--aspire-bad)' }}>The feedback could not be opened. Close this and try again.</p>}
        {state === 'ready' && (shown ? (
          <>
            <p style={muted}>
              {PERIOD_LINE[shown.period] || 'The latest feedback on file.'}
              {ta ? ' Shared with you under the Transition Form; the ASPIRE team can see that you opened it.' : ' Every entry is in the binder, on the Interview sheet.'}
            </p>
            <FeedbackEntry entry={shown} first />
          </>
        ) : <p style={muted}>The feedback is no longer on file.</p>)}
      </div>
    </div>,
    document.body,
  )
}
