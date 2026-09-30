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
import { AlertTriangle, Check, ChevronRight, Eye, Info, OctagonAlert, Plus, X } from 'lucide-react'
import KeithMark from '../keith/KeithMark'
import { receiptPaper, setLineCategory, rowsFrom, draftTotal, filedName, vendorLogo, slipState, receiptsOnCard, ATTENDEE_FIELDS } from '../../lib/budget/receiptModel'
import { receiptChecks } from '../../lib/budget/receiptChecks'
import { usd, dateText, fyShort, PAYMENT_METHODS, paymentLabel } from '../../lib/budget/budgetModel'

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

const shortDate = (ymd) => dateText(ymd).replace(/, \d{4}$/, '')

export default function ReceiptSlip({ slip, context, categories, cohorts, busy, openSlips = [], onDraft, onAccept, onSnooze, onReject, onRead, onDiscard, onOriginal, onStartYear, onHold, onRemember, onAmend }) {
  const d = slip.draft
  const [details, setDetails] = useState(false)
  const [choice, setChoice] = useState(null)       // BUDGET-V2 item 11: 'attach' | 'add'; null is Keith's pick
  const [moveFrom, setMoveFrom] = useState('')     // BUDGET-V2 item 16: the category a move comes from   // date, vendor and order: Keith's reading, correctable on request
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
  // BUDGET-V2 item 1: a subscription charge attaches or holds; a new row is the owner's explicit choice.
  const m = result.subMatch
  const charge = m && m.kind !== 'uncounted' ? m : null
  const chargeLabel = charge ? `Attach to ${shortDate(charge.charge_date)} charge` : ''
  // BUDGET-V2 item 11: Match or add? Attach to a charge that already exists (a subscription charge, or
  // a row this receipt duplicates), or add it as a new one-time expense. Keith picks the likely one.
  const attachable = !!charge || !!dup
  const pickAttach = (choice || (attachable ? 'attach' : 'add')) === 'attach' && attachable
  const addTotal = draftTotal(d)
  const monthName = d.date ? new Date(`${d.date}T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) : ''
  const attachNote = charge
    ? charge.kind === 'hold' ? `The ${charge.subscription.name} charge on ${shortDate(charge.charge_date)} (${usd(charge.amount)}). ${charge.subscription.name} is awaiting approval, so it holds until you approve it.`
      : charge.kind === 'filed' ? `The ${charge.subscription.name} charge on ${shortDate(charge.charge_date)} already has its receipt.`
        : `The ${charge.subscription.name} charge on ${shortDate(charge.charge_date)} (${usd(charge.amount)}). Spent does not change.`
    : dup ? `${dup.expense.row_label}: ${dup.expense.item || 'no item'}, ${usd(dup.expense.amount)}. Spent does not change.`
      : `Keith found no charge for ${usd(addTotal)} near ${d.date ? shortDate(d.date) : 'this date'}.`
  // BUDGET-V2 item 16: over the approved plan, move inside the limit or ask Margo.
  const planC = result.checks.find(c => c.key === 'plan')?.plan || null
  const over = planC?.key === 'over' ? planC : null
  const otherBlocks = result.checks.filter(c => c.tone === 'block')
  const from = moveFrom && over?.sources.some(s => s.category_id === moveFrom) ? moveFrom : over?.sources[0]?.category_id || ''
  const addNote = result.fyStarted ? `Adds ${usd(addTotal)} to Spent in ${monthName}${rows.length > 1 ? `, as ${rows.length} rows` : ''}.` : 'Its fiscal year has to start first.'
  // BUDGET-V2 item 5: remember this card as the method chosen, for every open receipt on it.
  const card = slip.proposal?.card_last4 || ''
  const remembered = (context.rememberedCards || []).find(c => c.last4 === card)
  const others = card && d.payment_method ? receiptsOnCard(openSlips, card, d.payment_method, slip.id).length : 0

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
          <KeithMark provenanceId={slip.keith_provenance_id} />
        </div>

        {(details || !d.date) && <div className="bud-slip-meta">
          <label><span>Date</span><input type="date" className="bud-input" value={d.date || ''} onChange={e => set({ date: e.target.value })} /></label>
          <label><span>Vendor</span><input className="bud-input" value={d.vendor} maxLength={120} onChange={e => set({ vendor: e.target.value })} /></label>
          <label><span>Order or invoice no.</span><input className="bud-input" value={d.order_number} maxLength={80} onChange={e => set({ order_number: e.target.value })} /></label>
        </div>}

        {!(pickAttach && dup && !charge) && (
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
                  <input className="bud-input bud-num" aria-label={`Line ${i + 1} amount`} inputMode="decimal" placeholder="0.00" value={Number(l.amount) === 0 && String(l.amount) !== '0.' ? '' : l.amount} onChange={e => setLine(l.id, { amount: e.target.value })} />
                  <button type="button" className="bud-iconbtn" aria-label={`Remove line ${i + 1}`} disabled={d.lines.length === 1} onClick={() => set({ lines: d.lines.filter(x => x.id !== l.id) })}><X size={14} /></button>
                </div>
                <p className="bud-line-why"><span className={`bud-conf bud-conf-${l.confidence}`}>{CONF[l.confidence]}</span>{l.reason}</p>
              </div>
            ))}
            <button type="button" className="bud-linkbtn" onClick={() => set({ lines: [...d.lines, { id: newId(), item: '', category: null, quantity: 1, amount: 0, base: 0, confidence: 'high', reason: 'Line added by you.', flags: [], set_by_owner: true }] })}><Plus size={13} aria-hidden="true" /> Add line</button>
          </div>
        )}

        {!(pickAttach && dup && !charge) && (
          <div className="bud-slip-meta bud-slip-meta-2">
            <label><span>Payment</span>
              <select className="bud-input" value={d.payment_method || ''} onChange={e => set({ payment_method: e.target.value || null })}>
                <option value="">Not recorded</option>{PAYMENT_METHODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select></label>
            <label><span>Cohort</span>
              <select className="bud-input" value={d.cohort_id || ''} onChange={e => set({ cohort_id: e.target.value || null })}>
                <option value="">No cohort (program-wide)</option>{cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            {/* BUDGET-V2 item 4: the Platform tag, set from the subscription a charge belongs to. */}
            {context.tagsEnabled && (
              <label><span>Tag</span>
                <select className="bud-input" value={(d.tag ?? (charge?.subscription.tag || '')) || ''} onChange={e => set({ tag: e.target.value || null })}>
                  <option value="">None</option><option value="platform">Platform</option>
                </select>
                {d.tag == null && charge?.subscription.tag === 'platform' && <small className="bud-hint">Set from the {charge.subscription.name} subscription.</small>}
              </label>
            )}
            {card && d.payment_method && onRemember && (
              <label className="bud-remember">
                <input type="checkbox" checked={remembered?.method === d.payment_method} disabled={busy}
                  onChange={e => onRemember(card, d.payment_method, e.target.checked)} />
                <span>Remember card ending {card} as {paymentLabel(d.payment_method)}. {others ? `Applies to ${others} other ${others === 1 ? 'receipt' : 'receipts'}.` : 'Applies to receipts you add later.'}</span>
              </label>
            )}
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


        <p className="bud-files">Files to <code>Budget Tracker › {fy ? fyShort(fy) : 'FY'} › Receipts › {filed}</code></p>

        <fieldset className="bud-match">
          <legend className="bud-sr">Match or add?</legend>
          <p aria-hidden="true">Match or add?</p>
          <div className="bud-match-opts">
            <label className="bud-opt">
              <input type="radio" name={`ma-${slip.id}`} checked={pickAttach} disabled={!attachable || charge?.kind === 'filed'} onChange={() => setChoice('attach')} />
              <span><b>Attach to an existing charge</b><small>{attachNote}</small></span>
            </label>
            <label className="bud-opt">
              <input type="radio" name={`ma-${slip.id}`} checked={!pickAttach} onChange={() => setChoice('add')} />
              <span><b>Add as a new one-time expense</b><small>{addNote}</small></span>
            </label>
          </div>
        </fieldset>

        {over && !pickAttach && (
          <div className="bud-plan-paths" role="group" aria-label="Outside the approved plan">
            {over.canMove ? (<>
              <label className="bud-sr" htmlFor={`mv-${slip.id}`}>Move from</label>
              <span className="bud-hint">Move {usd(over.first.over)} from</span>
              <select id={`mv-${slip.id}`} className="bud-input" value={from} onChange={e => setMoveFrom(e.target.value)}>
                {over.sources.map(s => <option key={s.category_id} value={s.category_id}>{s.name} ({usd(s.room)} left)</option>)}
              </select>
              <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || otherBlocks.length > 0} title={otherBlocks.length ? otherBlocks.map(c => c.text).join(' ') : undefined}
                onClick={() => onAccept(slip, null, { moveFrom: from, asOneTime: !!charge })}>Move and add</button>
            </>) : <span className="bud-hint">{over.whyNoMove}</span>}
            {onAmend && <button type="button" className="bud-btn bud-btn-sm" disabled={busy || otherBlocks.length > 0} title={otherBlocks.length ? otherBlocks.map(c => c.text).join(' ') : undefined} onClick={() => onAmend(slip)}>Ask Margo for an amendment</button>}
          </div>
        )}

        <div className="bud-slip-acts">
          {startCheck
            ? <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" onClick={() => onStartYear(startCheck.startYear)}>Start {fyShort(startCheck.startYear)}</button>
            : pickAttach && charge?.kind === 'hold'
                ? <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy} onClick={() => onHold(slip)}>Hold until {charge.subscription.name} is approved</button>
                : pickAttach && charge
                  ? <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || result.attachBlocked} title={result.attachBlocked ? result.attachBlockers.join(' ') : undefined}
                      onClick={() => onAccept(slip, null, { attachCharge: true })}>{chargeLabel}</button>
                  : pickAttach && dup
                    ? <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || result.attachBlocked} title={result.attachBlocked ? result.attachBlockers.join(' ') : undefined}
                        onClick={() => onAccept(slip, dup.expense.id)}>Attach to {dup.expense.row_label}</button>
                    : <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || result.blocked} title={result.blocked ? result.blockers.join(' ') : undefined}
                        onClick={() => onAccept(slip, null, { asOneTime: !!charge })}>{rows.length > 1 ? `Add ${rows.length} rows` : 'Add expense'}</button>}
          <button type="button" className="bud-btn bud-btn-sm" disabled={busy} onClick={() => onSnooze(slip)}>Snooze</button>
          <span className="bud-grow" />
          <button type="button" className="bud-btn bud-btn-sm bud-btn-danger" disabled={busy} onClick={() => onReject(slip)}>Reject</button>
        </div>
      </div>
    </article>
  )
}
