// src/components/budget/BudgetFiled.jsx
//
// RECEIPT-ORGANIZER-1 (Owner, 2026-09-27): Program Budget > Receipts > Filed, every accepted receipt of
// the fiscal year, drawn the same way, in folders. Reference: the receipt organizer mockup the Owner
// approved the same day.
//
// - Group by Month (default), Category, Vendor or Status. Every folder starts CLOSED, and changing the
//   grouping closes them all again (Owner: "I need to open them to launch them"). A closed folder is a
//   folder card in a grid, its three newest receipts tucked in with their tops showing; an open one
//   takes the whole row and lays its receipts out newest first.
// - A receipt split across categories sits in each of its category folders with "Split · $X here", so
//   every folder adds up to its own spend (filedFolders in src/lib/budget/receiptModel.js).
// - Clicking a receipt opens the side panel: the drawn receipt, the Sheet rows it posted, payment,
//   status, the filed name, a meal's purpose and attendees, and View original, Show in Sheet, Download.
// - No frame around a receipt: on hover (and keyboard focus) the paper itself lifts.
// Classic draws the folders as the manila folder of Evaluation > Responses; Modern as plain cards.
import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import SurfaceCard from '../ui/SurfaceCard'
import DetailDrawer from '../ui/DetailDrawer'
import SegmentedPicker from '../shared/SegmentedPicker'
import { ReceiptPaper } from './ReceiptSlip'
import ReceiptOriginal from './ReceiptOriginal'
import { budgetStaff } from './budgetApi'
import { filedFolders, FILED_GROUPS } from '../../lib/budget/receiptModel'
import { usd, dateText, fyShort, fiscalYearOfDate } from '../../lib/budget/budgetModel'

