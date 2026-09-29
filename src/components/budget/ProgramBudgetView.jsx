// src/components/budget/ProgramBudgetView.jsx
//
// PROGRAM-BUDGET A3/A5 (2026-09-27): the Program Budget, one view in two places, the way
// Community Benefit is: Settings > Program Budget (source STAFF_SOURCE: the Owner edits, an
// Admin reads) and the Nursing Education & Leadership portal's Program Budget tab (source
// PORTAL_SOURCE: read-only, no write path). What a viewer may see is decided by the server
// (lib/server/budget/engine.js builds the reader payload without the owner-only fields); this
// file only lays it out. Reference: docs/mockups/program-budget.html.
//
// Tabs, in the prompt's order: Summary, Sheet, Subscriptions, Allocations. Receipts arrives with
// Phase B, and until then there is no placeholder for it. A reader sees Allocations only once a
// plan is saved. A year that has not started shows the Start form (the owner) or "isn't
// published yet" (a reader) in place of Summary, Sheet and Allocations.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, ReceiptText } from 'lucide-react'
import SegmentedPicker from '../shared/SegmentedPicker'
import BudgetSummary from './BudgetSummary'
import BudgetSheet from './BudgetSheet'
import BudgetSubscriptions from './BudgetSubscriptions'
import BudgetAllocations from './BudgetAllocations'
import BudgetReceipts from './BudgetReceipts'
import { inlineBadgeStyle } from '../../lib/badgeTokens'
import BudgetStart from './BudgetStart'
import { saveXlsx, budgetStaff } from './budgetApi'
import { fyShort, fyRangeText, STATE_CHIP, currentFiscalYear } from '../../lib/budget/budgetModel'
import '../forms/forms.css'
import './budget.css'

const NOT_ENABLED = 'Program Budget is not enabled yet. Its database update (20261009000000_program_budget_phase_a.sql) has not been applied.'

// Tab order (prompt, decision 10): Summary, Sheet, Subscriptions, Receipts, Allocations. Receipts is
// the Owner's alone (decision 5).
function tabsFor(year, canEdit, receiptCount = 0) {
  // A reader sees Subscriptions before the year starts when there are proposals to look at (SUB-APPROVAL-1).
  if (year.state === 'not_started') return [{ value: 'summary', label: canEdit ? `Start ${year.label}` : 'Summary' }, ...(canEdit || year.proposals?.count ? [{ value: 'subscriptions', label: 'Subscriptions' }] : [])]
  const t = [{ value: 'summary', label: 'Summary' }, { value: 'sheet', label: 'Sheet' }, { value: 'subscriptions', label: 'Subscriptions' }]
  if (canEdit) t.push({ value: 'receipts', label: receiptCount ? <>Receipts<span style={{ ...inlineBadgeStyle, marginLeft: 6 }} aria-label={`${receiptCount} waiting`}>{receiptCount}</span></> : 'Receipts' })
  if (canEdit || year.budget?.plan_saved_at) t.push({ value: 'allocations', label: 'Allocations' })
  return t
}

