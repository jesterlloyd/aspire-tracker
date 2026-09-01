// NGRP-RELEASE-2: the Send-to-Many panel for the NGRP Transition Form
// invitation. Unlike BulkManualComposer, this panel has NO editable body and
// NO client-side recipient entry: the recipients are the alumni selected in
// NGRP → Applicants (carried by the launch context), the email is a trusted
// server template, and each secure link is minted inside
// /api/ngrp-transition-send - a raw token never reaches this browser.
//
// Flow: preview (server classifies the selection: first sends, re-sends,
// skips) → typed confirmation → send → three-bucket delivery report →
// return to Applicants with the residency cohort and filters preserved.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Send, ArrowLeft, ShieldCheck } from 'lucide-react'
import ConnectPanel from './ConnectPanel'
import { supabase } from '../../lib/supabase'
import { LAUNCH_KINDS, readLaunchContext, clearLaunchContext } from '../../lib/connect/launchContext'

const F = 'DM Sans, sans-serif'
const CONFIRMATION = 'SEND MESSAGES'

async function authedPost(payload) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return { ok: false, status: 401, body: null }
  const res = await fetch('/api/ngrp-transition-send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  let body = null
  try { body = await res.json() } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, body }
}

const SEND_ERRORS = {
  confirmation_required: `Type ${CONFIRMATION} exactly to confirm.`,
  invalid_form_close_date: 'That revise-until date is not a real date. Nothing was sent.',
  form_close_date_in_past: 'The revise-until date has already passed, so the form would arrive closed. Nothing was sent.',
}

const SKIP_LABELS = {
  missing_email: 'no email on file',
  not_completed: 'not at Completed status',
  already_sent: 'already has a live form (enable resend to replace the link)',
  not_in_cycle_scope: 'not in this residency cohort’s source cohorts',
  already_sent_in_batch: 'already sent in this batch',
}

