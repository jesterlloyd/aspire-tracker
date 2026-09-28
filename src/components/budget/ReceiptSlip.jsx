// src/components/budget/ReceiptSlip.jsx
//
// PROGRAM-BUDGET Phase B (BUDGET-B3, 2026-09-27): one receipt waiting for the owner (prompt B5; a
// decision is a slip, never a table row: table canon section 2). Reference: the Receipts tab of
// docs/mockups/program-budget.html.
//
// Left: the DRAWN receipt (Owner, 2026-09-27: every slip shows the same printed receipt, built from
// Keith's reading, "for the sake of uniformity and beauty"), the file name, and View original, which
// opens the uploaded file itself. Right: the reading, editable; the checks; where it files; Accept
// (or Attach to row N), Snooze and Reject. Every rule is src/lib/budget/receiptModel.js and
// receiptChecks.js, the same modules the server's Accept runs.
import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Eye, Info, OctagonAlert, Plus, Sparkles, X } from 'lucide-react'
import { receiptPaper, setLineCategory, rowsFrom, draftTotal, filedName, vendorLogo, slipState, ATTENDEE_FIELDS } from '../../lib/budget/receiptModel'
import { receiptChecks } from '../../lib/budget/receiptChecks'
import { usd, dateText, fyShort, PAYMENT_METHODS } from '../../lib/budget/budgetModel'

// The mockup's check icons: a warning triangle, an info mark, a tick; a block is the stop sign.
const CHECK_ICON = { block: OctagonAlert, warn: AlertTriangle, info: Info, ok: Check }
const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }
const ATTENDEE_LABEL = { name: 'Name', title: 'Title', organization: 'Organization', relationship: 'Business relationship' }
let seq = 0
const newId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * The printed receipt drawn from the reading. Decorative paper, real text (it is what Keith read).
 * RECEIPT-ORGANIZER-1: the vendor's logo prints at the top when one is on file (vendorLogo), and the
 * receipt comes in four sizes: lg on a slip, md in a Filed folder, sm tucked in a closed folder, xs
 * on a folded slip. The small sizes are thumbnails and leave out the order number and the address.
 */
