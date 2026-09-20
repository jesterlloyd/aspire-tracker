import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Send, RefreshCw, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { surveyByKey } from '../../lib/evaluation/surveyCatalog'
import { PERIOD_LABELS } from '../../lib/evaluation/preceptorDueDetection'
import { RELEASE_ROUTES } from '../../lib/evaluation/releaseRouting'
import { ACTION_API } from '../../lib/unitEvaluationReleaseActions'
import { fmtHours, recentSent, whenLabel } from '../../lib/evaluation/reviewQueueShape'

// REVIEW-RELEASE-1: the one queue component. Six workflows, three states, one shape.
//
// This component knows nothing about detection. It receives items already in the shared
// shape (reviewQueueShape.js) from the dashboard, which ran the loaders and the adapters,
// and it renders them the same way whichever workflow they came from. What differs per
// workflow is DATA, read from the catalog: the name, the old name, the recipient, the
// trigger, the gate, the policy paragraph. What is the same is everything else: the
// tools row, the three sections, the slip, the chain strip, the actions, the sent tape.
//
// REVIEW-RELEASE-2: the queue is a clipboard. Every class here is dressed by
// reviewReleaseClipboard.css (imported by the dashboard, which owns the board and the
// rail); this file carries structure and words, never a colour or a radius.
//
// EVERY RELEASE STILL GOES THROUGH A CONFIRMATION, shows the server-resolved recipient
// with no editable field, and is handed back to the dashboard to send: the queue never
// calls an endpoint itself.

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'

// Per-workflow policy text: the collapsed "How release works" paragraph (section 6.4).
// These replace the banner and the long description that used to top each panel.
const POLICY = {
  caseyFinkPreRotation: 'Releasing emails the student the pre-rotation Readiness for Practice survey. Any student who has been interviewed is a candidate, whether or not they are placed yet. Nothing downstream is blocked by it.',
  preceptor: 'Releasing re-checks eligibility on the server and sends through the same path as a manual send. The recipient is resolved from the student, there is no recipient field.',
  student: 'Releasing emails the student a link to the feedback survey. It re-checks hours on the server first.',
  caseyFinkPostRotation: 'Releasing emails the student the post-rotation Readiness for Practice survey. The Certificate of Completion unlocks only after the student submits it. There is no bulk release.',
  postRotation: 'Releasing emails the student the program feedback survey. Nothing downstream depends on it. The server also requires the required program activities to be recorded first.',
  unitLeaderRelease: 'Releasing puts this response’s quantitative results in front of that unit’s leader in their portal, seven days after the rotation ends and once moderation is cleared. Nothing is emailed. A single-response result is not anonymous.',
}

const NODE_MARK = { done: '✓', this: 'Now', waiting: 'Waiting', fix: 'Fix' }

function ChainStrip({ chain }) {
  if (!chain?.length) return null
  return (
    <div className="rq-chain">
      {chain.map((n, i) => (
        <div key={`${n.role}-${i}`} className={`rq-node rq-node-${n.status}`}>
          <div className="rq-node-k">{n.label}</div>
          <div className="rq-node-v">
            {NODE_MARK[n.status] && <i>{NODE_MARK[n.status]}</i>}
            {n.detail}
          </div>
        </div>
      ))}
    </div>
  )
}

function Stamp({ stamp }) {
  if (!stamp?.text) return null
  return <span className={`rq-stamp rq-stamp-${stamp.tone}`}>{stamp.text}</span>
}

