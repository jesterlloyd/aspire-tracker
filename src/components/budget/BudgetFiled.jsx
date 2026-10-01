// src/components/budget/BudgetFiled.jsx
//
// Budget Tracker > Receipts > Filed. RECEIPTS-REDESIGN-1 (Owner, 2026-10-01) rebuilt it around one
// question about every receipt: has it been submitted to Concur, and is it late? Reference:
// docs/mockups/receipts-redesign.html. One drawing in both styles (Owner, 2026-10-01): the manila
// folders of RECEIPT-ORGANIZER-1 are retired.
//
// - A status strip for the fiscal year: filed, submitted to Concur, past the 60-day limit, due in the
//   next 14 days. Only Personal (Concur) receipts are counted: a P-card receipt never needs Concur.
// - Group by Month (default), Vendor, Stage or Category. Every folder still starts CLOSED and changing
//   the grouping closes them all (Owner, 2026-09-27: "I need to open them to launch them"). A closed
//   folder is a tan card: up to five small receipts with a LATE or SOON tab, its count and total, its
//   progress and its late and due-soon chips. An open one takes the whole row.
// - A month that still has unsubmitted Personal (Concur) receipts offers Submit [Month] to Concur,
//   which walks them in the modal, oldest first.
// - Receipts stay white; what holds them is the tan paper of Rotation > Activity (.bud-holder).
// - A card is a button named in full ("Vercel Inc., $20.00, Sep 1, 2026, not submitted, 30 days left"),
//   with the stage chip and, while it is not submitted, how long it has. Stamps and LATE tabs are
//   decoration; the chips carry the meaning in words.
// - A receipt split across categories still sits in each of its category folders with "Split · $X here"
//   (filedFolders in src/lib/budget/receiptModel.js).
// Every figure and word is from src/lib/budget/filedModel.js; the receipt itself opens in ReceiptModal.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Send } from 'lucide-react'
import SurfaceCard from '../ui/SurfaceCard'
import SegmentedPicker from '../shared/SegmentedPicker'
import { ReceiptPaper } from './ReceiptSlip'
import ReceiptOriginal from './ReceiptOriginal'
import ReceiptModal, { PaperMark } from './ReceiptModal'
import { budgetStaff } from './budgetApi'
import { filedFolders, FILED_GROUPS } from '../../lib/budget/receiptModel'
import { usd, dateText, fyShort, pacificToday } from '../../lib/budget/budgetModel'
import { filedStats, folderSummary, folderChips, stageChips, cardLabel, isLate, isSoon, subscriptionGrid } from '../../lib/budget/filedModel'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const TILTS = [-0.8, 0.6, -0.4, 0.7, -0.6]
const shortDate = (ymd) => (ymd ? dateText(ymd).replace(/, \d{4}$/, '') : '')
const Bar = ({ pct, label }) => <span className="bud-bar" role="img" aria-label={label}><i style={{ width: `${pct}%` }} /></span>