export function ReceiptPaper({ proposal, reading = false, fileName, size = 'lg' }) {
  if (reading || !proposal) {
    return (
      <div className={`bud-rcpt bud-rcpt-${size} bud-rcpt-blank`} aria-hidden="true">
        <div className="c hd">{fileName}</div><hr /><div className="c">{reading ? 'Reading…' : 'Not read yet'}</div>
      </div>
    )
  }
  const small = size === 'sm' || size === 'xs'
  const logo = vendorLogo(proposal.vendor)
  const lines = receiptPaper(proposal).filter(l => !(small && (l.redacted || l.sub || /^Order #/.test(l.text || '') || l.left === 'Card')))
  const label = `Receipt as Keith read it: ${proposal.vendor}, ${usd(proposal.total)}`
  return (
    <div className={`bud-rcpt bud-rcpt-${size}${logo ? ' bud-rcpt-logo' : ''}`} {...(size === 'lg' ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}>
      {logo && <div className="bud-rcpt-mark"><img src={logo} alt="" loading="lazy" draggable="false" /></div>}
      {lines.map((l, i) => {
        if (l.rule) return <hr key={i} />
        const cls = [l.hl ? 'hl' : '', l.strong ? 'tot' : '', l.sub ? 'sub' : ''].filter(Boolean).join(' ')
        if (l.redacted) return <div key={i} className="l"><span>{l.left}</span><span className="bud-rcpt-bar" aria-label="address not shown" /></div>
        if ('left' in l) return <div key={i} className={`l ${cls}`}><span>{l.left}</span><span>{l.right}</span></div>
        return <div key={i} className={`c ${l.head ? 'hd' : ''} ${cls}`}>{l.text}</div>
      })}
    </div>
  )
}

/**
 * RECEIPT-ORGANIZER-1: a slip waiting behind the open one, folded to one line (Owner, 2026-09-27: the
 * queue grows long). A tiny receipt, what it is, and what it needs; clicking it opens it.
 */
export function ReceiptFold({ slip, context, onOpen }) {
  const d = slip.draft
  const result = receiptChecks(d, { ...context, proposal: slip.proposal || {}, duplicateFile: slip.duplicateFile })
  const rows = rowsFrom(d)
  const st = slipState(result, rows.length)
  const cats = [...new Set(d.lines.map(l => l.category).filter(Boolean))]
  const total = result.duplicate ? (slip.proposal?.total ?? draftTotal(d)) : draftTotal(d)
  return (
    <button type="button" className="bud-fold" onClick={() => onOpen(slip.id)} aria-label={`Open ${d.vendor || 'receipt'}, ${usd(total)}: ${st.text}`}>
      <ReceiptPaper proposal={slip.proposal} size="xs" />
      <span className="bud-fold-text"><b>{d.vendor || 'Vendor'} · {usd(total)}</b><small>{[d.date ? dateText(d.date) : 'No date', cats.join(', ')].filter(Boolean).join(' · ')}</small></span>
      <span className={`bud-conf bud-conf-${st.tone === 'warn' ? 'low' : 'medium'}`}>{st.text}</span>
      <ChevronRight size={18} aria-hidden="true" className="bud-fold-chev" />
    </button>
  )
}

export default function ReceiptSlip({ slip, context, categories, cohorts, busy, onDraft, onAccept, onSnooze, onReject, onRead, onDiscard, onOriginal, onStartYear }) {
  const d = slip.draft
  const [details, setDetails] = useState(false)   // date, vendor and order: Keith's reading, correctable on request
  const result = useMemo(() => (d ? receiptChecks(d, { ...context, proposal: slip.proposal || {}, duplicateFile: slip.duplicateFile }) : null), [d, context, slip.proposal, slip.duplicateFile])
  const heading = `${slip.file_name}`

  // Reading, failed, or not yet read: the paper stays blank and the right side says what is happening.
  if (!d || slip.status === 'reading' || slip.status === 'uploading' || slip.status === 'failed') {
    const reading = slip.status === 'reading' || slip.status === 'uploading'
    return (
      <article className="bud-slip" aria-label={reading ? `Keith is reading ${heading}` : `${heading} could not be read`}>
        <div className="bud-slip-side">
          <ReceiptPaper reading={reading} fileName={slip.file_name} />
          <span className="bud-slip-fname">{slip.file_name}</span>
          {slip.status !== 'uploading' && <button type="button" className="bud-btn bud-btn-sm" onClick={() => onOriginal(slip)}><Eye size={14} aria-hidden="true" /> View original</button>}
        </div>
        <div className="bud-slip-prop">
          {reading
            ? <p className="bud-reading" role="status"><span className="bud-spin" aria-hidden="true" />{slip.status === 'uploading' ? `Uploading ${slip.file_name}…` : `Keith is reading ${slip.file_name}…`}</p>
            : <div className="bud-check bud-check-warn" role="alert">{slip.read_error || 'This receipt has not been read yet.'}</div>}
          <div className="bud-slip-acts">
            {!reading && <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy} onClick={() => onRead(slip)}>Read again</button>}
            <span className="bud-grow" />
            <button type="button" className="bud-btn bud-btn-sm bud-btn-danger" disabled={busy} onClick={() => onDiscard(slip)}>Remove</button>
          </div>
        </div>
      </article>
    )
  }

  const set = (patch) => onDraft(slip, { ...d, ...patch })
  const setLine = (id, patch) => set({ lines: d.lines.map(l => (l.id === id ? { ...l, ...patch } : l)) })
  const fy = result.fy
  const dup = result.duplicate
  const rows = rowsFrom(d)
  const mealsCheck = result.checks.find(c => c.rule === 'meals_documentation')
  const total = dup ? (slip.proposal?.total ?? draftTotal(d)) : draftTotal(d)
  const filed = filedName({ date: d.date, vendor: d.vendor, order_number: d.order_number, total, contentType: slip.content_type })
  const startCheck = result.checks.find(c => c.startYear)
  const canAccept = dup ? !result.attachBlocked : !result.blocked

  return (
    <article className="bud-slip" aria-labelledby={`slip-${slip.id}`}>
      <div className="bud-slip-side">
        <ReceiptPaper proposal={slip.proposal} />
        <span className="bud-slip-fname">{slip.file_name}</span>
        <button type="button" className="bud-btn bud-btn-sm" onClick={() => onOriginal(slip)}><Eye size={14} aria-hidden="true" /> View original</button>
      </div>
      <div className="bud-slip-prop">
        <div className="bud-slip-head">
          <div>
            <b id={`slip-${slip.id}`}>{d.vendor || 'Vendor'} · {usd(total)}</b>
            <small>{[d.date ? dateText(d.date) : 'No date', fy ? fyShort(fy) : null, d.order_number ? `Order or invoice ${d.order_number}` : null].filter(Boolean).join(' · ')}
              {' '}<button type="button" className="bud-linkbtn bud-linkbtn-inline" aria-expanded={details || !d.date} onClick={() => setDetails(x => !x)}>{details || !d.date ? 'Done' : 'Edit'}</button></small>
          </div>
          <span className="bud-by"><Sparkles size={13} aria-hidden="true" />Read by Keith</span>
        </div>

        {(details || !d.date) && <div className="bud-slip-meta">
          <label><span>Date</span><input type="date" className="bud-input" value={d.date || ''} onChange={e => set({ date: e.target.value })} /></label>
          <label><span>Vendor</span><input className="bud-input" value={d.vendor} maxLength={120} onChange={e => set({ vendor: e.target.value })} /></label>
          <label><span>Order or invoice no.</span><input className="bud-input" value={d.order_number} maxLength={80} onChange={e => set({ order_number: e.target.value })} /></label>
        </div>}

        {!dup && (
          <div className="bud-lines" role="group" aria-label="Lines">
            <div className="bud-line bud-line-head" aria-hidden="true"><span>Item</span><span>Category</span><span>Qty</span><span>Amount</span><span /></div>
            {d.lines.map((l, i) => (
              <div key={l.id} className="bud-line-wrap">
                <div className="bud-line">
                  <input className="bud-input" aria-label={`Line ${i + 1} item`} value={l.item} maxLength={200} onChange={e => setLine(l.id, { item: e.target.value })} />
                  <select className="bud-input" aria-label={`Line ${i + 1} category`} value={l.category || ''} onChange={e => onDraft(slip, setLineCategory(d, l.id, e.target.value || null))}>
                    <option value="">Choose a category</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="bud-input bud-num" aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={e => setLine(l.id, { quantity: e.target.value })} />
                  <input className="bud-input bud-num" aria-label={`Line ${i + 1} amount`} inputMode="decimal" value={l.amount} onChange={e => setLine(l.id, { amount: e.target.value })} />
                  <button type="button" className="bud-iconbtn" aria-label={`Remove line ${i + 1}`} disabled={d.lines.length === 1} onClick={() => set({ lines: d.lines.filter(x => x.id !== l.id) })}><X size={14} /></button>
                </div>
                <p className="bud-line-why"><span className={`bud-conf bud-conf-${l.confidence}`}>{CONF[l.confidence]}</span>{l.reason}</p>
              </div>
            ))}
            <button type="button" className="bud-linkbtn" onClick={() => set({ lines: [...d.lines, { id: newId(), item: '', category: null, quantity: 1, amount: 0, base: 0, confidence: 'high', reason: 'Line added by you.', flags: [], set_by_owner: true }] })}><Plus size={13} aria-hidden="true" /> Add line</button>
          </div>
        )}

        {!dup && (
          <div className="bud-slip-meta bud-slip-meta-2">
            <label><span>Payment</span>
              <select className="bud-input" value={d.payment_method || ''} onChange={e => set({ payment_method: e.target.value || null })}>
                <option value="">Not recorded</option>{PAYMENT_METHODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select></label>
            <label><span>Cohort</span>
              <select className="bud-input" value={d.cohort_id || ''} onChange={e => set({ cohort_id: e.target.value || null })}>
                <option value="">No cohort (program-wide)</option>{cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
          </div>
        )}

        <ul className="bud-checks" aria-label="Checks">
          {result.checks.map(c => { const Icon = CHECK_ICON[c.tone]; return <li key={c.key} className={`bud-check bud-check-${c.tone}`}><Icon size={15} aria-hidden="true" /><span>{c.text}</span></li> })}
        </ul>
        {/* Business meals (policy p.1, p.9-10): a purpose and every attendee, before Accept. */}
        {mealsCheck && (
          <fieldset className="bud-meal">
            <legend>Business meal</legend>
            <label className="bud-fld"><span>Business purpose</span>
              <textarea className="bud-textarea" rows={2} maxLength={1000} value={d.business_purpose} placeholder="Fall 2026 preceptor appreciation lunch" onChange={e => set({ business_purpose: e.target.value })} /></label>
            <div className="bud-att" role="group" aria-label="Attendees">
              <div className="bud-att-row bud-att-head" aria-hidden="true">{ATTENDEE_FIELDS.map(k => <span key={k}>{ATTENDEE_LABEL[k]}</span>)}<span /></div>
              {d.attendees.map((a, i) => (
                <div key={i} className="bud-att-row">
                  {ATTENDEE_FIELDS.map(k => (
                    <input key={k} className="bud-input" aria-label={`Attendee ${i + 1} ${ATTENDEE_LABEL[k].toLowerCase()}`} value={a[k] || ''} maxLength={120}
                      onChange={e => set({ attendees: d.attendees.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                  ))}
                  <button type="button" className="bud-iconbtn" aria-label={`Remove attendee ${i + 1}`} onClick={() => set({ attendees: d.attendees.filter((_, j) => j !== i) })}><X size={14} /></button>
                </div>
              ))}
              <button type="button" className="bud-linkbtn" onClick={() => set({ attendees: [...d.attendees, { name: '', title: '', organization: '', relationship: '' }] })}><Plus size={13} aria-hidden="true" /> Add attendee</button>
            </div>
          </fieldset>
        )}


        <p className="bud-files">Files to <code>Program Budget › {fy ? fyShort(fy) : 'FY'} › Receipts › {filed}</code></p>

        <div className="bud-slip-acts">
          {startCheck
            ? <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" onClick={() => onStartYear(startCheck.startYear)}>Start {fyShort(startCheck.startYear)}</button>
            : <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || !canAccept} title={canAccept ? undefined : (dup ? result.attachBlockers : result.blockers).join(' ')} onClick={() => onAccept(slip, dup ? dup.expense.id : null)}>
                {dup ? `Attach to ${dup.expense.row_label}` : rows.length > 1 ? `Accept ${rows.length} rows` : 'Accept and post'}
              </button>}
          {dup && <button type="button" className="bud-btn bud-btn-sm" disabled={busy || result.blocked} title={result.blocked ? result.blockers.join(' ') : undefined} onClick={() => onAccept(slip, null)}>Add as a new row</button>}
          <button type="button" className="bud-btn bud-btn-sm" disabled={busy} onClick={() => onSnooze(slip)}>Snooze</button>
          <span className="bud-grow" />
          <button type="button" className="bud-btn bud-btn-sm bud-btn-danger" disabled={busy} onClick={() => onReject(slip)}>Reject</button>
        </div>
      </div>
    </article>
  )
}