const STATUS_TONE = { recorded: 'low', submitted: 'medium', reimbursed: 'high', paid: 'high', void: 'medium' }
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export default function BudgetFiled({ year, notify, onShowInSheet }) {
  const [receipts, setReceipts] = useState(null)
  const [error, setError] = useState(null)
  const [groupBy, setGroupBy] = useState('month')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => new Set())   // folder keys the owner opened; none by default
  const [panel, setPanel] = useState(null)             // the receipt in the side panel
  const [original, setOriginal] = useState(null)

  useEffect(() => {
    let live = true
    budgetStaff('receipts_filed', { fiscal_year: year.fy })
      .then(out => { if (live) { setReceipts(out.receipts || []); setError(null) } })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [year.fy])

  const folders = useMemo(() => filedFolders(receipts || [], { groupBy, query }), [receipts, groupBy, query])
  const shown = useMemo(() => [...new Map(folders.flatMap(f => f.entries.map(e => [e.receipt.id, e.receipt]))).values()], [folders])

  const regroup = (g) => { setGroupBy(g); setOpen(new Set()) }
  const toggle = (key) => setOpen(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const viewOriginal = async (r, download = false) => {
    if (!download) setOriginal({ slip: { file_name: r.filed_name || r.vendor }, loading: true })
    try {
      const out = await budgetStaff('receipt_file', { id: r.id, download })
      if (download) window.location.assign(out.url)
      else setOriginal({ slip: { file_name: r.filed_name || r.vendor }, ...out })
    } catch (e) { setOriginal(null); notify(e.message, 'err') }
  }

  if (error) return <div className="bud-empty bud-error" role="alert">{error}</div>
  if (!receipts) return <div className="bud-empty">Loading filed receipts…</div>
  if (!receipts.length) return <SurfaceCard className="bud-card"><p className="bud-empty">No receipts filed in {fyShort(year.fy)} yet. Accepted receipts appear here, in folders.</p></SurfaceCard>

  return (
    <div className="bud-filed">
      <div className="bud-filed-tools">
        <span className="bud-filed-group"><span>Group by</span>
          <SegmentedPicker ariaLabel="Group filed receipts by" options={FILED_GROUPS.map(g => ({ value: g.key, label: g.label }))} value={groupBy} onChange={regroup} /></span>
        <label className="bud-filed-search"><Search size={15} aria-hidden="true" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search vendor, item or order number" aria-label="Search filed receipts" /></label>
        <span className="bud-filed-sum"><b>{shown.length}</b> {shown.length === 1 ? 'receipt' : 'receipts'} · <b>{usd(shown.reduce((a, r) => a + (Number(r.total) || 0), 0))}</b> · {fyShort(year.fy)}</span>
      </div>

      {folders.length
        ? (
          <div className="bud-folders">
            {folders.map(f => (open.has(f.key)
              ? (
                <section key={f.key} className="bud-folder bud-folder-open" aria-label={f.key}>
                  <button type="button" className="bud-folder-head" aria-expanded="true" onClick={() => toggle(f.key)}>
                    <span className="bud-folder-tab">{f.key}</span>
                    <span className="bud-folder-meta">{plural(f.count, 'receipt')}</span>
                    <span className="bud-folder-tot">{usd(f.total)}</span>
                    <span className="bud-folder-close">Close</span>
                  </button>
                  <div className="bud-tiles">
                    {f.entries.map(e => <FiledTile key={`${f.key}-${e.receipt.id}`} entry={e} groupBy={groupBy} onOpen={() => setPanel(e.receipt)} />)}
                  </div>
                </section>
              )
              : (
                <button key={f.key} type="button" className="bud-fcard" aria-expanded="false" onClick={() => toggle(f.key)}
                  aria-label={`Open ${f.key}: ${plural(f.count, 'receipt')}, ${usd(f.total)}`}>
                  <span className="bud-fcard-peek" aria-hidden="true">
                    {f.entries.slice(0, 3).map(e => <ReceiptPaper key={e.receipt.id} proposal={e.receipt.proposal} size="sm" />)}
                  </span>
                  <span className="bud-fcard-front">
                    <b>{f.key}</b>
                    <small>{plural(f.count, 'receipt')}</small>
                    <span className="bud-fcard-tot">{usd(f.total)}</span>
                  </span>
                </button>
              )))}
          </div>
        )
        : <SurfaceCard className="bud-card"><p className="bud-empty">No filed receipts match.</p></SurfaceCard>}

      {panel && (
        <DetailDrawer open title={`${panel.vendor} · ${usd(panel.total)}`} onClose={() => setPanel(null)} width={520}
          footer={(<>
            <button type="button" className="bud-btn bud-btn-sm" onClick={() => viewOriginal(panel, true)}>Download</button>
            <button type="button" className="bud-btn bud-btn-sm" disabled={!panel.rows.length} onClick={() => { const r = panel; setPanel(null); onShowInSheet(r) }}>Show in Sheet</button>
            <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" onClick={() => viewOriginal(panel)}>View original</button>
          </>)}>
          <FiledDetail receipt={panel} />
        </DetailDrawer>
      )}
      {original && <ReceiptOriginal original={original} onClose={() => setOriginal(null)} />}
    </div>
  )
}

/** One receipt in an open folder: the paper (which lifts on hover), and its line. */
function FiledTile({ entry, groupBy, onOpen }) {
  const r = entry.receipt
  const cats = [...new Set(r.rows.map(x => x.category).filter(Boolean))]
  const status = r.rows[0]
  const meal = r.rows.some(x => x.business_purpose || x.attendees?.length)
  return (
    <button type="button" className="bud-ftile" onClick={onOpen} aria-label={`${r.vendor}, ${usd(r.total)}, ${r.date ? dateText(r.date) : 'no date'}`}>
      <span className="bud-ftile-paper"><ReceiptPaper proposal={r.proposal} size="md" /></span>
      <span className="bud-ftile-cap">
        <b>{r.vendor} · {usd(r.total)}</b>
        <small>{r.date ? dateText(r.date) : 'No date'}</small>
        <span className="bud-ftile-tags">
          {groupBy !== 'category' && cats.length > 0 && <span className="bud-conf bud-conf-grey">{cats.length > 1 ? `${cats.length} categories` : cats[0]}</span>}
          {entry.part != null && <span className="bud-conf bud-conf-medium">Split · {usd(entry.part)} here</span>}
          {r.attached && <span className="bud-conf bud-conf-grey">Attached</span>}
          {meal && <span className="bud-conf bud-conf-high">Meal · documented</span>}
          {groupBy !== 'status' && status && <span className={`bud-conf bud-conf-${STATUS_TONE[status.status] || 'grey'}`}>{status.statusLabel}</span>}
        </span>
      </span>
    </button>
  )
}

/** The side panel's body: what the receipt is and what it did to the ledger. */
function FiledDetail({ receipt: r }) {
  const meal = r.rows.find(x => x.business_purpose || x.attendees?.length)
  const fy = r.date ? fyShort(fiscalYearOfDate(r.date)) : 'FY'
  return (
    <div className="bud-fdetail">
      <p className="bud-sub">{[r.date ? dateText(r.date) : 'No date', fy, r.order_number ? `Order or invoice ${r.order_number}` : null].filter(Boolean).join(' · ')}</p>
      <div className="bud-fdetail-paper"><ReceiptPaper proposal={r.proposal} /></div>
      <div>
        <h3>{r.attached ? 'Attached to the Sheet' : 'Posted to the Sheet'}</h3>
        {r.rows.length
          ? (
            <ul className="bud-fdetail-rows">
              {r.rows.map(x => (
                <li key={x.id}><span className="rl">{x.row_label || 'Row'}</span><span>{x.item || 'No item'}<small>{x.category || 'No category'}</small></span><b>{usd(x.amount)}</b></li>
              ))}
            </ul>
          )
          : <p className="bud-hint">The rows this receipt posted have since been deleted from the Sheet.</p>}
      </div>
      <dl className="bud-fdetail-kv">
        <dt>Payment</dt><dd>{r.rows[0]?.payment || 'Not recorded'}</dd>
        <dt>Status</dt><dd>{r.rows[0] ? <span className={`bud-conf bud-conf-${STATUS_TONE[r.rows[0].status] || 'grey'}`}>{r.rows[0].statusLabel}</span> : 'None'}</dd>
        <dt>Filed as</dt><dd><code className="bud-path">Program Budget › {fy} › Receipts › {r.filed_name}</code></dd>
        {meal && (<>
          <dt>Business purpose</dt><dd>{meal.business_purpose || 'Not recorded'}</dd>
          <dt>Attendees</dt><dd>{(meal.attendees || []).length ? meal.attendees.map((a, i) => <span key={i} className="bud-att-line">{[a.name, a.title, a.organization, a.relationship].filter(Boolean).join(', ')}</span>) : 'Not recorded'}</dd>
        </>)}
        <dt>Accepted</dt><dd>{r.decided_at ? new Date(r.decided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}{r.decided_by ? ` by ${r.decided_by}` : ''}</dd>
      </dl>
    </div>
  )
}
