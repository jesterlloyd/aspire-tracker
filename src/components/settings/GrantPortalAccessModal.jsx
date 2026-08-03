// ASPIRE-PORTAL-ACCESS-UI / ASPIRE-PORTAL-STUDENT-PICKER: Grant / Renew scoped
// portal access. SEPARATE from the staff invite modal: portal roles never appear
// in the staff role selector. All writes go through POST /api/invite-portal-user;
// the browser never touches the authorization tables.
//
// Identity fields reuse the shared saved-Contacts search (src/lib/contactSearch.js,
// the same authorized path Outreach uses). Selecting a saved Contact infers the
// portal role from its canonical category (Unit Leadership -> unit_leader,
// Academic Partners -> academic_partner, a stored Student -> student), fills name
// + email, and suggests the role's scope (units via the catalog; schools via
// alias-aware matching over school_name + organization). For the Student role the
// Full name field IS a unified picker over ASPIRE student records AND Contacts, so
// the Owner never selects the same person twice; the selected students.id is the
// authoritative linkage and the login email is only the sign-in identity.
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { X, Mail, Loader, ChevronLeft, ShieldCheck, Contact as ContactIcon, GraduationCap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PORTAL_ROLE_OPTIONS, PORTAL_ROLE_LABELS } from '../../lib/portalAccessStatus'
import { UNIT_SCOPE_OPTIONS, SCHOOL_SCOPE_OPTIONS } from '../../lib/portalScopeCatalog'
import { useContactSearch, contactSubtitle, matchCatalogKeys, matchSchoolKeys, pickReliableStudent, inferPortalRoleFromContact, bestStudentLoginEmail } from '../../lib/contactSearch'
import ContactSuggest from './ContactSuggest'

