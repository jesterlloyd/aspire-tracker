import { useCallback, useMemo, useRef, useState } from 'react'
import { BUILD_ENV, BUILD_SHA } from '../lib/buildInfo'
import {
  PortalFeedbackApiError,
  clearPortalFeedbackRequestId,
  createPortalFeedbackRequestId,
  submitPortalFeedbackReport,
  validatePortalFeedbackClientPayload,
} from '../lib/portalFeedbackApiClient'
import usePortalDialogFocus from './usePortalDialogFocus'

const INTENT_KEY = 'unit_leader:utility'
const FIELD_LIMIT = 5000

function emptyForm() {
  return {
    message: '',
    expected_behavior: '',
    actual_behavior: '',
    reproduction_steps: '',
  }
}

function errorText(code) {
  switch (code) {
    case 'request_id_payload_conflict':
      return 'This submission could not be safely retried. Please close this window and start a new report.'
    case 'rate_limited':
      return 'Too many reports were sent recently. Please try again later.'
    case 'message_required':
      return 'Please enter a message.'
    case 'expected_behavior_required':
      return 'Please describe what you expected to happen.'
    case 'actual_behavior_required':
      return 'Please describe what actually happened.'
    case 'reproduction_steps_required':
      return 'Please add the steps to reproduce the issue.'
    default:
      return 'Something went wrong. Your text is still here so you can try again.'
  }
}

function hasHtml(value) {
  return /<\s*\/?\s*[a-z][^>]*>/i.test(value || '')
}

