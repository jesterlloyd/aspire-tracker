// NURSING-ACADEMICS-1: Settings > Community Benefit.
//
// Owner-entered inputs for the Nursing Academics community-benefit report:
// hourly rates (RN Preceptor / Management) per fiscal year, and aggregate
// UCLA capstone project hours per fiscal year + school.
//
// AUTHORIZATION IS SERVER-SIDE. Admins see this panel read-only for
// visibility; every write goes through api/community-benefit-admin.js, which
// gates on the community_benefit_admin capability (empty allowlist =
// Owner-only by construction). The `can_edit` flag in the list response only
// decides whether the entry forms RENDER; it never decides whether a write
// succeeds.
//
// STORAGE IS APPEND-ONLY. Setting a rate supersedes the previous one (history
// preserved); a capstone entry is voided, never deleted.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { SCHOOLS } from '../../lib/constants'
import { SETTINGS_HEADING_STYLE } from './settingsSections'
import SurfaceCard from '../ui/SurfaceCard'

const F = 'DM Sans, sans-serif'
const CATEGORY_LABELS = { rn_preceptor: 'RN Preceptor', management: 'Management (UCLA capstone)' }
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

async function callAdmin(body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/community-benefit-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* non-JSON body: leave null */ }
  return { ok: res.ok, status: res.status, data: json }
}

const label = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, fontFamily: F }
const field = { width: '100%', padding: '8px 10px', border: '1px solid #d5d9e2', borderRadius: 8, fontFamily: F, fontSize: 13, boxSizing: 'border-box' }
const th = { textAlign: 'left', padding: '7px 10px', fontSize: 11.5, fontWeight: 700, color: '#6b7280', borderBottom: '1px solid #e5e7eb', fontFamily: F, whiteSpace: 'nowrap' }
const td = { padding: '7px 10px', fontSize: 12.5, color: '#191919', borderBottom: '1px solid #f3f4f6', fontFamily: F }

const currentFy = () => {
  const now = new Date()
  return now.getMonth() + 1 >= 7 ? now.getFullYear() + 1 : now.getFullYear()
}

