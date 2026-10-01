// src/components/budget/ReceiptModal.jsx
//
// RECEIPTS-REDESIGN-1 (Owner, 2026-10-01): a filed receipt, opened. Two columns: the drawn receipt on
// tan paper on the left (with its stamp or LATE tab, Download and View original, and the months of the
// subscription it belongs to), and the work on the right, in the order it is done: the deadline, Keith's
// policy check, the Concur entry as a copy checklist, and Details (collapsed). One primary button in the
// footer follows the stage. Reference: docs/mockups/receipts-redesign.html.
//
// - Every word and state comes from src/lib/budget/filedModel.js; nothing is computed here.
// - A stage change goes through receipt_stage, which moves the Sheet's rows, stamps the date and
//   writes the history line. Undo is the same action backwards.
// - Replace file sends the new file to To Review (REPLACE-REVIEW-1); the modal says a replacement is
//   pending until it is accepted or rejected there.
// - Mark submitted waits for the policy tick only when Keith's draft carries a warning. The tick is
//   stored (who, when); before the database update it is kept for this session.
// - Copy ticks live in memory for the session and are never stored.
// - Batch mode ("Submit September to Concur") walks the month's unsubmitted receipts, oldest first.
// - A P-card receipt shows Paid and never shows the deadline, the policy check or the Concur entry.
// The modal traps focus, is named by its title, closes on Escape and hands focus back to its opener;
// Left and Right move between receipts when focus is not in a field.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, X } from 'lucide-react'
import { ReceiptPaper } from './ReceiptSlip'
import KeithMark from '../keith/KeithMark'
import { budgetStaff, prepareReceiptFile, uploadReceiptFile } from './budgetApi'
import { usd, dateText, fyShort, fiscalYearOfDate } from '../../lib/budget/budgetModel'
import {
  filedStage, paperMark, trackerSteps, deadlineNote, concurFields, copyAllText, footerState, needsPolicyConfirm, stampDate, cellWord,
} from '../../lib/budget/filedModel'

// Session memory: which Concur fields were copied, and a policy tick the database cannot hold yet.
const copiedFields = new Map()   // receipt id -> Set of field keys
const sessionTicks = new Set()   // receipt ids confirmed this session, before the update
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const FIELDS = 'button:not([disabled]), a[href], input:not([disabled]):not([type="file"]), [tabindex]:not([tabindex="-1"])'

/** The stamp or LATE tab on a paper. Decorative: the chip and the tracker say it in words. */
export function PaperMark({ receipt, big = false, fresh = false }) {
  const m = paperMark(receipt, { big })
  if (!m) return null
  if (m.kind === 'tab') return <span className="bud-latetab" aria-hidden="true">{m.word}</span>
  return <span className={`bud-stamp bud-stamp-${m.tone}${fresh ? ' bud-stamp-new' : ''}`} aria-hidden="true">{m.word}{big && m.date ? <small>{m.date}</small> : null}</span>
}