export default function BudgetFiled({ year, receipts: given, notify, onShowInSheet, onGo = null, onChanged = async () => {}, rule = null, onReview = null, openReceipt = null, onOpened = () => {} }) {
  // RECEIPTS-SPEED-1: the Receipts tab reads Filed with its intake and hands it down; a caller that
  // does not still gets it read here.
  const [fetched, setReceipts] = useState(null)
  const receipts = given ?? fetched
  const [error, setError] = useState(null)
  const [groupBy, setGroupBy] = useState('month')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => new Set())   // folder keys the owner opened; none by default
  const [modal, setModal] = useState(null)             // { id, folder, batch: { label, ids } | null }
  const [original, setOriginal] = useState(null)
  const opener = useRef(null)

  useEffect(() => {
    if (given !== undefined) return undefined
    let live = true
    budgetStaff('receipts_filed', { fiscal_year: year.fy })
      .then(out => { if (live) { setReceipts(out.receipts || []); setError(null) } })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [year.fy, given])

  const stats = useMemo(() => filedStats(receipts || []), [receipts])
  const folders = useMemo(() => filedFolders(receipts || [], { groupBy, query }), [receipts, groupBy, query])
  const shown = useMemo(() => [...new Map(folders.flatMap(f => f.entries.map(e => [e.receipt.id, e.receipt]))).values()], [folders])
  // The months of each subscription, for the modal's "bills monthly" card.
  const grid = useMemo(() => subscriptionGrid({ subscriptions: year.subscriptions || [], expenses: year.expenses || [], receipts: receipts || [], fy: year.fy, today: pacificToday(), rule }), [year, receipts, rule])

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
  const openModal = (id, folder, batch = null) => { opener.current = document.activeElement; setModal({ id, folder, batch }) }
  const closeModal = () => {
    const id = modal?.id
    setModal(null)
    // Focus goes back to the receipt that opened the modal (or to whatever did, if it has gone).
    setTimeout(() => { const back = (id && document.querySelector(`[data-receipt="${id}"]`)) || opener.current; back?.focus?.() }, 0)
  }
  // The Subscriptions grid opens a receipt here: its month folder opens, then the modal.
  useEffect(() => {
    if (!openReceipt || !receipts) return
    const hit = filedFolders(receipts, { groupBy: 'month' }).find(f => f.entries.some(e => e.receipt.id === openReceipt))
    if (hit) { Promise.resolve().then(() => { setGroupBy('month'); setQuery(''); setOpen(new Set([hit.key])); setModal({ id: openReceipt, folder: hit.key, batch: null }) }) }
    onOpened()
  }, [openReceipt, receipts, onOpened])

  if (error) return <div className="bud-empty bud-error" role="alert">{error}</div>
  if (!receipts) return <div className="bud-empty">Loading filed receipts…</div>
  if (!receipts.length) return <SurfaceCard className="bud-card"><p className="bud-empty">No receipts filed in {fyShort(year.fy)} yet. Accepted receipts appear here, in folders.</p></SurfaceCard>

  const modalFolder = modal ? folders.find(f => f.key === modal.folder) || filedFolders(receipts, { groupBy }).find(f => f.entries.some(e => e.receipt.id === modal.id)) : null
  const modalList = modalFolder ? [...new Map(modalFolder.entries.map(e => [e.receipt.id, e.receipt])).values()] : []
  const modalReceipt = modal ? receipts.find(x => x.id === modal.id) : null
  const subRow = modalReceipt?.subscription ? grid.rows.find(x => x.id === modalReceipt.subscription.id) || null : null

  return (
    <div className="bud-filed">
      <div className="bud-fstats" role="group" aria-label={`Receipts filed in ${fyShort(year.fy)}`}>
        <div className="bud-fstat"><span className="k">Filed in {fyShort(year.fy)}</span><span className="v">{usd(stats.total)}</span><span className="s">{plural(stats.count, 'receipt')}</span></div>
        <div className="bud-fstat"><span className="k">Submitted to Concur</span><span className="v">{stats.submitted} of {stats.concur}</span><Bar pct={stats.pct} label={`${stats.submitted} of ${stats.concur} submitted to Concur`} /></div>
        <div className={`bud-fstat${stats.late ? ' late' : ''}`}><span className="k">Past the 60-day limit</span><span className="v">{plural(stats.late, 'receipt')}</span><span className="s">{stats.late ? stats.lateWhere : 'Nothing is late'}</span></div>
        <div className={`bud-fstat${stats.soon ? ' soon' : ''}`}><span className="k">Due in the next 14 days</span><span className="v">{plural(stats.soon, 'receipt')}</span><span className="s">{stats.soon ? `Next: ${shortDate(stats.soonNext)}` : 'Nothing due soon'}</span></div>
      </div>

      <div className="bud-filed-tools">
        <span className="bud-filed-group"><span>Group by</span>
          <SegmentedPicker ariaLabel="Group filed receipts by" options={FILED_GROUPS.map(g => ({ value: g.key, label: g.label }))} value={groupBy} onChange={regroup} /></span>
        {onGo && <button type="button" className="bud-linkbtn" onClick={() => onGo('subscriptions')}>Subscriptions by month →</button>}
        <label className="bud-filed-search"><Search size={15} aria-hidden="true" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search vendor, item or order number" aria-label="Search filed receipts" /></label>
      </div>

      {folders.length
        ? (
          <div className="bud-folders">
            {folders.map(f => {
              const sum = folderSummary(f.entries)
              const chips = folderChips(sum)
              const progress = sum.concur ? `${sum.submitted} of ${sum.concur} submitted` : 'Nothing for Concur'
              return open.has(f.key)
                ? (
                  <section key={f.key} className="bud-month bud-holder" aria-label={f.key}>
                    <div className="bud-month-head">
                      <h2>{f.key}</h2>
                      <span className="meta">{plural(f.count, 'receipt')} · {usd(f.total)}</span>
                      {sum.concur > 0 && <span className="prog"><Bar pct={sum.pct} label={progress} />{progress}</span>}
                      {sum.concur > 0 && <span className="meta">{sum.allSubmitted ? 'All submitted' : sum.nextDue ? `Next due ${shortDate(sum.nextDue)}` : ''}</span>}
                      <span className="bud-grow" />
                      {groupBy === 'month' && sum.open > 0 && (
                        <button type="button" className="bud-btn bud-btn-pri" onClick={() => openModal(sum.openIds[0], f.key, { label: f.key.replace(/ \d{4}$/, ''), ids: sum.openIds })}>
                          <Send size={16} aria-hidden="true" />Submit {f.key.replace(/ \d{4}$/, '')} to Concur
                        </button>
                      )}
                      <button type="button" className="bud-btn" aria-expanded="true" onClick={() => toggle(f.key)}>Close</button>
                    </div>
                    <div className="bud-tiles">
                      {f.entries.map((e, i) => <FiledTile key={`${f.key}-${e.receipt.id}`} entry={e} tilt={TILTS[i % TILTS.length]} onOpen={() => openModal(e.receipt.id, f.key)} />)}
                    </div>
                  </section>
                )
                : (
                  <button key={f.key} type="button" className="bud-fcard bud-holder" aria-expanded="false" onClick={() => toggle(f.key)}
                    aria-label={`Open ${f.key}: ${plural(f.count, 'receipt')}, ${usd(f.total)}${sum.concur ? `, ${progress}` : ''}${chips.length ? `, ${chips.map(c => c.text).join(', ')}` : ''}`}>
                    <span className="bud-fcard-minis" aria-hidden="true">
                      {f.entries.slice(0, 5).map(e => (
                        <span key={e.receipt.id} className="bud-mini">
                          <ReceiptPaper proposal={e.receipt.proposal} size="xs" />
                          {isLate(e.receipt) ? <b className="late">LATE</b> : isSoon(e.receipt) ? <b className="soon">SOON</b> : null}
                        </span>
                      ))}
                    </span>
                    <span className="bud-fcard-row"><strong>{f.key}</strong><span>{plural(f.count, 'receipt')}</span><em>{usd(f.total)}</em></span>
                    {sum.concur > 0 && <span className="bud-fcard-prog"><Bar pct={sum.pct} label={progress} /><span>{progress}</span></span>}
                    {chips.length > 0 && <span className="bud-chips">{chips.map(c => <span key={c.text} className={`bud-chip bud-chip-${c.tone}`}>{c.text}</span>)}</span>}
                  </button>
                )
            })}
          </div>
        )
        : <SurfaceCard className="bud-card"><p className="bud-empty">No filed receipts match.</p></SurfaceCard>}
      <p className="bud-filed-sum"><b>{shown.length}</b> {shown.length === 1 ? 'receipt' : 'receipts'} shown · <b>{usd(shown.reduce((a, r) => a + (Number(r.total) || 0), 0))}</b> · {fyShort(year.fy)}</p>

      {modalReceipt && (
        <ReceiptModal key="receipt-modal" receipt={modalReceipt} list={modalList} where={modal.folder} batch={modal.batch} subRow={subRow} months={grid.months}
          notify={notify} onChanged={onChanged} onClose={closeModal}
          onNavigate={(id) => setModal(m => ({ ...m, id }))}
          onBatchDone={() => { const label = modal.batch?.label; closeModal(); notify(`${label} submitted to Concur.`) }}
          onOriginal={viewOriginal}
          onShowInSheet={(r) => { setModal(null); onShowInSheet(r) }}
          onSubscriptions={() => { setModal(null); onGo?.('subscriptions') }}
          onReview={(id) => { setModal(null); onReview?.(id) }} />
      )}
      {original && <ReceiptOriginal original={original} onClose={() => setOriginal(null)} />}
    </div>
  )
}

/** One receipt in an open folder: the white paper with its stamp or LATE tab, its line, and its chips. */
function FiledTile({ entry, tilt, onOpen }) {
  const r = entry.receipt
  return (
    <button type="button" className="bud-ftile" data-receipt={r.id} onClick={onOpen} aria-label={cardLabel(r)}>
      <span className="bud-ftile-paper" style={{ '--tilt': `${tilt}deg` }}><ReceiptPaper proposal={r.proposal} size="md" /><PaperMark receipt={r} /></span>
      <span className="bud-ftile-cap"><span>{r.vendor}</span><b>{usd(entry.part ?? r.total)}</b></span>
      <span className="bud-chips">
        {stageChips(r).map(c => <span key={c.text} className={`bud-chip bud-chip-${c.tone}`}>{c.text}</span>)}
        {entry.part != null && <span className="bud-chip bud-chip-due">Split · {usd(entry.part)} here</span>}
      </span>
    </button>
  )
}