export default function CommunityBenefitPanel() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  const [rateForm, setRateForm] = useState({ fiscal_year: String(currentFy()), category: 'rn_preceptor', hourly_rate: '', note: '' })
  const [capForm, setCapForm] = useState({ fiscal_year: String(currentFy()), school_name: '', hours: '', note: '' })

  // Loading starts true; the effect performs no synchronous setState (state
  // settles in the fetch callback). Post-write refreshes bump the tick and
  // update in place silently.
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
        setLoading(false); return
      }
      setError(null)
      setData(res.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [loadTick])

  const notify = (ok, msg) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 3500) }

  const submitRate = async () => {
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
    setRateForm(f => ({ ...f, hourly_rate: '', note: '' }))
    load()
  }

  const submitCapstone = async () => {
    if (busy) return
    const fy = Number(capForm.fiscal_year)
    const hours = Number(capForm.hours)
    if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) return notify(false, 'Enter a fiscal year between 2020 and 2100.')
    if (!capForm.school_name.trim()) return notify(false, 'A school is required.')
    if (!Number.isFinite(hours) || hours < 0) return notify(false, 'Capstone hours must be a nonnegative number.')
    setBusy(true)
    const res = await callAdmin({ action: 'add_capstone', fiscal_year: fy, school_name: capForm.school_name.trim(), hours, note: capForm.note || null, cohort_id: null })
    setBusy(false)
    if (!res.ok) return notify(false, res.data?.message || 'The capstone entry could not be saved.')
    notify(true, `Capstone hours recorded for FY ${fy}.`)
    setCapForm(f => ({ ...f, hours: '', note: '' }))
    load()
  }

  const voidCapstone = async (id) => {
    if (busy) return
    setBusy(true)
    const res = await callAdmin({ action: 'void_capstone', id })
    setBusy(false)
    if (!res.ok) return notify(false, 'The entry could not be voided.')
    notify(true, 'Entry voided. History preserved.')
    load()
  }

  if (loading) return <div style={{ fontSize: 13, color: '#6b7280', fontFamily: F }}>Loading community-benefit settings…</div>
  if (error) return <div style={{ fontSize: 13, color: '#991b1b', fontFamily: F }}>{error}</div>

  const canEdit = data?.can_edit === true
  const rates = data?.rates || []
  const capstone = data?.capstone_hours || []
  const activeRates = rates.filter(r => !r.superseded_at)
  const supersededRates = rates.filter(r => r.superseded_at)

  return (
    <section aria-labelledby="community-benefit-heading">
      {toast && (
        <div role="status" style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2600, padding: '10px 18px', borderRadius: 10, fontFamily: F, fontSize: 13, fontWeight: 600, background: toast.ok ? '#f0fdf4' : '#fee2e2', color: toast.ok ? '#166534' : '#991b1b', border: `1px solid ${toast.ok ? '#86efac' : '#fca5a5'}` }}>{toast.msg}</div>
      )}
      <h2 id="community-benefit-heading" style={{ ...SETTINGS_HEADING_STYLE, margin: '0 0 4px' }}>Community Benefit</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13.5, color: '#6b7280', fontFamily: F }}>
        Hourly rates and UCLA capstone hours behind the Nursing Academics community-benefit report.
        {canEdit ? ' Only the Owner can enter or change these values.' : ' You are viewing read-only; only the Owner can enter or change these values.'}
      </p>

      {/* Rates */}
      <SurfaceCard padding="16px 18px" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14.5, fontWeight: 700, color: '#1D2567', fontFamily: F }}>Hourly rates</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Fiscal year</th><th style={th}>Category</th><th style={th}>Rate</th><th style={th}>Note</th><th style={th}>Entered</th></tr></thead>
            <tbody>
              {activeRates.length === 0 && (
                <tr><td style={td} colSpan={5}>No active rates entered yet.</td></tr>
              )}
              {activeRates.map(r => (
                <tr key={r.id}>
                  <td style={td}>FY {r.fiscal_year}</td>
                  <td style={td}>{CATEGORY_LABELS[r.category] || r.category}</td>
                  <td style={td}>{money.format(Number(r.hourly_rate))}/hr</td>
                  <td style={td}>{r.note || '-'}</td>
                  <td style={td}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {supersededRates.length > 0 && (
          <details style={{ marginTop: 10, fontFamily: F, fontSize: 12.5, color: '#6b7280' }}>
            <summary style={{ cursor: 'pointer' }}>Rate history ({supersededRates.length} superseded)</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {supersededRates.map(r => (
                <li key={r.id}>FY {r.fiscal_year} · {CATEGORY_LABELS[r.category] || r.category} · {money.format(Number(r.hourly_rate))}/hr · superseded {new Date(r.superseded_at).toLocaleDateString()}</li>
              ))}
            </ul>
          </details>
        )}

        {canEdit && (
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, alignItems: 'end' }}>
            <div>
              <label style={label} htmlFor="cb-rate-fy">Fiscal year (ending)</label>
              <input id="cb-rate-fy" type="number" min="2020" max="2100" style={field} value={rateForm.fiscal_year}
                onChange={e => setRateForm(f => ({ ...f, fiscal_year: e.target.value }))} />
            </div>
            <div>
              <label style={label} htmlFor="cb-rate-cat">Category</label>
              <select id="cb-rate-cat" style={{ ...field, cursor: 'pointer' }} value={rateForm.category}
                onChange={e => setRateForm(f => ({ ...f, category: e.target.value }))}>
                <option value="rn_preceptor">RN Preceptor</option>
                <option value="management">Management (UCLA capstone)</option>
              </select>
            </div>
            <div>
              <label style={label} htmlFor="cb-rate-amt">Hourly rate (USD)</label>
              <input id="cb-rate-amt" type="number" min="0" step="0.01" style={field} value={rateForm.hourly_rate}
                onChange={e => setRateForm(f => ({ ...f, hourly_rate: e.target.value }))} placeholder="e.g. 65" />
            </div>
            <div>
              <label style={label} htmlFor="cb-rate-note">Note (optional)</label>
              <input id="cb-rate-note" style={field} value={rateForm.note}
                onChange={e => setRateForm(f => ({ ...f, note: e.target.value }))} placeholder="Source or context" />
            </div>
            <button type="button" onClick={submitRate} disabled={busy}
              style={{ padding: '9px 14px', border: 'none', borderRadius: 8, background: '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>
              Save rate
            </button>
          </div>
        )}
        <p style={{ margin: '10px 0 0', fontSize: 11.5, color: '#6b7280', fontFamily: F }}>
          Saving a rate for a fiscal year and category supersedes the previous rate; history is preserved above.
        </p>
      </SurfaceCard>

      {/* Capstone hours */}
      <SurfaceCard padding="16px 18px">
        <h3 style={{ margin: '0 0 6px', fontSize: 14.5, fontWeight: 700, color: '#1D2567', fontFamily: F }}>UCLA capstone hours</h3>
        <div role="note" style={{ margin: '0 0 12px', padding: '9px 12px', borderRadius: 8, background: '#FEF3C7', border: '1px solid #fde68a', fontSize: 12.5, color: '#78350F', fontFamily: F }}>
          Enter only capstone project hours that are NOT already recorded as clinical shift hours.
          Hours logged through student shift logs are counted automatically; entering them here would
          double-count the benefit.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Fiscal year</th><th style={th}>School</th><th style={th}>Hours</th><th style={th}>Note</th><th style={th}>Entered</th>{canEdit && <th style={th} aria-label="Actions" />}</tr></thead>
            <tbody>
              {capstone.length === 0 && (
                <tr><td style={td} colSpan={canEdit ? 6 : 5}>No capstone hours recorded yet.</td></tr>
              )}
              {capstone.map(c => (
                <tr key={c.id} style={c.voided_at ? { opacity: 0.55 } : undefined}>
                  <td style={td}>FY {c.fiscal_year}</td>
                  <td style={td}>{c.school_name}</td>
                  <td style={td}>{Number(c.hours)}{c.voided_at ? ' (voided)' : ''}</td>
                  <td style={td}>{c.note || '-'}</td>
                  <td style={td}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '-'}</td>
                  {canEdit && (
                    <td style={td}>
                      {!c.voided_at && (
                        <button type="button" onClick={() => voidCapstone(c.id)} disabled={busy}
                          style={{ padding: '4px 10px', border: '1px solid #d5d9e2', borderRadius: 6, background: '#fff', color: '#991b1b', fontFamily: F, fontSize: 12, cursor: busy ? 'default' : 'pointer' }}>
                          Void
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, alignItems: 'end' }}>
            <div>
              <label style={label} htmlFor="cb-cap-fy">Fiscal year (ending)</label>
              <input id="cb-cap-fy" type="number" min="2020" max="2100" style={field} value={capForm.fiscal_year}
                onChange={e => setCapForm(f => ({ ...f, fiscal_year: e.target.value }))} />
            </div>
            <div>
              <label style={label} htmlFor="cb-cap-school">School</label>
              <select id="cb-cap-school" style={{ ...field, cursor: 'pointer' }} value={capForm.school_name}
                onChange={e => setCapForm(f => ({ ...f, school_name: e.target.value }))}>
                <option value="">Select school</option>
                {SCHOOLS.map(school => <option key={school} value={school}>{school}</option>)}
              </select>
            </div>
            <div>
              <label style={label} htmlFor="cb-cap-hours">Additional capstone hours</label>
              <input id="cb-cap-hours" type="number" min="0" step="0.25" style={field} value={capForm.hours}
                onChange={e => setCapForm(f => ({ ...f, hours: e.target.value }))} placeholder="e.g. 120" />
            </div>
            <div>
              <label style={label} htmlFor="cb-cap-note">Reporting note (optional)</label>
              <input id="cb-cap-note" style={field} value={capForm.note}
                onChange={e => setCapForm(f => ({ ...f, note: e.target.value }))} placeholder="Context for the entry" />
            </div>
            <button type="button" onClick={submitCapstone} disabled={busy}
              style={{ padding: '9px 14px', border: 'none', borderRadius: 8, background: '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>
              Add hours
            </button>
          </div>
        )}
      </SurfaceCard>
    </section>
  )
}
