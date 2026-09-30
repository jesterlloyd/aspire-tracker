// src/components/budget/ReceiptConcur.jsx
//
// BUDGET-CONCUR-1 (Owner, 2026-09-30): the receipt panel's Concur section, for a Personal (Concur)
// purchase. Two things:
//   1. Where it is: Mark submitted to Concur, then Mark reimbursed, each with Undo. They write the rows'
//      status through expense_update, the same field as the Sheet's Stage and its Submitted to Concur
//      checkbox, so marking it in one place marks it in the others.
//   2. What to type in Concur: Keith's draft (the prepare-concur skill), made on request and saved on
//      the receipt, each field with Copy. The amount, the date and the 60-day deadline are the app's.
import { useState } from 'react'
import { Copy } from 'lucide-react'
import { budgetStaff } from './budgetApi'
import KeithMark from '../keith/KeithMark'
import { usd, dateText, pacificToday, concurStateOf } from '../../lib/budget/budgetModel'

export default function ReceiptConcur({ receipt: r, notify, onChanged }) {
  const [busy, setBusy] = useState('')
  const rows = r.rows.filter(x => x.payment_method === 'personal_concur')
  const state = concurStateOf(r.rows)
  if (!state) return null
  const g = r.concur

  // Each row to `status`; Undo puts every row back to what it was.
  const mark = async (status, message) => {
    const before = rows.map(x => ({ id: x.id, status: x.status }))
    setBusy('mark')
    try {
      for (const x of rows) if (x.status !== status) await budgetStaff('expense_update', { id: x.id, patch: { status } })
      notify(message, 'ok', { label: 'Undo', ms: 8000, run: async () => {
        try { for (const b of before) await budgetStaff('expense_update', { id: b.id, patch: { status: b.status } }); notify('Undone.'); onChanged() } catch (e) { notify(e.message, 'err') }
      } })
      onChanged()
    } catch (e) { notify(e.message, 'err'); onChanged() } finally { setBusy('') }
  }
  const prepare = async () => {
    setBusy('prepare')
    try { await budgetStaff('receipt_concur_prepare', { id: r.id }); notify('Keith drafted the Concur entry.'); onChanged() } catch (e) { notify(e.message, 'err') } finally { setBusy('') }
  }
  const copy = (text) => { navigator.clipboard?.writeText(String(text || '')).then(() => notify('Copied.'), () => notify('Copy did not work in this browser.', 'err')) }
  const due = g?.due_by || null
  const late = due && state === 'open' && due < pacificToday()

  const field = (label, value, { copyable = true, multi = false } = {}) => (value ? (
    <div className={`bud-cc-row${multi ? ' multi' : ''}`}>
      <dt>{label}</dt>
      <dd><span>{value}</span>{copyable && <button type="button" className="bud-iconbtn bud-cc-copy" aria-label={`Copy ${label.toLowerCase()}`} title="Copy" onClick={() => copy(value)}><Copy size={13} aria-hidden="true" /></button>}</dd>
    </div>
  ) : null)

  return (
    <section className="bud-concur" aria-labelledby={`bud-concur-${r.id}`}>
      <div className="bud-concur-head">
        <h3 id={`bud-concur-${r.id}`}>Concur</h3>
        <span className={`bud-conf bud-conf-${state === 'reimbursed' ? 'high' : state === 'submitted' ? 'medium' : 'low'}`}>
          {state === 'reimbursed' ? 'Reimbursed or Paid' : state === 'submitted' ? 'Submitted to Concur' : 'Not submitted yet'}
        </span>
      </div>
      <div className="bud-concur-acts">
        {state === 'open' && <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={!!busy} onClick={() => mark('submitted', 'Marked submitted to Concur.')}>Mark submitted to Concur</button>}
        {state === 'submitted' && <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={!!busy} onClick={() => mark('reimbursed', 'Marked reimbursed.')}>Mark reimbursed</button>}
        {state === 'submitted' && <button type="button" className="bud-btn bud-btn-sm" disabled={!!busy} onClick={() => mark('recorded', 'Back to not submitted.')}>Not submitted yet</button>}
        {state === 'reimbursed' && <button type="button" className="bud-btn bud-btn-sm" disabled={!!busy} onClick={() => mark('submitted', 'Back to submitted.')}>Not reimbursed yet</button>}
        <span className="bud-hint">The Sheet’s Stage and its Submitted to Concur box follow this.</span>
      </div>

      {!r.concurEnabled ? (
        <p className="bud-hint">Keith’s Concur drafts need their database update (20261026000000_budget_concur.sql).</p>
      ) : !g ? (
        <div className="bud-concur-empty">
          <p className="bud-hint">Keith can draft what to enter in Concur from this receipt and the reimbursement policy in the Knowledge Center. It is saved here once drafted.</p>
          <button type="button" className="bud-btn bud-btn-sm" disabled={!!busy} onClick={prepare}>{busy === 'prepare' ? 'Keith is drafting…' : 'Prepare for Concur'}</button>
        </div>
      ) : (
        <>
          <dl className="bud-cc">
            {field('Report name', g.report_name)}
            {field('Expense type', g.expense_type)}
            {field('Transaction date', g.date ? dateText(g.date) : '')}
            {field('Amount', usd(g.amount))}
            {field('Vendor', g.vendor)}
            {field('Description', g.description)}
            {field('Business purpose', g.business_purpose, { multi: true })}
            {g.attendees?.length > 0 && field('Attendees', g.attendees.join('; '), { multi: true })}
            {g.attach?.length > 0 && field('Attach', g.attach.join('; '), { copyable: false, multi: true })}
            {due && <div className="bud-cc-row"><dt>Submit by</dt><dd><span className={late ? 'bud-cc-late' : undefined}>{dateText(due)}{late ? ' (past the 60 days)' : ''}</span></dd></div>}
          </dl>
          {g.checks?.length > 0 && (
            <ul className="bud-cc-checks">
              {g.checks.map((c, i) => <li key={i} className={`bud-check bud-check-${c.tone === 'warn' ? 'warn' : 'info'}`}><span>{c.text}</span></li>)}
            </ul>
          )}
          {g.notes && <p className="bud-hint">{g.notes}</p>}
          <p className="bud-cc-foot">
            {g.provenance_id && <KeithMark provenanceId={g.provenance_id} />}
            <span>Drafted by Keith{g.prepared_at ? ` ${new Date(g.prepared_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}{g.policy_found ? ' from the reimbursement policy' : ', policy not found in the Knowledge Center'}.</span>
            <button type="button" className="bud-linkbtn bud-linkbtn-inline" disabled={!!busy} onClick={prepare}>{busy === 'prepare' ? 'Drafting…' : 'Draft again'}</button>
          </p>
        </>
      )}
    </section>
  )
}
