// src/components/budget/SubscriptionMonths.jsx
//
// SUBSCRIPTIONS-ONE-VIEW-1 (Owner, 2026-10-02: "see my subscriptions, when they are due, how much do
// they cost, track my concur status on them and see a visual of if they are going to be late ...
// preferable in one view not two"). The Subscriptions tab's ONE table: a row per plan with what it
// costs, when it next charges, and this fiscal year's months, each cell saying its amount AND its
// Concur status in words (late, due soon, submitted, reimbursed, paid), never colour alone. A cell
// opens that month's receipt in Receipts > Filed. It replaces the four tiles' detail, the Charges by
// Month card and the Platform Cost card on the Owner's view; the totals are said once, in the summary
// line above it. The Owner's view only: receipts are the Owner's.
//
// Month statuses come from src/lib/budget/filedModel.js subscriptionGrid (the ONE 60-day rule); the
// receipts and the rule come from the Receipts tab's own single request (and its cache). Cost and next
// charge are the plan's own calculations (budgetModel), the same ones Edit plans shows.
import { useEffect, useMemo, useState } from 'react'
import SurfaceCard from '../ui/SurfaceCard'
import { Pill } from '../shared/DataSheet'
import { cachedReceipts, openReceipts } from './budgetApi'
import { usd, dateText, fyShort, pacificToday, nextCharge, perYear, billingLabel } from '../../lib/budget/budgetModel'
import { subscriptionGrid, gridNotes } from '../../lib/budget/filedModel'

const LEGEND = [['late', 'Late, not submitted'], ['soon', 'Due within 14 days'], ['ok', 'Filed, on time'], ['submitted', 'Submitted'], ['reimbursed', 'Reimbursed or paid']]
const TONE = { green: 'ok', amber: 'warn', blue: 'info', grey: 'off' }

export default function SubscriptionMonths({ year, statusOf, onOpenReceipt }) {
  const [data, setData] = useState(null)   // { filed, rule }
  const [today] = useState(() => pacificToday())
  useEffect(() => {
    let live = true
    const take = (out) => { if (live && out?.status?.enabled) setData({ filed: out.filed || [], rule: (out.intake?.context?.rules || []).find(x => x.key === 'concur_60_days') || null }) }
    cachedReceipts(year.fy).then(seen => { if (seen) take(seen) }).catch(() => {})
    openReceipts(year.fy).then(take).catch(() => {})
    return () => { live = false }
  }, [year.fy])
  const subs = useMemo(() => year.subscriptions || [], [year.subscriptions])
  const g = useMemo(() => subscriptionGrid({ subscriptions: subs, expenses: year.expenses || [], receipts: data?.filed || [], fy: year.fy, today, rule: data?.rule || null, all: true }), [subs, year.expenses, year.fy, data, today])
  if (!g.rows.length) return null
  const byId = new Map(subs.map(s => [s.id, s]))
  const late = gridNotes(g).find(n => n.tone === 'late')
  return (
    <SurfaceCard className="bud-card bud-subm">
      <div className="bud-subm-head">
        <h2>Subscriptions · {fyShort(year.fy)}</h2>
        <ul className="bud-subm-legend" aria-label="What each month cell means">
          {LEGEND.map(([k, text]) => <li key={k}><i className={`bud-subm-cell k-${k}`} aria-hidden="true" />{text}</li>)}
        </ul>
      </div>
      <div className="bud-subm-scroll">
        <table className="bud-subm-table">
          <thead>
            <tr>
              <th scope="col" className="aspire-th">Service</th>
              <th scope="col" className="aspire-th aspire-th-right">Cost</th>
              <th scope="col" className="aspire-th">Next charge</th>
              {g.months.map(m => <th key={m.key} scope="col" className="aspire-th aspire-th-center">{m.short}</th>)}
              <th scope="col" className="aspire-th aspire-th-right">Per year</th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map(r => {
              const s = byId.get(r.id) || {}
              const st = statusOf ? statusOf(s) : null
              const next = nextCharge(s, today)
              const yearly = perYear(s, today)
              return (
                <tr key={r.id}>
                  <th scope="row"><b>{r.vendor}</b>{r.plan && <small>{r.plan}</small>}{st && st.key !== 'active' && <Pill tone={TONE[st.tone]}>{st.label}</Pill>}</th>
                  <td className="num"><b>{s.amount == null ? '–' : usd(s.amount)}</b><small>{billingLabel(s.billing)}{s.billing === 'usage' ? ', est.' : ''}</small></td>
                  <td>{next ? dateText(next) : <span className="bud-dash">–</span>}</td>
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
                  <td className="num">{yearly ? <b>{usd(yearly)}</b> : <span className="bud-dash">–</span>}</td>
                </tr>
              )
            })}
            <tr className="bud-subm-total">
              <th scope="row"><b>Charged each month</b></th>
              <td /><td />
              {g.months.map(m => <td key={m.key}><b>{usd(g.totals[m.key])}</b></td>)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {late && <p className="bud-subm-note late"><strong>{late.strong}</strong> {late.text}</p>}
    </SurfaceCard>
  )
}
