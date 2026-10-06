// RESIDENCY-APPLICANT-PROFILE-1 (Owner, 2026-10-05): the applicant chart's Profile sheet holds
// the alumnus's Contact Information and Personal Information, "similar to what is in Student
// Profiles > Profile tab". Reused, not redrawn: the same section, header, field, copy row,
// input and "Saved" badge markup and classes as StudentSidePanel's two sections, and the same
// writers (/api/student-update's update_contact and update_profile, which keep their own role
// gates). Interest and Eligibility moved to the Application sheet.
//
// The details come from /api/ngrp-workspace `profile`, because the roster deliberately carries
// no emails. What each audience sees is decided there (lib/server/ngrpApplicantProfile.js).
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Mail, User } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { fetchApplicantProfile } from '../../lib/ngrp/useNgrpData'
import { updateContact, updateProfile } from '../../lib/studentProxy'

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say', 'Other']
const CONTACT_KEYS = ['personal_email', 'phone']

function SectionHeader({ title, icon, children }) {
  return (
    <div className="sp-section-hdr" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', rowGap: 6 }}>
      {icon && <span style={{ opacity: 0.65, flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 11 }}>{title}</span>
      {children}
    </div>
  )
}

function SavedBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9.5, fontWeight: 700,
      color: '#166534', padding: '1px 5px', borderRadius: 6, background: '#dcfce7', marginLeft: 6 }}>
      <Check size={9} /> Saved
    </span>
  )
}

function Field({ label, saved, children }) {
  return (
    <div className="sp-field">
      <label className="sp-field-lbl" style={{ display: 'flex', alignItems: 'center' }}>
        {label}
        {saved && <SavedBadge />}
      </label>
      {children}
    </div>
  )
}

function CopyButton({ value, label }) {
  if (!value) return null
  return (
    <Tooltip label={label} placement="top">
      <button type="button" className="sp-copy-btn" aria-label={label} onClick={() => navigator.clipboard?.writeText(value)}>⎘</button>
    </Tooltip>
  )
}

const note = { margin: '4px 0 0', fontSize: 12, color: 'var(--text-caption)' }

