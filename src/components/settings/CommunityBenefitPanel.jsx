// Settings > Community Benefit.
//
// The report is the same canonical Community Benefit view used by the Nursing
// Education and Leadership portal. Settings uses staff-only read endpoints;
// the portal continues to use its nursing_academic grant boundary. Reporting
// inputs remain Owner-only and append-only through community-benefit-admin.js.

import { useState, useEffect, useCallback } from 'react'
import { Download, DollarSign, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { SCHOOLS } from '../../lib/constants'
import { downloadCSV } from '../../lib/utils'
import { SETTINGS_HEADING_STYLE } from './settingsSections'
import SurfaceCard from '../ui/SurfaceCard'
import CommunityBenefitView from '../../portal/na/CommunityBenefitView'
import '../../portal/portal.css'
import './CommunityBenefitPanel.css'

const CATEGORY_LABELS = { rn_preceptor: 'RN', management: 'Leadership' }
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

async function authToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

async function callAdmin(body) {
  const token = await authToken()
  const res = await fetch('/api/community-benefit-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* non-JSON body: leave null */ }
  return { ok: res.ok, status: res.status, data: json }
}

async function fetchStaffReport(fiscalYear, { signal } = {}) {
  const token = await authToken()
  if (!token) return { ok: false, status: 401, data: null, error: 'unauthenticated' }
  const q = fiscalYear ? `?fiscal_year=${encodeURIComponent(fiscalYear)}` : ''
  try {
    const res = await fetch(`/api/community-benefit-report${q}`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    })
    let data = null
    try { data = await res.json() } catch { data = null }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data?.error || 'request_failed') }
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, status: 0, data: null, error: 'aborted' }
    return { ok: false, status: 0, data: null, error: 'network_error' }
  }
}

