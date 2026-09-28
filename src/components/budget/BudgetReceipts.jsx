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
// In Classic style the slips sit on the Review & Release pressboard (prompt B5); Modern turns the
// board off. Below the queue: what was snoozed, what was decided recently, and the owner's rules
// and P-card setting.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ReceiptText } from 'lucide-react'
import SurfaceCard from '../ui/SurfaceCard'
import ReceiptSlip from './ReceiptSlip'
import ReceiptOriginal from './ReceiptOriginal'
import { budgetStaff, prepareReceiptFile, uploadReceiptFile } from './budgetApi'
import { dateText, usd } from '../../lib/budget/budgetModel'

const ACCEPT = 'image/*,application/pdf,.pdf,.eml,message/rfc822,.heic,.heif'
const UNDO_MS = 5000
const toContext = (c) => (c ? { ...c, years: new Map(Object.entries(c.years || {}).map(([k, v]) => [Number(k), v])) } : null)

export default function BudgetReceipts({ year, onWrite, pendingFiles, onPendingTaken, onStartYear, onCount }) {
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
    t.set(slip.id, setTimeout(() => { budgetStaff('receipt_draft', { id: slip.id, draft }).catch(e => notify(e.message, 'err')) }, 700))
  }

  // ── Decisions, each with Undo ──
  const decide = async (slip, action, payload, message) => {
    mark(slip.id, true)
    clearTimeout(draftTimers.current.get(slip.id))
    try {
      await budgetStaff(action, { id: slip.id, ...payload })
      setData(d => (d ? { ...d, waiting: d.waiting.filter(x => x.id !== slip.id) } : d))
      notify(message, 'ok', { label: 'Undo', ms: UNDO_MS, run: async () => { try { await budgetStaff('receipt_undo', { id: slip.id }); notify('Undone.'); onWrite.changed(); load() } catch (e) { notify(e.message, 'err') } } })
      onWrite.changed()
      load()
    } catch (e) { notify(e.message, 'err') } finally { mark(slip.id, false) }
  }
  const onAccept = (slip, attachTo) => {
    const n = attachTo ? 0 : new Set(slip.draft.lines.map(l => l.category)).size
    return decide(slip, 'receipt_accept', { draft: slip.draft, attach_to: attachTo || null },
      attachTo ? `Receipt attached to its row and filed.` : `${n} ${n === 1 ? 'row' : 'rows'} posted and the receipt filed.`)
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
          <b>Drop Receipts Here</b>
          <small>Photos, PDFs or saved order emails. Keith reads each one, proposes rows, categories and the payment method, and checks for duplicates and the reimbursement policy. Nothing posts until you accept it.</small>
        </div>
        <button type="button" className="bud-btn" onClick={() => inputRef.current?.click()}>Choose files</button>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        <span className="bud-drop-count">Program Budget · {data.filedCount} filed</span>
      </SurfaceCard>

      <div className="bud-qhead">
        <h2>Waiting for Review</h2>
        <span>{waiting.length} {waiting.length === 1 ? 'receipt' : 'receipts'} · oldest first · also listed in the Action Center</span>
      </div>
      {waiting.length
        ? (
          <div className="bud-rboard">
            <div className="bud-slips">
              {waiting.map(s => (
                <ReceiptSlip key={s.id} slip={s} context={ctx} categories={categories} cohorts={year.cohorts} busy={busy.has(s.id)}
                  onDraft={onDraft} onAccept={onAccept} onSnooze={onSnooze} onReject={onReject} onRead={onRead} onDiscard={onDiscard} onOriginal={onOriginal} onStartYear={onStartYear} />
              ))}
            </div>
          </div>
        )
        : <SurfaceCard className="bud-card"><p className="bud-empty">Every receipt is reviewed. New uploads appear here.</p></SurfaceCard>}

      {(data.snoozed.length > 0 || data.recent.length > 0) && (
        <SurfaceCard className="bud-card">
          <h2>Snoozed and Recently Decided</h2>
          <ul className="bud-recent">
            {data.snoozed.map(s => <li key={s.id}><span>{s.draft?.vendor || s.file_name} · {usd(s.proposal?.total)}</span><small>Snoozed until {dateText(s.snoozed_until)}</small></li>)}
            {data.recent.map(s => (
              <li key={s.id}>
                <span>{s.draft?.vendor || s.file_name} · {usd(s.proposal?.total)}</span>
                <small>{s.status === 'accepted' ? `${s.attached ? 'Attached' : `${s.expense_ids.length} ${s.expense_ids.length === 1 ? 'row' : 'rows'} posted`} · ${s.filed_name}` : 'Rejected'}</small>
                <span className="bud-grow" />
                <button type="button" className="bud-linkbtn" onClick={() => onOriginal(s)}>View original</button>
              </li>
            ))}
          </ul>
        </SurfaceCard>
      )}

      <ReceiptRules rules={ctx.rules} pcardLast4={ctx.pcardLast4} notify={notify} onSaved={load} />

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
