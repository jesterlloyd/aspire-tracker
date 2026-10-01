// src/components/budget/BudgetReceipts.jsx
//
// PROGRAM-BUDGET Phase B (BUDGET-B3, 2026-09-27): the Receipts tab (prompt B1, B5, B6). Owner only:
// the tab, the upload button and the files never reach Admin or leadership (decision 5), and every
// call behind it is Owner-only on the server too.
//
// Drop receipts anywhere on the tab, or Choose files (or Add receipts in the header). Each file
// becomes a slip at once, uploads straight to private storage, and Keith reads it; the proposal
// replaces the "reading" slip. Nothing posts until Accept. Accept, Snooze and Reject each say so in
// a toast with Undo for 5 seconds, and Undo reverses it on the server.
//
// The slips are the mockup's cards on the page in both styles (Owner, 2026-09-27: "make it like the
// mockup"; the prompt's pressboard is not used). Below the queue: what was snoozed, what was decided recently, and the owner's rules
// and P-card setting.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ReceiptText } from 'lucide-react'
import SurfaceCard from '../ui/SurfaceCard'
import ReceiptSlip, { ReceiptFold, ReplacementSlip } from './ReceiptSlip'
import BudgetFiled from './BudgetFiled'
import SegmentedPicker from '../shared/SegmentedPicker'
import ReceiptOriginal from './ReceiptOriginal'
import { budgetStaff, cachedReceipts, openReceipts, prepareReceiptFile, uploadReceiptFile } from './budgetApi'
import { dateText, fyShort, usd } from '../../lib/budget/budgetModel'
import { receiptChecks } from '../../lib/budget/receiptChecks'
import { refreshKeithProvenance } from '../keith/keithProvenanceStore'

const ACCEPT = 'image/*,application/pdf,.pdf,.eml,message/rfc822,.heic,.heif'
const UNDO_MS = 5000
const FOLDABLE = new Set(['review', 'snoozed'])
// BUDGET-FIXES-1 item 1.4 (Owner, 2026-09-29): one receipt count, the selected year's. Other years are
// named in a quiet line; a receipt with no date is counted in no year and says so.
const filedIn = (d, fy) => (d.filedByYear ? d.filedByYear[String(fy)] || 0 : d.filedCount)
function otherYears(d, fy) {
  return Object.entries(d.filedByYear || {}).filter(([k, n]) => k !== String(fy) && n)
    .sort(([a], [b]) => (a === 'none' ? 1 : b === 'none' ? -1 : Number(b) - Number(a)))
    .map(([k, n]) => (k === 'none' ? `${n} with no date` : `${n} more in ${fyShort(Number(k))}`)).join(' · ')
}
const toContext = (c) => (c ? { ...c, years: new Map(Object.entries(c.years || {}).map(([k, v]) => [Number(k), v])) } : null)