async function fetchStaffCsv(fiscalYear) {
  const token = await authToken()
  if (!token) return { ok: false, status: 401, csv: null, error: 'unauthenticated' }
  try {
    const q = fiscalYear ? `?fiscal_year=${encodeURIComponent(fiscalYear)}` : ''
    const res = await fetch(`/api/community-benefit-export${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { ok: false, status: res.status, csv: null, error: 'request_failed' }
    return { ok: true, status: res.status, csv: await res.text(), error: null }
  } catch {
    return { ok: false, status: 0, csv: null, error: 'network_error' }
  }
}

const currentFy = () => {
  const now = new Date()
  return now.getMonth() + 1 >= 7 ? now.getFullYear() + 1 : now.getFullYear()
}

function ReportingModal({ title, description, children, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="cb-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="cb-modal" role="dialog" aria-modal="true" aria-labelledby="cb-modal-title">
        <header className="cb-modal-header">
          <div>
            <h3 id="cb-modal-title">{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="cb-icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  )
}

export default function CommunityBenefitPanel() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(null)
  const [selectedFy, setSelectedFy] = useState(currentFy())
  const [reportMeta, setReportMeta] = useState(null)
  const [reportRefreshKey, setReportRefreshKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [rateForm, setRateForm] = useState({ fiscal_year: String(currentFy()), category: 'rn_preceptor', hourly_rate: '', note: '' })
  const [capForm, setCapForm] = useState({ fiscal_year: String(currentFy()), school_name: '', hours: '', note: '' })
  const [loadTick, setLoadTick] = useState(0)
  const load = useCallback(() => setLoadTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    callAdmin({ action: 'list' }).then(res => {
      if (cancelled) return
      if (!res.ok) {
        setError(res.status === 403
          ? 'You do not have permission to view community-benefit settings.'
          : 'Could not load community-benefit settings. Please try again.')
        setLoading(false)
        return
      }
      setError(null)
      setData(res.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [loadTick])

  const notify = (ok, msg) => {
    setToast({ ok, msg })
    window.setTimeout(() => setToast(null), 3500)
  }

  const rates = data?.rates || []
  const capstone = data?.capstone_hours || []
  const activeRates = rates.filter(rate => !rate.superseded_at)
  const supersededRates = rates.filter(rate => rate.superseded_at)
  const canEdit = data?.can_edit === true
  const selectedRates = Object.fromEntries(
    activeRates.filter(rate => Number(rate.fiscal_year) === selectedFy).map(rate => [rate.category, rate]),
  )
  const selectedHours = capstone
    .filter(entry => Number(entry.fiscal_year) === selectedFy && !entry.voided_at)
    .reduce((sum, entry) => sum + Number(entry.hours || 0), 0)

  const fiscalYears = (() => {
    const years = new Set([selectedFy, currentFy(), ...(reportMeta?.available_fiscal_years || [])])
    activeRates.forEach(rate => years.add(Number(rate.fiscal_year)))
    capstone.forEach(entry => years.add(Number(entry.fiscal_year)))
    return [...years].filter(Number.isInteger).sort((a, b) => b - a)
  })()

  const handleReportLoaded = useCallback((report) => setReportMeta(report), [])

  const openRateModal = () => {
    const existing = selectedRates.rn_preceptor
    setRateForm({ fiscal_year: String(selectedFy), category: 'rn_preceptor', hourly_rate: existing ? String(existing.hourly_rate) : '', note: '' })
    setModal('rate')
  }

  const changeRateCategory = (category) => {
    const existing = selectedRates[category]
    setRateForm(form => ({ ...form, category, hourly_rate: existing ? String(existing.hourly_rate) : '' }))
  }

  const openHoursModal = () => {
    setCapForm({ fiscal_year: String(selectedFy), school_name: '', hours: '', note: '' })
    setModal('hours')
  }

  const refreshAfterWrite = () => {
    load()
    setReportRefreshKey(key => key + 1)
    setModal(null)
  }

  const submitRate = async (event) => {
    event?.preventDefault()
    if (busy) return
    const fy = Number(rateForm.fiscal_year)
    const rate = Number(rateForm.hourly_rate)
    if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) return notify(false, 'Enter a fiscal year between 2020 and 2100.')
    if (!Number.isFinite(rate) || rate < 0) return notify(false, 'The hourly rate must be a nonnegative number.')
    setBusy(true)
    const res = await callAdmin({ action: 'set_rate', fiscal_year: fy, category: rateForm.category, hourly_rate: rate, note: rateForm.note || null })
    setBusy(false)
    if (!res.ok) return notify(false, res.data?.message || 'The rate could not be saved.')
    notify(true, `Rate saved for FY ${fy}.`)
    refreshAfterWrite()
  }

  const submitCapstone = async (event) => {
    event?.preventDefault()
    if (busy) return
    const fy = Number(capForm.fiscal_year)
    const hours = Number(capForm.hours)
    if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) return notify(false, 'Enter a fiscal year between 2020 and 2100.')
    if (!capForm.school_name.trim()) return notify(false, 'A school is required.')
    if (!Number.isFinite(hours) || hours < 0) return notify(false, 'Additional non-clinical hours must be a nonnegative number.')
    setBusy(true)
    const res = await callAdmin({ action: 'add_capstone', fiscal_year: fy, school_name: capForm.school_name.trim(), hours, note: capForm.note || null, cohort_id: null })
    setBusy(false)
    if (!res.ok) return notify(false, res.data?.message || 'The additional-hours entry could not be saved.')
    notify(true, `Additional non-clinical hours recorded for FY ${fy}.`)
    refreshAfterWrite()
  }

  const voidCapstone = async (id) => {
    if (busy) return
    setBusy(true)
    const res = await callAdmin({ action: 'void_capstone', id })
    setBusy(false)
    if (!res.ok) return notify(false, 'The entry could not be voided.')
    notify(true, 'Entry voided. History preserved.')
    load()
    setReportRefreshKey(key => key + 1)
  }

  const onExport = async () => {
    if (exporting) return
    setExporting(true)
    const res = await fetchStaffCsv(selectedFy)
    if (res.ok && res.csv) downloadCSV(res.csv, `aspire-community-benefit-fy${selectedFy}.csv`)
    else notify(false, 'The CSV could not be generated right now.')
    setExporting(false)
  }

  if (loading) return <div className="cb-inline-state">Loading community-benefit settings…</div>
  if (error) return <div className="cb-inline-state cb-inline-error">{error}</div>

  return (
    <section className="cb-settings" aria-labelledby="community-benefit-heading">
      {toast && <div role="status" className={`cb-toast ${toast.ok ? 'cb-toast-success' : 'cb-toast-error'}`}>{toast.msg}</div>}
      <div className="cb-page-header">
        <div>
          <h2 id="community-benefit-heading" style={{ ...SETTINGS_HEADING_STYLE, margin: '0 0 4px' }}>Community Benefit</h2>
          <p>
            Review fiscal-year impact and manage the reporting inputs behind the Nursing Education and Leadership report.
            {!canEdit && ' You have read-only access; only the Owner can change reporting inputs.'}
          </p>
        </div>
        <div className="cb-page-actions" role="group" aria-label="Community Benefit actions">
          <label className="cb-fy-control" htmlFor="cb-settings-fy">
            <span>Fiscal year</span>
            <select id="cb-settings-fy" value={selectedFy} onChange={event => setSelectedFy(Number(event.target.value))}>
              {fiscalYears.map(year => <option key={year} value={year}>FY {year} (Jul {year - 1} to Jun {year})</option>)}
            </select>
          </label>
          {canEdit && <><button type="button" className="cb-button cb-button-secondary" onClick={openRateModal}><DollarSign size={16} />Set hourly rate</button><button type="button" className="cb-button cb-button-secondary" onClick={openHoursModal}><Plus size={16} />Add non-clinical hours</button></>}
          <button type="button" className="cb-button cb-button-primary" onClick={onExport} disabled={exporting}><Download size={16} />{exporting ? 'Preparing CSV…' : 'Download CSV'}</button>
        </div>
      </div>

      <SurfaceCard padding="14px 16px" className="cb-inputs-card">
        <div className="cb-inputs-heading">
          <div><h3>Reporting inputs</h3><p>Current values applied to FY {selectedFy}.</p></div>
          <span>Benefit estimates update when these inputs change.</span>
        </div>
        <div className="cb-inputs-grid">
          <div className="cb-input-summary"><span>RN hourly rate</span><strong>{selectedRates.rn_preceptor ? `${money.format(Number(selectedRates.rn_preceptor.hourly_rate))}/hr` : 'Not set'}</strong></div>
          <div className="cb-input-summary"><span>Leadership hourly rate</span><strong>{selectedRates.management ? `${money.format(Number(selectedRates.management.hourly_rate))}/hr` : 'Not set'}</strong></div>
          <div className="cb-input-summary"><span>Additional non-clinical hours</span><strong>{num.format(selectedHours)} hours</strong></div>
        </div>
        <p className="cb-double-count-note">Enter only project, leadership, or other non-clinical hours that are NOT already recorded as clinical shift hours.</p>
      </SurfaceCard>

      <div className="ptl-page cb-report-embed" aria-label={`Community Benefit report for FY ${selectedFy}`}>
        <CommunityBenefitView active fiscalYear={selectedFy} onFiscalYearChange={setSelectedFy} onReportLoaded={handleReportLoaded} reportFetcher={fetchStaffReport} refreshKey={reportRefreshKey} showToolbar={false} showSettingsLink={false} reportPortalFailures={false} embedded />
      </div>

      <details className="cb-history">
        <summary><span>Reporting history</span><small>{rates.length} rate entries · {capstone.length} non-clinical entries</small></summary>
        <div className="cb-history-body">
          <section>
            <h3>Hourly rate history</h3>
            <div className="cb-table-scroll"><table><thead><tr><th>Fiscal year</th><th>Category</th><th>Rate</th><th>Status</th><th>Entered</th></tr></thead><tbody>
              {rates.length === 0 && <tr><td colSpan={5}>No rates entered yet.</td></tr>}
              {rates.map(rate => <tr key={rate.id}><td>FY {rate.fiscal_year}</td><td>{CATEGORY_LABELS[rate.category] || rate.category}</td><td>{money.format(Number(rate.hourly_rate))}/hr</td><td>{rate.superseded_at ? 'Superseded' : 'Current'}</td><td>{rate.created_at ? new Date(rate.created_at).toLocaleDateString() : '-'}</td></tr>)}
            </tbody></table></div>
            {supersededRates.length > 0 && <p>{supersededRates.length} superseded rate {supersededRates.length === 1 ? 'is' : 'are'} retained for audit history.</p>}
          </section>
          <section>
            <h3>Non-clinical hour entries</h3>
            <div className="cb-table-scroll"><table><thead><tr><th>Fiscal year</th><th>School</th><th>Hours</th><th>Note</th><th>Entered</th>{canEdit && <th aria-label="Actions" />}</tr></thead><tbody>
              {capstone.length === 0 && <tr><td colSpan={canEdit ? 6 : 5}>No additional non-clinical hours recorded yet.</td></tr>}
              {capstone.map(entry => <tr key={entry.id} className={entry.voided_at ? 'cb-row-voided' : ''}><td>FY {entry.fiscal_year}</td><td>{entry.school_name}</td><td>{num.format(Number(entry.hours))}{entry.voided_at ? ' (voided)' : ''}</td><td>{entry.note || '-'}</td><td>{entry.created_at ? new Date(entry.created_at).toLocaleDateString() : '-'}</td>{canEdit && <td>{!entry.voided_at && <button type="button" className="cb-void-button" onClick={() => voidCapstone(entry.id)} disabled={busy}>Void</button>}</td>}</tr>)}
            </tbody></table></div>
          </section>
        </div>
      </details>

      {modal === 'rate' && <ReportingModal title="Set hourly rate" description={`Update the rate used for FY ${selectedFy} benefit calculations.`} onClose={() => setModal(null)}>
        <form className="cb-modal-form" onSubmit={submitRate}>
          <label htmlFor="cb-rate-fy">Fiscal year (ending)<input id="cb-rate-fy" type="number" min="2020" max="2100" value={rateForm.fiscal_year} onChange={event => setRateForm(form => ({ ...form, fiscal_year: event.target.value }))} /></label>
          <label htmlFor="cb-rate-cat">Category<select id="cb-rate-cat" value={rateForm.category} onChange={event => changeRateCategory(event.target.value)}><option value="rn_preceptor">RN</option><option value="management">Leadership</option></select></label>
          <label htmlFor="cb-rate-amt">Hourly rate (USD)<input id="cb-rate-amt" type="number" min="0" step="0.01" value={rateForm.hourly_rate} onChange={event => setRateForm(form => ({ ...form, hourly_rate: event.target.value }))} placeholder="e.g. 65" autoFocus /></label>
          <label htmlFor="cb-rate-note">Note (optional)<input id="cb-rate-note" value={rateForm.note} onChange={event => setRateForm(form => ({ ...form, note: event.target.value }))} placeholder="Source or context" /></label>
          <p className="cb-modal-help">Saving a rate supersedes the previous rate for this fiscal year and category. History is preserved.</p>
          <div className="cb-modal-actions"><button type="button" className="cb-button cb-button-secondary" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="cb-button cb-button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save rate'}</button></div>
        </form>
      </ReportingModal>}

      {modal === 'hours' && <ReportingModal title="Add non-clinical hours" description="Record project, leadership, or other hours that are not in student shift logs." onClose={() => setModal(null)}>
        <form className="cb-modal-form" onSubmit={submitCapstone}>
          <div className="cb-modal-warning">Do not enter hours already recorded as clinical shifts. That would double-count the benefit.</div>
          <label htmlFor="cb-cap-fy">Fiscal year (ending)<input id="cb-cap-fy" type="number" min="2020" max="2100" value={capForm.fiscal_year} onChange={event => setCapForm(form => ({ ...form, fiscal_year: event.target.value }))} /></label>
          <label htmlFor="cb-cap-school">School<select id="cb-cap-school" value={capForm.school_name} onChange={event => setCapForm(form => ({ ...form, school_name: event.target.value }))} autoFocus><option value="">Select school</option>{SCHOOLS.map(school => <option key={school} value={school}>{school}</option>)}</select></label>
          <label htmlFor="cb-cap-hours">Additional non-clinical hours<input id="cb-cap-hours" type="number" min="0" step="0.25" value={capForm.hours} onChange={event => setCapForm(form => ({ ...form, hours: event.target.value }))} placeholder="e.g. 120" /></label>
          <label htmlFor="cb-cap-note">Reporting note (optional)<input id="cb-cap-note" value={capForm.note} onChange={event => setCapForm(form => ({ ...form, note: event.target.value }))} placeholder="Context for the entry" /></label>
          <div className="cb-modal-actions"><button type="button" className="cb-button cb-button-secondary" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="cb-button cb-button-primary" disabled={busy}>{busy ? 'Adding…' : 'Add hours'}</button></div>
        </form>
      </ReportingModal>}
    </section>
  )
}