export default function ReceiptModal({ receipt: r, list, where, batch, subRow, months, onNavigate, onClose, onBatchDone, notify, onChanged, onOriginal, onShowInSheet, onSubscriptions, onReview = () => {} }) {
  const [busy, setBusy] = useState('')
  const [, setTick] = useState(0)                     // repaint after a session-memory change
  const [undo, setUndo] = useState(null)              // { id, to } after a stage change
  const [fresh, setFresh] = useState(null)            // the receipt whose stamp just landed
  const [details, setDetails] = useState(false)
  const [asking, setAsking] = useState(false)
  const [localNote, setLocalNote] = useState(null)
  const box = useRef(null)
  const pick = useRef(null)
  const repaint = () => setTick(n => n + 1)

  const stage = filedStage(r)
  const g = r.concur
  const idx = list.findIndex(x => x.id === r.id)
  const isLast = batch ? batch.ids.filter(id => id !== r.id).every(id => (list.find(x => x.id === id)?.concurState || 'open') !== 'open') : idx >= list.length - 1
  const confirmed = !!r.policy?.confirmed_at || sessionTicks.has(r.id)
  const foot = footerState(r, { confirmed, batch: !!batch, isLast })
  const fields = stage && stage !== 'paid' ? concurFields(g) : []
  const copied = copiedFields.get(r.id) || new Set()
  const note = deadlineNote(r)
  const lateNote = localNote?.id === r.id ? localNote.note : r.late_note
  const steps = trackerSteps(r)
  const fy = r.date ? fyShort(fiscalYearOfDate(r.date)) : 'FY'
  const cats = [...new Set(r.rows.map(x => x.category).filter(Boolean))]
  const titleId = `bud-rm-title-${r.id}`

  const go = useCallback((step) => { const next = list[idx + step]; if (next) { setAsking(false); onNavigate(next.id) } }, [list, idx, onNavigate])

  // Focus: into the modal on open, trapped while it is open; Escape closes; arrows move when not typing.
  useEffect(() => { box.current?.querySelector('[data-rm-close]')?.focus() }, [])
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox'
    if (!typing && e.key === 'ArrowRight') { go(1); return }
    if (!typing && e.key === 'ArrowLeft') { go(-1); return }
    if (e.key !== 'Tab') return
    const f = [...(box.current?.querySelectorAll(FIELDS) || [])]
    if (!f.length) return
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
  }

  const copy = (text, done) => navigator.clipboard?.writeText(String(text || '')).then(done, () => notify('Copy did not work in this browser.', 'err'))
  const copyField = (f) => copy(f.value, () => { copiedFields.set(r.id, new Set([...copied, f.key])); repaint(); notify('Copied.') })
  const copyAll = () => copy(copyAllText(fields), () => { copiedFields.set(r.id, new Set(fields.map(f => f.key))); repaint(); notify('All fields copied.') })

  const setStage = async (to, back, message) => {
    setBusy('stage')
    try {
      await budgetStaff('receipt_stage', { id: r.id, to })
      setUndo(back ? { id: r.id, to: back } : null)
      if (back) setFresh(r.id)
      notify(message)
      await onChanged()
      return true
    } catch (e) { notify(e.message, 'err'); await onChanged(); return false } finally { setBusy('') }
  }
  const primary = async () => {
    if (foot.action === 'next') return go(1)
    if (foot.action === 'done') return onClose()
    if (foot.action === 'reimburse') return setStage('reimbursed', 'submitted', 'Marked reimbursed.')
    const rest = batch ? batch.ids.filter(id => id !== r.id && (list.find(x => x.id === id)?.concurState || 'open') === 'open') : []
    if (!(await setStage('submitted', 'recorded', 'Marked submitted to Concur.')) || !batch) return
    // Batch: let the stamp land, then the next unsubmitted receipt, or close the month.
    setTimeout(() => { if (rest.length) { setUndo(null); onNavigate(rest[0]) } else onBatchDone() }, 650)
  }
  const doUndo = () => setStage(undo.to, null, 'Undone.')

  const tick = async (on) => {
    setBusy('confirm')
    try { await budgetStaff('receipt_policy_confirm', { id: r.id, confirmed: on }); sessionTicks.delete(r.id); await onChanged() } catch (e) {
      // Before the database update the tick cannot be stored: it holds for this session.
      if (e.code === 'not_enabled') { if (on) sessionTicks.add(r.id); else sessionTicks.delete(r.id); repaint() } else notify(e.message, 'err')
    } finally { setBusy('') }
  }
  const prepare = async () => {
    setBusy('prepare')
    try { await budgetStaff('receipt_concur_prepare', { id: r.id }); sessionTicks.delete(r.id); copiedFields.delete(r.id); notify('Keith drafted the Concur entry.'); await onChanged() } catch (e) { notify(e.message, 'err') } finally { setBusy('') }
  }
  const draftNote = async () => {
    setBusy('note')
    try { const out = await budgetStaff('receipt_late_note', { id: r.id }); setLocalNote({ id: r.id, note: out.late_note }); onChanged() } catch (e) { notify(e.message, 'err') } finally { setBusy('') }
  }
  // REPLACE-REVIEW-1 (Owner, 2026-10-01): a replacement is not swapped in here. It goes to To Review,
  // Keith reads it, and it takes this receipt's place only when it is accepted there.
  const replace = async (raw) => {
    if (!raw) return
    setBusy('replace')
    let sent = false
    try {
      const file = await prepareReceiptFile(raw)
      const { receipt, upload } = await budgetStaff('receipt_replace_start', { id: r.id, file_name: file.name, content_type: file.type, size: file.size })
      await uploadReceiptFile(upload, file)
      sent = true
      await onChanged()
      await budgetStaff('receipt_read', { id: receipt.id })
      notify('The replacement is in To Review. This receipt keeps its file until you accept it there.')
    } catch (e) { notify(sent ? `The replacement is in To Review, but Keith could not read it: ${e.message}` : e.message, 'err') } finally { await onChanged(); setBusy(''); if (pick.current) pick.current.value = '' }
  }
  const remove = async () => {
    setBusy('delete')
    try {
      const out = await budgetStaff('receipt_delete', { id: r.id })
      notify(out.rows ? `Receipt deleted. ${plural(out.rows, 'row')} in the Sheet ${out.rows === 1 ? 'reads' : 'read'} Missing now.` : 'Receipt deleted.')
      onClose(); onChanged()
    } catch (e) { notify(e.message, 'err'); setBusy('') }
  }

  const warns = (g?.checks || []).filter(c => c.tone === 'warn')
  const infos = (g?.checks || []).filter(c => c.tone !== 'warn')
  const needs = needsPolicyConfirm(g)
  const settled = r.rows.filter(x => x.stage === 'submitted' || x.stage === 'settled')

  return (
    <div className="bud-rm-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bud-rm" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box} onKeyDown={onKey}>
        <header className="bud-rm-head">
          <div className="bud-rm-title">
            <div className="bud-rm-t">
              <h2 id={titleId}>{r.vendor} · {usd(r.total)}</h2>
              <span className="bud-rm-sub">{[r.date ? dateText(r.date) : 'No date', fy, cats.length > 1 ? `${cats.length} categories` : cats[0]].filter(Boolean).join(' · ')}{r.order_number ? <> · <span className="bud-rm-mono">{r.order_number}</span></> : null}</span>
            </div>
            {batch
              ? <span className="bud-rm-batch">Submitting {batch.label} · {batch.ids.indexOf(r.id) + 1} of {batch.ids.length}</span>
              : <span className="bud-rm-pos">{idx + 1} of {list.length}{where ? ` in ${where}` : ''}</span>}
            <button type="button" className="bud-rm-icon" aria-label="Previous receipt" disabled={idx <= 0} onClick={() => go(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <button type="button" className="bud-rm-icon" aria-label="Next receipt" disabled={idx >= list.length - 1} onClick={() => go(1)}><ChevronRight size={18} aria-hidden="true" /></button>
            <button type="button" className="bud-rm-icon bud-rm-x" aria-label="Close" data-rm-close onClick={onClose}><X size={20} aria-hidden="true" /></button>
          </div>
          <ol className="bud-rm-steps" aria-label="Receipt progress" style={{ '--steps': steps.length }}>
            {steps.map((s, i) => (
              <li key={s.label} className={`bud-rm-step bud-rm-step-${s.state}`} {...(s.state === 'current' ? { 'aria-current': 'step' } : {})}>
                <span className="dot" aria-hidden="true">{s.state === 'done' ? <Check size={14} /> : i + 1}</span>
                <span><span className="l">{s.label}</span><span className="s">{s.detail}</span></span>
              </li>
            ))}
          </ol>
        </header>

        <div className="bud-rm-body">
          <div className="bud-rm-left bud-holder">
            <div className="bud-rm-big">
              <ReceiptPaper proposal={r.proposal} />
              <PaperMark receipt={r} big fresh={fresh === r.id} />
            </div>
            {r.replacement && (
              <div className="bud-rm-pending" role="status">
                <b>Replacement pending review</b>
                <span>{r.replacement.file_name} is in To Review{r.replacement.status === 'reading' || r.replacement.status === 'uploading' ? ', and Keith is reading it' : ''}. This receipt keeps its file until you accept it there.</span>
                <button type="button" className="bud-btn" onClick={() => onReview(r.replacement.id)}>Review it</button>
              </div>
            )}
            <div className="bud-rm-files">
              <button type="button" className="bud-btn" onClick={() => onOriginal(r, true)}>Download</button>
              <button type="button" className="bud-btn" onClick={() => onOriginal(r)}>View original</button>
            </div>
            {subRow && (
              <div className="bud-rm-recur">
                <b>{r.subscription?.name || subRow.vendor} bills monthly</b>
                <div className="ms">
                  {months.map(m => { const c = subRow.cells[m.key]; return c.kind === 'none' ? null : <span key={m.key} className={`k-${c.kind}`}>{m.short} · {cellWord(c.kind)}</span> })}
                </div>
                <span className="bud-rm-recur-hint">Paying through Purchasing would end the monthly Concur entries.</span>
                <button type="button" className="bud-linkbtn" onClick={onSubscriptions}>See all subscriptions →</button>
              </div>
            )}
          </div>

          <div className="bud-rm-right">
            {note && (
              <div className={`bud-rm-alert bud-rm-alert-${note.tone}`} role={note.tone === 'late' ? 'alert' : undefined}>
                <div className="top">
                  <Clock size={20} aria-hidden="true" />
                  <span><strong>{note.strong}</strong> {note.text}</span>
                  {note.tone === 'late' && !lateNote && r.lateNoteEnabled && <button type="button" className="bud-btn bud-btn-danger" disabled={!!busy} onClick={draftNote}>{busy === 'note' ? 'Keith is drafting…' : 'Draft late note'}</button>}
                </div>
                {note.tone === 'late' && !r.lateNoteEnabled && <span className="bud-rm-fine">Draft late note needs the Receipts database update (20261101000000_receipts_redesign.sql).</span>}
                {note.tone === 'late' && lateNote && (
                  <div className="draft">
                    <span>{lateNote.text}</span>
                    <button type="button" className="bud-rm-copy" aria-label="Copy late note" onClick={() => copy(lateNote.text, () => notify('Late note copied. Replace [REASON] with your reason.'))}><Copy size={16} aria-hidden="true" /></button>
                    <span className="bud-rm-fine">{lateNote.provenance_id && <KeithMark provenanceId={lateNote.provenance_id} />} Drafted by Keith. Replace [REASON] with your reason. <button type="button" className="bud-linkbtn bud-linkbtn-inline" disabled={!!busy} onClick={draftNote}>{busy === 'note' ? 'Drafting…' : 'Draft again'}</button></span>
                  </div>
                )}
              </div>
            )}

            {stage && stage !== 'paid' && g && (warns.length > 0 || infos.length > 0 || g.notes) && (
              <div className={`bud-rm-check${needs ? (confirmed ? ' ok' : ' wait') : ''}`}>
                <div className="h">
                  {g.provenance_id ? <KeithMark provenanceId={g.provenance_id} /> : <span className="bud-rm-kmark" aria-hidden="true">K</span>}
                  <b>Keith’s policy check</b>
                  <small>Drafted {g.prepared_at ? stampDate(g.prepared_at) : ''}{g.policy_found ? '' : ' · policy not found in the Knowledge Center'} · <button type="button" className="bud-linkbtn bud-linkbtn-inline" disabled={!!busy} onClick={prepare}>{busy === 'prepare' ? 'Drafting…' : 'Draft again'}</button></small>
                </div>
                {[...warns, ...infos].map((c, i) => <p key={i}>{c.text}</p>)}
                {g.notes && <p className="bud-rm-fine">{g.notes}</p>}
                {needs && (
                  <label>
                    <input type="checkbox" checked={confirmed} disabled={stage !== 'open' || busy === 'confirm'} onChange={e => tick(e.target.checked)} />
                    I confirm this is necessary for ASPIRE operations.
                    {r.policy?.confirmed_at && <span className="bud-rm-fine">Confirmed {stampDate(r.policy.confirmed_at)}{r.policy.confirmed_by ? ` by ${r.policy.confirmed_by}` : ''}</span>}
                  </label>
                )}
              </div>
            )}

            {stage && stage !== 'paid' && (
              <section className="bud-rm-concur" aria-labelledby={`bud-rm-concur-${r.id}`}>
                <div className="h">
                  <b id={`bud-rm-concur-${r.id}`}>Concur entry</b>
                  <span>{fields.length ? (copied.size >= fields.length ? `All ${fields.length} fields copied` : `${copied.size} of ${fields.length} copied`) : ''}</span>
                  {fields.length > 0 && <button type="button" className="bud-btn" onClick={copyAll}><Copy size={16} aria-hidden="true" />Copy all</button>}
                </div>
                {!r.concurEnabled ? (
                  <p className="bud-rm-empty">Keith’s Concur drafts need their database update (20261026000000_budget_concur.sql).</p>
                ) : !g ? (
                  <div className="bud-rm-empty">
                    <p>Keith can draft what to enter in Concur from this receipt and the reimbursement policy in the Knowledge Center. It is saved here once drafted.</p>
                    <button type="button" className="bud-btn bud-btn-pri" disabled={!!busy} onClick={prepare}>{busy === 'prepare' ? 'Keith is drafting…' : 'Prepare for Concur'}</button>
                  </div>
                ) : (<>
                  {fields.map(f => {
                    const done = copied.has(f.key)
                    return (
                      <div key={f.key} className={`bud-rm-f${done ? ' done' : ''}`}>
                        <span className="lab">{f.label}</span><span className="val">{f.value}</span>
                        <button type="button" className="bud-rm-copy" aria-label={done ? `${f.label} copied` : `Copy ${f.label}`} onClick={() => copyField(f)}>{done ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button>
                      </div>
                    )
                  })}
                  <div className="bud-rm-f plain"><span className="lab">Attach</span><span className="val">{g.attach?.length ? g.attach.join('; ') : 'The itemized receipt.'} Use <strong>Download</strong> under the receipt.</span></div>
                </>)}
              </section>
            )}

            <div className="bud-rm-details">
              <button type="button" aria-expanded={details} onClick={() => setDetails(d => !d)}>
                <span>Details <em>· Sheet row, payment, file</em></span><ChevronDown size={18} aria-hidden="true" className={details ? 'up' : undefined} />
              </button>
              {details && (
                <div className="in">
                  <span className="lab">Sheet {r.rows.length === 1 ? 'row' : 'rows'}</span>
                  <span>
                    {r.rows.length
                      ? r.rows.map(x => <span key={x.id} className="bud-rm-row">{x.row_label || 'Row'} · {x.item || 'No item'} · {usd(x.amount)}</span>)
                      : 'The rows this receipt posted have since been deleted from the Sheet.'}
                    {r.rows.length > 0 && <button type="button" className="bud-linkbtn" onClick={() => onShowInSheet(r)}>Show in Sheet</button>}
                  </span>
                  <span className="lab">Payment</span><span>{r.rows[0]?.payment || 'Not recorded'}</span>
                  <span className="lab">Accepted</span><span>{r.decided_at ? stampDate(r.decided_at) : ''}{r.decided_by ? ` by ${r.decided_by}` : ''}</span>
                  <span className="lab">File</span><span className="bud-rm-mono bud-rm-path">Budget Tracker › {fy} › Receipts › {r.filed_name}</span>
                  <span />
                  <span className="bud-rm-fileacts">
                    <input ref={pick} type="file" hidden accept="image/*,application/pdf,.pdf,.eml,message/rfc822,.heic,.heif" onChange={e => replace(e.target.files?.[0])} />
                    {asking ? (
                      <span className="bud-ffile-ask" role="alertdialog" aria-label="Delete this receipt">
                        <span><b>Delete this receipt for good?</b> The file and its filed record are removed and cannot be brought back.{' '}
                          {r.rows.length ? `${plural(r.rows.length, 'row')} ${r.rows.length === 1 ? 'stays' : 'stay'} in the Sheet and will read Missing. ` : ''}
                          {r.concur ? 'Keith’s Concur draft for it goes too. ' : ''}
                          {settled.length ? <span className="bud-ffile-warn">This purchase is already {settled.some(x => x.stage === 'settled') ? 'reimbursed or paid' : 'submitted to Concur'}; its record will have no receipt.</span> : null}</span>
                        <span className="bud-ffile-acts">
                          <button type="button" className="bud-btn" disabled={!!busy} onClick={() => setAsking(false)}>Keep it</button>
                          <button type="button" className="bud-btn bud-btn-danger" disabled={!!busy} onClick={remove}>{busy === 'delete' ? 'Deleting…' : 'Delete for good'}</button>
                        </span>
                      </span>
                    ) : (<>
                      <button type="button" className="bud-btn" disabled={!!busy || !!r.replacement} title={r.replacement ? 'A replacement is already waiting in To Review' : undefined} onClick={() => pick.current?.click()}>{busy === 'replace' ? 'Sending to review…' : r.replacement ? 'Replacement pending' : 'Replace file'}</button>
                      <button type="button" className="bud-btn bud-btn-danger" disabled={!!busy} onClick={() => setAsking(true)}>Delete receipt</button>
                    </>)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="bud-rm-foot">
          <span className={`hint${foot.tone ? ` ${foot.tone}` : ''}`}>{foot.hint}</span>
          {undo?.id === r.id && <button type="button" className="bud-btn bud-rm-ghost" disabled={!!busy} onClick={doUndo}>Undo</button>}
          <button type="button" className="bud-btn bud-btn-pri bud-rm-primary" disabled={foot.disabled || !!busy} onClick={primary}>{busy === 'stage' ? 'Saving…' : foot.label}</button>
        </footer>
      </div>
    </div>
  )
}
