// src/components/budget/BudgetPlan.jsx
//
// BUDGET-V2 Phase 3 (2026-09-29): the Plan tab, which replaces Allocations. Reference: the Plan tab and
// Margo's review in docs/mockups/program-budget-v2.html. "Plan" means category totals in every state:
// proposed, approved or amended. The server sends year.plan (lib/server/budget/plan.js withPlan); every
// rule is src/lib/budget/planModel.js. Nothing is computed here but layout and the draft's own sums.
//
//   The owner drafts: "Why this budget" (Margo reads it first), one block per category with its
//   planned items (quantity x unit cost, a reason), subscriptions carried forward tagged Platform, and
//   a side panel with the request total, last year's budget and actual, and the Platform share. Submit
//   to Margo freezes the version. An approved plan can be revised as the next version.
//   Margo (a grant with budget_access 'approve', in the portal) sees the note and a table of categories
//   (prior actual, requested, an editable approved amount), and Approve (Approve with changes once she
//   edits a total) or Send back with a comment. Download PDF for Finance is there for both.
//   Everyone else reads the latest version that is not a draft.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Download, Plus, X } from 'lucide-react'
import SurfaceCard from '../ui/SurfaceCard'
import { Pill } from '../shared/DataSheet'
import { usd, fyShort, parseMoney, currentFiscalYear } from '../../lib/budget/budgetModel'
import { itemAmount, planTotals, statusLine, PLATFORM, moveLimit, unallocated } from '../../lib/budget/planModel'
import { savePdf } from './budgetApi'

