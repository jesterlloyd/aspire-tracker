// ADD-ALUMNUS-1 (Owner, 2026-10-29): the alumnus's application profile, on their Residency tab.
// Only what the residency application needs (lib/server/ngrpAddedAlumni.js PROFILE_KEYS),
// nothing from ASPIRE intake; the Transition Form asks the rest. It saves to their own student
// record through api/portal/my-residency.js `profile_save`. The ASPIRE cohort, and a precepted
// unit that comes from their ASPIRE placement, are the program's and read-only here.
import { useState } from 'react'
import { postMyResidency } from '../lib/myResidencyApi'
import { getEligibleUnits, unitOptionLabel } from '../lib/unitCatalog'

const PROGRAMS = ['BSN', 'ABSN / Accelerated BSN', 'MSN (entry-level)', 'ADN', 'Other']

export default function ApplicationProfileCard({ profile, onSaved }) {
  const [p, setP] = useState(() => ({ ...profile }))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = (k, v) => { setP(prev => ({ ...prev, [k]: v })); setMsg(null) }
  const dirty = JSON.stringify(p) !== JSON.stringify(profile)
  const missing = !p.phone || !p.school || !p.program_type || !p.estimated_graduation_date || !p.precepted_unit

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const r = await postMyResidency('profile_save', { profile: p })
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: (r.errors || []).map(x => x.message).join(' ') || 'Your profile could not be saved. Try again.' }); return }
    setMsg({ ok: true, text: 'Saved.' })
    onSaved?.()
  }

  const field = (key, label, input) => (
    <label className="sr-pfield">
      <span className="ptl-field-label">{label}</span>
      {input}
    </label>
  )
  const text = (key, type = 'text') => (
    <input className="ptl-input ptl-input-full" type={type} value={p[key] || ''} onChange={e => set(key, e.target.value)} />
  )

  return (
    <form className="ptl-card" aria-labelledby="sr-profile" onSubmit={save}>
      <h3 id="sr-profile" className="ptl-card-title">Application Profile</h3>
      <p className="ptl-muted" style={{ marginTop: 0 }}>
        {missing
          ? 'Please complete your details. Your ASPIRE team uses them for your residency application.'
          : 'The details your ASPIRE team uses for your residency application. Keep them current.'}
      </p>
      <div className="sr-pgrid">
        {field('first_name', 'Legal first name *', text('first_name'))}
        {field('last_name', 'Legal last name *', text('last_name'))}
        {field('preferred_first_name', 'Preferred first name', text('preferred_first_name'))}
        {field('personal_email', 'Personal email *', text('personal_email', 'email'))}
        {field('phone', 'Mobile phone', text('phone', 'tel'))}
        {field('school', 'Nursing school', text('school'))}
        {field('program_type', 'Program', (
          <select className="ptl-input ptl-input-full" value={p.program_type || ''} onChange={e => set('program_type', e.target.value)}>
            <option value="">Select…</option>
            {[...new Set([...PROGRAMS, p.program_type].filter(Boolean))].map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        ))}
        {field('estimated_graduation_date', 'Graduation or expected completion', text('estimated_graduation_date', 'date'))}
        {field('aspire_cohort', 'ASPIRE cohort', <div className="sr-pstatic">{p.aspire_cohort || 'Not recorded'}</div>)}
        {field('precepted_unit', 'Unit you precepted on', p.precepted_from_placement
          ? <div className="sr-pstatic">{p.precepted_unit}</div>
          : (
            <select className="ptl-input ptl-input-full" value={p.precepted_unit || ''} onChange={e => set('precepted_unit', e.target.value)}>
              <option value="">Select…</option>
              {getEligibleUnits().map(u => <option key={u.name} value={u.name}>{unitOptionLabel(u.name)}</option>)}
            </select>
          ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button type="submit" className="ptl-btn ptl-btn-sm" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save'}</button>
        {msg && <span className={msg.ok ? 'ptl-muted' : 'sr-perror'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span>}
      </div>
    </form>
  )
}