export default function PortalFeedbackDialog({
  open,
  onClose,
  launcherRef,
  pathname,
  section,
}) {
  const dialogRef = useRef(null)
  const submittingRef = useRef(false)
  const [requestId, setRequestId] = useState(() => createPortalFeedbackRequestId(INTENT_KEY))
  const [mode, setMode] = useState('feedback')
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const title = mode === 'bug' ? 'Report a Bug' : 'Send Feedback'
  const description = 'Share feedback or report an issue with this portal. Attachments and screenshots are not included.'

  const resetAndClose = useCallback(() => {
    if (submittingRef.current) return
    clearPortalFeedbackRequestId(INTENT_KEY)
    setRequestId('')
    setForm(emptyForm())
    setErrors({})
    setStatus('')
    setMode('feedback')
    onClose?.()
  }, [onClose])

  usePortalDialogFocus({
    open,
    dialogRef,
    returnFocusRef: launcherRef,
    onEscape: resetAndClose,
    disabled: submitting,
  })

  const setField = (field, value) => {
    setForm(current => ({ ...current, [field]: value }))
    setErrors(current => ({ ...current, [field]: null, form: null }))
    setStatus('')
  }

  const payload = useMemo(() => {
    const base = {
      request_id: requestId,
      type: mode,
      message: form.message,
      pathname,
      section,
      build_sha: BUILD_SHA,
      environment: BUILD_ENV,
    }
    if (mode !== 'bug') return base
    return {
      ...base,
      expected_behavior: form.expected_behavior,
      actual_behavior: form.actual_behavior,
      reproduction_steps: form.reproduction_steps,
      viewport_width: Math.max(1, Math.round(window.innerWidth || 1)),
      viewport_height: Math.max(1, Math.round(window.innerHeight || 1)),
    }
  }, [form, mode, pathname, requestId, section])

  const validate = () => {
    const next = {}
    for (const field of ['message', 'expected_behavior', 'actual_behavior', 'reproduction_steps']) {
      if (form[field]?.length > FIELD_LIMIT) next[field] = 'Keep this field to 5,000 characters or fewer.'
      if (hasHtml(form[field])) next[field] = 'Use plain text only.'
    }
    if (!form.message.trim()) next.message = 'Please enter a message.'
    if (mode === 'bug') {
      if (!form.expected_behavior.trim()) next.expected_behavior = 'Please describe what you expected to happen.'
      if (!form.actual_behavior.trim()) next.actual_behavior = 'Please describe what actually happened.'
      if (!form.reproduction_steps.trim()) next.reproduction_steps = 'Please add the steps to reproduce the issue.'
    }
    const checked = validatePortalFeedbackClientPayload(payload)
    if (!checked.ok && !Object.keys(next).length) next.form = errorText(checked.error)
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async (event) => {
    event.preventDefault()
    if (submittingRef.current) return
    if (!validate()) return
    submittingRef.current = true
    setSubmitting(true)
    setStatus('')
    setErrors({})
    try {
      const result = await submitPortalFeedbackReport(payload)
      clearPortalFeedbackRequestId(INTENT_KEY)
      setRequestId(createPortalFeedbackRequestId(INTENT_KEY))
      setStatus(result?.notification_status === 'sent'
        ? 'ASPIRE received your submission and the notification was sent.'
        : 'ASPIRE received your submission.')
      setForm(emptyForm())
    } catch (err) {
      const code = err instanceof PortalFeedbackApiError ? err.code : null
      setErrors({ form: errorText(code) })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="ptl-modal-backdrop ptl-feedback-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !submittingRef.current) resetAndClose()
    }}>
      <form
        ref={dialogRef}
        className="ptl-modal ptl-feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ptl-feedback-title"
        aria-describedby="ptl-feedback-desc"
        tabIndex={-1}
        onSubmit={submit}
      >
        <div className="ptl-modal-head">
          <div>
            <h2 id="ptl-feedback-title">{title}</h2>
            <p id="ptl-feedback-desc" className="ptl-muted">{description}</p>
          </div>
          <button type="button" className="ptl-icon-btn" aria-label="Close feedback dialog" onClick={resetAndClose} disabled={submitting}>×</button>
        </div>
        <div className="ptl-modal-body ptl-feedback-body">
          <fieldset className="ptl-feedback-mode" aria-label="Submission type">
            <legend className="ptl-field-label">What would you like to send?</legend>
            <label className="ptl-feedback-mode-option">
              <input type="radio" name="feedback-mode" value="feedback" checked={mode === 'feedback'} onChange={() => { setMode('feedback'); setErrors({}); setStatus('') }} />
              <span>Send Feedback</span>
            </label>
            <label className="ptl-feedback-mode-option">
              <input type="radio" name="feedback-mode" value="bug" checked={mode === 'bug'} onChange={() => { setMode('bug'); setErrors({}); setStatus('') }} />
              <span>Report a Bug</span>
            </label>
          </fieldset>

          <label className="ptl-field">
            <span className="ptl-field-label">{mode === 'bug' ? 'Summary' : 'Message'} <span aria-hidden="true">*</span></span>
            <textarea className="ptl-input ptl-feedback-textarea" value={form.message} maxLength={FIELD_LIMIT}
              onChange={(e) => setField('message', e.target.value)} disabled={submitting} />
            {errors.message && <span className="ptl-field-error">{errors.message}</span>}
          </label>

          {mode === 'bug' && (
            <>
              <label className="ptl-field">
                <span className="ptl-field-label">Expected behavior <span aria-hidden="true">*</span></span>
                <textarea className="ptl-input ptl-feedback-textarea" value={form.expected_behavior} maxLength={FIELD_LIMIT}
                  onChange={(e) => setField('expected_behavior', e.target.value)} disabled={submitting} />
                {errors.expected_behavior && <span className="ptl-field-error">{errors.expected_behavior}</span>}
              </label>
              <label className="ptl-field">
                <span className="ptl-field-label">Actual behavior <span aria-hidden="true">*</span></span>
                <textarea className="ptl-input ptl-feedback-textarea" value={form.actual_behavior} maxLength={FIELD_LIMIT}
                  onChange={(e) => setField('actual_behavior', e.target.value)} disabled={submitting} />
                {errors.actual_behavior && <span className="ptl-field-error">{errors.actual_behavior}</span>}
              </label>
              <label className="ptl-field">
                <span className="ptl-field-label">Reproduction steps <span aria-hidden="true">*</span></span>
                <textarea className="ptl-input ptl-feedback-textarea" value={form.reproduction_steps} maxLength={FIELD_LIMIT}
                  onChange={(e) => setField('reproduction_steps', e.target.value)} disabled={submitting} />
                {errors.reproduction_steps && <span className="ptl-field-error">{errors.reproduction_steps}</span>}
              </label>
            </>
          )}

          <p className="ptl-muted ptl-feedback-privacy">Do not include student details, message content, evaluation text, access tokens, screenshots, or attachments.</p>
          <div className="ptl-feedback-live" role="status" aria-live="polite">
            {status}
            {errors.form && <span className="ptl-form-error">{errors.form}</span>}
          </div>
        </div>
        <div className="ptl-modal-actions">
          <button type="button" className="ptl-btn-outline" onClick={resetAndClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="ptl-btn" disabled={submitting}>{submitting ? 'Sending...' : 'Submit'}</button>
        </div>
      </form>
    </div>
  )
}
