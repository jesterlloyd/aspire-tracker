// src/components/budget/BudgetSubscriptions.jsx
//
// PROGRAM-BUDGET A9: recurring charges, tracked once. The basis line (Active, Monthly run rate,
// Per year, Due by Jun 30), Renewals to decide as slips (a decision is a slip, never a table
// row: table canon section 2), and every subscription on an Editable sheet. Next charge, Per
// year, Due by Jun 30 and Status are calculated from the row, by src/lib/budget/budgetModel.js,
// so an edit shows its effect at once.
import { useMemo, useState } from 'react'
import SurfaceCard from '../ui/SurfaceCard'
import EditableSheet from '../sheet/EditableSheet'
import { Pill } from '../shared/DataSheet'
import {
  usd, dateText, BILLING, PAYMENT_METHODS, nextCharge, perYear, dueByYearEnd, subscriptionStatus, isActiveSub, monthlyEquivalent,
  paymentKey, pacificToday, fyShort, parseMoney,
} from '../../lib/budget/budgetModel'

const LEAD = { key: '@name', label: 'Service', type: 'text' }
const TONE = { green: 'ok', amber: 'warn', blue: 'info', grey: 'off' }
const DASH = <span className="bud-dash">–</span>
const CALCULATED = new Set(['next', 'perYear', 'due', 'status'])
const DEFAULT_LAYOUT = {
  order: [], hidden: [], widths: { '@name': 190, plan: 170, notes: 240 }, frozen: 0, groupBy: null, staffColumns: [],
  colFormats: { amount: { num: 'currency' }, perYear: { num: 'currency' }, due: { num: 'currency' } }, summaries: { perYear: 'sum', due: 'sum' },
}
const billingLabel = (k) => BILLING.find(b => b.key === k)?.label || ''
const billingKey = (l) => BILLING.find(b => b.label === l)?.key || 'monthly'