export default function ApplicantProfileSheet({ cycleId, studentId, toast = null }) {
  const qc = useQueryClient()
  const key = ['ngrp_workspace', 'profile', cycleId, studentId]
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchApplicantProfile(cycleId, studentId),
    enabled: Boolean(cycleId && studentId),
    placeholderData: undefined,
  })
  const res = query.data
  const [data, setData] = useState(null)
  const [savedField, setSavedField] = useState(null)
  const timerRef = useRef(null)
  const pendingRef = useRef(null)

  // A new alumnus replaces what is on the page; a refetch of the same one never overwrites
  // what is being typed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(prev => (res?.ok ? (prev && prev.id === res.student.id ? prev : res.student) : null))
  }, [res])
  useEffect(() => () => clearTimeout(timerRef.current), [])

  if (query.isLoading || (query.isFetching && !data)) return <p style={note}>Loading details…</p>
  if (!res?.ok || !data) return <p style={note}>Contact and personal details could not load. Try again in a moment.</p>

  const editContact = res.editable?.contact === true
  const editPersonal = res.editable?.personal === true

  const save = async (fields) => {
    const keys = Object.keys(fields)
    const writer = keys.every(k => CONTACT_KEYS.includes(k)) ? updateContact : updateProfile
    try {
      await writer(studentId, fields)
      const field = keys.length > 1 ? 'name' : keys[0]
      setSavedField(field)
      setTimeout(() => setSavedField(prev => (prev === field ? null : prev)), 1800)
      // A name shows on the roster and the plate too.
      if (keys.some(k => ['first_name', 'last_name', 'preferred_first_name'].includes(k))) {
        qc.invalidateQueries({ queryKey: ['ngrp_workspace', 'applicants'] })
      }
      qc.setQueryData(key, prev => (prev?.ok ? { ...prev, student: { ...prev.student, ...fields } } : prev))
    } catch {
      toast?.error?.('Save failed', 'Unable to save changes. Please try again.')
    }
  }
  const later = (fields) => {
    pendingRef.current = { ...(pendingRef.current || {}), ...fields }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const next = pendingRef.current
      pendingRef.current = null
      // Contact and profile fields go to different writers, so they never share a save.
      const contact = Object.fromEntries(Object.entries(next).filter(([k]) => CONTACT_KEYS.includes(k)))
      const profile = Object.fromEntries(Object.entries(next).filter(([k]) => !CONTACT_KEYS.includes(k)))
      if (Object.keys(contact).length) save(contact)
      if (Object.keys(profile).length) save(profile)
    }, 800)
  }
  const handleText = (field, value) => { setData(p => ({ ...p, [field]: value })); later({ [field]: value }) }
  // The server composes `name` from first and last, so both always go together.
  const handleName = (field, value) => {
    const next = { ...data, [field]: value }
    setData(p => ({ ...p, [field]: value }))
    later({ first_name: next.first_name || '', last_name: next.last_name || '' })
  }
  const handleSelect = (field, value) => { setData(p => ({ ...p, [field]: value })); save({ [field]: value }) }
  const handleDecimal = (field, raw) => {
    const value = raw === '' ? null : parseFloat(raw)
    setData(p => ({ ...p, [field]: value }))
    later({ [field]: value })
  }
  const ro = v => <div className="sp-readonly">{v || '-'}</div>
  const isSaved = f => savedField === f || (savedField === 'name' && (f === 'first_name' || f === 'last_name'))

  return (
    <>
      <div className="sp-section sp-card sp-zone-contact">
        <SectionHeader title="Contact Information" icon={<Mail size={13} />} />
        {res.contactShared ? (
          <>
            <Field label="School Email">
              <div className="sp-copyrow">
                {ro(data.school_email)}
                <CopyButton value={data.school_email} label="Copy email" />
              </div>
            </Field>
            <Field label="Personal Email" saved={isSaved('personal_email')}>
              <div className="sp-copyrow">
                {editContact
                  ? <input className="sp-input" value={data.personal_email || ''} onChange={e => handleText('personal_email', e.target.value)} />
                  : ro(data.personal_email)}
                <CopyButton value={data.personal_email} label="Copy personal email" />
              </div>
            </Field>
            <Field label="Phone" saved={isSaved('phone')}>
              <div className="sp-copyrow">
                {editContact
                  ? <input className="sp-input" value={data.phone || ''} onChange={e => handleText('phone', e.target.value)} />
                  : ro(data.phone)}
                <CopyButton value={data.phone} label="Copy phone" />
              </div>
            </Field>
          </>
        ) : (
          <p style={note}>
            Contact details are shared with Talent Acquisition once this alumnus submits the
            Transition Form, which is where they agree to it.
          </p>
        )}
      </div>

      <div className="sp-section sp-card sp-zone-contact">
        <SectionHeader title="Personal Information" icon={<User size={13} />} />
        <div className="sp-grid-2">
          <Field label="First Name" saved={isSaved('first_name')}>
            {editPersonal
              ? <input className="sp-input" value={data.first_name || ''} onChange={e => handleName('first_name', e.target.value)} />
              : ro(data.first_name)}
          </Field>
          <Field label="Last Name" saved={isSaved('last_name')}>
            {editPersonal
              ? <input className="sp-input" value={data.last_name || ''} onChange={e => handleName('last_name', e.target.value)} />
              : ro(data.last_name)}
          </Field>
          <Field label="Preferred First Name" saved={isSaved('preferred_first_name')}>
            {editPersonal
              ? <input className="sp-input" value={data.preferred_first_name || ''} placeholder="Optional (e.g. Emi)"
                  onChange={e => handleText('preferred_first_name', e.target.value)} />
              : ro(data.preferred_first_name)}
          </Field>
          {res.personal && (
            <>
              <Field label="Date of Birth" saved={isSaved('date_of_birth')}>
                {editPersonal
                  ? <input className="sp-input" type="date" value={data.date_of_birth || ''} onChange={e => handleText('date_of_birth', e.target.value)} />
                  : ro(data.date_of_birth)}
              </Field>
              <Field label="Gender" saved={isSaved('gender')}>
                {editPersonal ? (
                  <select className="sp-select" value={data.gender || ''} onChange={e => handleSelect('gender', e.target.value)}>
                    <option value="">Select…</option>
                    {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                ) : ro(data.gender)}
              </Field>
              <Field label="Cumulative GPA" saved={isSaved('cumulative_gpa')}>
                {editPersonal ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input className="sp-input" type="text" inputMode="decimal" pattern="[0-9.]*"
                      style={{ maxWidth: 80 }} value={data.cumulative_gpa ?? ''} placeholder="0.00"
                      onChange={e => handleDecimal('cumulative_gpa', e.target.value)} />
                    {data.cumulative_gpa != null && !Number.isNaN(parseFloat(data.cumulative_gpa)) && (
                      <span style={{ fontSize: 12, color: 'var(--text-caption)' }}>
                        {parseFloat(data.cumulative_gpa).toFixed(2)} / 4.0
                      </span>
                    )}
                  </div>
                ) : ro(data.cumulative_gpa != null ? `${parseFloat(data.cumulative_gpa).toFixed(2)} / 4.0` : '')}
              </Field>
            </>
          )}
        </div>
      </div>
    </>
  )
}
