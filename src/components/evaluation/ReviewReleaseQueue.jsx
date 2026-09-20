import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Send, RefreshCw, ExternalLink, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { surveyByKey } from '../../lib/evaluation/surveyCatalog'
import { PERIOD_LABELS } from '../../lib/evaluation/preceptorDueDetection'
import { RELEASE_ROUTES } from '../../lib/evaluation/releaseRouting'
import { ACTION_API } from '../../lib/unitEvaluationReleaseActions'
import { fmtHours, recentSent, whenLabel, localToday, fmtDay } from '../../lib/evaluation/reviewQueueShape'
import Tooltip from '../ui/Tooltip'

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

// "Casey-Fink Readiness for Practice (Pre-Rotation)" reads as the name with the timepoint
// as a smaller qualifier (Owner, 2026-09-20); the rail keeps the full name.
function splitTitle(label = '') {
  const m = /^(.*\S)\s+\(([^()]+)\)$/.exec(label)
  return m ? [m[1], m[2]] : [label, null]
}

// `expandable` names ONE node whose label is a toggle (the Required activities node on
// the ASPIRE feedback slip): its chevron points right, and down when the recording area
// below the chain is open (Owner, 2026-09-20).
function ChainStrip({ chain, expandable = null }) {
  if (!chain?.length) return null
  return (
    <div className="rq-chain">
      {chain.map((n, i) => {
        const toggle = expandable && n.label === expandable.label
        return (
          <div key={`${n.role}-${i}`} className={`rq-node rq-node-${n.status}`}>
            {toggle ? (
              <button type="button" className="rq-node-k rq-node-toggle" aria-expanded={expandable.open} onClick={expandable.onToggle}>
                <ChevronRight size={12} aria-hidden="true" className="rq-chev" /> {n.label}
              </button>
            ) : <div className="rq-node-k">{n.label}</div>}
            <div className="rq-node-v">
              {NODE_MARK[n.status] && <i>{NODE_MARK[n.status]}</i>}
              {n.detail}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// The recording area (Owner, 2026-09-20): the three activities in Residency > Support's
// order, each with its most recent date, recorded HERE with the date it happened. A
// completion that exists only in Support is shown as Support's and is corrected there.
// Nothing here sends or releases; a correction keeps the original ledger entry.
function ActivitiesArea({ item, onRecord }) {
  const today = localToday()
  const [drafts, setDrafts] = useState({})
  const [busyKey, setBusyKey] = useState(null)
  const [msg, setMsg] = useState(null)
  const draft = (k) => drafts[k] || { date: today, reason: '', correcting: false }
  const setDraft = (k, patch) => setDrafts(d => ({ ...d, [k]: { ...draft(k), ...patch } }))
  const record = async (a, action) => {
    const d = draft(a.key)
    setBusyKey(a.key); setMsg(null)
    const res = await onRecord?.(item, { activity: a, action, completedAt: action === 'complete' ? d.date : undefined, reason: action === 'reverse' ? d.reason.trim() : undefined })
    setBusyKey(null)
    setMsg(res ? { tone: res.ok ? 'ok' : 'err', text: res.text } : null)
    if (res?.ok) setDraft(a.key, { correcting: false, reason: '' })
  }
  return (
    <div className="rq-acts" data-testid="pr-activity-area">
      {(item.activities || []).map(a => {
        const d = draft(a.key)
        const supportOnly = a.completed && a.source === 'support'
        const when = a.completed
          ? `${fmtDay(a.completedAt)}${a.source === 'support' || a.source === 'both' ? ' · Support' : ''}${a.supportCount > 1 ? ` ×${a.supportCount}` : ''}`
          : 'Not yet'
        return (
          <div key={a.key} className={`rq-act${a.completed ? ' done' : ''}`} data-testid="pr-activity-row">
            <span className="rq-act-mark" aria-hidden="true">{a.completed ? '✓' : '○'}</span>
            <span className="rq-act-label">{a.label}</span>
            <span className="rq-act-when">{when}</span>
            <span className="rq-act-ctl">
              {!a.completed && (
                <>
                  <input type="date" className="rq-act-date" max={today} value={d.date} aria-label={`Date ${a.label} happened`} onChange={e => setDraft(a.key, { date: e.target.value })} />
                  <button type="button" className="rq-pbtn" disabled={busyKey === a.key || !d.date} onClick={() => record(a, 'complete')}>{busyKey === a.key ? 'Saving…' : 'Mark complete'}</button>
                </>
              )}
              {a.completed && !supportOnly && !d.correcting && (
                <button type="button" className="rq-pbtn link" onClick={() => setDraft(a.key, { correcting: true })}>Correct</button>
              )}
              {supportOnly && <span className="rq-act-note">recorded in Support</span>}
            </span>
            {a.completed && !supportOnly && d.correcting && (
              <div className="rq-act-correct">
                <input type="text" className="rq-act-reason" value={d.reason} placeholder="Why is this being corrected?" aria-label={`Reason for correcting ${a.label}`} onChange={e => setDraft(a.key, { reason: e.target.value })} />
                <button type="button" className="rq-pbtn" disabled={busyKey === a.key || !d.reason.trim()} onClick={() => record(a, 'reverse')}>{busyKey === a.key ? 'Saving…' : 'Record correction'}</button>
                <button type="button" className="rq-pbtn link" onClick={() => setDraft(a.key, { correcting: false, reason: '' })}>Cancel</button>
              </div>
            )}
          </div>
        )
      })}
      {item.supportDown && <p className="rq-act-foot">Residency &gt; Support could not be read just now; only the ledger is shown.</p>}
      {msg && <div role="status" className={`rq-act-msg ${msg.tone}`} data-testid="pr-activity-msg">{msg.text}</div>}
      <p className="rq-act-foot">Recording writes to the ledger under your name and the date you enter. It sends nothing and releases nothing; a correction keeps the original entry.</p>
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
function Card({ item, workflow, busy, locked, leaving, highlighted, onRelease, onAction, onJump, onReadFeedback, onRecordActivity }) {
  const ready = item.state === 'ready'
  const b = item.blocker
  const tone = item.stamp?.tone === 'ok' ? 'ok' : item.stamp?.tone === 'late' ? 'late' : 'soon'
  // The Required activities node opens the recording area (Owner, 2026-09-20).
  const recordable = b?.action === 'activity' && (item.activities || []).length > 0
  const [actsOpen, setActsOpen] = useState(false)
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

        <ChainStrip chain={item.chain} expandable={recordable ? { label: 'Required activities', open: actsOpen, onToggle: () => setActsOpen(o => !o) } : null} />
        {recordable && actsOpen && <ActivitiesArea item={item} onRecord={onRecordActivity} />}

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
                <button type="button" className="rq-pbtn" aria-expanded={actsOpen} onClick={() => setActsOpen(o => !o)}>{actsOpen ? 'Hide activities' : 'Record activities'}</button>
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
  onRerun, onRelease, onAction, onJump, onTrackResponses, onReadFeedback, onRecordActivity,
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
  const [mainTitle, qualifier] = splitTitle(survey.label)
  const notEligibleLabel = survey.key === 'caseyFinkPreRotation'
    ? `Not yet interviewed (${notEligible.length}) · nothing to do yet`
    : survey.key === 'unitLeaderRelease'
      ? `Not yet eligible (${notEligible.length}) · results release 7 days after the rotation ends`
      : `Not yet eligible (${notEligible.length}) · below the hours threshold, nothing to do yet`

  const cardProps = (it) => ({
    item: it, workflow: survey, busy: busyItemId === it.id, locked: releaseLocked, leaving: leavingItemId === it.id,
    highlighted: highlightItemId === it.id, onRelease, onAction, onJump, onReadFeedback, onRecordActivity,
  })

  return (
    <div className="rq">
      {/* 1. The name, with the timepoint as a smaller qualifier, and the four tools as icon
          buttons at the top right on the shared Tooltip (Owner, 2026-09-20): the eye
          previews the email, the square-arrow opens a sample of the survey, the paper
          plane sends a test to me, the arrows re-run detection. */}
      <div className="rq-head">
        <h2>{mainTitle}{qualifier && <span className="rq-title-q">{qualifier}</span>}</h2>
        <div className="rq-head-icons" role="group" aria-label="Survey tools">
          {survey.slug && (
            <>
              <Tooltip label="Preview the invitation email" placement="bottom" tone="contrast">
                <button type="button" className="rq-iconbtn" onClick={tools?.onPreviewEmail} aria-label="Preview the invitation email"><Eye size={15} aria-hidden="true" /></button>
              </Tooltip>
              <Tooltip label="Open a sample of the survey" placement="bottom" tone="contrast">
                <button type="button" className="rq-iconbtn" onClick={tools?.onPreviewSurvey} aria-label="Open a sample of the survey"><ExternalLink size={15} aria-hidden="true" /></button>
              </Tooltip>
              <Tooltip label={tools?.testState?.busy ? 'Preparing the test…' : 'Send a test to my email'} placement="bottom" tone="contrast">
                <button type="button" className="rq-iconbtn" disabled={tools?.testState?.busy} onClick={tools?.onSendTest} aria-label="Send a test to my email"><Send size={15} aria-hidden="true" /></button>
              </Tooltip>
            </>
          )}
          <Tooltip label={loading ? 'Detecting…' : 'Re-run detection'} placement="bottom" tone="contrast">
            <button type="button" className="rq-iconbtn" disabled={loading} onClick={onRerun} aria-label="Re-run detection"><RefreshCw size={15} aria-hidden="true" className={loading ? 'rq-spin' : undefined} /></button>
          </Tooltip>
        </div>
      </div>
      {/* 2. One quiet line: who it goes to, what triggers it, what it gates; the detection stamp at the right. */}
      <div className="rq-meta-row">
        <p className="rq-meta-line">To {survey.to} {'·'} {survey.trigger} {'·'} {survey.gate}</p>
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
