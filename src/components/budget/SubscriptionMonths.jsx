// src/components/budget/SubscriptionMonths.jsx
//
// RECEIPTS-REDESIGN-1 (Owner, 2026-10-01): Subscriptions, month by month. One row per plan with a charge
// this fiscal year, one column per month so far, then the next month as a dashed Expected cell. A cell
// says the amount AND its status in words (late, due soon, submitted, reimbursed, paid), never colour
// alone, and opens that month's receipt in Receipts > Filed. The Owner's view only: receipts are the
// Owner's. Every figure is src/lib/budget/filedModel.js subscriptionGrid; the receipts and the 60-day
// rule come from the Receipts tab's own single request (and its cache).
import { useEffect, useMemo, useState } from 'react'
import SurfaceCard from '../ui/SurfaceCard'
import { cachedReceipts, openReceipts } from './budgetApi'
import { usd, fyShort, pacificToday } from '../../lib/budget/budgetModel'
import { subscriptionGrid, gridNotes } from '../../lib/budget/filedModel'

const LEGEND = [['late', 'Late, not submitted'], ['soon', 'Due within 14 days'], ['ok', 'Filed, on time'], ['submitted', 'Submitted'], ['reimbursed', 'Reimbursed or paid']]

export default function SubscriptionMonths({ year, onOpenReceipt }) {
  const [data, setData] = useState(null)   // { filed, rule }
  useEffect(() => {
    let live = true
    const take = (out) => { if (live && out?.status?.enabled) setData({ filed: out.filed || [], rule: (out.intake?.context?.rules || []).find(x => x.key === 'concur_60_days') || null }) }
    cachedReceipts(year.fy).then(seen => { if (seen) take(seen) }).catch(() => {})
    openReceipts(year.fy).then(take).catch(() => {})
    return () => { live = false }
  }, [year.fy])
  const g = useMemo(() => subscriptionGrid({ subscriptions: year.subscriptions || [], expenses: year.expenses || [], receipts: data?.filed || [], fy: year.fy, today: pacificToday(), rule: data?.rule || null }), [year, data])
  if (!g.rows.length) return null
  const notes = gridNotes(g)
  return (
    <SurfaceCard className="bud-card bud-subm">
      <div className="bud-subm-head">
        <h2>Charges by Month · {fyShort(year.fy)}</h2>
        <span className="bud-sub">{g.rows.length} {g.rows.length === 1 ? 'plan' : 'plans'} · {usd(g.total)} so far</span>
        <ul className="bud-subm-legend" aria-label="What each cell means">
          {LEGEND.map(([k, text]) => <li key={k}><i className={`bud-subm-cell k-${k}`} aria-hidden="true" />{text}</li>)}
        </ul>
      </div>
      <div className="bud-subm-scroll">
        <table className="bud-subm-table">
          <thead>
            <tr>
              <th scope="col" className="aspire-th">Vendor and plan</th>
              {g.months.map(m => <th key={m.key} scope="col" className="aspire-th aspire-th-center">{m.short}</th>)}
              {g.next && <th scope="col" className="aspire-th aspire-th-center">{g.next.short}</th>}
              <th scope="col" className="aspire-th aspire-th-right">Last charge</th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map(r => (
              <tr key={r.id}>
                <th scope="row"><b>{r.vendor}</b>{r.plan && <small>{r.plan}</small>}</th>
                {g.months.map(m => {
                  const c = r.cells[m.key]
                  if (c.kind === 'none') return <td key={m.key}><span className="bud-subm-cell k-none" aria-label={c.label}>–</span></td>
                  const text = `${usd(c.amount)}${c.kind === 'ok' ? '' : ` · ${c.word}`}`
                  return (
                    <td key={m.key}>
                      {c.receiptId && onOpenReceipt
                        ? <button type="button" className={`bud-subm-cell k-${c.kind}`} aria-label={`${c.label}. Open the receipt.`} onClick={() => onOpenReceipt(c.receiptId)}>{text}</button>
                        : <span className={`bud-subm-cell k-${c.kind}`} aria-label={`${c.label}, no receipt filed`} title="No receipt is filed for this charge">{text}</span>}
                    </td>
                  )
                })}
                {g.next && <td><span className="bud-subm-cell k-expected">Expected</span></td>}
                <td className="num"><b>{usd(r.last)}</b></td>
              </tr>
            ))}
            <tr className="bud-subm-total">
              <th scope="row"><b>Month total</b></th>
              {g.months.map(m => <td key={m.key}><b>{usd(g.totals[m.key])}</b></td>)}
              {g.next && <td>Pending</td>}
              <td className="num"><b>{usd(g.total)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
      {notes.length > 0 && (
        <div className="bud-subm-notes">
          {notes.map(n => <p key={n.strong} className={`bud-subm-note ${n.tone}`}><strong>{n.strong}</strong> {n.text}</p>)}
        </div>
      )}
    </SurfaceCard>
  )
}