// A slip. The band's colour is the stamp's tone: ready is green, a wait or a step behind
// is amber, a data fix or a wait older than seven days is red (the adapters decide the
// tone; the slip only wears it). One student, one sheet: no stack under it (Owner,
// 2026-09-19, "it's single student and it's in a clipboard already").
function Card({ item, workflow, busy, locked, leaving, highlighted, onRelease, onAction, onJump, onReadFeedback }) {
  const ready = item.state === 'ready'
  const b = item.blocker
  const tone = item.stamp?.tone === 'ok' ? 'ok' : item.stamp?.tone === 'late' ? 'late' : 'soon'
  return (
      <article
        className={`rq-card rq-card-${item.state} rq-band-${tone}${highlighted ? ' rq-card-flash' : ''}${leaving ? ' rq-card-gone' : ''}`}
        data-item-id={item.id}
      >
        <div className="rq-top">
          <div className="rq-who">
            {item.person.name}
            {item.person.sub && <small>{item.person.sub}</small>}
          </div>
          <div className="rq-right">
            <Stamp stamp={item.stamp} />
            {item.hours ? (
              <span className="rq-hours">
                <b>{fmtHours(item.hours.approved)} / {fmtHours(item.hours.required)}</b> h
                <span className="rq-thr">threshold {fmtHours(item.hours.threshold)}</span>
              </span>
            ) : (
              <span className="rq-hours-none">hours not required</span>
            )}
          </div>
        </div>

        <ChainStrip chain={item.chain} />

        <div className="rq-actions">
          {ready ? (
            <>
              {/* No preview here: the previews live on the board's head (Owner, 2026-09-19). */}
              {workflow.key === 'unitLeaderRelease'
                ? <button type="button" className="rq-pbtn" onClick={() => onReadFeedback?.(item)}>Read the feedback</button>
                : <span className="rq-why">{item.sendTo ? `To ${item.sendTo}` : ''}</span>}
              <button type="button" className="rq-pbtn go" disabled={busy || locked}
                title={locked ? 'Releases are paused until you re-run detection.' : undefined}
                onClick={() => onRelease(item)}>
                {item.release?.reissue ? 'Reissue' : item.release?.action === 'rerelease' ? 'Re-release' : 'Release'}
              </button>
            </>
          ) : (
            <>
              <span className="rq-why">{b?.text}</span>
              {b?.action === 'jump' && (
                <button type="button" className="rq-pbtn link" onClick={() => onJump(b.target)}>{b.target?.label} {'→'}</button>
              )}
              {b?.action === 'fix' && (
                <button type="button" className="rq-pbtn" onClick={() => onAction(item)}>
                  {b.target?.kind === 'preceptor' ? 'Open preceptor' : b.target?.kind === 'response' ? 'Open Responses' : 'Open student'}
                </button>
              )}
              {b?.action === 'activity' && (
                <button type="button" className="rq-pbtn" onClick={() => onAction(item)}>Record activities</button>
              )}
              {b?.action === 'moderate' && (
                <button type="button" className="rq-pbtn" disabled={busy} onClick={() => onAction(item)}>Clear moderation</button>
              )}
              {/* Owner, 2026-09-19: no manual Remind yet. A waiting card says when the system will nudge. */}
            </>
          )}
        </div>
      </article>
  )
}

function Section({ title, caption, count, children }) {
  return (
    <section className="rq-section">
      <div className="rq-sect-head">
        <span>{title} ({count})</span>
        {caption && <em>{caption}</em>}
      </div>
      <div className="rq-stack">{children}</div>
    </section>
  )
}