export default function BudgetSubscriptions({ year, canEdit, onWrite }) {
  const [today] = useState(() => pacificToday())   // one day per visit, so the calculated columns hold still
  const state = year.state
  const subs = year.subscriptions
  const cats = useMemo(() => new Map(year.categories.map(c => [c.id, c.name])), [year.categories])
  const catIds = useMemo(() => new Map(year.categories.map(c => [c.name, c.id])), [year.categories])
  const active = subs.filter(s => isActiveSub(s, today))
  const run = active.reduce((a, s) => a + monthlyEquivalent(s), 0)
  const next = active.map(s => [s, nextCharge(s, today)]).filter(x => x[1]).sort((a, b) => a[1].localeCompare(b[1]))[0]
  const due = year.summary.committed

  const toRow = (s) => ({
    id: s.id, raw: s, format: {},
    cells: {
      plan: s.plan || '', vendor: s.vendor || '', billing: billingLabel(s.billing), amount: s.amount == null ? '' : String(s.amount),
      anchor: s.anchor_date || '', start: s.start_date || '', end: s.end_date || '',
      pay: PAYMENT_METHODS.find(p => p.key === s.payment_method)?.label || '', cat: cats.get(s.category_id) || '',
      auto: s.auto_renew ? 'Yes' : 'No', notes: s.notes || '',
    },
  })
  const rows = useMemo(() => subs.map(toRow), [subs]) // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useMemo(() => [
    { key: 'plan', label: 'Plan', type: 'text' },
    { key: 'vendor', label: 'Vendor', type: 'text' },
    { key: 'billing', label: 'Billing', type: 'choice', options: BILLING.map(b => b.label) },
    { key: 'amount', label: 'Amount', type: 'number' },
    { key: 'next', label: 'Next charge', type: 'text', compute: (r) => { const n = nextCharge(r.raw, today); return n ? dateText(n) : '' } },
    { key: 'perYear', label: 'Per year', type: 'number', compute: (r) => perYear(r.raw, today) || null },
    { key: 'due', label: `Due by Jun 30`, type: 'number', compute: (r) => dueByYearEnd(r.raw, year.fy, state, today) || null },
    { key: 'pay', label: 'Payment', type: 'choice', options: PAYMENT_METHODS.map(p => p.label) },
    { key: 'cat', label: 'Category', type: 'choice', options: year.categories.map(c => c.name) },
    { key: 'auto', label: 'Auto-renew', type: 'choice', options: ['Yes', 'No'] },
    { key: 'status', label: 'Status', type: 'text', compute: (r) => subscriptionStatus(r.raw, today).label },
    { key: 'anchor', label: 'A charge date', type: 'date' },
    { key: 'start', label: 'Start', type: 'date' },
    { key: 'end', label: 'End', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'paragraph' },
  ], [year.categories, year.fy, state, today])

  const toPatch = (key, draft) => {
    const v = typeof draft === 'string' ? draft.trim() : draft
    switch (key) {
      case '@name': return { name: v }
      case 'billing': return { billing: billingKey(v) }
      case 'amount': return { amount: parseMoney(v) ?? v }
      case 'pay': return { payment_method: v ? paymentKey(v) : null }
      case 'cat': return { category_id: v ? catIds.get(v) || null : null }
      case 'auto': return { auto_renew: v === 'Yes' }
      case 'anchor': return { anchor_date: v }
      case 'start': return { start_date: v }
      case 'end': return { end_date: v || null }
      default: return { [key]: v }
    }
  }
  const decide = (id, decision, ok) => onWrite.run('renewal_decide', { id, decision }, ok)

  return (
    <>
      <div className="bud-basis bud-basis-4">
        <SurfaceCard className="bud-tile"><span className="k">Active</span><b>{active.length}</b><small>{subs.length - active.length} cancelled or ending</small></SurfaceCard>
        <SurfaceCard className="bud-tile"><span className="k">Monthly run rate</span><b>{usd(run)}</b><small>Annual plans spread by month</small></SurfaceCard>
        <SurfaceCard className="bud-tile"><span className="k">Per year</span><b>{usd(run * 12)}</b><small>{state === 'current' && year.summary.total ? `${((run * 12) / year.summary.total * 100).toFixed(1)}% of the ${fyShort(year.fy)} budget` : 'At current plans'}</small></SurfaceCard>
        <SurfaceCard className="bud-tile"><span className="k">Due by Jun 30</span><b>{usd(due)}</b><small>{next ? `Next: ${next[0].name}, ${dateText(next[1])}` : 'Nothing scheduled'}</small></SurfaceCard>
      </div>

      {canEdit && year.renewals.length > 0 && (
        <section aria-label="Renewals to decide">
          <p className="bud-sub"><b>Renewals to Decide</b> · Annual plans renewing in the next 45 days</p>
          <div className="bud-renews">
            {year.renewals.map(r => (
              <SurfaceCard key={r.id} className="bud-renew" role="group" aria-label={`${r.name} renewal`}>
                <span className="when">In {r.days} {r.days === 1 ? 'day' : 'days'}</span>
                <div><b>{r.name} renews {dateText(r.date)} for {usd(r.amount)}</b>
                  <small>{[r.plan, r.paymentLabel, `auto-renew ${r.auto_renew ? 'on' : 'off'}`].filter(Boolean).join(' · ')}. Decide before the charge posts.</small></div>
                <div className="acts">
                  <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" onClick={() => decide(r.id, 'keep', `${r.name} will renew.`)}>Keep</button>
                  <button type="button" className="bud-btn bud-btn-sm" onClick={() => decide(r.id, 'cancel')}>Cancel at renewal</button>
                  <button type="button" className="bud-btn bud-btn-sm" onClick={() => decide(r.id, 'remind', 'We’ll ask again in 7 days.')}>Remind me in 7 days</button>
                </div>
              </SurfaceCard>
            ))}
          </div>
        </section>
      )}

      <p className="bud-hint">{canEdit
        ? 'Each charge posts to the Sheet on its date as a Recorded or Paid row, marked Subscription. Usage-based amounts are estimates. Double-click a cell to edit it; set an End date to stop a plan.'
        : 'Read-only view.'}</p>
      <EditableSheet
        key={`subs-${year.fy}`}
        initialRows={rows}
        initialLayout={{ ...DEFAULT_LAYOUT, ...(year.subscriptionsLayout || {}) }}
        lead={LEAD}
        columns={columns}
        editable={canEdit}
        valueOf={(r, k) => (k === '@name' ? r.raw.name : k === 'amount' ? r.raw.amount : r.cells[k])}
        shownOf={(r, k) => (k === '@name' ? r.raw.name : (r.cells[k] ?? ''))}
        searchValues={(r) => [r.raw.name, r.raw.vendor, r.raw.notes]}
        ungroupable={new Set(['amount', 'next', 'perYear', 'due', 'anchor', 'start', 'end', 'notes', 'plan'])}
        defaultSort={{ key: '@name', dir: 'asc' }} defaultFilterKey="billing"
        saveLayout={(layout) => onWrite.call('sheet_layout', { layout, sheet: 'subscriptions' })}
        saveCells={async () => {}}   // a subscription row keeps no per-cell formatting; column formats live in the layout
        canEditColumn={(col) => !CALCULATED.has(col.key) && !col.staff}
        canClear={(col) => ['plan', 'vendor', 'notes', 'end', 'cat', 'pay'].includes(col.key)}
        draftOf={(r, col) => (col.key === '@name' ? r.raw.name : r.cells[col.key])}
        commitEdit={async (row, col, editing, { patchRows }) => {
          const out = await onWrite.call('subscription_update', { id: row.id, patch: toPatch(col.key, editing.draft) })
          patchRows(x => (x.id === row.id ? toRow({ ...row.raw, ...normalize(out.subscription) }) : x))
          onWrite.changed()
        }}
        onAddRow={canEdit ? async () => { const out = await onWrite.call('subscription_create', { fields: { name: 'New subscription' } }); onWrite.changed(); return toRow(normalize(out.subscription)) } : undefined}
        onDeleteRows={canEdit ? async (list) => { for (const r of list) await onWrite.call('subscription_delete', { id: r.id }); onWrite.changed() } : undefined}
        renderCell={(row, col, text) => {
          if (col.key === 'status') { const st = subscriptionStatus(row.raw, today); return <Pill tone={TONE[st.tone]}>{st.label}</Pill> }
          if (col.key === 'amount' && row.raw.billing === 'usage' && text) return <>{text} <span className="bud-dash">est.</span></>
          return text === '' || text == null ? DASH : undefined
        }}
        labels={{
          searchPlaceholder: 'Search services, vendors and notes', searchLabel: 'Search the subscriptions',
          count: (n, total) => (n === total ? `${n} ${n === 1 ? 'subscription' : 'subscriptions'}` : `${n} of ${total}`),
          emptyNote: canEdit ? 'No subscriptions yet. Add a row for each recurring charge.' : 'No subscriptions.',
          noMatch: 'No subscriptions match.', frameLabel: 'Subscriptions. Arrow keys move, Enter edits.',
          readOnlyEdit: 'This view is read-only.',
        }}
        notify={onWrite.notify}
      />
    </>
  )
}

// The server returns a stored row; the date columns may arrive as timestamps.
const d10 = (v) => (v ? String(v).slice(0, 10) : null)
function normalize(s) {
  return { ...s, amount: s.amount == null ? null : Number(s.amount), anchor_date: d10(s.anchor_date), start_date: d10(s.start_date), end_date: d10(s.end_date),
    renewal_kept_for: d10(s.renewal_kept_for), renewal_remind_after: d10(s.renewal_remind_after) }
}