export default function NgrpTransitionSendPanel({ renderTypeSelector }) {
  const navigate = useNavigate()
  const [ctx] = useState(() => {
    const c = readLaunchContext()
    return c && c.kind === LAUNCH_KINDS.NGRP_TRANSITION_FORM ? c : null
  })
  const [resend, setResend] = useState(false)
  // NGRP-TRANSITION-COPY-2: the optional per-send revise-until date. BLANK IS THE DEFAULT
  // and means the residency cohort's application deadline, which is what every send used
  // before this field existed - so leaving it alone changes nothing.
  const [closeDate, setCloseDate] = useState('')
  const [typed, setTyped] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [errorText, setErrorText] = useState(null)

  // Server-side classification of the launched selection - a query, not an
  // effect, so there is nothing to synchronize by hand.
  const previewQuery = useQuery({
    queryKey: ['ngrp_transition_preview', ctx?.cycleId, (ctx?.studentIds || []).join('|'), resend],
    queryFn: () => authedPost({
      preview: true, cycle_id: ctx.cycleId, student_ids: ctx.studentIds || [], resend,
    }),
    enabled: Boolean(ctx),
    staleTime: 15_000,
    retry: false,
  })
  const res = previewQuery.data
  const preview = res?.ok ? res.body
    : res?.status === 422 && res.body?.error === 'cycle_not_ready' ? { notReady: res.body.reasons || [] }
    : null
  const previewState = !ctx ? 'none'
    : previewQuery.isLoading ? 'loading'
    : previewQuery.isError || !res ? 'error'
    : res.ok && res.body?.provisioned === false ? 'unprovisioned'
    : res.status === 422 && res.body?.error === 'cycle_not_ready' ? 'not_ready'
    : res.ok && res.body ? 'ready'
    : 'error'

  const doSend = async () => {
    if (!ctx || sending) return
    setSending(true)
    setErrorText(null)
    const res = await authedPost({
      confirmation: typed,
      batch_id: crypto.randomUUID(),
      cycle_id: ctx.cycleId,
      student_ids: ctx.studentIds || [],
      resend,
      ...(closeDate ? { form_close_date: closeDate } : {}),
    })
    setSending(false)
    if (!res.ok || !res.body?.success) {
      setErrorText(SEND_ERRORS[res.body?.error]
        || 'The send could not start. Nothing was sent - review and try again.')
      return
    }
    setResult(res.body)
  }

  const returnToApplicants = () => {
    const path = ctx?.returnPath || '/ngrp/applicants'
    clearLaunchContext()
    navigate(path)
  }

  const sendCount = preview ? (preview.send?.length || 0) + (resend ? (preview.reissue?.length || 0) : 0) : 0

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 300px', minWidth: 260 }}>
        {renderTypeSelector ? renderTypeSelector('student') : null}
      </div>

      <div style={{ flex: '1 1 480px', minWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ConnectPanel
          tone="draft"
          title="NGRP Transition Form Invitation"
          helper={ctx ? `Residency cohort: ${ctx.cycleName || 'selected cohort'}` : undefined}
          icon={<ShieldCheck size={14} />}
        >
          {!ctx && (
            <p style={{ margin: 0, fontSize: 13, color: '#4a5560', fontFamily: F, lineHeight: 1.6 }}>
              This secure invitation starts from <strong>Residency → Applicants</strong>: select the
              completed alumni there and choose <strong>Send Transition Form</strong>. Each recipient
              receives one personal, secure link minted on the server - there is no editable message
              body or manual recipient entry for this template.
            </p>
          )}

          {ctx && previewState === 'loading' && (
            <p style={{ margin: 0, fontSize: 13, color: '#6b7785', fontFamily: F }}>Checking the selection…</p>
          )}
          {ctx && previewState === 'unprovisioned' && (
            <p style={{ margin: 0, fontSize: 13, color: '#4b5563', fontFamily: F }}>
              NGRP form persistence is not provisioned yet (migration 20260904000000). Nothing was sent.
            </p>
          )}
          {ctx && previewState === 'error' && (
            <p style={{ margin: 0, fontSize: 13, color: '#991b1b', fontFamily: F }}>
              The selection could not be verified. Nothing was sent - return to Applicants and try again.
            </p>
          )}
          {ctx && previewState === 'not_ready' && (
            <div style={{ fontSize: 13, color: '#92400e', fontFamily: F }}>
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>This residency cohort is not ready for form sends:</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(preview?.notReady || []).map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
              </ul>
              <p style={{ margin: '10px 0 0' }}>Fix this in Residency → Planning, then relaunch the send.</p>
            </div>
          )}

          {ctx && previewState === 'ready' && !result && (
            <div style={{ fontFamily: F, fontSize: 13, color: '#191919' }}>
              <p style={{ margin: '0 0 10px', color: '#4a5560', lineHeight: 1.6 }}>
                Each alumnus below receives one secure, personal Transition Form link. Sending records
                “Transition Form Sent” - it is not an invitation to apply, and a submitted form is
                never an application confirmation.
              </p>
              <ul style={{ margin: '0 0 10px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <li><b>{preview.send.length}</b> will receive the form for the first time</li>
                {preview.reissue.length > 0 && (
                  <li>
                    <b>{preview.reissue.length}</b> already have a live form
                    {resend
                      ? ' - their prior link will be revoked and replaced'
                      : ' - they will be skipped (enable resend below to replace their links)'}
                  </li>
                )}
                {preview.skipped.length > 0 && (
                  <li style={{ color: '#92400e' }}>
                    <b>{preview.skipped.length}</b> cannot be sent:{' '}
                    {preview.skipped.map(s => `${s.name || s.student_id} (${SKIP_LABELS[s.reason] || s.reason})`).join('; ')}
                  </li>
                )}
                {(preview.out_of_scope || []).length > 0 && (
                  <li style={{ color: '#92400e' }}>
                    <b>{preview.out_of_scope.length}</b> selected record(s) are outside this residency
                    cohort's scope and were excluded.
                  </li>
                )}
              </ul>
              {preview.reissue.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={resend} onChange={e => setResend(e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: '#1D2567' }} />
                  <span>Resend to alumni who already have a form (revokes their prior link immediately)</span>
                </label>
              )}
              <label style={{ display: 'block', margin: '0 0 12px' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4a5560', marginBottom: 5 }}>
                  Revise submitted forms until
                </span>
                <input
                  type="date"
                  value={closeDate}
                  onChange={e => setCloseDate(e.target.value)}
                  style={{ height: 34, padding: '0 10px', border: '1px solid rgba(29,37,103,0.15)', borderRadius: 8, fontFamily: F, fontSize: 12.5 }}
                />
                <span style={{ display: 'block', fontSize: 11.5, color: '#6b7785', marginTop: 5, lineHeight: 1.5 }}>
                  {closeDate
                    ? 'This date is stated in the email and enforced by the form, for this send only.'
                    : preview.cycle?.application_deadline
                      ? `Leave blank to use the cohort's application deadline (${preview.cycle.application_deadline}).`
                      : "Leave blank to use the cohort's application deadline."}
                </span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                <input
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  placeholder={`Type ${CONFIRMATION} to confirm`}
                  aria-label={`Type ${CONFIRMATION} to confirm the send`}
                  style={{ height: 34, padding: '0 10px', border: '1px solid rgba(29,37,103,0.15)', borderRadius: 8, fontFamily: F, fontSize: 12.5, minWidth: 220 }}
                />
                <button
                  type="button"
                  disabled={sending || typed !== CONFIRMATION || sendCount === 0}
                  onClick={doSend}
                  style={{
                    height: 34, padding: '0 16px', borderRadius: 9, border: 'none',
                    background: '#1D2567', color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: F,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    cursor: sending || typed !== CONFIRMATION || sendCount === 0 ? 'not-allowed' : 'pointer',
                    opacity: sending || typed !== CONFIRMATION || sendCount === 0 ? 0.55 : 1,
                  }}
                >
                  <Send size={13} strokeWidth={2.2} aria-hidden="true" />
                  {sending ? 'Sending…' : `Send Transition Form (${sendCount})`}
                </button>
              </div>
              {errorText && <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#991b1b' }}>{errorText}</p>}
            </div>
          )}

          {result && (
            <div style={{ fontFamily: F, fontSize: 13 }}>
              <p style={{ margin: '0 0 10px', fontWeight: 700, color: result.summary.failed > 0 ? '#991b1b' : result.summary.skipped > 0 ? '#92400e' : '#166534' }}>
                {result.summary.failed > 0
                  ? `${result.summary.failed} delivery failure(s) - those alumni were NOT marked as sent.`
                  : result.summary.skipped > 0
                    ? 'Sent, with some recipients skipped.'
                    : 'All Transition Forms sent.'}
              </p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, color: '#4a5560' }}>
                <li>Sent: <b>{result.summary.sent}</b></li>
                <li>Skipped: <b>{result.summary.skipped}</b></li>
                <li>Failed: <b>{result.summary.failed}</b></li>
              </ul>
              {result.failed.length > 0 && (
                <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#991b1b' }}>
                  Failed recipients stay at their previous form state - fix the issue and send again;
                  the workflow is idempotent and will not double-send anyone who succeeded.
                </p>
              )}
              {(result.warnings || []).length > 0 && (
                <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#92400e' }}>
                  {result.warnings.length} email(s) were delivered but a bookkeeping ledger write failed -
                  those recipients ARE sent; the delivery record may be incomplete in Sent History.
                </p>
              )}
              <p style={{ margin: '0 0 12px', fontSize: 11.5, color: '#9ca3af' }}>Batch {result.batch_id}</p>
            </div>
          )}

          {ctx && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(29,37,103,0.08)' }}>
              <button
                type="button"
                onClick={returnToApplicants}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none',
                  border: '1px solid rgba(29,37,103,0.15)', borderRadius: 8, height: 32, padding: '0 12px',
                  color: '#1D2567', fontSize: 12.5, fontWeight: 600, fontFamily: F, cursor: 'pointer',
                }}
              >
                <ArrowLeft size={13} strokeWidth={2.2} aria-hidden="true" />
                {result ? 'Return to Applicants' : 'Cancel and return to Applicants'}
              </button>
            </div>
          )}
        </ConnectPanel>
      </div>
    </div>
  )
}