export default function ReviewReleaseQueue({
  workflow, items = [], sent = [], detectedAtMs = 0, loading = false, error = null,
  busyItemId = null, releaseLocked = false, leavingItemId = null, notice = null, highlightItemId = null,
  onRerun, onRelease, onAction, onJump, onTrackResponses, onReadFeedback,
  tools, // { onPreviewSurvey, onPreviewEmail, onSendTest, testState, onOpenTest, onCopyTest }
}) {
  // The policy paragraph is collapsed by default and collapses again on every workflow
  // change. Keyed derived state rather than an effect: an effect that sets state on a
  // key change renders twice, and this repo forbids the pattern.
  const [policy, setPolicy] = useState({ key: workflow?.key, open: false })
  const policyOpen = policy.key === workflow?.key ? policy.open : false
  const setPolicyOpen = (updater) => setPolicy({ key: workflow?.key, open: typeof updater === 'function' ? updater(policyOpen) : updater })

  const ready = useMemo(() => items.filter(i => i.state === 'ready'), [items])
  const blocked = useMemo(() => items.filter(i => i.state === 'blocked'), [items])
  const notEligible = useMemo(() => items.filter(i => i.state === 'notEligible'), [items])
  const recent = useMemo(() => recentSent(sent, 5), [sent])

  // A jump target scrolls into view and flashes once; the flash is dropped by the
  // dashboard after a moment, so it never sticks to a card.
  const flashedRef = useRef(null)
  useEffect(() => {
    if (!highlightItemId || flashedRef.current === highlightItemId) return
    flashedRef.current = highlightItemId
    const el = document.querySelector(`[data-item-id="${CSS.escape(highlightItemId)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightItemId])

  if (!workflow) return null
  const survey = surveyByKey(workflow.key) || workflow
  const notEligibleLabel = survey.key === 'caseyFinkPreRotation'
    ? `Not yet interviewed (${notEligible.length}) · nothing to do yet`
    : survey.key === 'unitLeaderRelease'
      ? `Not yet eligible (${notEligible.length}) · results release 7 days after the rotation ends`
      : `Not yet eligible (${notEligible.length}) · below the hours threshold, nothing to do yet`

  const cardProps = (it) => ({
    item: it, workflow: survey, busy: busyItemId === it.id, locked: releaseLocked, leaving: leavingItemId === it.id,
    highlighted: highlightItemId === it.id, onRelease, onAction, onJump, onReadFeedback,
  })

  return (
    <div className="rq">
      {/* 1. Name, with the old name beside it for one release cycle, and the two previews as
          icon buttons at the top right: the canon from Residency > Support (Owner,
          2026-09-19), the eye for the email and the square-arrow for the form. */}
      <div className="rq-head">
        <div className="rq-head-main">
          <h2>{survey.label}</h2>
          <span className="rq-was">{survey.was ? `currently “${survey.was}”` : 'new'}</span>
        </div>
        {survey.slug && (
          <div className="rq-head-icons" role="group" aria-label="Survey tools">
            <button type="button" className="rq-iconbtn" onClick={tools?.onPreviewEmail} title="Preview the invitation email" aria-label="Preview the invitation email"><Eye size={15} aria-hidden="true" /></button>
            <button type="button" className="rq-iconbtn" onClick={tools?.onPreviewSurvey} title="Open a sample of the survey" aria-label="Open a sample of the survey"><ExternalLink size={15} aria-hidden="true" /></button>
          </div>
        )}
      </div>
      {/* 2. One quiet line: who it goes to, what triggers it, what it gates. */}
      <p className="rq-meta-line">To {survey.to} {'·'} {survey.trigger} {'·'} {survey.gate}</p>
      {/* 3. The tool row: a test send and detection, with the stamp at the right. */}
      <div className="rq-tools">
        {survey.slug && (
          <button type="button" className="rr-tool-test" disabled={tools?.testState?.busy} onClick={tools?.onSendTest} aria-label="Send a test of the selected survey to my own email"><Send size={14} aria-hidden="true" /> {tools?.testState?.busy ? 'Preparing…' : 'Send test to me'}</button>
        )}
        <button type="button" className="rr-tool-secondary" onClick={onRerun} disabled={loading}><RefreshCw size={14} aria-hidden="true" /> {loading ? 'Detecting…' : 'Re-run detection'}</button>
        <span className="rq-meta">{detectedAtMs ? `Detected ${new Date(detectedAtMs).toLocaleString('en-US')}` : ''}</span>
      </div>
      {tools?.testState?.note && (
        <div role="status" className="rq-testnote">
          <span>{tools.testState.note}</span>
          {tools.testState.url && (
            <>
              <button type="button" className="rr-tool-primary" onClick={tools.onOpenTest}><ExternalLink size={14} aria-hidden="true" /> Open test now</button>
              <button type="button" className="rr-tool-secondary" onClick={tools.onCopyTest}>Copy test link</button>
            </>
          )}
        </div>
      )}
      {/* 4. The policy, collapsed. */}
      <div className="rq-policy">
        <button type="button" aria-expanded={policyOpen} onClick={() => setPolicyOpen(o => !o)}>
          {policyOpen ? 'Hide' : 'How release works'}
        </button>
        {policyOpen && <span className="rq-policy-more">{POLICY[survey.key]}</span>}
      </div>

      {notice && <div role="status" className={`rq-notice ${notice.tone === 'ok' ? 'ok' : 'err'}`}>{notice.text}</div>}
      {error && <div role="alert" className="rq-notice err">Error running detection: {error.message || String(error)}</div>}
      {releaseLocked && (
        <p role="alert" className="rq-notice err">Release is paused on this screen until you re-run detection and verify the Sent log.</p>
      )}

      {/* 5. Ready. */}
      <Section title="Ready to release" caption="Every prerequisite is done" count={ready.length}>
        {ready.length === 0
          ? <div className="rq-empty">{loading ? 'Detecting…' : 'Nothing waiting on you here.'}</div>
          : ready.map(it => <Card key={it.id} {...cardProps(it)} />)}
      </Section>
      {/* 6. Blocked, omitted when empty. */}
      {blocked.length > 0 && (
        <Section title="Needs a fix or a reminder" caption="Something a person can do today" count={blocked.length}>
          {blocked.map(it => <Card key={it.id} {...cardProps(it)} />)}
        </Section>
      )}
      {/* 7. Not yet eligible, collapsed. */}
      {notEligible.length > 0 && (
        <details className="rq-eligible">
          <summary>{notEligibleLabel}</summary>
          <ul>
            {notEligible.map(it => (
              <li key={it.id}>
                {it.person.name}{it.hours ? ` ${fmtHours(it.hours.approved)}/${fmtHours(it.hours.required)}` : it.notEligibleDetail ? ` · ${it.notEligibleDetail}` : ''}{it.nextGate ? ` · ${it.nextGate}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* 8. The sent tape. Owner, 2026-09-19: no Undo on it; sends are synchronous. */}
      <div className="rq-sent rq-tape">
        <div className="rq-tape-head">
          <span>Sent from this clipboard</span>
          <button type="button" onClick={() => onTrackResponses?.(survey)}>Track responses {'→'}</button>
        </div>
        {recent.length === 0
          ? <div className="rq-tape-empty">Nothing sent from here yet.</div>
          : recent.map(line => (
            <div key={line.id} className="rq-tape-line">
              <span className="t">{whenLabel(line.at)}</span>
              <span className="d">{line.who}{line.step ? ` · ${line.step}` : ''}</span>
              <span className="r">{line.recipient}{line.submission ? ` · ${line.submission}` : ''}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

// ── Confirmations ──────────────────────────────────────────────────────────────
// The release confirmation, shared by the five survey workflows. Shows the server-resolved
// recipient with no editable field. The preceptor workflow may redirect to an ACTIVE
// secondary or coverage preceptor (PRECEPTOR-ROUTE-1), which is a canonical selection the
// server re-validates; nothing else in here is a recipient input.

// Modal buttons only (the confirmations below are dialogs, not the clipboard).
const btn = (kind) => ({
  padding: kind === 'go' ? '5px 14px' : '4px 11px', borderRadius: 6, fontSize: 12, fontFamily: F, cursor: 'pointer',
  fontWeight: kind === 'go' ? 700 : 500, whiteSpace: 'nowrap',
  background: kind === 'go' ? '#166534' : kind === 'link' ? 'none' : 'rgba(30,42,110,0.05)',
  color: kind === 'go' ? '#fff' : kind === 'link' ? NAVY : '#191919',
  border: kind === 'go' ? '1px solid #166534' : kind === 'link' ? 'none' : '1px solid #d7ddf5',
  textDecoration: kind === 'link' ? 'underline' : 'none', textUnderlineOffset: 3,
})

export function ReleaseConfirm({ item, workflow, releasing, onCancel, onConfirm }) {
  const [alternates, setAlternates] = useState([])
  const [redirectId, setRedirectId] = useState('')
  const isPreceptor = workflow?.key === 'preceptor'
  const route = RELEASE_ROUTES[workflow?.key]

  useEffect(() => {
    if (!isPreceptor || !item?.studentId) return
    let cancelled = false
    ;(async () => {
      const { data: spa } = await supabase
        .from('student_preceptor_assignments')
        .select('preceptor_id, role')
        .eq('student_id', item.studentId)
        .eq('status', 'active')
        .in('role', ['secondary', 'coverage'])
      if (cancelled || !spa?.length) return
      const ids = spa.map(r => r.preceptor_id)
      const { data: precs } = await supabase.from('preceptors').select('id, full_name, email, is_active').in('id', ids)
      if (cancelled) return
      const byId = new Map((precs || []).map(p => [p.id, p]))
      setAlternates(spa
        .map(r => ({ ...r, prec: byId.get(r.preceptor_id) }))
        .filter(r => r.prec && r.prec.is_active !== false && (r.prec.email || '').trim())
        .map(r => ({ id: r.preceptor_id, role: r.role, name: r.prec.full_name, email: r.prec.email })))
    })()
    return () => { cancelled = true }
  }, [isPreceptor, item?.studentId])

  if (!item) return null
  const reissue = !!item.release?.reissue
  const title = workflow.key === 'unitLeaderRelease'
    ? (item.release?.action === 'rerelease' ? 'Re-release this response to the unit leader?' : 'Release this response to the unit leader?')
    : reissue ? `Reissue ${workflow.label}?` : `Release ${workflow.label}?`

  return (
    <div className="modal-overlay" onMouseDown={() => !releasing && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480, fontFamily: F }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: NAVY, fontFamily: F }}>{title}</h2>
        </div>
        <div style={{ padding: '16px 20px', fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 12px', marginBottom: 14 }}>
            <span style={{ color: '#9ca3af', fontWeight: 600 }}>Workflow</span><span style={{ fontWeight: 600, color: NAVY }}>{route?.workflowTitle || workflow.label}</span>
            <span style={{ color: '#9ca3af', fontWeight: 600 }}>{workflow.key === 'unitLeaderRelease' ? 'Response of' : 'Student'}</span><span style={{ fontWeight: 600, color: '#191919' }}>{item.person.name}</span>
            {item.period && (<><span style={{ color: '#9ca3af', fontWeight: 600 }}>Period</span><span>{PERIOD_LABELS[item.period]}</span></>)}
            <span style={{ color: '#9ca3af', fontWeight: 600 }}>{workflow.key === 'unitLeaderRelease' ? 'Released to' : 'Recipient'}</span>
            <span>{isPreceptor ? (item.release?.preceptorName ? `${item.release.preceptorName} (${item.release.preceptorEmail})` : item.release?.preceptorEmail) : item.sendTo || '-'}</span>
            {item.hours && (<><span style={{ color: '#9ca3af', fontWeight: 600 }}>Approved / Required</span><span>{fmtHours(item.hours.approved)} / {fmtHours(item.hours.required)}</span></>)}
          </div>
          {isPreceptor && alternates.length > 0 && (
            <label style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
              <span style={{ color: '#6b7280', fontWeight: 600 }}>Send to instead (active secondary or coverage preceptor)</span>
              <select value={redirectId} onChange={e => setRedirectId(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%', padding: '6px 8px', fontFamily: F, fontSize: 12.5, borderRadius: 7, border: '1px solid #d1d5db' }}>
                <option value="">Primary preceptor (as shown above)</option>
                {alternates.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role}) · {a.email}</option>)}
              </select>
            </label>
          )}
          <p style={{ margin: 0, fontSize: 12.5, color: '#6b7280' }}>
            {workflow.key === 'unitLeaderRelease'
              ? 'The unit leader sees quantitative results only, in their portal. The database re-checks moderation and the 7-day rule before releasing.'
              : reissue
                ? 'This replaces the expired or revoked link, opens a new 28-day response window, and sends one new invitation. A completed response is never replaced.'
                : 'Eligibility and the recipient are re-checked on the server before anything is sent.'}
          </p>
        </div>
        <div className="modal-footer" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-outline-modal" onClick={onCancel} disabled={releasing}>Cancel</button>
          <button onClick={() => onConfirm({ redirectId })} disabled={releasing}
            style={{ padding: '8px 18px', background: '#166534', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: F, cursor: releasing ? 'default' : 'pointer', opacity: releasing ? 0.6 : 1 }}>
            {releasing ? 'Sending…' : reissue ? 'Confirm & Reissue' : 'Confirm & Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Record or correct ONE activity for ONE student (POST-ROTATION-SEQUENCED-RELEASE-1).
// Ported from the ASPIRE feedback panel: confirmation required, a correction needs a
// reason, nothing here sends or releases.
export function ActivityDialog({ item, saving, message, onCancel, onSubmit }) {
  // Selection and reason belong to ONE item; a different item starts clean. Keyed
  // derived state, not an effect (see the policy toggle above for why).
  const [draft, setDraft] = useState({ id: item?.id, chosen: null, reason: '' })
  const live = draft.id === item?.id ? draft : { id: item?.id, chosen: null, reason: '' }
  const chosen = live.chosen
  const reason = live.reason
  const setChosen = (c) => setDraft({ ...live, chosen: c })
  const setReason = (r) => setDraft({ ...live, reason: r })
  if (!item) return null
  const activities = item.activities || []
  return (
    <div onClick={() => { if (!saving) onCancel() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" data-testid="pr-activity-dialog"
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520, padding: 22, fontFamily: F, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: NAVY }}>Required activities for {item.person.name}</h2>
        <p style={{ fontSize: 12.5, color: '#6b7280', margin: '6px 0 12px' }}>Recording completion writes to the ledger under your name and today&rsquo;s date. It does not send any email and does not release an evaluation. A correction keeps the original entry in the history.</p>
        <div style={{ display: 'grid', gap: 6 }}>
          {activities.map(a => (
            <label key={a.key} data-testid="pr-activity-row" style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" name="activity" checked={chosen?.key === a.key} onChange={() => setChosen(a)} />
              <span style={{ color: a.completed ? '#166534' : '#92400e' }}>{a.completed ? '✓' : '○'} {a.label}
                {a.completed && a.completedAt ? <span style={{ color: '#6b7280' }}>{` ${new Date(a.completedAt).toLocaleDateString('en-US')}`}</span> : null}
                {a.completed && a.recordedByName ? <span style={{ color: '#9ca3af' }}>{` · ${a.recordedByName}`}</span> : null}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: NAVY, fontWeight: 600 }}>{a.completed ? 'Correct' : 'Mark complete'}</span>
            </label>
          ))}
        </div>
        {chosen?.completed && (
          <textarea data-testid="pr-activity-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this being corrected?" rows={3}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 12, padding: '8px 10px', fontFamily: F, fontSize: 12.5, borderRadius: 8, border: '1px solid #d1d5db' }} />
        )}
        {message && (
          <div data-testid="pr-activity-msg" style={{ margin: '10px 0 0', padding: '8px 12px', borderRadius: 8, fontSize: 12.5,
            background: message.tone === 'ok' ? '#ecfdf5' : '#fef2f2', color: message.tone === 'ok' ? '#065f46' : '#991b1b',
            border: `1px solid ${message.tone === 'ok' ? '#a7f3d0' : '#fecaca'}` }}>{message.text}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button type="button" className="btn-outline-modal" disabled={saving} onClick={onCancel}>Close</button>
          <button type="button" data-testid="pr-activity-submit" disabled={saving || !chosen || (chosen.completed && !reason.trim())}
            onClick={() => onSubmit({ activity: chosen, reason: reason.trim() })}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#166534', color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: F, cursor: saving ? 'default' : 'pointer', opacity: (saving || !chosen) ? 0.6 : 1 }}>
            {saving ? 'Saving…' : chosen?.completed ? 'Record correction' : 'Mark complete'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The Unit Leader moderation step, offered from a blocked card. */
export function ModerateConfirm({ item, busy, onCancel, onDecide }) {
  if (!item) return null
  return (
    <div className="modal-overlay" onMouseDown={() => !busy && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 440, fontFamily: F }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header"><h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: NAVY, fontFamily: F }}>Moderate this response?</h2></div>
        <div style={{ padding: '16px 20px', fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 10px' }}><b>{item.person.name}</b> · {item.person.sub}</p>
          <p style={{ margin: 0, fontSize: 12.5, color: '#6b7280' }}>Clearing moderation makes the response releasable once its 7-day window has passed. Blocking holds it. {ACTION_API.moderate_blocked.confirm ? 'Blocking is recorded.' : ''}</p>
        </div>
        <div className="modal-footer" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-outline-modal" onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={() => onDecide('moderate_blocked')} disabled={busy} style={{ ...btn(), color: '#991b1b', borderColor: '#f0c9c9' }}>Block</button>
          <button onClick={() => onDecide('moderate_cleared')} disabled={busy} style={{ ...btn('go') }}>Clear</button>
        </div>
      </div>
    </div>
  )
}