export default function ProgramBudgetView({ source, renderBand, initialFy = null }) {
  const [fy, setFy] = useState(() => initialFy ?? currentFiscalYear())   // the Pacific fiscal year, as the server defaults
  const [year, setYear] = useState(null)
  const [error, setError] = useState(null)
  // AC-RENEW-1: the Action Center's Open lands on the tab it names (?tab=subscriptions).
  const [tab, setTab] = useState(() => { try { return new URLSearchParams(window.location.search).get('tab') || 'summary' } catch { return 'summary' } })
  const [toast, setToast] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [receiptCount, setReceiptCount] = useState(0)
  // Filed > Show in Sheet: what the Sheet opens searched for; the Action Center's Missing receipt link
  // (?tab=sheet&filter=missing-receipt) opens it with that quick filter on.
  const [sheetFocus, setSheetFocus] = useState(() => { try { const f = new URLSearchParams(window.location.search).get('filter'); return f === 'missing-receipt' ? { filter: f, at: 0 } : null } catch { return null } })
  const [pendingFiles, setPendingFiles] = useState(null)   // files chosen from the header's Add receipts
  const addRef = useRef(null)
  const reloadTimer = useRef(null)
  const toastTimer = useRef(null)

  // A toast may carry one action (Receipts: Undo for 5 seconds, prompt B6).
  const notify = useCallback((message, kind = 'ok', action = null) => {
    clearTimeout(toastTimer.current)
    setToast({ message, kind, action })
    toastTimer.current = setTimeout(() => setToast(null), action?.ms || (kind === 'err' ? 8000 : 4000))
  }, [])
  const load = useCallback(async (which) => {
    try {
      const y = await source.load(which)
      setYear(y); setError(null)
    } catch (e) { setError(e.code === 'not_enabled' ? NOT_ENABLED : e.message) }
  }, [source])
  useEffect(() => {
    let live = true
    source.load(fy).then(y => { if (!live) return; setYear(y); setError(null) })
      .catch(e => { if (live) setError(e.code === 'not_enabled' ? NOT_ENABLED : e.message) })
    return () => { live = false }
  }, [fy, source])
  useEffect(() => () => { clearTimeout(reloadTimer.current); clearTimeout(toastTimer.current) }, [])

  const canEdit = !!year?.can_edit && !!source.write
  // The Receipts tab's count, before the tab is opened: receipts waiting for review.
  useEffect(() => {
    if (!canEdit) return undefined
    let live = true
    budgetStaff('receipts_queue').then(q => { if (live) setReceiptCount(q.receipts?.length || 0) }).catch(() => {})
    return () => { live = false }
  }, [canEdit])
  // Writes go through the one staff endpoint. `run` reports and reloads; `call` is for the
  // sheets, which keep their own rows and only ask the rest of the page to catch up.
  const onWrite = {
    notify,
    call: (action, payload) => source.write(action, payload),
    changed: () => { clearTimeout(reloadTimer.current); reloadTimer.current = setTimeout(() => load(fy), 700) },
    run: async (action, payload, ok, { reload = true } = {}) => {
      try {
        const out = await source.write(action, payload)
        if (ok || out?.message) notify(out?.message || ok)
        if (reload) await load(fy)
        return true
      } catch (e) { notify(e.message, 'err'); return false }
    },
  }

  const exportXlsx = async () => {
    setExporting(true)
    try { saveXlsx(await source.exportXlsx(year.fy)) } catch (e) { notify(e.message, 'err') }
    setExporting(false)
  }

  const actions = year && (
    <div className="bud-actions" role="group" aria-label="Program Budget actions">
      <label htmlFor="bud-fy"><span>Fiscal year</span>
        <select id="bud-fy" value={year.fy} onChange={e => { setTab('summary'); setFy(Number(e.target.value)) }}>
          {year.years.map(y => <option key={y} value={y}>{fyShort(y)}</option>)}
        </select></label>
      {canEdit && (<>
        <button type="button" className="bud-btn" onClick={() => addRef.current?.click()}><ReceiptText size={15} aria-hidden="true" />Add receipts</button>
        <input ref={addRef} type="file" accept="image/*,application/pdf,.pdf,.eml,message/rfc822,.heic,.heif" multiple hidden
          onChange={e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) { setPendingFiles(f); setTab('receipts') } }} />
      </>)}
      {year.state !== 'not_started' && <button type="button" className="bud-btn bud-btn-pri" onClick={exportXlsx} disabled={exporting}><Download size={15} aria-hidden="true" />{exporting ? 'Preparing…' : 'Export to Excel'}</button>}
    </div>
  )
  const band = renderBand(actions, year && !canEdit ? 'Read-only access' : undefined)

  if (error) return <>{band}<div className="bud-empty bud-error" role="alert">{error}</div></>
  if (!year) return <>{band}<div className="bud-empty">Loading the budget…</div></>

  const tabs = tabsFor(year, canEdit, receiptCount)
  const current = tabs.some(t => t.value === tab) ? tab : 'summary'
  const notStarted = year.state === 'not_started'

  return (
    <>
      {band}
      <div className="bud">
        <div className="bud-head">
          <span className={`bud-chip bud-chip-${year.state}`}>{year.label} · {STATE_CHIP[year.state]}</span>
          <p className="bud-sub">{[year.program, year.budget?.cost_center, year.owner_name && `Owner ${year.owner_name}`, fyRangeText(year.fy)].filter(Boolean).join(' · ')}</p>
        </div>
        {/* SHEET-LIVE-1: a toast at the foot of the window; a click puts it away. */}
        {toast && (
          <div className={`bud-toast${toast.kind === 'err' ? ' bud-toast-err' : ''}`} role={toast.kind === 'err' ? 'alert' : 'status'}>
            <span>{toast.message}</span>
            {toast.action && <button type="button" className="bud-toast-act" onClick={() => { const run = toast.action.run; setToast(null); run() }}>{toast.action.label}</button>}
            <button type="button" className="bud-toast-x" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
          </div>
        )}
        <SegmentedPicker ariaLabel="Program Budget views" options={tabs} value={current} onChange={(t) => { setSheetFocus(null); setTab(t) }} />
        {current === 'summary' && (notStarted
          ? <BudgetStart year={year} canEdit={canEdit} onWrite={onWrite} onPickYear={(y) => setFy(y)} />
          : <BudgetSummary key={year.fy} year={year} canEdit={canEdit} onWrite={onWrite}
              onGo={(t, filter) => { setSheetFocus(filter ? { filter, at: Date.now() } : null); setTab(t) }} />)}
        {current === 'sheet' && <BudgetSheet year={year} canEdit={canEdit} onWrite={onWrite} focus={sheetFocus} />}
        {current === 'subscriptions' && <BudgetSubscriptions year={year} canEdit={canEdit} onWrite={onWrite} />}
        {current === 'receipts' && canEdit && (
          <BudgetReceipts year={year} onWrite={onWrite} pendingFiles={pendingFiles} onPendingTaken={() => setPendingFiles(null)} onCount={setReceiptCount}
            onStartYear={(y) => { setTab('summary'); setFy(y) }}
            onShowInSheet={(r) => { setSheetFocus({ search: r.order_number || r.vendor, at: Date.now() }); setTab('sheet') }} />
        )}
        {current === 'allocations' && <BudgetAllocations key={`${year.fy}-${year.budget?.plan_saved_at || ''}`} year={year} canEdit={canEdit} onWrite={onWrite} />}
      </div>
    </>
  )
}