// A timestamp, as the day it was where the reader is (never the UTC day).
const stamp = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const TONE = { draft: 'info', submitted: 'warn', approved: 'ok', sent_back: 'off' }
let seq = 0
/** What the server stores for an item. */
const payload = (i) => ({ category_id: i.category_id, name: i.name, quantity: i.quantity, unit_cost: i.unit_cost, reason: i.reason, tag: i.tag, provenance_id: i.provenance_id || null })
const key = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`

export default function BudgetPlan({ year, canEdit, onWrite, source, onOpenYear }) {
  const p = year.plan
  const cur = p?.current || null
  const owner = canEdit
  const draft = owner && cur?.status === 'draft'
  const reviewing = !owner && year.canApprove && cur?.status === 'submitted'
  const fy = year.fy
  const running = year.state === 'current' || year.state === 'closed'
  const labels = {
    prior2: `${fyShort(fy - 2)} actual`,
    prior1: `${fyShort(fy - 1)} ${fy - 1 === currentFiscalYear() ? 'to date' : 'actual'}`,
    req: `${fyShort(fy)} request`,
  }

  const [items, setItems] = useState(() => (cur?.items || []).map(i => ({ ...i, key: key() })))
  const [note, setNote] = useState(cur?.note || '')
  const [saving, setSaving] = useState('')
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const persist = (next = items, nextNote = note) => {
    clearTimeout(timer.current)
    setSaving('Saving…')
    timer.current = setTimeout(async () => {
      try {
        await onWrite.call('plan_save', { id: cur.id, note: nextNote, items: next.map(payload) })
        setSaving('All changes saved')
      } catch (e) { setSaving(''); onWrite.notify(e.message, 'err') }
    }, 700)
  }
  const setItem = (k, patch) => setItems(list => { const n = list.map(i => (i.key === k ? { ...i, ...patch } : i)); persist(n); return n })
  const addItem = (category_id) => setItems(list => { const n = [...list, { key: key(), category_id, name: '', quantity: 1, unit_cost: 0, reason: '', tag: null }]; persist(n); return n })
  const removeItem = (k) => setItems(list => { const n = list.filter(i => i.key !== k); persist(n); return n })

  const cats = cur?.categories || []
  const totals = useMemo(() => planTotals(draft ? items : (cur?.items || [])), [draft, items, cur])
  const requestedOf = (c) => (draft ? (totals.byCategory.get(c.id) || 0) : c.requested)
  const shown = cats.filter(c => requestedOf(c) || c.prior1 || c.prior2 || c.approved || (draft && items.some(i => i.category_id === c.id)))
  const unused = cats.filter(c => !shown.includes(c))

  // Margo's approved amounts, as she edits them.
  const [approved, setApproved] = useState(() => Object.fromEntries(cats.map(c => [c.id, c.requested ? String(c.requested) : ''])))
  const [comment, setComment] = useState('')
  const changed = cats.some(c => (parseMoney(approved[c.id] || '0') ?? 0) !== c.requested)
  const approvedTotal = cats.reduce((a, c) => a + (parseMoney(approved[c.id] || '0') ?? 0), 0)

  const [busy, setBusy] = useState(false)
  const act = async (fn) => { setBusy(true); try { await fn() } catch (e) { onWrite.notify(e.message, 'err') } finally { setBusy(false) } }
  const run = (action, payload, done) => act(async () => { if (await onWrite.run(action, payload)) done?.() })
  const review = (action, payload) => act(async () => { const out = await source.review(action, payload); onWrite.notify(out.message || 'Saved.'); onWrite.changed() })
  const pdf = () => act(async () => savePdf(await source.pdf(cur.id)))

  if (!p) return null
  if (p.enabled === false) return <SurfaceCard className="bud-card"><p className="bud-empty">The plan needs its database update (20261023000000_budget_v2_phase3.sql).</p></SurfaceCard>

  // No plan yet.
  if (!cur) {
    return (
      <SurfaceCard className="bud-card">
        <div className="bud-empty">
          <b>{year.state === 'proposal' ? `No ${fyShort(fy)} proposal yet` : `No approved category plan for ${fyShort(fy)}`}</b>
          <span>{owner
            ? `${year.state === 'proposal' ? 'Draft the request Margo approves: a note, the items in each category, and the subscriptions carried forward.' : 'Draft the category plan Margo approves. Any saved allocations come with it as items.'}`
            : 'The program owner has not submitted a plan yet.'}</span>
          {owner && p.canStart && <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy} onClick={() => run('plan_start', { fiscal_year: fy })}>Start the {fyShort(fy)} {year.state === 'proposal' ? 'proposal' : 'plan'}</button>}
        </div>
      </SurfaceCard>
    )
  }

  const prevSentBack = p.versions.find(v => v.version === cur.version - 1 && v.status === 'sent_back')
  const pending = (p.amendments || []).filter(a => a.status === 'pending')
  const catName = new Map(cats.map(c => [c.id, c.name]))
  // BUDGET-FIXES-1 item 1.3: the category totals against this year's budget.
  const planned = cur.status === 'approved' ? cur.approvedTotal : (draft ? totals.total : cur.total)
  const left = unallocated(year.summary?.total, planned)
  const leftLine = (cls) => (
    <div className={`${cls}${left.kind === 'over' ? ' bud-unalloc-over' : ''}`} role="note">
      <span>{left.kind === 'over' ? 'Over budget' : 'Unallocated'}</span>
      <b>{left.kind === 'over' ? left.text.replace('Over budget by ', 'by ') : left.text}</b>
    </div>
  )

  return (
    <div className="bud-plan">
      <div className="bud-plan-main">
        <SurfaceCard className="bud-card">
          <div className="bud-plan-head">
            <div>
              <h2>{fyShort(fy)} Plan</h2>
              <p className="bud-sub"><Pill tone={TONE[cur.status]}>{statusLine(cur)}</Pill>
                {cur.submitted_at && <> Submitted {stamp(cur.submitted_at)}{cur.submitted_by ? ` by ${cur.submitted_by}` : ''}.</>}
                {cur.decided_at && cur.status === 'approved' && <> Approved {stamp(cur.decided_at)}{cur.decided_by ? ` by ${cur.decided_by}` : ''}.</>}
                {draft && saving && <span className="bud-hint"> {saving}</span>}</p>
            </div>
            <div className="bud-plan-acts">
              {draft && <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy || !totals.total || !note.trim()} title={!note.trim() ? 'Write "Why this budget" first' : !totals.total ? 'Add an item with an amount first' : undefined}
                onClick={() => act(async () => { clearTimeout(timer.current); await onWrite.call('plan_save', { id: cur.id, note, items: items.map(payload) }); await onWrite.run('plan_submit', { id: cur.id }) })}>Submit to Margo</button>}
              {owner && cur.status === 'approved' && <button type="button" className="bud-btn bud-btn-sm" disabled={busy} onClick={() => run('plan_revise', { id: cur.id })}>Start a revision</button>}
              {cur.status !== 'draft' && <button type="button" className="bud-btn bud-btn-sm" disabled={busy} onClick={pdf}><Download size={14} aria-hidden="true" />Download PDF for Finance</button>}
            </div>
          </div>
          {prevSentBack && <div className="bud-check bud-check-warn" role="note"><span><b>Margo sent v{prevSentBack.version} back.</b> {prevSentBack.comment || 'No comment.'} This is v{cur.version}.</span></div>}
          {cur.status === 'sent_back' && cur.comment && <div className="bud-check bud-check-warn" role="note"><span><b>Sent back:</b> {cur.comment}</span></div>}
          {cur.status === 'approved' && cur.comment && <div className="bud-check bud-check-ok" role="note"><span><b>Margo:</b> {cur.comment}</span></div>}
          {owner && cur.status === 'submitted' && <p className="bud-hint">With Margo. v{cur.version} no longer changes; she approves the category totals in the Leadership Portal.</p>}
        </SurfaceCard>

        <SurfaceCard className="bud-card">
          <h2>Why This Budget</h2><p className="bud-sub">Margo reads this first.</p>
          {draft
            ? <textarea className="bud-textarea" rows={4} maxLength={4000} value={note} placeholder="What this year's budget pays for, what changed from last year, and why."
                onChange={e => { setNote(e.target.value); persist(items, e.target.value) }} />
            : <p className="bud-plan-note">{cur.note || 'No note.'}</p>}
        </SurfaceCard>

        {reviewing && (
          <SurfaceCard className="bud-card bud-review" aria-labelledby="bud-review-h">
            <h2 id="bud-review-h">Your Decision</h2>
            <p className="bud-sub">You approve category totals. Change any total to approve with changes.</p>
            <div className="bud-review-table" role="table" aria-label="Categories">
              <div role="row" className="bud-review-row bud-review-head"><span role="columnheader">Category</span><span role="columnheader">{labels.prior1}</span><span role="columnheader">Requested</span><span role="columnheader">Approved</span></div>
              {cats.filter(c => c.requested).map(c => (
                <div key={c.id} role="row" className="bud-review-row">
                  <span role="cell">{c.name}</span><span role="cell" className="n">{usd(c.prior1)}</span><span role="cell" className="n">{usd(c.requested)}</span>
                  <span role="cell"><input className="bud-input bud-num" inputMode="decimal" aria-label={`Approved for ${c.name}`} value={approved[c.id] ?? ''} onChange={e => setApproved(a => ({ ...a, [c.id]: e.target.value }))} /></span>
                </div>
              ))}
              <div role="row" className="bud-review-row bud-review-total"><span role="cell">Total</span><span role="cell" className="n">{usd(cats.reduce((a, c) => a + c.prior1, 0))}</span><span role="cell" className="n">{usd(cur.total)}</span><span role="cell" className="n">{usd(approvedTotal)}</span></div>
            </div>
            <label className="bud-fld"><span>Comment (optional)</span>
              <textarea className="bud-textarea" rows={2} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} placeholder="What to change, or a note on the approval" /></label>
            <div className="bud-close-acts">
              <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy} onClick={() => review('plan_decide', { plan_id: cur.id, decision: 'approve', approved: Object.fromEntries(cats.filter(c => c.requested).map(c => [c.id, parseMoney(approved[c.id] || '0') ?? 0])), comment })}>{changed ? 'Approve with changes' : 'Approve'}</button>
              <button type="button" className="bud-btn bud-btn-sm" disabled={busy} onClick={() => review('plan_decide', { plan_id: cur.id, decision: 'send_back', comment })}>Send back for revision</button>
            </div>
          </SurfaceCard>
        )}

        {year.canApprove && pending.length > 0 && (
          <SurfaceCard className="bud-card bud-review">
            <h2>Amendments to Decide</h2><p className="bud-sub">The program owner asks to raise a category beyond the move limit.</p>
            <ul className="bud-recent">
              {pending.map(a => (
                <li key={a.id}><span><b>{catName.get(a.category_id)}</b> · raise by {usd(a.amount)}</span><small>{a.reason}</small><span className="bud-grow" />
                  <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy} onClick={() => review('amendment_decide', { id: a.id, decision: 'approve' })}>Approve</button>
                  <button type="button" className="bud-btn bud-btn-sm" disabled={busy} onClick={() => review('amendment_decide', { id: a.id, decision: 'decline' })}>Decline</button></li>
              ))}
            </ul>
          </SurfaceCard>
        )}

        <SurfaceCard className="bud-card">
          <div className="bud-plan-cathead"><h2>Categories</h2><span className="bud-hint">{labels.prior2} · {labels.prior1} · {labels.req}{cur.status === 'approved' ? ' · approved' : ''}</span></div>
          {shown.length === 0 && <p className="bud-empty">No items yet. Add items to a category below.</p>}
          {shown.map(c => {
            const own = (draft ? items : cur.items).filter(i => i.category_id === c.id)
            const plat = own.some(i => i.tag === PLATFORM)
            return (
              <details key={c.id} className={`bud-pcat${cur.status === 'approved' ? ' bud-pcat-4' : ''}`} open={draft && own.length > 0 && own.length <= 6}>
                <summary>
                  <ChevronRight size={15} aria-hidden="true" className="chev" />
                  <span className="nm">{c.name}{plat && <span className="bud-tag">Platform</span>}</span>
                  <span className="n" title={labels.prior2}>{usd(c.prior2)}</span>
                  <span className="n" title={labels.prior1}>{usd(c.prior1)}</span>
                  <span className="n req" title={labels.req}>{usd(requestedOf(c))}</span>
                  {cur.status === 'approved' && <span className="n" title="Approved">{c.approved == null ? 'Not set' : usd(c.approved)}{c.effective != null && c.effective !== c.approved ? <small> now {usd(c.effective)}</small> : null}</span>}
                </summary>
                <div className="bud-pitems">
                  {own.map((i, n) => draft ? (
                    <div key={i.key} className="bud-pitem">
                      <input className="bud-input" aria-label={`${c.name} item ${n + 1}`} value={i.name} maxLength={200} placeholder="Item" onChange={e => setItem(i.key, { name: e.target.value })} />
                      <input className="bud-input bud-num" aria-label="Quantity" inputMode="decimal" value={i.quantity} onChange={e => setItem(i.key, { quantity: e.target.value })} />
                      <span className="x" aria-hidden="true">×</span>
                      <input className="bud-input bud-num" aria-label="Unit cost" inputMode="decimal" placeholder="0.00" value={Number(i.unit_cost) === 0 && String(i.unit_cost) !== '0.' ? '' : i.unit_cost} onChange={e => setItem(i.key, { unit_cost: e.target.value })} />
                      <span className="eq">= {usd(itemAmount(i))}</span>
                      <label className="bud-ptag"><input type="checkbox" checked={i.tag === PLATFORM} onChange={e => setItem(i.key, { tag: e.target.checked ? PLATFORM : null })} />Platform</label>
                      <button type="button" className="bud-iconbtn" aria-label={`Remove ${i.name || 'item'}`} onClick={() => removeItem(i.key)}><X size={14} /></button>
                      <input className="bud-input bud-preason" aria-label="Reason" value={i.reason} maxLength={500} placeholder="One line on why" onChange={e => setItem(i.key, { reason: e.target.value })} />
                    </div>
                  ) : (
                    <div key={i.id || n} className="bud-pitem bud-pitem-ro">
                      <span className="nm">{i.name}{i.tag === PLATFORM && <span className="bud-tag">Platform</span>}</span>
                      <span className="eq">{i.quantity} × {usd(i.unit_cost)} = {usd(i.amount ?? itemAmount(i))}</span>
                      {i.reason && <small>{i.reason}</small>}
                    </div>
                  ))}
                  {draft && <button type="button" className="bud-linkbtn" onClick={() => addItem(c.id)}><Plus size={13} aria-hidden="true" /> Add item</button>}
                </div>
              </details>
            )
          })}
          {leftLine('bud-unalloc')}
          {draft && unused.length > 0 && (
            <label className="bud-fld bud-addcat"><span>Add items to another category</span>
              <select className="bud-input" value="" onChange={e => { if (e.target.value) addItem(e.target.value) }}>
                <option value="">Choose a category</option>{unused.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
          )}
        </SurfaceCard>

        {cur.status === 'approved' && ((p.moves || []).length > 0 || (p.amendments || []).length > 0) && (
          <SurfaceCard className="bud-card">
            <h2>Moves and Amendments</h2><p className="bud-sub">Changes to the approved totals since Margo approved them</p>
            <ul className="bud-recent">
              {(p.moves || []).map(m => <li key={m.id}><span>Moved {usd(m.amount)} from {catName.get(m.from_category_id)} to {catName.get(m.to_category_id)}</span><small>{stamp(m.created_at)} · inside the agreed limit</small></li>)}
              {(p.amendments || []).map(a => <li key={a.id}><span>{catName.get(a.category_id)} · raise by {usd(a.amount)}</span><small>{a.status === 'pending' ? 'Waiting for Margo' : a.status === 'approved' ? `Approved ${stamp(a.decided_at)}` : `Declined ${stamp(a.decided_at)}`}{a.comment ? ` · ${a.comment}` : ''}</small></li>)}
            </ul>
          </SurfaceCard>
        )}

        <SurfaceCard className="bud-card">
          <h2>Plan History</h2><p className="bud-sub">Every submission, decision, change and comment</p>
          <ul className="bud-hist">
            {p.history.length ? p.history.map((h, i) => <li key={i}><span className="when">{stamp(h.created_at)}</span><span>{h.message}{h.actor_name && <small>{h.actor_name}</small>}</span></li>)
              : <li><span className="when">–</span><span>No plan events yet</span></li>}
          </ul>
        </SurfaceCard>
      </div>

      <aside className="bud-plan-side" aria-label="Request summary">
        <SurfaceCard className="bud-card">
          <div className="bud-side-row"><span>{cur.status === 'approved' ? 'Approved total' : 'Request total'}</span><b>{usd(cur.status === 'approved' ? cur.approvedTotal : (draft ? totals.total : cur.total))}</b></div>
          {cur.status === 'approved' && <div className="bud-side-row"><span>Requested</span><b>{usd(cur.total)}</b></div>}
          <div className="bud-side-row"><span>{fyShort(fy)} budget</span><b>{year.summary?.total > 0 ? usd(year.summary.total) : 'Not set'}</b></div>
          {leftLine('bud-side-row bud-unalloc-side')}
          <div className="bud-side-row"><span>{fyShort(fy - 1)} budget</span><b>{p.priorBudget == null ? 'Not set' : usd(p.priorBudget)}</b></div>
          <div className="bud-side-row"><span>{labels.prior1}</span><b>{usd(p.priorActual)}</b></div>
          <div className="bud-side-row"><span>Platform share</span><b>{usd(totals.platform)} <small>{Math.round(totals.platformShare * 100)}%</small></b></div>
          {running && year.state === 'current' && onOpenYear && <button type="button" className="bud-linkbtn" onClick={() => onOpenYear(fy + 1)}>Open the {fyShort(fy + 1)} proposal</button>}
        </SurfaceCard>
        {owner && running && <MoveLimit limits={p.limits} approvedTotals={cats} onWrite={onWrite} />}
      </aside>
    </div>
  )
}

/** The owner's move limit (item 16): a percent of the receiving category's approved total, capped. */
function MoveLimit({ limits, approvedTotals, onWrite }) {
  const [pct, setPct] = useState(String(limits?.pct ?? 10))
  const [cap, setCap] = useState(String(limits?.cap ?? 500))
  const dirty = Number(pct) !== Number(limits?.pct) || Number(cap) !== Number(limits?.cap)
  const example = approvedTotals.find(c => c.approved)
  return (
    <SurfaceCard className="bud-card">
      <h2>Move Limit</h2>
      <p className="bud-sub">What you may move into a category without asking. Agreed with Margo.</p>
      <div className="bud-limit">
        <label><span>Percent of the receiving category’s approved total</span><input className="bud-input bud-num" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} /></label>
        <label><span>Most per move, in dollars</span><input className="bud-input bud-num" inputMode="decimal" value={cap} onChange={e => setCap(e.target.value)} /></label>
      </div>
      {example && <p className="bud-hint">For {example.name} ({usd(example.approved)} approved) that is up to {usd(moveLimit(example.approved, { pct: Number(pct) || 0, cap: Number(cap) || 0 }))} per move.</p>}
      {dirty && <button type="button" className="bud-btn bud-btn-sm bud-btn-pri" onClick={() => onWrite.run('plan_limits', { pct: Number(pct), cap: Number(cap) })}>Save limit</button>}
    </SurfaceCard>
  )
}
