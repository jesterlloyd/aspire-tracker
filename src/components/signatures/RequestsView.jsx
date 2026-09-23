// src/components/signatures/RequestsView.jsx
//
// SIGNATURES-PHASE2: Signature requests, the tracker (brief section 3). Rows come from
// /api/sig-staff `list`; a bulk send is one parent row whose numbers are computed from its
// children every time. The detail panel's actions depend on status, and everything it shows
// about a request (timeline, audit trail, seal) comes from `get`, which reads the append-only
// event log.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  TRACKER_FILTERS, REQUEST_STATUS, trackerCounts, bulkCounts, bulkProgressLabel, currentTurn, isFinal,
  formatInZone, describeEvent, summarizeAgent, fieldLabel, isAutoField, autoFieldValue,
} from '../../lib/signatures/sigModel'
import { sigStaff, sigStaffDownload } from './sigApi'
import PdfPages from './PdfPages'

const short = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const statusClass = (s) => `sg-st sg-st-${s}`

export default function RequestsView({ focusId, notify, onContinueDraft, onResend }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [sel, setSel] = useState(focusId || null)      // request id or `bulk:<id>`
  const [open, setOpen] = useState({})                   // expanded bulk parents
  const [detail, setDetail] = useState(null)
  const [modal, setModal] = useState(null)

  const load = useCallback(async () => {
    try { setData(await sigStaff('list')); setError(null) } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const signersOf = useMemo(() => {
    const m = {}; for (const s of data?.signers || []) (m[s.request_id] ||= []).push(s); return m
  }, [data])
  const me = data?.me
  const standalone = useMemo(() => (data?.requests || []).filter(r => !r.parent_bulk_id), [data])
  const children = useMemo(() => {
    const m = {}; for (const r of data?.requests || []) if (r.parent_bulk_id) (m[r.parent_bulk_id] ||= []).push(r); return m
  }, [data])
  const yourTurn = useMemo(() => (data?.requests || []).filter(r => !isFinal(r.status) && r.status !== 'draft' &&
    currentTurn(signersOf[r.id] || [], r.signing_order).some(s => s.user_profile_id && s.user_profile_id === me?.id)), [data, signersOf, me])

  const rows = useMemo(() => {
    const f = TRACKER_FILTERS.find(x => x.key === filter)
    const bulkRows = (data?.bulks || []).map(b => ({ kind: 'bulk', b, kids: children[b.id] || [] })).filter(x => filter === 'all' || x.kids.some(k => f.test(k.status)))
    const single = standalone.filter(r => f.test(r.status)).map(r => ({ kind: 'req', r }))
    return [...bulkRows, ...single].sort((a, b) => new Date((b.b || b.r).sent_at || (b.r || {}).created_at || 0) - new Date((a.b || a.r).sent_at || (a.r || {}).created_at || 0))
  }, [data, filter, standalone, children])
  const counts = useMemo(() => trackerCounts(data?.requests || []), [data])

  useEffect(() => {
    if (!sel || sel.startsWith('bulk:')) { setDetail(null); return }
    let live = true
    sigStaff('get', { id: sel }).then(b => { if (live) setDetail(b) }).catch(e => notify?.(e.message, 'err'))
    return () => { live = false }
  }, [sel, data, notify])

  const act = async (fn, ok) => { try { await fn(); if (ok) notify?.(ok); await load() } catch (e) { notify?.(e.message, 'err') } }

  if (error) return <div className="sg-err" role="alert">{error}</div>
  if (!data) return <p className="sg-hint">Loading signature requests…</p>

  const bulkSel = sel?.startsWith('bulk:') ? (data.bulks || []).find(b => `bulk:${b.id}` === sel) : null
  const selReq = !bulkSel && sel ? (data.requests || []).find(r => r.id === sel) : null

  return (
    <>
      {yourTurn.length > 0 && (
        <div className="sg-yourturn" role="status">
          <span><b>{yourTurn.length} document{yourTurn.length === 1 ? ' is' : 's are'} waiting for your signature.</b> {yourTurn[0].title}.</span>
          <button type="button" className="sg-btn sg-pri sg-sm" onClick={() => { setSel(yourTurn[0].id); setModal({ type: 'self', id: yourTurn[0].id }) }}>Sign now</button>
        </div>
      )}
      <div className={`sg-env${sel ? '' : ' sg-env-full'}`}>
        <div className="sg-envlist">
          <div className="sg-chips" role="group" aria-label="Filter by status">
            {TRACKER_FILTERS.map(f => <button key={f.key} type="button" className="sg-chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}<b>{counts[f.key] || 0}</b></button>)}
          </div>
          <div className="sg-card sg-elist" role="listbox" aria-label="Signature requests">
            {!rows.length && <div className="sg-empty">Nothing here yet.</div>}
            {rows.map(x => x.kind === 'bulk'
              ? <BulkRow key={x.b.id} b={x.b} kids={x.kids} signersOf={signersOf} sel={sel} setSel={setSel} open={!!open[x.b.id]} toggle={() => setOpen(o => ({ ...o, [x.b.id]: !o[x.b.id] }))} />
              : <ReqRow key={x.r.id} r={x.r} signers={signersOf[x.r.id] || []} me={me} sel={sel} setSel={setSel} />)}
          </div>
        </div>
        {bulkSel && <BulkDetail b={bulkSel} kids={children[bulkSel.id] || []} signersOf={signersOf} onPick={(id) => setSel(id)} act={act} />}
        {selReq && (
          <RequestDetail r={selReq} bundle={detail} me={me} parent={selReq.parent_bulk_id ? (data.bulks || []).find(b => b.id === selReq.parent_bulk_id) : null}
            parentCount={selReq.parent_bulk_id ? (children[selReq.parent_bulk_id] || []).length : 0}
            onBack={() => setSel(`bulk:${selReq.parent_bulk_id}`)} act={act} setModal={setModal}
            onContinueDraft={onContinueDraft} onResend={onResend} onClose={() => setSel(null)} />
        )}
      </div>
      {modal?.type === 'void' && <VoidModal onClose={() => setModal(null)} onVoid={(reason) => act(() => sigStaff('void', { id: modal.id, reason }), 'Voided. Signers were told.').then(() => setModal(null))} />}
      {modal?.type === 'cert' && detail && <CertificateModal bundle={detail} onClose={() => setModal(null)} />}
      {modal?.type === 'self' && <SelfSignModal id={modal.id} me={me} onClose={() => setModal(null)} onDone={(m) => { setModal(null); notify?.(m); load() }} />}
    </>
  )
}

function turnLine(r, signers, me) {
  const cur = currentTurn(signers, r.signing_order)[0]
  const people = signers.filter(s => s.recipient_type !== 'cc' && s.status !== 'replaced')
  if (r.status === 'draft') return 'Not sent'
  if (r.status === 'completed') return `Returned to you ${short(r.completed_at)}`
  if (r.status === 'declined') return `Declined by ${people.find(s => s.declined_at)?.name || 'a signer'}`
  if (r.status === 'expired') return 'Expired unsigned'
  if (r.status === 'voided') return 'Voided'
  if (!cur) return 'Sealing'
  return `Waiting on ${cur.user_profile_id && cur.user_profile_id === me?.id ? 'you' : cur.name}`
}

function Dots({ signers }) {
  return (
    <span className="sg-dots" aria-hidden="true">
      {signers.filter(s => s.recipient_type !== 'cc' && s.status !== 'replaced').sort((a, b) => a.order_index - b.order_index)
        .map(s => <i key={s.id} className={s.signed_at ? 'sg-ds' : s.declined_at ? 'sg-dx' : s.opened_at ? 'sg-do' : ''} />)}
    </span>
  )
}

function ReqRow({ r, signers, me, sel, setSel, kid }) {
  const first = signers.filter(s => s.recipient_type !== 'cc').sort((a, b) => a.order_index - b.order_index)[0]
  const you = !isFinal(r.status) && currentTurn(signers, r.signing_order).some(s => s.user_profile_id === me?.id)
  const to = first?.school_name || first?.name || (r.draft_state?.recipients?.[0]?.name) || 'No recipient yet'
  return (
    <button type="button" role="option" aria-selected={sel === r.id} className={`sg-er${kid ? ' sg-kid' : ''}`} onClick={() => setSel(r.id)}>
      <span>
        <b>{kid ? to : r.title}{you && <span className="sg-yt">Your turn</span>}</b>
        <small>{kid ? turnLine(r, signers, me) : `${to} · ${turnLine(r, signers, me)}`}</small>
        {!kid && <Dots signers={signers} />}
      </span>
      <span><span className={statusClass(r.status)}>{REQUEST_STATUS[r.status]}</span></span>
      <span className="sg-when">{r.sent_at ? `Sent ${short(r.sent_at)}` : 'Draft'}</span>
    </button>
  )
}

function BulkRow({ b, kids, signersOf, sel, setSel, open, toggle }) {
  const c = bulkCounts(kids)
  const pct = (n) => `${c.total ? (n / c.total) * 100 : 0}%`
  return (
    <>
      <button type="button" role="option" aria-selected={sel === `bulk:${b.id}`} aria-expanded={open} className="sg-er"
        onClick={() => { if (sel === `bulk:${b.id}`) toggle(); else { setSel(`bulk:${b.id}`); if (!open) toggle() } }}>
        <span>
          <b><span className="sg-chev" aria-hidden="true">{open ? '▾' : '▸'}</span> {b.title}</b>
          <small>{b.audience_label} · {c.total} people, each signs their own copy · <strong>{c.signed} signed</strong>{c.overdue ? <> · <span className="sg-late">{c.overdue} overdue</span></> : null}</small>
          <span className="sg-bulkbar" aria-hidden="true"><i className="sg-d" style={{ width: pct(c.signed) }} /><i className="sg-l" style={{ width: pct(c.overdue) }} /><i className="sg-o" style={{ width: pct(c.opened) }} /></span>
        </span>
        <span><span className="sg-st sg-st-progress">{c.signed} of {c.total}</span></span>
        <span className="sg-when">Sent {short(b.sent_at)}</span>
      </button>
      {open && kids.map(k => <ReqRow key={k.id} r={k} signers={signersOf[k.id] || []} sel={sel} setSel={setSel} kid />)}
    </>
  )
}

function BulkDetail({ b, kids, signersOf, onPick, act }) {
  const c = bulkCounts(kids)
  const pct = (n) => `${c.total ? (n / c.total) * 100 : 0}%`
  const notSigned = kids.filter(k => !isFinal(k.status)).length
  return (
    <div className="sg-detwrap"><aside className="sg-card sg-det" aria-label="Bulk send details">
      <div><span className="sg-st sg-st-progress">{c.signed} of {c.total} signed</span><h2>{b.title}</h2>
        <div className="sg-sub">Sent {formatInZone(b.sent_at)} to {c.total} people in {b.audience_label} · each signs their own copy{b.expires_at ? ` · expires ${short(b.expires_at)}` : ''}</div></div>
      <div className="sg-acts">
        <button type="button" className="sg-btn sg-pri sg-sm" disabled={!notSigned} onClick={() => act(() => sigStaff('remind_bulk', { bulk_id: b.id }), `Reminders sent to ${notSigned} people who have not signed.`)}>Remind {notSigned} not signed</button>
        <button type="button" className="sg-btn sg-sm" disabled={!c.signed} onClick={() => act(() => sigStaffDownload('zip_bulk', { bulk_id: b.id }, 'Signed copies.zip'))}>Signed copies (ZIP)</button>
        <button type="button" className="sg-btn sg-sm" onClick={() => act(() => sigStaffDownload('csv_bulk', { bulk_id: b.id }, 'Signature status.csv'))}>Export status (CSV)</button>
      </div>
      <div className="sg-bulkbar sg-big" role="img" aria-label={bulkProgressLabel(c)}><i className="sg-d" style={{ width: pct(c.signed) }} /><i className="sg-l" style={{ width: pct(c.overdue) }} /><i className="sg-o" style={{ width: pct(c.opened) }} /></div>
      <p className="sg-hint">{bulkProgressLabel(c)}</p>
      <p className="sg-h3">People</p>
      <div className="sg-kidlist">
        {kids.map(k => { const who = (signersOf[k.id] || []).sort((x, y) => x.order_index - y.order_index)[0]
          return <button key={k.id} type="button" onClick={() => onPick(k.id)}><span>{who?.name || k.envelope_code}</span><span className={statusClass(k.status)}>{k.status === 'completed' ? 'Signed' : REQUEST_STATUS[k.status]}</span></button> })}
      </div>
      <p className="sg-hint">Each person has their own request, audit trail and sealed copy. Open a name to see theirs.</p>
    </aside></div>
  )
}

const SIGNER_STEPS = [
  ['notified_at', 'Sent'], ['verified_at', 'Code verified'], ['consented_at', 'Consent accepted'], ['opened_at', 'Opened'],
  ['signed_at', 'Signed'], ['completed_copy_sent_at', 'Completed copy sent'],
]

function RequestDetail({ r, bundle, me, parent, parentCount, onBack, act, setModal, onContinueDraft, onResend, onClose }) {
  const tz = bundle?.time_zone || 'America/Los_Angeles'
  const signers = (bundle?.signers || []).filter(s => s.status !== 'replaced' || s.delegation).sort((a, b) => a.order_index - b.order_index)
  const you = bundle && !isFinal(r.status) && currentTurn(bundle.signers, r.signing_order).some(s => s.user_profile_id === me?.id)
  const first = signers.find(s => s.recipient_type !== 'cc')
  const [verify, setVerify] = useState(null)
  const acts = r.status === 'draft'
    ? <><button type="button" className="sg-btn sg-pri sg-sm" onClick={() => onContinueDraft?.(r)}>Continue editing</button>
        <button type="button" className="sg-btn sg-sm sg-danger" onClick={() => act(() => sigStaff('draft_delete', { id: r.id }), 'Draft deleted.').then(onClose)}>Delete draft</button></>
    : r.status === 'completed'
      ? <><button type="button" className="sg-btn sg-pri sg-sm" onClick={() => act(async () => { const u = await sigStaff('doc_url', { id: r.id, sealed: true, download: true }); window.open(u.url, '_blank', 'noopener') })}>Sealed PDF</button>
          <button type="button" className="sg-btn sg-sm" onClick={() => setModal({ type: 'cert' })} disabled={!bundle}>Certificate</button>
          <button type="button" className="sg-btn sg-sm" onClick={() => act(async () => setVerify(await sigStaff('verify_seal', { id: r.id })))}>Verify seal</button></>
      : r.status === 'declined' || r.status === 'expired'
        ? <button type="button" className="sg-btn sg-pri sg-sm" onClick={() => onResend?.(r, bundle)}>Correct and resend</button>
        : r.status === 'voided' ? null
          : you
            ? <><button type="button" className="sg-btn sg-pri sg-sm" onClick={() => setModal({ type: 'self', id: r.id })}>Sign now</button>
                <button type="button" className="sg-btn sg-sm" onClick={() => setModal({ type: 'void', id: r.id })}>Void</button></>
            : <><button type="button" className="sg-btn sg-pri sg-sm" onClick={() => act(() => sigStaff('remind', { id: r.id }), 'Reminder sent to the current signer.')}>Remind</button>
                <button type="button" className="sg-btn sg-sm" onClick={() => setModal({ type: 'void', id: r.id })}>Void</button>
                <button type="button" className="sg-btn sg-sm" onClick={() => act(async () => { const u = await sigStaff('doc_url', { id: r.id }); window.open(u.url, '_blank', 'noopener') })}>View progress</button></>
  const ts = bundle?.request?.seal_timestamp
  return (
    <div className="sg-detwrap">
      {parent && <button type="button" className="sg-back" onClick={onBack}>‹ Back to all {parentCount}</button>}
      <aside className="sg-card sg-det" aria-label="Document details">
        <div className="sg-dethead">
          <span className={statusClass(r.status)}>{REQUEST_STATUS[r.status]}</span>
          <button type="button" className="sg-iconbtn" aria-label="Close details" onClick={onClose}>✕</button>
        </div>
        <div><h2>{r.title}</h2><div className="sg-sub">To {first?.school_name || first?.name || 'no one yet'}{r.sent_at ? ` · sent ${formatInZone(r.sent_at, tz)}` : ''}{r.expires_at && !isFinal(r.status) ? ` · expires ${short(r.expires_at)}` : ''}</div></div>
        {acts && <div className="sg-acts">{acts}</div>}
        {r.status === 'completed' && bundle?.request?.sealed_sha256 && (
          <div className="sg-seal">
            <span><b>Sealed and returned.</b> Fields flattened, certificate appended, digital seal applied{ts?.seal?.gen_time ? ` with a trusted timestamp (${formatInZone(ts.seal.gen_time, tz, true)}, ${ts.seal.tsa_name || 'RFC 3161'})` : ''}. Any later edit shows as invalid in PDF readers. Copies went to every party.<br />
              <code>SHA-256 {bundle.request.sealed_sha256}</code></span>
          </div>
        )}
        {verify && (
          <div className={verify.valid && verify.stored_sha256_matches ? 'sg-seal' : 'sg-note'} role="status">
            <span>{verify.valid && verify.stored_sha256_matches ? 'The seal verifies: the file has not changed since it was sealed.' : `The seal does not verify: ${verify.reason || 'the stored hash does not match'}.`}
              {verify.timestamp ? ` Timestamp ${verify.timestamp.covers_signature ? 'covers' : 'does not cover'} the seal.` : ''}
              {verify.signer?.self_signed ? ' Sealed with ASPIRE’s own certificate, so PDF readers show the signer as not trusted until a trusted certificate replaces it.' : ''}</span>
          </div>
        )}
        {!bundle ? <p className="sg-hint">Loading…</p> : (
          <>
            <p className="sg-h3">Signers{signers.length > 1 ? (r.signing_order === 'parallel' ? ', any order' : ', in order') : ''}</p>
            {signers.map(s => <SignerCard key={s.id} s={s} r={r} tz={tz} act={act} />)}
            <p className="sg-h3">Audit trail</p>
            <div className="sg-auditwrap">
              <table className="sg-audit">
                <thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">By</th><th scope="col">IP · device</th></tr></thead>
                <tbody>{bundle.events.map(e => (
                  <tr key={e.id}><td>{formatInZone(e.at, tz, true)}</td><td>{describeEvent(e)}</td><td>{e.actor || 'System'}</td><td>{e.ip ? `${e.ip} · ${summarizeAgent(e.user_agent)}` : ''}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="sg-hint">Every event is added, never edited, and each one's hash covers the one before it. The certificate of completion prints this trail in plain words.</p>
          </>
        )}
      </aside>
    </div>
  )
}

function SignerCard({ s, r, tz, act }) {
  const label = s.status === 'replaced' ? 'Replaced' : s.declined_at ? 'Declined' : s.signed_at ? (s.recipient_type === 'viewer' ? 'Viewed' : 'Signed') : s.notified_at ? 'Waiting' : 'Not sent yet'
  const cls = s.declined_at ? 'declined' : s.signed_at ? 'completed' : s.notified_at ? 'sent' : 'draft'
  return (
    <div className="sg-signer">
      <div className="sg-top">
        <span className={`sg-ord sg-c-${s.color}`}>{s.recipient_type === 'cc' ? 'cc' : s.order_index}</span>
        <span><b>{s.name}</b><small>{s.email}{s.recipient_type === 'viewer' ? ' · needs to view' : s.recipient_type === 'cc' ? ' · receives a copy' : ''}</small></span>
        <span className={statusClass(cls)}>{label}</span>
      </div>
      {s.recipient_type !== 'cc' && (
        <ul className="sg-tl">
          {SIGNER_STEPS.filter(([k]) => !(s.verify_method === 'password' && k === 'consented_at')).map(([k, l]) => (
            <li key={k} className={s[k] ? 'sg-ok' : 'sg-wait'}><span>{k === 'verified_at' && s.verify_method === 'password' ? 'Password re-confirmed' : l}</span><span className="sg-t">{s[k] ? formatInZone(s[k], tz) : 'waiting'}</span></li>
          ))}
          {s.declined_at && <li className="sg-bad"><span>Declined: "{s.decline_reason}"</span><span className="sg-t">{formatInZone(s.declined_at, tz)}</span></li>}
        </ul>
      )}
      {s.paper_copy_requested_at && <p className="sg-note">Asked for a paper copy on {formatInZone(s.paper_copy_requested_at, tz)}. Send one at no cost.</p>}
      {s.delegation?.status === 'pending' && (
        <div className="sg-note">
          <span>Asked to reassign to {s.delegation.name} ({s.delegation.email}){s.delegation.reason ? `: "${s.delegation.reason}"` : ''}.</span>
          <span className="sg-row">
            <button type="button" className="sg-btn sg-sm sg-pri" onClick={() => act(() => sigStaff('delegation', { id: r.id, signer_id: s.id, approve: true }), `Sent to ${s.delegation.name}.`)}>Approve</button>
            <button type="button" className="sg-btn sg-sm" onClick={() => act(() => sigStaff('delegation', { id: r.id, signer_id: s.id, approve: false }), 'Reassignment declined.')}>Decline</button>
          </span>
        </div>
      )}
    </div>
  )
}

function Modal({ title, children, onClose, wide }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="sg-scrim" onMouseDown={onClose}>
      <div className={`sg-modal${wide ? ' sg-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}>{children}</div>
    </div>
  )
}

function VoidModal({ onClose, onVoid }) {
  const [reason, setReason] = useState('')
  return (
    <Modal title="Void this document?" onClose={onClose}>
      <h2>Void this document?</h2>
      <p className="sg-hint">Signers can no longer open it. Signatures collected so far stay in the audit trail. Signers get an email saying it was voided.</p>
      <div className="sg-field"><label htmlFor="sg-void">Reason (sent to signers)</label><input id="sg-void" autoFocus value={reason} onChange={e => setReason(e.target.value)} /></div>
      <div className="sg-two"><button type="button" className="sg-btn" onClick={onClose}>Keep it</button>
        <button type="button" className="sg-btn sg-pri" disabled={!reason.trim()} onClick={() => onVoid(reason.trim())}>Void document</button></div>
    </Modal>
  )
}

function CertificateModal({ bundle, onClose }) {
  const r = bundle.request, tz = bundle.time_zone
  const ts = r.seal_timestamp || {}
  const ev = (s, t) => bundle.events.find(e => e.signer_id === s.id && e.type === t)
  return (
    <Modal title="Certificate of completion" onClose={onClose} wide>
      <div className="sg-cert">
        <div className="sg-cert-h"><span className="sg-h3">Certificate of completion</span><h2>{r.title}</h2>
          <dl>
            <dt>Envelope</dt><dd>{r.envelope_code}</dd>
            <dt>Sent by</dt><dd>{r.sender_name}, {formatInZone(r.sent_at, tz)}</dd>
            <dt>Completed</dt><dd>{formatInZone(r.completed_at, tz)}</dd>
            <dt>Original upload</dt><dd><code>SHA-256 {r.original_sha256}</code></dd>
            {ts.content && <><dt>Signed pages</dt><dd>Timestamped {formatInZone(ts.content.gen_time, tz, true)} by {ts.content.tsa_name || ts.content.tsa_url} (RFC 3161, serial {ts.content.serial})</dd></>}
            {ts.seal && <><dt>Seal</dt><dd>Timestamped {formatInZone(ts.seal.gen_time, tz, true)} by {ts.seal.tsa_name || ts.seal.tsa_url} (serial {ts.seal.serial}){ts.certificate ? `, certificate ${ts.certificate.subject}${ts.certificate.self_signed ? ' (self-signed)' : ''}` : ''}</dd></>}
            <dt>Final document</dt><dd><code>SHA-256 {r.sealed_sha256}</code></dd>
          </dl>
        </div>
        {bundle.signers.filter(s => s.recipient_type !== 'cc' && s.status !== 'replaced').map(s => {
          const signed = ev(s, 'signed') || ev(s, 'viewed')
          return (
            <div key={s.id} className="sg-cert-s">
              <b>{s.name}</b><span>{s.email}</span>
              <dl>
                <dt>Identity check</dt><dd>{s.verify_method === 'password' ? 'ASPIRE account, password re-entered' : `Unique emailed link + 6-digit code sent to ${s.code_sent_to || 'email'}`}</dd>
                <dt>Consent</dt><dd>{s.consented_at ? `Accepted, disclosure v${s.consent_version}, ${formatInZone(s.consented_at, tz)}` : s.verify_method === 'password' ? 'Staff signer in the app' : 'n/a'}</dd>
                <dt>{s.recipient_type === 'viewer' ? 'Viewed' : 'Signed'}</dt><dd>{formatInZone(s.signed_at || s.opened_at, tz, true)}</dd>
                <dt>IP and device</dt><dd>{signed ? `${signed.ip || 'unknown'} · ${summarizeAgent(signed.user_agent)}` : 'n/a'}</dd>
                {s.adopted_signature && <><dt>Signature</dt><dd className="sg-cert-sig">{s.adopted_signature.kind === 'draw' && s.adopted_signature.path
                  ? <svg viewBox="0 0 100 30" className="sg-drawn" role="img" aria-label={`Drawn signature of ${s.name}`}><path d={s.adopted_signature.path} /></svg>
                  : s.adopted_signature.text}</dd></>}
              </dl>
            </div>
          )
        })}
        <p className="sg-hint">This page is appended to the sealed PDF, with the full event log after it.</p>
        <button type="button" className="sg-btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

// Sign in the app: all pages, earlier signers' values, your fields, your password.
function SelfSignModal({ id, me, onClose, onDone }) {
  const [b, setB] = useState(null)
  const [url, setUrl] = useState(null)
  const [vals, setVals] = useState({})
  const [pw, setPw] = useState('')
  const [agree, setAgree] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    sigStaff('get', { id }).then(x => { setB(x); const mine = x.signers.find(s => s.user_profile_id === me?.id); setTyped(mine?.name || '') }).catch(e => setErr(e.message))
    sigStaff('doc_url', { id }).then(x => setUrl(x.url)).catch(() => {})
  }, [id, me])
  if (!b) return <Modal title="Sign" onClose={onClose}><p className="sg-hint">{err || 'Loading…'}</p></Modal>
  const mine = b.signers.find(s => s.user_profile_id === me?.id && s.status !== 'replaced')
  const people = b.signers.filter(s => s.recipient_type === 'signer' && s.status !== 'replaced')
  const myFields = b.request.fields.filter(f => f.role === mine?.role_key)
  const inputs = myFields.filter(f => !isAutoField(f) && !['sig', 'ini'].includes(f.type))
  const missing = inputs.filter(f => f.required && !String(vals[f.type === 'radio' ? f.group : f.id] || '').trim()).length
  const ok = !missing && pw && agree && typed.trim()
  const earlier = people.filter(s => s.signed_at)
  const sign = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await sigStaff('self_sign', { id, password: pw, values: vals, typed_name: typed, agree })
      onDone(r.completed ? 'Signed and sealed. The completed copy went to every party.' : r.seal_pending ? 'Signed. Sealing will finish shortly.' : 'Signed. It moves to the next signer.')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Sign now" onClose={onClose} wide>
      <div className="sg-selfsign">
        <div className="sg-sspages">
          <PdfPages source={url ? { url } : null} pageSizes={b.request.page_sizes} overlay={(n) => b.request.fields.filter(f => (f.page || 1) === n).map(f => {
            const v = f.role === mine?.role_key ? (f.type === 'sig' ? typed : f.type === 'ini' ? typed.split(/\s+/).map(w => w[0]).join('') : isAutoField(f) ? autoFieldValue(f.type, new Date(), b.time_zone) : vals[f.id]) : b.values[f.id]
            return <div key={f.id} className={`sg-sf${f.role === mine?.role_key ? ' sg-sf-mine' : ' sg-sf-other'}${v ? ' sg-sf-filled' : ''}${f.type === 'sig' || f.type === 'ini' ? ' sg-sf-sig' : ''}`}
              style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%` }} aria-hidden="true">{v || (f.role === mine?.role_key ? fieldLabel(f) : '')}</div>
          })} />
        </div>
        <div className="sg-ssside">
          <span className="sg-h3">Your turn, signer {mine?.order_index} of {people.length}</span>
          <h2>{b.request.title}</h2>
          {earlier.length > 0 && <p className="sg-hint">{earlier.map(s => `${s.name} signed ${formatInZone(s.signed_at, b.time_zone)}`).join('. ')}.</p>}
          <div className="sg-field"><label htmlFor="sg-typed">Your typed name (your signature)</label><input id="sg-typed" value={typed} onChange={e => setTyped(e.target.value)} /></div>
          {inputs.map(f => (
            <div key={f.id} className="sg-field"><label htmlFor={`sg-in-${f.id}`}>{fieldLabel(f)}{f.required ? ' *' : ''}</label>
              {f.type === 'check'
                ? <input id={`sg-in-${f.id}`} type="checkbox" checked={vals[f.id] === '✓'} onChange={e => setVals(v => ({ ...v, [f.id]: e.target.checked ? '✓' : '' }))} />
                : <input id={`sg-in-${f.id}`} value={vals[f.id] || ''} onChange={e => setVals(v => ({ ...v, [f.id]: e.target.value }))} />}
            </div>
          ))}
          <div className={missing ? 'sg-wl sg-bad' : 'sg-wl sg-ok'}>{missing ? `${missing} field${missing === 1 ? '' : 's'} left` : 'All your fields are filled'}</div>
          <div className="sg-field"><label htmlFor="sg-pw">Confirm it's you: ASPIRE password</label>
            <input id="sg-pw" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} />
            <p className="sg-hint">Re-entering your password is the identity check the audit trail records for staff signers.</p></div>
          <label className="sg-chkline"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /> I agree that my typed name is my electronic signature on this document.</label>
          {err && <div className="sg-err" role="alert">{err}</div>}
          <button type="button" className="sg-btn sg-pri" disabled={!ok || busy} onClick={sign}>{busy ? 'Signing…' : 'Sign and complete'}</button>
          <button type="button" className="sg-btn" onClick={onClose}>Cancel</button>
          <p className="sg-hint">If you are the last signer, completing seals the document and sends the sealed copy to every party.</p>
        </div>
      </div>
    </Modal>
  )
}

