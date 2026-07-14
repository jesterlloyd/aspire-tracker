// ASPIRE-PORTAL-ACCESS-UI: Grant / Renew scoped portal access. SEPARATE from the
// staff invite modal: portal roles (student, unit_leader, academic_partner)
// never appear in the staff role selector, and this modal never touches staff
// invitation. All writes go through POST /api/invite-portal-user; the browser
// never inserts into the authorization tables. Backend idempotency handles
// renewal (grant_action: created | reused | renewed | reissued).
import { useState, useRef, useEffect, useMemo } from 'react'
import { X, Mail, Loader, ChevronLeft, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PORTAL_ROLE_OPTIONS, PORTAL_ROLE_LABELS } from '../../lib/portalAccessStatus'
import { UNIT_SCOPE_OPTIONS, SCHOOL_SCOPE_OPTIONS } from '../../lib/portalScopeCatalog'

const F = 'DM Sans, sans-serif'
const field = { width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: F, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const label = { display: 'block', fontFamily: F, fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 6 }

const studentName = (s) => s ? [s.preferred_first_name || s.first_name, s.last_name].filter(Boolean).join(' ') : ''

// Accessible multi-select chip picker over a static catalog.
function MultiScopePicker({ id, options, selected, onChange, placeholder }) {
  const [term, setTerm] = useState('')
  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase()
    return options.filter(o => !selected.includes(o.value) && (!t || o.label.toLowerCase().includes(t) || (o.hint || '').toLowerCase().includes(t))).slice(0, 8)
  }, [options, selected, term])
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: selected.length ? 8 : 0 }}>
        {selected.map(v => {
          const o = options.find(x => x.value === v)
          return (
            <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#eef2fb', color: '#1D2567', fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 16 }}>
              {o?.label || v}
              <button type="button" aria-label={`Remove ${o?.label || v}`} onClick={() => onChange(selected.filter(s => s !== v))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1D2567', display: 'flex', padding: 0 }}>
                <X size={12} />
              </button>
            </span>
          )
        })}
      </div>
      <input id={id} value={term} onChange={e => setTerm(e.target.value)} placeholder={placeholder}
        role="combobox" aria-expanded={filtered.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list" style={field} />
      {term.trim() && filtered.length > 0 && (
        <ul id={`${id}-list`} role="listbox" style={{ listStyle: 'none', margin: '6px 0 0', padding: 4, border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 180, overflowY: 'auto' }}>
          {filtered.map(o => (
            <li key={o.value} role="option" aria-selected={false} tabIndex={0}
              onClick={() => { onChange([...selected, o.value]); setTerm('') }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange([...selected, o.value]); setTerm('') } }}
              style={{ padding: '7px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{ fontWeight: 600, color: '#1D2567' }}>{o.label}</span>
              {o.hint && <span style={{ color: '#9ca3af', marginLeft: 6, fontSize: 12 }}>{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Searchable single-select over live students (staff-authorized read; students
// is NOT a protected authorization table).
function StudentPicker({ value, onPick, cohortsById }) {
  const [term, setTerm] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const t = term.trim()
    if (t.length < 2 || value) { setRows([]); return }
    let cancelled = false
    setLoading(true)
    const run = setTimeout(async () => {
      const { data } = await supabase.from('students')
        .select('id, first_name, last_name, preferred_first_name, school, school_email, status, cohort_id')
        .or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%,school_email.ilike.%${t}%`)
        .limit(12)
      if (!cancelled) { setRows(data || []); setLoading(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(run) }
  }, [term, value])

  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid #c7d2fe', background: '#eef2fb', borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#1D2567' }}>{studentName(value)}</div>
          <div style={{ fontSize: 12, color: '#4b5563' }}>{[value.school, cohortsById[value.cohort_id], value.status].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" aria-label="Clear selected student" onClick={() => onPick(null)}
          style={{ background: '#fff', border: '1px solid #c7d2fe', borderRadius: 6, cursor: 'pointer', color: '#1D2567', padding: '4px 8px', fontSize: 12, fontWeight: 600 }}>Change</button>
      </div>
    )
  }
  return (
    <div>
      <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search students by name or school email"
        role="combobox" aria-expanded={rows.length > 0} aria-controls="student-picker-list" aria-autocomplete="list" style={field} />
      {loading && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>Searching…</div>}
      {rows.length > 0 && (
        <ul id="student-picker-list" role="listbox" style={{ listStyle: 'none', margin: '6px 0 0', padding: 4, border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
          {rows.map(s => (
            <li key={s.id} role="option" aria-selected={false} tabIndex={0}
              onClick={() => onPick(s)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(s) } }}
              style={{ padding: '8px 9px', borderRadius: 6, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#1D2567' }}>{studentName(s)}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{[s.school, cohortsById[s.cohort_id], s.status].filter(Boolean).join(' · ')}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const OUTCOME_200 = {
  reused: 'Portal access already active. No changes were needed.',
  renewed: 'Portal access renewed.',
  reissued: 'Portal access reissued.',
  created: 'Portal access granted.',
}

export default function GrantPortalAccessModal({ onClose, onGranted, initial = null }) {
  const isRenew = !!initial
  const [step, setStep] = useState('form') // form | review
  const [role, setRole] = useState(initial?.portal_role || 'student')
  const [fullName, setFullName] = useState(initial?.full_name || '')
  const [email, setEmail] = useState(initial?.email || '')
  const [startsAt, setStartsAt] = useState('') // '' = now
  const [expiresAt, setExpiresAt] = useState(initial?.expires_at ? initial.expires_at.slice(0, 10) : '')
  const [student, setStudent] = useState(null)
  const [unitKeys, setUnitKeys] = useState(initial?.scope?.units?.map(u => u.unit_key) || [])
  const [schoolKeys, setSchoolKeys] = useState(initial?.scope?.schools?.map(s => s.school_key) || [])
  const [cohortId, setCohortId] = useState('')
  const [cohorts, setCohorts] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const firstFieldRef = useRef(null)

  const cohortsById = useMemo(() => Object.fromEntries(cohorts.map(c => [c.id, c.name])), [cohorts])

  useEffect(() => {
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30)
    const onKey = (e) => { if (e.key === 'Escape' && !loading) onClose?.() }
    document.addEventListener('keydown', onKey)
    supabase.from('cohorts').select('id, name').order('created_at', { ascending: false })
      .then(({ data }) => setCohorts(data || []))
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey) }
  }, [onClose, loading])

  const scopeValid =
    role === 'student' ? !!student :
    role === 'unit_leader' ? unitKeys.length > 0 :
    role === 'academic_partner' ? schoolKeys.length > 0 : false
  const formValid = !!email && !!fullName && !!role && scopeValid && !loading

  const buildPayload = () => {
    const base = { role, email: email.trim(), full_name: fullName.trim() }
    if (expiresAt) base.expires_at = new Date(`${expiresAt}T23:59:59`).toISOString()
    if (role === 'student') base.student_id = student?.id
    if (role === 'unit_leader') { base.unit_keys = unitKeys; if (cohortId) base.cohort_id = cohortId }
    if (role === 'academic_partner') { base.school_keys = schoolKeys; if (cohortId) base.cohort_id = cohortId }
    return base
  }

  const submit = async () => {
    if (!formValid || loading) return
    setLoading(true); setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/invite-portal-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(buildPayload()),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 201) {
        setResult({ success: true, message: 'Portal invitation sent and access granted.' })
        onGranted?.(); setTimeout(() => onClose?.(), 1100)
      } else if (res.status === 200) {
        const action = json?.provisioned?.grant_action
        setResult({ success: true, message: OUTCOME_200[action] || 'Portal access updated.' })
        onGranted?.(); setTimeout(() => onClose?.(), 1100)
      } else if (res.status === 409) {
        setResult({ success: false, message: role === 'student'
          ? 'This student record is already linked to another active portal account.'
          : 'That assignment conflicts with an existing active portal account.' })
      } else if (res.status === 400) {
        setResult({ success: false, message: json?.message || 'Please review the highlighted fields and try again.' })
      } else if (res.status === 401 || res.status === 403) {
        setResult({ success: false, message: 'Owner or Admin authorization is required.' })
      } else {
        setResult({ success: false, message: 'Something went wrong. Please try again.' })
      }
    } catch {
      setResult({ success: false, message: 'Something went wrong. Please try again.' })
    }
    setLoading(false)
  }

  const scopeSummary =
    role === 'student' ? (student ? `${studentName(student)}${student.school ? ` · ${student.school}` : ''}` : 'No student selected') :
    role === 'unit_leader' ? (unitKeys.join(', ') || 'No units selected') :
    (schoolKeys.join(', ') || 'No schools selected')

  return (
    <div onClick={() => !loading && onClose?.()} role="dialog" aria-modal="true" aria-label="Grant Portal Access"
      style={{ position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(500px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #f3f4f6' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1D2567' }}>{isRenew ? 'Renew / Edit Portal Access' : 'Grant Portal Access'}</h2>
          <button type="button" onClick={() => !loading && onClose?.()} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4, display: 'flex' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '18px 20px', overflowY: 'auto' }}>
          {/* Scoped-access banner: makes clear this is NOT staff app access. */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#eef2fb', border: '1px solid #dbe3fb', borderRadius: 8, padding: '9px 12px', marginBottom: 16 }}>
            <ShieldCheck size={16} style={{ color: '#1D2567', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: '#3a4a7a', lineHeight: 1.5 }}>
              This grants <strong>scoped portal access</strong>, not staff application access. The portal user only sees the scope you assign below.
            </div>
          </div>

          {step === 'form' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={label} htmlFor="gpa-role">Portal role</label>
                <select id="gpa-role" value={role} disabled={isRenew} onChange={e => setRole(e.target.value)} style={{ ...field, cursor: isRenew ? 'default' : 'pointer', background: isRenew ? '#f9fafb' : '#fff' }}>
                  {PORTAL_ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={label} htmlFor="gpa-name">Full name</label>
                <input id="gpa-name" ref={firstFieldRef} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name" style={field} />
              </div>
              <div style={{ marginBottom: 6 }}>
                <label style={label} htmlFor="gpa-email">Login email</label>
                <input id="gpa-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" style={field} />
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 11.5, color: '#6b7280', lineHeight: 1.5 }}>
                The login email is the address used to access the portal. It does not have to match an email stored on the linked ASPIRE student record.
              </p>

              {role === 'student' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={label}>Linked student record (exactly one)</label>
                  <StudentPicker value={student} onPick={setStudent} cohortsById={cohortsById} />
                </div>
              )}
              {role === 'unit_leader' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={label} htmlFor="gpa-units">Assigned units (at least one)</label>
                  <MultiScopePicker id="gpa-units" options={UNIT_SCOPE_OPTIONS} selected={unitKeys} onChange={setUnitKeys} placeholder="Search units" />
                </div>
              )}
              {role === 'academic_partner' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={label} htmlFor="gpa-schools">Assigned schools (at least one)</label>
                  <MultiScopePicker id="gpa-schools" options={SCHOOL_SCOPE_OPTIONS} selected={schoolKeys} onChange={setSchoolKeys} placeholder="Search schools" />
                </div>
              )}
              {(role === 'unit_leader' || role === 'academic_partner') && (
                <div style={{ marginBottom: 14 }}>
                  <label style={label} htmlFor="gpa-cohort">Cohort (optional)</label>
                  <select id="gpa-cohort" value={cohortId} onChange={e => setCohortId(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                    <option value="">All cohorts</option>
                    {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={label} htmlFor="gpa-start">Access start</label>
                  <input id="gpa-start" type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={field} />
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Defaults to now.</div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label} htmlFor="gpa-exp">Expiration (optional)</label>
                  <input id="gpa-exp" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} style={field} />
                </div>
              </div>
            </>
          )}

          {step === 'review' && (
            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#1D2567' }}>Review portal access</h3>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 9, fontSize: 13 }}>
                <dt style={{ color: '#6b7280' }}>Login email</dt><dd style={{ margin: 0, color: '#191919' }}>{email}</dd>
                <dt style={{ color: '#6b7280' }}>Portal role</dt><dd style={{ margin: 0, color: '#191919' }}>{PORTAL_ROLE_LABELS[role]}</dd>
                <dt style={{ color: '#6b7280' }}>{role === 'student' ? 'Linked student' : 'Assigned scope'}</dt><dd style={{ margin: 0, color: '#191919' }}>{scopeSummary}</dd>
                {(role !== 'student' && cohortId) && (<><dt style={{ color: '#6b7280' }}>Cohort</dt><dd style={{ margin: 0, color: '#191919' }}>{cohortsById[cohortId]}</dd></>)}
                <dt style={{ color: '#6b7280' }}>Start</dt><dd style={{ margin: 0, color: '#191919' }}>{startsAt || 'Now'}</dd>
                <dt style={{ color: '#6b7280' }}>Expiration</dt><dd style={{ margin: 0, color: '#191919' }}>{expiresAt || 'No expiration'}</dd>
              </dl>
              {isRenew && role === 'student' && (
                <div style={{ marginTop: 14, background: '#FEF3C7', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#78350F' }}>
                  Changing the linked student replaces the current student scope. The backend rejects a student already linked to another active account.
                </div>
              )}
            </div>
          )}

          {result && (
            <div role="status" style={{ marginTop: 14, padding: '8px 12px', borderRadius: 8, fontSize: 12, background: result.success ? '#f0fdf4' : '#fff1f2', border: `1px solid ${result.success ? '#86efac' : '#fca5a5'}`, color: result.success ? '#166534' : '#991b1b' }}>
              {result.message}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px 20px', borderTop: '1px solid #f3f4f6' }}>
          <button type="button" onClick={() => step === 'review' ? setStep('form') : onClose?.()} disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: loading ? 'default' : 'pointer' }}>
            {step === 'review' && <ChevronLeft size={14} />}{step === 'review' ? 'Back' : 'Cancel'}
          </button>
          {step === 'form' ? (
            <button type="button" onClick={() => setStep('review')} disabled={!formValid}
              style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: formValid ? '#1D2567' : '#e5e7eb', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: formValid ? 'pointer' : 'default' }}>Review</button>
          ) : (
            <button type="button" onClick={submit} disabled={loading || !formValid}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', border: 'none', borderRadius: 8, background: (loading || !formValid) ? '#e5e7eb' : '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: (loading || !formValid) ? 'default' : 'pointer' }}>
              {loading ? <Loader size={13} /> : <Mail size={13} />} {loading ? 'Granting…' : (isRenew ? 'Confirm changes' : 'Grant access')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
