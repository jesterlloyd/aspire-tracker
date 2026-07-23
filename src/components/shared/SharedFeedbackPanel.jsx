import { useRef, useState } from 'react'
import { MessageCircle, X } from 'lucide-react'

const FEEDBACK_CATEGORIES = [
  { value: 'Bug Report', emoji: '🐛' },
  { value: 'Feature Idea', emoji: '💡' },
  { value: 'Question', emoji: '❓' },
]

const FIELD_LIMIT = 5000

function emptyBugFields() {
  return {
    expected_behavior: '',
    actual_behavior: '',
    reproduction_steps: '',
  }
}

export default function SharedFeedbackPanel({
  activeTab,
  cohortName,
  isAuthenticated = true,
  launcherRef,
  open,
  onOpenChange,
  hidden = false,
  side = 'left',
  submitLabel = 'Send to Jester',
  contextNote,
  onSubmit,
}) {
  const ownRef = useRef(null)
  const buttonRef = launcherRef || ownRef
  const submittingRef = useRef(false)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [category, setCategory] = useState('')
  const [message, setMessage] = useState('')
  const [bugFields, setBugFields] = useState(emptyBugFields)
  const [showTooltip, setShowTooltip] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  if (!isAuthenticated) return null

  const isOpen = open ?? uncontrolledOpen
  const setOpen = (next) => {
    if (onOpenChange) onOpenChange(next)
    else setUncontrolledOpen(next)
  }
  const tabLabel = activeTab
    ? activeTab.charAt(0).toUpperCase() + activeTab.slice(1).replace(/-/g, ' ')
    : 'Unknown tab'
  const note = contextNote || `Will include: ${activeTab ? `${activeTab} tab` : 'current tab'} · ${cohortName || 'current cohort'}`
  const bugSelected = category === 'Bug Report'
  const bugComplete = !bugSelected
    || (bugFields.expected_behavior.trim() && bugFields.actual_behavior.trim() && bugFields.reproduction_steps.trim())
  const canSend = Boolean(category && message.trim() && bugComplete && !submitting)

  const updateBugField = (field, value) => {
    setBugFields(current => ({ ...current, [field]: value }))
    setError('')
    setStatus('')
  }

  const handleSend = async () => {
    if (!canSend || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    setStatus('')
    try {
      await onSubmit?.({
        category,
        message,
        bugFields,
        activeTab: tabLabel,
        cohortName,
      })
      setMessage('')
      setCategory('')
      setBugFields(emptyBugFields())
      setStatus('Message sent.')
      setOpen(false)
    } catch (err) {
      setError(err?.message || 'Something went wrong. Your text is still here so you can try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className={`shared-feedback-tooltip shared-feedback-tooltip-${side}${showTooltip && !isOpen && !hidden ? ' is-visible' : ''}`}>
        Send feedback
      </div>

      {!hidden && (
        <button
          ref={buttonRef}
          data-tour="feedback-button"
          type="button"
          className={`shared-feedback-launcher shared-feedback-launcher-${side}${isOpen ? ' is-open' : ''}`}
          onClick={() => setOpen(!isOpen)}
          aria-label="Send feedback"
          aria-expanded={isOpen}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <MessageCircle size={22} color="#ffffff" strokeWidth={2} aria-hidden="true" />
        </button>
      )}

      {isOpen && (
        <>
          <div className="shared-feedback-backdrop" onClick={() => setOpen(false)} />
          <section
            className={`shared-feedback-panel shared-feedback-panel-${side}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shared-feedback-title"
            aria-describedby="shared-feedback-desc"
          >
            <div className="shared-feedback-head">
              <MessageCircle size={20} color="#ffffff" strokeWidth={2} aria-hidden="true" />
              <div>
                <h2 id="shared-feedback-title">Send Feedback</h2>
                <p id="shared-feedback-desc">Report a bug, suggest a feature, or ask a question.</p>
              </div>
              <button type="button" className="shared-feedback-close" onClick={() => setOpen(false)} aria-label="Close feedback panel">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="shared-feedback-body">
              <fieldset className="shared-feedback-categories">
                <legend>What&apos;s this about?</legend>
                <div className="shared-feedback-category-grid">
                  {FEEDBACK_CATEGORIES.map(cat => (
                    <button
                      key={cat.value}
                      type="button"
                      className={`shared-feedback-category${category === cat.value ? ' is-selected' : ''}`}
                      aria-pressed={category === cat.value}
                      onClick={() => { setCategory(cat.value); setError(''); setStatus('') }}
                    >
                      <span aria-hidden="true">{cat.emoji}</span>
                      {cat.value}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="shared-feedback-field">
                <span>Your message</span>
                <textarea
                  value={message}
                  maxLength={FIELD_LIMIT}
                  onChange={e => { setMessage(e.target.value); setError(''); setStatus('') }}
                  placeholder={
                    category === 'Bug Report'
                      ? 'Describe what happened...'
                      : category === 'Feature Idea'
                        ? 'Describe the feature and how it would help your workflow...'
                        : 'Ask anything about the platform or ASPIRE...'
                  }
                  rows={5}
                />
              </label>

              {bugSelected && (
                <div className="shared-feedback-bug-fields">
                  <label className="shared-feedback-field">
                    <span>Expected behavior</span>
                    <textarea value={bugFields.expected_behavior} maxLength={FIELD_LIMIT} rows={3}
                      onChange={e => updateBugField('expected_behavior', e.target.value)} />
                  </label>
                  <label className="shared-feedback-field">
                    <span>Actual behavior</span>
                    <textarea value={bugFields.actual_behavior} maxLength={FIELD_LIMIT} rows={3}
                      onChange={e => updateBugField('actual_behavior', e.target.value)} />
                  </label>
                  <label className="shared-feedback-field">
                    <span>Reproduction steps</span>
                    <textarea value={bugFields.reproduction_steps} maxLength={FIELD_LIMIT} rows={3}
                      onChange={e => updateBugField('reproduction_steps', e.target.value)} />
                  </label>
                </div>
              )}

              <div className="shared-feedback-context">📍 {note}</div>
              <div className="shared-feedback-live" role="status" aria-live="polite">
                {status}
                {error && <span role="alert">{error}</span>}
              </div>

              <button type="button" className="shared-feedback-submit" disabled={!canSend} onClick={handleSend}>
                {submitting ? 'Sending...' : submitLabel}
              </button>
            </div>
          </section>
        </>
      )}
    </>
  )
}