const F = 'DM Sans, sans-serif'
const field = { width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: F, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const label = { display: 'block', fontFamily: F, fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 6 }
const UNIT_VALUES = UNIT_SCOPE_OPTIONS.map(o => o.value)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isValidEmail = (e) => EMAIL_RE.test(String(e || '').trim())

const studentName = (s) => s ? [s.preferred_first_name || s.first_name, s.last_name].filter(Boolean).join(' ') : ''
const contactName = (c) => c?.full_name || c?.preferred_name || c?.email || ''
// Available student login emails (live schema exposes school_email + personal_email;
// there is no Cedars-Sinai student email column, so none is shown).
const studentEmailOptions = (s) => !s ? [] : [
  s.school_email && { label: 'School email', value: s.school_email },
  s.personal_email && { label: 'Personal email', value: s.personal_email },
].filter(Boolean)

// Sanitize a free-typed term for PostgREST .or(ilike).
const sanitize = (s) => String(s || '').replace(/[,()%_\\*]/g, ' ').replace(/\s+/g, ' ').trim()

// ── Unified identity picker: Contacts always, ASPIRE students when includeStudents.
//    Searches by full name and every approved student email field. ──
function IdentityPicker({ id, value, onChange, onPickStudent, onPickContact, includeStudents, cohortsById, placeholder, ariaLabel }) {
  const { rows: contactRows, loading: contactsLoading, debounced } = useContactSearch(value)
  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    if (!includeStudents) { setStudents([]); return }
    const term = sanitize(value)
    if (term.length < 2) { setStudents([]); return }
    let cancelled = false; setStudentsLoading(true)
    const run = setTimeout(async () => {
      const like = `%${term}%`
      const { data } = await supabase.from('students')
        .select('id, first_name, last_name, preferred_first_name, school, cohort_id, status, school_email, personal_email, matched_unit_id')
        .or(`first_name.ilike.${like},last_name.ilike.${like},preferred_first_name.ilike.${like},school_email.ilike.${like},personal_email.ilike.${like}`)
        .limit(6)
      if (!cancelled) { setStudents(data || []); setStudentsLoading(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(run) }
  }, [value, includeStudents])

  const results = useMemo(() => {
    const list = []
    if (includeStudents) for (const s of students) list.push({ kind: 'student', key: `stu-${s.id}`, student: s })
    for (const c of contactRows) list.push({ kind: 'contact', key: `con-${c.id}`, contact: c })
    return list
  }, [students, contactRows, includeStudents])

  const loading = contactsLoading || studentsLoading
  const safeActive = results.length ? Math.min(activeIdx, results.length - 1) : 0
  const showNoMatch = open && !loading && debounced.length >= 2 && results.length === 0
  const listboxId = `${id}-listbox`

  const choose = (r) => { if (r.kind === 'student') onPickStudent?.(r.student); else onPickContact?.(r.contact); setOpen(false) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActiveIdx(Math.min(safeActive + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(Math.max(safeActive - 1, 0)) }
    else if (e.key === 'Enter') { if (open && results[safeActive]) { e.preventDefault(); choose(results[safeActive]) } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false) } }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input id={id} value={value}
        onChange={e => { onChange?.(e.target.value); setActiveIdx(0); setOpen(true) }}
        onKeyDown={onKey} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 130)}
        placeholder={placeholder} style={field}
        role="combobox" aria-expanded={open && results.length > 0} aria-controls={listboxId} aria-autocomplete="list"
        aria-label={ariaLabel} aria-activedescendant={open && results[safeActive] ? `${id}-opt-${safeActive}` : undefined} />
      {open && (results.length > 0 || loading || showNoMatch) && (
        <div id={listboxId} role="listbox" aria-label="Search results"
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.12)', maxHeight: 320, overflowY: 'auto', padding: 4 }}>
          {loading && <div style={{ fontSize: 11.5, color: '#9ca3af', padding: '10px' }}>Searching…</div>}
          {showNoMatch && <div style={{ fontSize: 12, color: '#6b7280', padding: '10px', lineHeight: 1.5 }}>No matching student or contact found. You can continue by entering the details manually.</div>}
          {results.map((r, i) => {
            const isActive = i === safeActive
            const isStudent = r.kind === 'student'
            const s = r.student, c = r.contact
            const emails = isStudent ? studentEmailOptions(s).map(e => `${e.label.split(' ')[0]}: ${e.value}`).join(' · ') : ''
            const sub = isStudent
              ? [s.school, cohortsById?.[s.cohort_id], s.status, s.matched_unit_id ? 'Placed' : null].filter(Boolean).join(' · ')
              : contactSubtitle(c)
            return (
              <div key={r.key} id={`${id}-opt-${i}`} role="option" aria-selected={isActive}
                onMouseDown={e => e.preventDefault()} onClick={() => choose(r)} onMouseEnter={() => setActiveIdx(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', cursor: 'pointer', borderRadius: 7, background: isActive ? '#EEF2FB' : 'transparent' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: isStudent ? '#92400e' : '#1D2567', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isStudent ? <GraduationCap size={14} /> : <ContactIcon size={14} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isStudent ? studentName(s) : contactName(c)}</div>
                  <div style={{ fontSize: 10.5, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}{isStudent && emails ? ` · ${emails}` : ''}</div>
                </div>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em', background: isStudent ? '#FEF3C7' : '#EEF2FB', color: isStudent ? '#92400e' : '#1D2567', border: `1px solid ${isStudent ? '#fde68a' : '#c3cdf0'}` }}>{isStudent ? 'ASPIRE student' : 'Saved contact'}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// STAFF-INVITE-CONTACTS-1: the contacts-only typeahead (Unit Leader / Academic
// Partner name field) moved VERBATIM to ./ContactSuggest.jsx so the staff invite
// shares this exact component. Behavior here is unchanged.

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
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1D2567', display: 'flex', padding: 0 }}><X size={12} /></button>
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
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{ fontWeight: 600, color: '#1D2567' }}>{o.label}</span>
              {o.hint && <span style={{ color: '#9ca3af', marginLeft: 6, fontSize: 12 }}>{o.hint}</span>}
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
  const [startsAt, setStartsAt] = useState('')
  const [expiresAt, setExpiresAt] = useState(initial?.expires_at ? initial.expires_at.slice(0, 10) : '')
  const [student, setStudent] = useState(null)
  const [unitKeys, setUnitKeys] = useState(initial?.scope?.units?.map(u => u.unit_key) || [])
  const [schoolKeys, setSchoolKeys] = useState(initial?.scope?.schools?.map(s => s.school_key) || [])
  const [cohortId, setCohortId] = useState('')
  const [cohorts, setCohorts] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  const [unitTouched, setUnitTouched] = useState(!!initial?.scope?.units?.length)
  const [schoolTouched, setSchoolTouched] = useState(!!initial?.scope?.schools?.length)
  const [studentTouched, setStudentTouched] = useState(false)

  const cohortsById = useMemo(() => Object.fromEntries(cohorts.map(c => [c.id, c.name])), [cohorts])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !loading) onClose?.() }
    document.addEventListener('keydown', onKey)
    supabase.from('cohorts').select('id, name').order('created_at', { ascending: false }).then(({ data }) => setCohorts(data || []))
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, loading])

  // Explicit saved-contact selection: infer the role from the contact's category,
  // fill name + email, and suggest the (possibly new) role's scope. A fresh
  // contact resets scope guards so its suggestions apply.
  const applyContactSelection = useCallback(async (c) => {
    if (!c) return
    setResult(null)
    setSelectedContact(c)
    setFullName(contactName(c))
    if (c.email) setEmail(c.email)

    const inferred = inferPortalRoleFromContact(c)
    const targetRole = inferred || role
    if (inferred) setRole(targetRole)
    setUnitTouched(false); setSchoolTouched(false); setStudentTouched(false)

    if (targetRole === 'unit_leader') {
      setStudent(null)
      setUnitKeys(matchCatalogKeys(c.unit_name, UNIT_VALUES))
    } else if (targetRole === 'academic_partner') {
      setStudent(null)
      // Alias-aware, normalized matching over ALL affiliation fields.
      setSchoolKeys(matchSchoolKeys([c.school_name, c.organization], SCHOOL_SCOPE_OPTIONS))
    } else if (targetRole === 'student' && c.email) {
      // Reliable link = exact email match (school or personal) to EXACTLY ONE
      // student. Never by name; ambiguous/zero keeps explicit selection required.
      const em = c.email.trim()
      const { data } = await supabase.from('students')
        .select('id, first_name, last_name, preferred_first_name, school, school_email, personal_email, cohort_id, status, matched_unit_id')
        .or(`school_email.ilike.${em},personal_email.ilike.${em}`)
        .limit(5)
      const match = pickReliableStudent(c.email, data || [])
      if (match) setStudent(match)
    }
  }, [role])

  const suggestUntouchedScope = useCallback((c, roleArg) => {
    if (!c) return
    if (roleArg === 'unit_leader' && !unitTouched) { const k = matchCatalogKeys(c.unit_name, UNIT_VALUES); if (k.length) setUnitKeys(k) }
    else if (roleArg === 'academic_partner' && !schoolTouched) { const k = matchSchoolKeys([c.school_name, c.organization], SCHOOL_SCOPE_OPTIONS); if (k.length) setSchoolKeys(k) }
  }, [unitTouched, schoolTouched])

  // Manual role change: preserve name/email, clear the other role's student link,
  // and offer the selected contact's scope only where untouched.
  const onRoleChange = (next) => {
    setRole(next); setResult(null)
    if (next !== 'student') setStudent(null) // deactivate internal student_id off the Student role
    if (selectedContact) suggestUntouchedScope(selectedContact, next)
  }

  // Explicit ASPIRE student-record selection: authoritative student_id linkage.
  const onPickStudentRecord = useCallback((s) => {
    setResult(null); setStudentTouched(true)
    if (!s) { setStudent(null); return }
    setStudent(s)
    setRole('student')
    setFullName(studentName(s))
    const em = bestStudentLoginEmail(s, null) // school -> personal (no Cedars-Sinai column exists)
    if (em) setEmail(em) // else leave as-is; the manual-entry prompt shows below
  }, [])

  // Validation evaluates ONLY the active role's scope.
  const scopeValid =
    role === 'student' ? !!student :
    role === 'unit_leader' ? unitKeys.length > 0 :
    role === 'academic_partner' ? schoolKeys.length > 0 : false
  const emailValid = isValidEmail(email)
  const formValid = !!fullName.trim() && emailValid && !!role && scopeValid && !loading
  const showStudentEmailPrompt = role === 'student' && !!student && !email.trim()
  const emails = studentEmailOptions(student)

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
        setResult({ success: true, message: OUTCOME_200[json?.provisioned?.grant_action] || 'Portal access updated.' })
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
                <select id="gpa-role" value={role} disabled={isRenew} onChange={e => onRoleChange(e.target.value)} style={{ ...field, cursor: isRenew ? 'default' : 'pointer', background: isRenew ? '#f9fafb' : '#fff' }}>
                  {PORTAL_ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={label} htmlFor="gpa-name">{role === 'student' ? 'Student' : 'Full name'}</label>
                {role === 'student' && student ? (
                  <div style={{ border: '1px solid #c7d2fe', background: '#eef2fb', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#1D2567' }}>{studentName(student)}</div>
                        <div style={{ fontSize: 12, color: '#4b5563' }}>{[student.school, cohortsById[student.cohort_id], student.status, student.matched_unit_id ? 'Placed' : null].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button type="button" onClick={() => setStudent(null)} style={{ background: '#fff', border: '1px solid #c7d2fe', borderRadius: 6, cursor: 'pointer', color: '#1D2567', padding: '4px 8px', fontSize: 12, fontWeight: 600 }}>Change</button>
                        <button type="button" onClick={() => { setStudent(null); setFullName('') }} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', color: '#6b7280', padding: '4px 8px', fontSize: 12, fontWeight: 600 }}>Clear</button>
                      </div>
                    </div>
                    <input value={fullName} onChange={e => setFullName(e.target.value)} aria-label="Full name for the invitation" placeholder="Full name" style={{ ...field, marginTop: 8 }} />
                  </div>
                ) : role === 'student' ? (
                  <IdentityPicker id="gpa-name" value={fullName} onChange={setFullName} onPickStudent={onPickStudentRecord} onPickContact={applyContactSelection}
                    includeStudents cohortsById={cohortsById} placeholder="Search students by name or email" ariaLabel="Student, searches ASPIRE students and saved contacts" />
                ) : (
                  <ContactSuggest id="gpa-name" value={fullName} onChange={setFullName} onPick={applyContactSelection} placeholder="Search saved contacts or type a name" ariaLabel="Full name, searches saved contacts" />
                )}
              </div>

              <div style={{ marginBottom: 6 }}>
                <label style={label} htmlFor="gpa-email">Login email</label>
                <input id="gpa-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" style={field} aria-label="Login email" />
                {role === 'student' && student && emails.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>Use:</span>
                    {emails.map(e => (
                      <button key={e.value} type="button" onClick={() => setEmail(e.value)} aria-label={`Use ${e.label} ${e.value}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 14, border: `1px solid ${email.trim().toLowerCase() === e.value.toLowerCase() ? '#1D2567' : '#d5d9e2'}`, background: email.trim().toLowerCase() === e.value.toLowerCase() ? '#eef2fb' : '#fff', color: '#1D2567', fontFamily: F, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                        {e.label}
                      </button>
                    ))}
                  </div>
                )}
                {showStudentEmailPrompt && <div role="alert" style={{ fontSize: 11.5, color: '#991b1b', marginTop: 5 }}>No email is on file for this student. Enter a login email manually.</div>}
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 11.5, color: '#6b7280', lineHeight: 1.5 }}>
                The login email is the portal sign-in identity. It does not have to match an email stored on the linked ASPIRE student record, and changing it never changes the linked student.
              </p>

              {role === 'unit_leader' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={label} htmlFor="gpa-units">Assigned units (at least one)</label>
                  <MultiScopePicker id="gpa-units" options={UNIT_SCOPE_OPTIONS} selected={unitKeys} onChange={(next) => { setUnitTouched(true); setUnitKeys(next) }} placeholder="Search units" />
                </div>
              )}
              {role === 'academic_partner' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={label} htmlFor="gpa-schools">Assigned schools (at least one)</label>
                  <MultiScopePicker id="gpa-schools" options={SCHOOL_SCOPE_OPTIONS} selected={schoolKeys} onChange={(next) => { setSchoolTouched(true); setSchoolKeys(next) }} placeholder="Search schools" />
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