export default function BudgetReceipts({ year, onWrite, pendingFiles, onPendingTaken, onStartYear, onCount, onShowInSheet, onGo = null, openReceipt = null, onOpened = () => {} }) {
  // RECEIPT-ORGANIZER-1 (Owner, 2026-09-27): To Review is the queue, one slip open at a time and the
  // rest folded to a line; Filed is every accepted receipt in folders (BudgetFiled).
  const [view, setView] = useState('review')
  // BUDGET-CONCUR-1: arriving with files (the Sheet's Upload, the header's Add receipts) opens To Review,
  // where they are read, even when nothing else is waiting.
  const withFiles = useRef(!!pendingFiles?.length)
  // RECEIPTS-REDESIGN-1: the Subscriptions grid opens a receipt, which lives in Filed.
  useEffect(() => { if (openReceipt) Promise.resolve().then(() => setView('filed')) }, [openReceipt])
  const [openId, setOpenId] = useState(null)
  const [status, setStatus] = useState(null)        // { enabled, keith }
  const [data, setData] = useState(null)
  const [filed, setFiled] = useState(null)          // this year's Filed, read with the intake
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(() => new Set())
  const [local, setLocal] = useState([])             // slips the browser is still uploading
  const [original, setOriginal] = useState(null)     // { slip, url, content_type, file_name } | { loading }
  const [dragging, setDragging] = useState(false)
  const [askDelete, setAskDelete] = useState(null)   // the rejected receipt whose Delete is being confirmed
  const inputRef = useRef(null)
  const firstLoad = useRef(false)
  const draftTimers = useRef(new Map())
  const notify = onWrite.notify

  const fy = year.fy
  const load = useCallback(async () => {
    // RECEIPTS-SPEED-1: one request for status, intake and Filed. The last answer paints first when
    // the owner comes back to the tab, then the fresh one replaces it.
    const apply = (out) => {
      setStatus(out.status)
      if (!out.status.enabled) return
      const d = out.intake
      setData(d); setFiled(out.filed); setError(null)
      // BUDGET-POLISH-1 (Owner, 2026-09-29): with nothing to review, the tab opens on Filed. Only on the
      // first load, so reviewing the last receipt never moves the page from under you.
      if (!firstLoad.current) { firstLoad.current = true; if (!d.waiting.length && filedIn(d, fy) && !withFiles.current) setView('filed') }
      onCount?.(d.waiting.length)
    }
    try {
      if (!firstLoad.current) { const seen = await cachedReceipts(fy); if (seen) apply(seen) }
      apply(await openReceipts(fy))
    } catch (e) { setError(e.message) }
  }, [onCount, fy])
  useEffect(() => { Promise.resolve().then(load) }, [load])   // load sets state only after its reads
  useEffect(() => { const t = draftTimers.current; return () => { for (const x of t.values()) clearTimeout(x) } }, [])

  const mark = (id, on) => setBusy(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  const replaceSlip = (slip) => setData(d => (d ? { ...d, waiting: d.waiting.some(x => x.id === slip.id) ? d.waiting.map(x => (x.id === slip.id ? { ...x, ...slip } : x)) : [...d.waiting, slip] } : d))

  // ── Adding receipts ──
  const addFiles = useCallback(async (files) => {
    const list = [...(files || [])]
    if (!list.length) return
    for (const raw of list) {
      const temp = { id: `local-${raw.name}-${Math.random().toString(36).slice(2, 8)}`, status: 'uploading', file_name: raw.name, content_type: raw.type }
      setLocal(l => [...l, temp])
      let receipt = null
      try {
        const file = await prepareReceiptFile(raw)
        const started = await budgetStaff('receipt_upload', { file_name: file.name, content_type: file.type, size: file.size })
        receipt = started.receipt
        await uploadReceiptFile(started.upload, file)
        setLocal(l => l.filter(x => x.id !== temp.id))
        replaceSlip({ ...receipt, status: 'reading' })
        const out = await budgetStaff('receipt_read', { id: receipt.id })
        replaceSlip(out.receipt)
      } catch (e) {
        setLocal(l => l.filter(x => x.id !== temp.id))
        if (receipt) replaceSlip({ ...receipt, status: 'failed', read_error: e.message })
        else notify(`${raw.name}: ${e.message}`, 'err')
      }
    }
    load()
  }, [load, notify])
  useEffect(() => {
    if (!pendingFiles?.length || !data) return
    const files = pendingFiles
    // After this effect, not inside it: both calls set state.
    Promise.resolve().then(() => { onPendingTaken?.(); addFiles(files) })
  }, [pendingFiles, data, addFiles, onPendingTaken])

  // ── The slip's edits save themselves ──
  const onDraft = (slip, draft) => {
    replaceSlip({ ...slip, draft })
    const t = draftTimers.current
    clearTimeout(t.get(slip.id))
    // KEITH-FOUNDATION-1: a save that changed Keith's reading moves the Keith mark to Edited.
    t.set(slip.id, setTimeout(() => { budgetStaff('receipt_draft', { id: slip.id, draft }).then(out => { if (out?.keith_state) refreshKeithProvenance(slip.keith_provenance_id) }).catch(e => notify(e.message, 'err')) }, 700))
  }

  // ── Decisions, each with Undo ──
  const decide = async (slip, action, payload, message) => {
    mark(slip.id, true)
    clearTimeout(draftTimers.current.get(slip.id))
    try {
      await budgetStaff(action, { id: slip.id, ...payload })
      setData(d => (d ? { ...d, waiting: d.waiting.filter(x => x.id !== slip.id) } : d))
      refreshKeithProvenance(slip.keith_provenance_id)
      notify(message, 'ok', { label: 'Undo', ms: UNDO_MS, run: async () => { try { await budgetStaff('receipt_undo', { id: slip.id }); refreshKeithProvenance(slip.keith_provenance_id); notify('Undone.'); onWrite.changed(); load() } catch (e) { notify(e.message, 'err') } } })
      onWrite.changed()
      load()
    } catch (e) { notify(e.message, 'err') } finally { mark(slip.id, false) }
  }
  const onAccept = (slip, attachTo, { attachCharge = false, asOneTime = false, moveFrom = null } = {}) => {
    const n = attachTo || attachCharge ? 0 : new Set(slip.draft.lines.map(l => l.category)).size
    return decide(slip, 'receipt_accept', { draft: slip.draft, attach_to: attachTo || null, ...(attachCharge ? { attach_charge: true } : {}), ...(asOneTime ? { as_one_time: true } : {}), ...(moveFrom ? { move_from: moveFrom } : {}) },
      attachCharge ? 'Receipt attached to its subscription charge and filed. Spent did not change.' : attachTo ? `Receipt attached to its row and filed.` : `${moveFrom ? 'Moved inside the limit. ' : ''}${n} ${n === 1 ? 'row' : 'rows'} posted and the receipt filed.`)
  }
  // BUDGET-V2 item 16: over the plan and past the move limit, the receipt waits for Margo.
  const onAmend = async (slip) => {
    mark(slip.id, true)
    try { const out = await budgetStaff('receipt_amend', { id: slip.id, draft: slip.draft }); notify(out.message); onWrite.changed(); load() } catch (e) { notify(e.message, 'err') } finally { mark(slip.id, false) }
  }
  // BUDGET-V2 item 1: hold a receipt for a subscription awaiting approval, one or all at once.
  const onHold = (slip) => decide(slip, 'receipt_hold', { draft: slip.draft }, 'Held. It attaches to its charge when you approve the subscription.')
  const onHoldAll = async () => {
    try { const out = await budgetStaff('receipts_hold_all'); notify(out.message); onWrite.changed(); load() } catch (e) { notify(e.message, 'err') }
  }
  const onUnhold = async (slip) => {
    mark(slip.id, true)
    try { await budgetStaff('receipt_unhold', { id: slip.id }); notify('Back in To Review.'); load() } catch (e) { notify(e.message, 'err') } finally { mark(slip.id, false) }
  }
  // BUDGET-V2 item 5: remember a card (or forget it); the server sets every open receipt on it.
  const onRemember = async (last4, method, remember) => {
    try { const out = await budgetStaff('card_remember', { last4, method, remember }); notify(out.message); load() } catch (e) { notify(e.message, 'err') }
  }
  const onSnooze = (slip) => decide(slip, 'receipt_snooze', {}, 'Snoozed for 7 days.')
  const onReject = (slip) => decide(slip, 'receipt_reject', {}, 'Receipt rejected. Nothing was posted.')
  // REPLACE-REVIEW-1: accept a replacement (it takes its filed receipt's place), put a rejected receipt
  // back in To Review, or delete a rejected one for good.
  const onReplace = async (slip) => {
    mark(slip.id, true)
    clearTimeout(draftTimers.current.get(slip.id))   // the draft goes with the accept; a late save would find the slip gone
    try { const out = await budgetStaff('receipt_replace_accept', { id: slip.id, draft: slip.draft }); notify(out.message); onWrite.changed(); await load() } catch (e) { notify(e.message, 'err'); load() } finally { mark(slip.id, false) }
  }
  // MONTH-CONTROL-1: reopening a month is the Owner's own act, offered where a closed month is in the way.
  const onReopenMonth = async (slip, m) => {
    mark(slip.id, true)
    try {
      // Save what is typed on the slip first: the reload after reopening would otherwise bring back the
      // draft as it was last saved, and an edit made a moment ago would be lost.
      clearTimeout(draftTimers.current.get(slip.id))
      await budgetStaff('receipt_draft', { id: slip.id, draft: slip.draft })
      const out = await budgetStaff('month_reopen', { fiscal_year: m.fy, month: m.key }); notify(out.message); onWrite.changed(); await load()
    } catch (e) { notify(e.message, 'err') } finally { mark(slip.id, false) }
  }
  const onRestore = async (slip) => {
    mark(slip.id, true)
    try { await budgetStaff('receipt_restore', { id: slip.id }); notify('Back in To Review.'); await load() } catch (e) { notify(e.message, 'err') } finally { mark(slip.id, false) }
  }
  const onDelete = async (slip) => {
    mark(slip.id, true)
    try { await budgetStaff('receipt_delete', { id: slip.id }); setAskDelete(null); notify('Receipt deleted for good.'); await load() } catch (e) { notify(e.message, 'err') } finally { mark(slip.id, false) }
  }
  const onRead = async (slip) => {
    mark(slip.id, true)
    replaceSlip({ ...slip, status: 'reading' })
    try { replaceSlip((await budgetStaff('receipt_read', { id: slip.id })).receipt) } catch (e) { replaceSlip({ ...slip, status: 'failed', read_error: e.message }) } finally { mark(slip.id, false) }
  }
  const onDiscard = async (slip) => {
    mark(slip.id, true)
    try { await budgetStaff('receipt_discard', { id: slip.id }); setData(d => ({ ...d, waiting: d.waiting.filter(x => x.id !== slip.id) })) } catch (e) { notify(e.message, 'err') } finally { mark(slip.id, false) }
  }
  const onOriginal = async (slip) => {
    setOriginal({ slip, loading: true })
    try { setOriginal({ slip, ...(await budgetStaff('receipt_file', { id: slip.id })) }) } catch (e) { setOriginal(null); notify(e.message, 'err') }
  }

  if (status && !status.enabled) return <SurfaceCard className="bud-card"><p className="bud-empty">Receipts are not enabled yet. Their database update (20261013000000_budget_receipts.sql) has not been applied.</p></SurfaceCard>
  if (error) return <div className="bud-empty bud-error" role="alert">{error}</div>
  if (!data) return <div className="bud-empty">Loading receipts…</div>

  const ctx = toContext(data.context)
  const categories = ctx.categories.map(c => c.name)
  const waiting = [...local, ...data.waiting]
  // The open slip: the one the owner opened, else the oldest read one. Slips still uploading, reading
  // or failed stay whole (they are short and say what is happening).
  const reviewable = waiting.filter(s => s.draft && FOLDABLE.has(s.status))
  const openKey = reviewable.some(s => s.id === openId) ? openId : reviewable[0]?.id
  const held = data.held || []
  // Before the server sends the full list, the recent ones (the last twelve decided).
  const rejected = data.rejected || data.recent.filter(x => x.status === 'rejected')
  const openSlips = [...data.waiting, ...data.snoozed, ...held]
  const holdable = reviewable.filter(s => receiptChecks(s.draft, { ...ctx, proposal: s.proposal || {} }).subMatch?.kind === 'hold')
  const subName = new Map((ctx.subscriptions || []).map(x => [x.id, x.name]))

  return (
    <div className={`bud-receipts${dragging ? ' bud-dragging' : ''}`}
      onDragOver={e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
      onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}>
      {status?.keith !== 'on' && (
        <div className="bud-check bud-check-warn" role="status">Keith&apos;s Read Receipt skill is off. Turn it on in Settings &gt; Keith &gt; Skills (Activate, then Enable) so Keith can read receipts.</div>
      )}
      {/* RECEIPTS-REDESIGN-1: one compact row. */}
      <SurfaceCard className="bud-drop">
        <ReceiptText size={22} aria-hidden="true" className="bud-drop-icon" />
        <div className="bud-drop-text">
          <b>Drop receipts here.</b>{' '}
          <small>Keith reads each one and proposes rows. Nothing posts until you accept it.</small>
        </div>
        <button type="button" className="bud-btn" onClick={() => inputRef.current?.click()}>Choose files</button>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      </SurfaceCard>

      <div className="bud-viewbar">
        <SegmentedPicker ariaLabel="Receipts view" value={view} onChange={setView}
          options={[{ value: 'review', label: <>To Review<span className="bud-view-n">{waiting.length}</span></> }, { value: 'filed', label: <>Filed<span className="bud-view-n">{filedIn(data, fy)}</span></> }]} />
        <span className="bud-hint">{view === 'review' ? 'One receipt open at a time; the rest wait folded, oldest first.' : 'Open a month, then a receipt, to send it to Concur.'}{otherYears(data, fy) ? ` ${otherYears(data, fy)}.` : ''}</span>
      </div>

      {view === 'filed'
        ? <BudgetFiled key={year.fy} year={year} receipts={filed} notify={notify} onShowInSheet={onShowInSheet} onGo={onGo}
            onReview={(id) => { setOpenId(id); setView('review') }}
            rule={(ctx?.rules || []).find(x => x.key === 'concur_60_days') || null} openReceipt={openReceipt} onOpened={onOpened}
            onChanged={async () => { await load(); onWrite.changed() }} />
        : (<>
      <div className="bud-qhead">
        <h2>Waiting for Review</h2>
        <span>{waiting.length} {waiting.length === 1 ? 'receipt' : 'receipts'} · oldest first · also listed in the Action Center</span>
      </div>
      {holdable.length > 0 && (
        <SurfaceCard className="bud-batch" role="group" aria-label="Receipts for subscriptions awaiting approval">
          <span><b>{holdable.length} {holdable.length === 1 ? 'receipt matches a subscription that is' : 'receipts match subscriptions that are'} awaiting approval.</b> Hold {holdable.length === 1 ? 'it' : 'them together'} now. When you approve a subscription, its receipts attach to their charges in one step.</span>
          <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" onClick={onHoldAll}>Hold all {holdable.length}</button>
        </SurfaceCard>
      )}
      {waiting.length
        ? (
          <div className="bud-slips">
            {waiting.map(s => (s.replaces && s.draft
              ? <ReplacementSlip key={s.id} slip={s} context={ctx} categories={categories} busy={busy.has(s.id)} onDraft={onDraft} onReplace={onReplace} onReject={onReject} onOriginal={onOriginal} onReopen={(m) => onReopenMonth(s, m)} />
              : s.id !== openKey && s.draft && FOLDABLE.has(s.status)
              ? <ReceiptFold key={s.id} slip={s} context={ctx} onOpen={setOpenId} />
              : (
                <ReceiptSlip key={s.id} slip={s} context={ctx} categories={categories} cohorts={year.cohorts} busy={busy.has(s.id)} openSlips={openSlips}
                  onHold={onHold} onRemember={ctx.cardsEnabled ? onRemember : null} onAmend={year.plan?.live ? onAmend : null}
                  onDraft={onDraft} onAccept={onAccept} onSnooze={onSnooze} onReject={onReject} onRead={onRead} onDiscard={onDiscard} onOriginal={onOriginal} onStartYear={onStartYear} />
              )))}
          </div>
        )
        : <SurfaceCard className="bud-card"><p className="bud-empty">Every receipt is reviewed. New uploads appear here.</p></SurfaceCard>}

      {held.length > 0 && (
        <SurfaceCard className="bud-card">
          <h2>Held for Approval</h2>
          <ul className="bud-recent">
            {held.map(s => (
              <li key={s.id}>
                <span className="bud-held-name">{s.draft?.vendor || s.file_name} · {usd(s.proposal?.total)}</span>
                <small>{s.held_amendment_id ? 'Waiting for Margo to decide an amendment' : <>{s.held_charge_date ? `${dateText(s.held_charge_date)} charge · ` : ''}Held until {subName.get(s.held_subscription_id) || 'its subscription'} is approved</>}</small>
                <span className="bud-grow" />
                <button type="button" className="bud-linkbtn" onClick={() => onOriginal(s)}>View original</button>
                <button type="button" className="bud-linkbtn" disabled={busy.has(s.id)} onClick={() => onUnhold(s)}>Back to review</button>
              </li>
            ))}
          </ul>
        </SurfaceCard>
      )}

      {/* Accepted receipts live in Filed now (RECEIPT-ORGANIZER-1); this keeps what Filed does not. */}
      {data.snoozed.length > 0 && (
        <SurfaceCard className="bud-card">
          <h2>Snoozed</h2>
          <ul className="bud-recent">
            {data.snoozed.map(s => <li key={s.id}><span>{s.draft?.vendor || s.file_name} · {usd(s.proposal?.total)}</span><small>Snoozed until {dateText(s.snoozed_until)}</small></li>)}
          </ul>
        </SurfaceCard>
      )}
      {/* REPLACE-REVIEW-1 (Owner, 2026-10-01): every rejected receipt can be viewed, put back or deleted for good. */}
      {rejected.length > 0 && (
        <SurfaceCard className="bud-card">
          <h2>Rejected</h2>
          <p className="bud-sub">Nothing was posted for these. View one, put it back in To Review, or delete its file for good.</p>
          <ul className="bud-recent">
            {rejected.map(s => (
              <li key={s.id}>
                <span>{s.draft?.vendor || s.file_name}{s.proposal?.total != null ? ` · ${usd(s.proposal.total)}` : ''}</span>
                <small>{s.replaces_receipt_id ? 'Replacement · ' : ''}Rejected{s.decided_at ? ` ${dateText(String(s.decided_at).slice(0, 10))}` : ''}</small>
                <span className="bud-grow" />
                {askDelete === s.id ? (
                  <span className="bud-rej-ask" role="alertdialog" aria-label={`Delete ${s.file_name}`}>
                    <span>Delete this file for good? It cannot be brought back.</span>
                    <button type="button" className="bud-btn bud-btn-sm" disabled={busy.has(s.id)} onClick={() => setAskDelete(null)}>Keep it</button>
                    <button type="button" className="bud-btn bud-btn-sm bud-btn-danger" disabled={busy.has(s.id)} onClick={() => onDelete(s)}>{busy.has(s.id) ? 'Deleting…' : 'Delete for good'}</button>
                  </span>
                ) : (<>
                  <button type="button" className="bud-linkbtn" onClick={() => onOriginal(s)}>View original</button>
                  <button type="button" className="bud-linkbtn" disabled={busy.has(s.id)} onClick={() => onRestore(s)}>Back to review</button>
                  <button type="button" className="bud-linkbtn bud-btn-danger" disabled={busy.has(s.id)} onClick={() => setAskDelete(s.id)}>Delete</button>
                </>)}
              </li>
            ))}
          </ul>
        </SurfaceCard>
      )}
        </>)}

      {view === 'review' && <ReceiptRules rules={ctx.rules} pcardLast4={ctx.pcardLast4} notify={notify} onSaved={load} />}

      {original && <ReceiptOriginal original={original} onClose={() => setOriginal(null)} />}
    </div>
  )
}

const TONES = [['block', 'Blocks Accept'], ['warn', 'Warning'], ['info', 'Note']]
const APPLIES = [['all', 'Every payment method'], ['personal_concur', 'Personal (Concur) only']]
const PARAM_LABEL = { remind_after_days: 'Remind after (days)', deadline_days: 'Deadline (days)', limit_pct: 'Limit (%)', limit: 'Limit ($)' }

/** The owner's rules (seeded from the reimbursement policy) and the P-card's last four digits. */
function ReceiptRules({ rules, pcardLast4, notify, onSaved }) {
  const [open, setOpen] = useState(false)
  const [edits, setEdits] = useState({})
  const [last4, setLast4] = useState(pcardLast4 || '')
  const save = async (key) => {
    try { await budgetStaff('policy_rule_save', { key, patch: edits[key] }); setEdits(e => { const n = { ...e }; delete n[key]; return n }); notify('Rule saved.'); onSaved() } catch (e) { notify(e.message, 'err') }
  }
  const saveCard = async () => {
    try { await budgetStaff('budget_settings_save', { pcard_last4: last4 }); notify(last4 ? 'P-card saved. New receipts on that card read as P-card, Paid.' : 'P-card cleared.'); onSaved() } catch (e) { notify(e.message, 'err') }
  }
  const val = (r, k) => (edits[r.key] && k in edits[r.key] ? edits[r.key][k] : r[k])
  const edit = (r, k, v) => setEdits(e => ({ ...e, [r.key]: { ...(e[r.key] || {}), [k]: v } }))
  return (
    <SurfaceCard className="bud-card">
      <button type="button" className="bud-disclose" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <h2>Receipt Rules</h2><small>{rules.filter(r => r.enabled).length} of {rules.length} on · from the Business Expense Reimbursement Policy (effective January 1, 2024)</small>
      </button>
      {open && (
        <div className="bud-rules">
          <div className="bud-rule bud-pcard">
            <label className="bud-fld"><span>P-card last four digits</span>
              <input className="bud-input" inputMode="numeric" maxLength={4} value={last4} placeholder="None on file" onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
            <small>Only the last four are ever stored. With none on file, you choose the payment method on each receipt.</small>
            <button type="button" className="bud-btn bud-btn-sm" disabled={last4 === (pcardLast4 || '') || (last4 && last4.length !== 4)} onClick={saveCard}>Save</button>
          </div>
          {rules.map(r => (
            <div key={r.key} className="bud-rule">
              <label className="bud-rule-on"><input type="checkbox" checked={!!val(r, 'enabled')} onChange={e => edit(r, 'enabled', e.target.checked)} /><b>{r.label}</b></label>
              <div className="bud-rule-row">
                <select className="bud-input" aria-label={`${r.label}: tone`} value={val(r, 'tone')} onChange={e => edit(r, 'tone', e.target.value)}>{TONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <select className="bud-input" aria-label={`${r.label}: applies to`} value={val(r, 'applies_to')} onChange={e => edit(r, 'applies_to', e.target.value)}>{APPLIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                {Object.entries(r.params || {}).filter(([, v]) => !Array.isArray(v)).map(([k, v]) => (
                  <label key={k} className="bud-rule-param"><span>{PARAM_LABEL[k] || k}</span>
                    <input className="bud-input bud-num" inputMode="decimal" value={edits[r.key]?.params?.[k] ?? v} onChange={e => edit(r, 'params', { ...(edits[r.key]?.params || {}), [k]: e.target.value })} /></label>
                ))}
              </div>
              <textarea className="bud-textarea" rows={2} aria-label={`${r.label}: words`} maxLength={400} value={val(r, 'message')} onChange={e => edit(r, 'message', e.target.value)} />
              <small>{r.source}</small>
              {edits[r.key] && <button type="button" className="bud-btn bud-btn-sm bud-btn-pri" onClick={() => save(r.key)}>Save rule</button>}
            </div>
          ))}
        </div>
      )}
    </SurfaceCard>
  )
}
