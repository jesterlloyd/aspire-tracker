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
import ReceiptSlip, { ReceiptFold } from './ReceiptSlip'
import BudgetFiled from './BudgetFiled'
import SegmentedPicker from '../shared/SegmentedPicker'
import ReceiptOriginal from './ReceiptOriginal'
import { budgetStaff, prepareReceiptFile, uploadReceiptFile } from './budgetApi'
import { dateText, usd } from '../../lib/budget/budgetModel'
import { receiptChecks } from '../../lib/budget/receiptChecks'
import { refreshKeithProvenance } from '../keith/keithProvenanceStore'

const ACCEPT = 'image/*,application/pdf,.pdf,.eml,message/rfc822,.heic,.heif'
const UNDO_MS = 5000
const FOLDABLE = new Set(['review', 'snoozed'])
const toContext = (c) => (c ? { ...c, years: new Map(Object.entries(c.years || {}).map(([k, v]) => [Number(k), v])) } : null)

export default function BudgetReceipts({ year, onWrite, pendingFiles, onPendingTaken, onStartYear, onCount, onShowInSheet }) {
  // RECEIPT-ORGANIZER-1 (Owner, 2026-09-27): To Review is the queue, one slip open at a time and the
  // rest folded to a line; Filed is every accepted receipt in folders (BudgetFiled).
  const [view, setView] = useState('review')
  const [openId, setOpenId] = useState(null)
  const [status, setStatus] = useState(null)        // { enabled, keith }
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(() => new Set())
  const [local, setLocal] = useState([])             // slips the browser is still uploading
  const [original, setOriginal] = useState(null)     // { slip, url, content_type, file_name } | { loading }
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const draftTimers = useRef(new Map())
  const notify = onWrite.notify

  const load = useCallback(async () => {
    try {
      const st = await budgetStaff('receipts_status')
      setStatus(st)
      if (!st.enabled) return
      const d = await budgetStaff('receipts_intake')
      setData(d); setError(null)
      onCount?.(d.waiting.length)
    } catch (e) { setError(e.message) }
  }, [onCount])
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
  const onAccept = (slip, attachTo, { attachCharge = false, asOneTime = false } = {}) => {
    const n = attachTo || attachCharge ? 0 : new Set(slip.draft.lines.map(l => l.category)).size
    return decide(slip, 'receipt_accept', { draft: slip.draft, attach_to: attachTo || null, ...(attachCharge ? { attach_charge: true } : {}), ...(asOneTime ? { as_one_time: true } : {}) },
      attachCharge ? 'Receipt attached to its subscription charge and filed. Spent did not change.' : attachTo ? `Receipt attached to its row and filed.` : `${n} ${n === 1 ? 'row' : 'rows'} posted and the receipt filed.`)
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
  // BUDGET-V2 item 11: a receipt in a closed month asks for the month to be reopened first.
  const onReopen = async ({ fy, month }) => {
    try { const out = await budgetStaff('month_reopen', { fiscal_year: fy, month }); notify(out.message); onWrite.changed(); load() } catch (e) { notify(e.message, 'err') }
  }
  // BUDGET-V2 item 5: remember a card (or forget it); the server sets every open receipt on it.
  const onRemember = async (last4, method, remember) => {
    try { const out = await budgetStaff('card_remember', { last4, method, remember }); notify(out.message); load() } catch (e) { notify(e.message, 'err') }
  }
  const onSnooze = (slip) => decide(slip, 'receipt_snooze', {}, 'Snoozed for 7 days.')
  const onReject = (slip) => decide(slip, 'receipt_reject', {}, 'Receipt rejected. Nothing was posted.')
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
      <SurfaceCard className="bud-drop">
        <ReceiptText size={26} aria-hidden="true" className="bud-drop-icon" />
        <div className="bud-drop-text">
          <b>Drop receipts here</b>
          <small>Photos, PDFs or saved order emails. Keith reads each one, proposes rows, categories and the payment method, and checks for duplicates and the reimbursement policy. Nothing posts until you accept it.</small>
        </div>
        <button type="button" className="bud-btn" onClick={() => inputRef.current?.click()}>Choose files</button>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        <span className="bud-drop-count bud-path">Program Budget · {data.filedCount} filed</span>
      </SurfaceCard>

      <div className="bud-viewbar">
        <SegmentedPicker ariaLabel="Receipts view" value={view} onChange={setView}
          options={[{ value: 'review', label: <>To Review<span className="bud-view-n">{waiting.length}</span></> }, { value: 'filed', label: <>Filed<span className="bud-view-n">{data.filedCount}</span></> }]} />
        <span className="bud-hint">{view === 'review' ? 'One receipt open at a time; the rest wait folded, oldest first.' : 'Every accepted receipt, drawn the same way, in folders. Open a folder, then a receipt, to see what it posted.'}</span>
      </div>

      {view === 'filed'
        ? <BudgetFiled key={`${year.fy}-${data.filedCount}`} year={year} notify={notify} onShowInSheet={onShowInSheet} />
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
            {waiting.map(s => (s.id !== openKey && s.draft && FOLDABLE.has(s.status)
              ? <ReceiptFold key={s.id} slip={s} context={ctx} onOpen={setOpenId} />
              : (
                <ReceiptSlip key={s.id} slip={s} context={ctx} categories={categories} cohorts={year.cohorts} busy={busy.has(s.id)} openSlips={openSlips}
                  onHold={onHold} onRemember={ctx.cardsEnabled ? onRemember : null} onReopen={onReopen}
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
                <small>{s.held_charge_date ? `${dateText(s.held_charge_date)} charge · ` : ''}Held until {subName.get(s.held_subscription_id) || 'its subscription'} is approved</small>
                <span className="bud-grow" />
                <button type="button" className="bud-linkbtn" onClick={() => onOriginal(s)}>View original</button>
                <button type="button" className="bud-linkbtn" disabled={busy.has(s.id)} onClick={() => onUnhold(s)}>Back to review</button>
              </li>
            ))}
          </ul>
        </SurfaceCard>
      )}

      {/* Accepted receipts live in Filed now (RECEIPT-ORGANIZER-1); this keeps what Filed does not. */}
      {(data.snoozed.length > 0 || data.recent.some(s => s.status === 'rejected')) && (
        <SurfaceCard className="bud-card">
          <h2>Snoozed and Rejected</h2>
          <ul className="bud-recent">
            {data.snoozed.map(s => <li key={s.id}><span>{s.draft?.vendor || s.file_name} · {usd(s.proposal?.total)}</span><small>Snoozed until {dateText(s.snoozed_until)}</small></li>)}
            {data.recent.filter(s => s.status === 'rejected').map(s => (
              <li key={s.id}>
                <span>{s.draft?.vendor || s.file_name} · {usd(s.proposal?.total)}</span>
                <small>Rejected{s.decided_at ? ` ${dateText(String(s.decided_at).slice(0, 10))}` : ''}</small>
                <span className="bud-grow" />
                <button type="button" className="bud-linkbtn" onClick={() => onOriginal(s)}>View original</button>
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
