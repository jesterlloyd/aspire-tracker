import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Mail, Send, RefreshCw, ExternalLink } from 'lucide-react'
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
// tools row, the three sections, the card, the chain strip, the actions, the sent log.
//
// Part 2 restyles this as a clipboard. Nothing here is styled beyond what the current
// panels already had; the class names on the containers are the hooks Part 2 will dress.
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

const STAMP_COLOR = { ok: '#166534', soon: '#92400e', late: '#991b1b' }
const NODE_COLOR = { done: '#166534', this: NAVY, next: '#6b7280', waiting: '#92400e', fix: '#991b1b' }
const NODE_MARK = { done: '✓', this: 'Now', waiting: 'Waiting', fix: 'Fix' }

function ChainStrip({ chain }) {
  if (!chain?.length) return null
  return (
    <div className="rq-chain" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 0', borderTop: '1px solid #eef0f2', borderBottom: '1px solid #eef0f2', padding: '7px 0', margin: '8px 0' }}>
      {chain.map((n, i) => (
        <div key={`${n.role}-${i}`} className={`rq-node rq-node-${n.status}`}
          style={{ flex: '1 1 150px', minWidth: 0, paddingLeft: i === 0 ? 0 : 14, position: 'relative' }}>
          {i > 0 && <span aria-hidden="true" style={{ position: 'absolute', left: 1, top: 2, color: '#9ca3af', fontSize: 15, lineHeight: 1 }}>{'›'}</span>}
          <div style={{ fontSize: 9.5, letterSpacing: '0.11em', textTransform: 'uppercase', color: '#6b7280', fontWeight: 700 }}>{n.label}</div>
          <div style={{ fontSize: 12.5, color: NODE_COLOR[n.status] || '#191919', fontWeight: (n.status === 'this' || n.status === 'waiting' || n.status === 'fix') ? 700 : 400, display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
            {NODE_MARK[n.status] && (
              <i style={{ fontStyle: 'normal', fontSize: 10, padding: '0 5px', borderRadius: 4,
                background: n.status === 'this' ? NAVY : n.status === 'done' ? '#EDF7F0' : n.status === 'waiting' ? '#FBF5E8' : '#FEECEC',
                color: n.status === 'this' ? '#fff' : NODE_COLOR[n.status] }}>{NODE_MARK[n.status]}</i>
            )}
            {n.detail}
          </div>
        </div>
      ))}
    </div>
  )
}

function Stamp({ stamp }) {
  if (!stamp?.text) return null
  return (
    <span className={`rq-stamp rq-stamp-${stamp.tone}`} style={{
      fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', border: '1.5px solid currentColor',
      borderRadius: 3, padding: '1px 5px', color: STAMP_COLOR[stamp.tone] || '#6b7280', whiteSpace: 'nowrap', fontWeight: 700,
    }}>{stamp.text}</span>
  )
}

const btn = (kind) => ({
  padding: kind === 'go' ? '5px 14px' : '4px 11px', borderRadius: 6, fontSize: 12, fontFamily: F, cursor: 'pointer',
  fontWeight: kind === 'go' ? 700 : 500, whiteSpace: 'nowrap',
  background: kind === 'go' ? '#166534' : kind === 'link' ? 'none' : 'rgba(30,42,110,0.05)',
  color: kind === 'go' ? '#fff' : kind === 'link' ? NAVY : '#191919',
  border: kind === 'go' ? '1px solid #166534' : kind === 'link' ? 'none' : '1px solid #d7ddf5',
  textDecoration: kind === 'link' ? 'underline' : 'none', textUnderlineOffset: 3,
})

function Card({ item, workflow, busy, locked, highlighted, onRelease, onAction, onJump, onPreviewEmail }) {
  const ready = item.state === 'ready'
  const b = item.blocker
  return (
    <article className={`rq-card rq-card-${item.state}${highlighted ? ' rq-card-flash' : ''}`} data-item-id={item.id}
      style={{
        background: ready ? '#fff' : '#fafaf8', border: '1px solid #e5e7eb', borderLeft: `5px solid ${item.stamp?.tone === 'ok' ? '#166534' : item.stamp?.tone === 'late' ? '#991b1b' : '#92400e'}`,
        borderRadius: 10, padding: '11px 14px 11px 14px', marginBottom: 10, fontFamily: F,
        boxShadow: highlighted ? '0 0 0 4px #f0c36a' : 'none', transition: 'box-shadow .3s',
      }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#191919' }}>{item.person.name}</div>
          {item.person.sub && <div style={{ fontSize: 12, color: '#6b7280' }}>{item.person.sub}</div>}
        </div>
        <div style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
          <Stamp stamp={item.stamp} />
          {item.hours ? (
            <span style={{ fontSize: 11.5, color: '#6b7280', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              <b style={{ color: '#191919', fontWeight: 600 }}>{fmtHours(item.hours.approved)} / {fmtHours(item.hours.required)}</b> h
              <span style={{ display: 'block', fontSize: 10 }}>threshold {fmtHours(item.hours.threshold)}</span>
            </span>
          ) : (
            <span style={{ fontSize: 10, color: '#9ca3af' }}>hours not required</span>
          )}
        </div>
      </div>

      <ChainStrip chain={item.chain} />

      <div className="rq-actions" style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
        {ready ? (
          <>
            {workflow.key === 'unitLeaderRelease'
              ? <span style={{ fontSize: 12.5, color: '#6b7280', marginRight: 'auto' }}>Releases to the unit leader portal, not by email.</span>
              : <button type="button" style={btn()} onClick={onPreviewEmail}>Preview email</button>}
            <button type="button" style={{ ...btn('go'), marginLeft: 'auto', opacity: (busy || locked) ? 0.6 : 1 }} disabled={busy || locked}
              title={locked ? 'Releases are paused until you re-run detection.' : undefined}
              onClick={() => onRelease(item)}>
              {item.release?.reissue ? 'Reissue' : item.release?.action === 'rerelease' ? 'Re-release' : 'Release'}
            </button>
          </>
        ) : (
          <>
            <span className="rq-why" style={{ fontSize: 12.5, color: '#6b7280', marginRight: 'auto' }}>{b?.text}</span>
            {b?.action === 'jump' && (
              <button type="button" style={btn('link')} onClick={() => onJump(b.target)}>{b.target?.label} {'→'}</button>
            )}
            {b?.action === 'fix' && (
              <button type="button" style={btn()} onClick={() => onAction(item)}>
                {b.target?.kind === 'preceptor' ? 'Open preceptor' : b.target?.kind === 'response' ? 'Open Responses' : 'Open student'}
              </button>
            )}
            {b?.action === 'activity' && (
              <button type="button" style={btn()} onClick={() => onAction(item)}>Record activities</button>
            )}
            {b?.action === 'moderate' && (
              <button type="button" style={btn()} disabled={busy} onClick={() => onAction(item)}>Clear moderation</button>
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
    <section className="rq-section" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, letterSpacing: '0.13em', textTransform: 'uppercase', fontWeight: 700, color: '#374151' }}>{title} ({count})</span>
        {caption && <em style={{ fontStyle: 'normal', fontSize: 11.5, color: '#9ca3af' }}>{caption}</em>}
      </div>
      {children}
    </section>
  )
}

export default function ReviewReleaseQueue({
  workflow, items = [], sent = [], detectedAtMs = 0, loading = false, error = null,
  busyItemId = null, releaseLocked = false, notice = null, highlightItemId = null,
  onRerun, onRelease, onAction, onJump, onTrackResponses,
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

  return (
    <div className="rq" style={{ fontFamily: F }}>
      {/* 1. Name, with the old name beside it for one release cycle. */}
      <div className="rq-head" style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#191919', margin: 0 }}>{survey.label}</h2>
        <span className="rq-was" style={{ fontSize: 11, color: '#9ca3af' }}>{survey.was ? `currently “${survey.was}”` : 'new'}</span>
      </div>
      {/* 2. Three chips. */}
      <div className="rq-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {[['To', survey.recipient], ['Trigger', survey.trigger]].map(([k, v]) => (
          <span key={k} style={{ fontSize: 11.5, borderRadius: 999, padding: '2px 9px', background: '#EEF1FB', border: '1px solid #d7ddf5', color: NAVY }}>{k}: {v}</span>
        ))}
        <span className="rq-chip-gate" style={{ fontSize: 11.5, borderRadius: 999, padding: '2px 9px', background: '#FBF5E8', border: '1px solid #f0e0bd', color: '#92400e' }}>{survey.gate}</span>
      </div>
      {/* 3. One tool row. */}
      <div className="rq-tools" role="group" aria-label="Survey tools" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        {survey.slug && (
          <>
            <button type="button" className="rr-tool-primary" onClick={tools?.onPreviewSurvey} aria-label="Preview the survey questions for the selected workflow"><Eye size={15} aria-hidden="true" /> Preview Survey</button>
            <button type="button" className="rr-tool-secondary" onClick={tools?.onPreviewEmail} aria-label="Preview the invitation email for the selected workflow"><Mail size={14} aria-hidden="true" /> Preview Email</button>
            <button type="button" className="rr-tool-test" disabled={tools?.testState?.busy} onClick={tools?.onSendTest} aria-label="Send a test of the selected survey to my own email"><Send size={14} aria-hidden="true" /> {tools?.testState?.busy ? 'Preparing…' : 'Send test to me'}</button>
          </>
        )}
        <button type="button" className="rr-tool-secondary" onClick={onRerun} disabled={loading}><RefreshCw size={14} aria-hidden="true" /> {loading ? 'Detecting…' : 'Re-run detection'}</button>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#9ca3af' }}>{detectedAtMs ? `Detected ${new Date(detectedAtMs).toLocaleString('en-US')}` : ''}</span>
      </div>
      {tools?.testState?.note && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#f7f9ff', border: '1px solid #d7ddf5', borderRadius: 10, padding: '9px 12px', marginBottom: 10, fontSize: 12.5, color: '#191919' }}>
          <span>{tools.testState.note}</span>
          {tools.testState.url && (
            <>
              <button type="button" className="rr-tool-primary" onClick={tools.onOpenTest}><ExternalLink size={14} aria-hidden="true" /> Open test now</button>
              <button type="button" className="rr-tool-secondary" onClick={tools.onCopyTest}>Copy test link</button>
            </>
          )}
        </div>
      )}
      {/* 4. Human-approved sends only, with the policy collapsed. */}
      <div className="rq-policy" style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <span>Human-approved sends only.</span>
        <button type="button" aria-expanded={policyOpen} onClick={() => setPolicyOpen(o => !o)}
          style={{ background: 'none', border: 'none', color: NAVY, textDecoration: 'underline', textUnderlineOffset: 3, padding: 0, fontSize: 12, fontFamily: F, cursor: 'pointer' }}>
          {policyOpen ? 'Hide' : 'How release works'}
        </button>
        {policyOpen && <span style={{ flexBasis: '100%', padding: '6px 10px', borderLeft: `2px solid ${NAVY}`, color: '#374151' }}>{POLICY[survey.key]}</span>}
      </div>

      {notice && (
        <div role="status" style={{ fontSize: 13, borderRadius: 8, padding: '10px 14px', marginBottom: 14, lineHeight: 1.5,
          background: notice.tone === 'ok' ? '#EDF7F0' : '#FEECEC', color: notice.tone === 'ok' ? '#166534' : '#991b1b',
          border: `1px solid ${notice.tone === 'ok' ? '#c6e7d0' : '#f3c6c6'}` }}>{notice.text}</div>
      )}
      {error && <div role="alert" style={{ padding: '14px 0', color: '#dc2626', fontSize: 14 }}>Error running detection: {error.message || String(error)}</div>}

      {/* 5. Ready. */}
      <Section title="Ready to release" caption="Every prerequisite is done" count={ready.length}>
        {ready.length === 0
          ? <div style={{ fontSize: 13, color: '#9ca3af', padding: '10px 0', textAlign: 'center' }}>{loading ? 'Detecting…' : 'Nothing waiting on you here.'}</div>
          : ready.map(it => <Card key={it.id} item={it} workflow={survey} busy={busyItemId === it.id} locked={releaseLocked} highlighted={highlightItemId === it.id}
              onRelease={onRelease} onAction={onAction} onJump={onJump} onPreviewEmail={tools?.onPreviewEmail} />)}
      </Section>
      {/* 6. Blocked, omitted when empty. */}
      {blocked.length > 0 && (
        <Section title="Needs a fix or a reminder" caption="Something a person can do today" count={blocked.length}>
          {blocked.map(it => <Card key={it.id} item={it} workflow={survey} busy={busyItemId === it.id} locked={releaseLocked} highlighted={highlightItemId === it.id}
            onRelease={onRelease} onAction={onAction} onJump={onJump} onPreviewEmail={tools?.onPreviewEmail} />)}
        </Section>
      )}
      {/* 7. Not yet eligible, collapsed. */}
      {notEligible.length > 0 && (
        <details className="rq-eligible" style={{ border: '1px dashed #d7ddf5', borderRadius: 7, fontSize: 12.5, color: '#6b7280', marginBottom: 16 }}>
          <summary style={{ padding: '8px 12px', cursor: 'pointer' }}>{notEligibleLabel}</summary>
          <ul style={{ margin: 0, padding: '0 12px 10px 30px', columns: 2, columnGap: 20, fontSize: 11.5 }}>
            {notEligible.map(it => (
              <li key={it.id} style={{ padding: '2px 0', breakInside: 'avoid' }}>
                {it.person.name}{it.hours ? ` ${fmtHours(it.hours.approved)}/${fmtHours(it.hours.required)}` : it.notEligibleDetail ? ` · ${it.notEligibleDetail}` : ''}{it.nextGate ? ` · ${it.nextGate}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* 8. The sent log. */}
      <div className="rq-sent" style={{ borderTop: '2px dashed #e5e7eb', paddingTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.13em', textTransform: 'uppercase', fontWeight: 700, color: '#6b7280' }}>Sent from this workflow</span>
          <button type="button" onClick={() => onTrackResponses?.(survey)} style={{ background: 'none', border: 'none', color: NAVY, textDecoration: 'underline', textUnderlineOffset: 3, fontSize: 12, fontFamily: F, cursor: 'pointer', padding: 0 }}>Track responses {'→'}</button>
        </div>
        {recent.length === 0
          ? <div style={{ fontSize: 12.5, color: '#9ca3af' }}>Nothing sent from here yet.</div>
          : recent.map(line => (
            <div key={line.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #f3f4f6', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>{whenLabel(line.at)}</span>
              <span>{line.who}{line.step ? ` · ${line.step}` : ''}</span>
              <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>{line.recipient}{line.submission ? ` · ${line.submission}` : ''}</span>
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
