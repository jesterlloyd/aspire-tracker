import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { signAndUploadIntakeFile, signAndUploadPortalFile } from '../lib/studentFileClient'
import { evaluateRequiredDocuments } from '../lib/studentDocuments'
import { groupUnitNamesByDivision, getUnit, DIVISION_ORDER } from '../lib/unitCatalog'
import { WEEKDAYS, toggleWeekday, isValidIsoDate } from '../lib/availability'
import {
  STUDENT_FORM_ACK_TITLE, STUDENT_FORM_ACK_BODY, STUDENT_FORM_ACK_CHECKBOX_LABEL,
  STUDENT_FORM_ACK_TYPED_NAME_TEXT, STUDENT_FORM_ACK_FIELD_LABEL, STUDENT_FORM_ACK_HELPER_TEXT,
} from '../lib/studentFormAck'
// STUDENT-PORTAL-PROFILE-1: portal reuse. The SAME component renders the public
// /student-form (no props - behavior unchanged) and the authenticated portal My
// Profile states via the `portal` prop: { mode: 'intake'|'edit'|'locked', student,
// units, onSubmitted, onSaved }. Not an iframe; one field set, one validation chain.
import { buildFormValuesFromStudent } from '../lib/studentProfileFields'
import { PROFILE_LOCKED_MESSAGE } from '../lib/studentProfileLock'
// WS1e-A0: public intake submission now goes through the dedicated
// /api/student-intake-submit endpoint (was: proxyUpdateStudent + setAspireStatus
// + logEvent against the staff student-update path).

const PAGE_TITLE = 'ASPIRE: Student Information Form'

// Unit preference dropdown grouped by division with descriptive option labels.
// Stored value is always the canonical name (e.g., '5 SCCT'); description is display-only.
function UnitPreferenceSelect({ label, value, onChange, availableUnits, excludeValues, placeholder, optional }) {
  const filtered = availableUnits.filter(u => !excludeValues.includes(u))
  const grouped  = groupUnitNamesByDivision(filtered)
  const ordered  = DIVISION_ORDER.filter(d => grouped[d])
  if (grouped['Other']) ordered.push('Other')

  const selectedUnit = getUnit(value)
  // STUDENT-PORTAL-PROFILE-1: a previously stored preference must stay visible even if
  // the unit later left the participating list (edit/locked prefill would otherwise
  // render blank and a save would silently drop it).
  const storedMissing = !!value && !filtered.includes(value)

  return (
    <div className="uf-field">
      <label className="uf-label">{label}</label>
      <select className="uf-input" value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {storedMissing && <option value={value}>{value} (previously selected)</option>}
        {ordered.map(division => (
          <optgroup key={division} label={division}>
            {grouped[division].map(unitName => {
              const entry = getUnit(unitName)
              return (
                <option key={unitName} value={unitName}>
                  {entry ? `${unitName}, ${entry.description}` : unitName}
                </option>
              )
            })}
          </optgroup>
        ))}
      </select>
      {value && selectedUnit && (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{selectedUnit.description}</p>
      )}
    </div>
  )
}

const EXP_ROLES = [
  'CNA', 'Medical Assistant', 'EMT', 'Phlebotomist',
  'Unit Secretary', 'Patient Care Technician', 'Other',
]
const CS_AFFILIATIONS = ['Current Employee', 'Former Employee', 'Volunteer', 'No prior affiliation']
const CS_WITH_DEPT    = ['Current Employee', 'Former Employee', 'Volunteer']

const initForm = () => ({
  school_email: '',
  first_name: '', last_name: '', preferred_first_name: '', personal_email: '', phone: '',
  date_of_birth: '', ssn_last4: '', gender: '',
  cumulative_gpa: '', shift_availability: '',
  has_prior_experience: null,
  exp_roles: Object.fromEntries(EXP_ROLES.map(r => [r, false])),
  exp_other_desc: '',
  cs_affiliation: '', cs_department: '', cs_role: '',
  unit_preference_1: '', unit_preference_2: '', unit_preference_3: '',
  interest_statement: '',
  // AVAILABILITY-CANON-1B: student-owned rotation availability
  unavailable_weekdays: [],
  unavailable_weekdays_reason: '',
  personal_blackout_dates: [],
  weekends_available: null,
  nights_available: null,
  preferred_days: [],
  availability_notes: '',
  availability_ack: false,
  // STUDENT-FORM-INFORMATION-ACKNOWLEDGMENT: checkbox + typed name. Client never sends version/timestamp.
  privacy_ack: false,
  privacy_ack_name: '',
})

const AVAILABILITY_ACK_TEXT =
  'I understand that ASPIRE will consider my availability when matching me to a unit and preceptor, ' +
  'but placement depends on unit capacity, preceptor availability, and clinical learning goals. ' +
  'I understand that failure to disclose recurring availability conflicts may delay matching or require coordinator review.'

// Build the initial form state for a portal mode: intake defaults overlaid with the
// student's stored answers (names/emails prefill even pre-submission; edit/locked
// prefill everything, including the completed acknowledgments).
function initFormFromPortal(portal) {
  if (!portal?.student) return initForm()
  const values = buildFormValuesFromStudent(portal.student, EXP_ROLES)
  const { exp_selected_roles, ...rest } = values
  return {
    ...initForm(),
    ...rest,
    exp_roles: Object.fromEntries(EXP_ROLES.map(r => [r, exp_selected_roles.includes(r)])),
  }
}

export default function StudentIntakeFormPage({ portal = null }) {
  const portalMode = portal?.mode || null            // null | 'intake' | 'edit' | 'locked'
  const isPortalEdit   = portalMode === 'edit'
  const isPortalLocked = portalMode === 'locked'
  // Every portal mode skips the public accepting-cohort gate (Owner refinement): an
  // authenticated LINKED student completes or maintains their profile regardless of
  // whether public intake is open - the student link is the authority, and the units
  // come from the profile endpoint (cohort-scoped). The public /student-form keeps
  // its gate untouched.
  const skipGates = !!portalMode

  const [cohortId,       setCohortId]       = useState(skipGates ? (portal?.student?.cohort_id || null) : null)
  const [cohortName,     setCohortName]     = useState('')
  const [open,           setOpen]           = useState(skipGates ? true : null)
  const [form,           setForm]           = useState(() => initFormFromPortal(portal))
  const [availableUnits, setAvailableUnits] = useState(() => (skipGates ? (portal?.units || []) : []))  // canonical unit names from DB
  const [unitsLoaded,    setUnitsLoaded]    = useState(skipGates)
  const [resumeFile,     setResumeFile]     = useState(null)
  const [headshotFile,   setHeadshotFile]   = useState(null)
  // Durable upload references (canonical storage paths). A path is set only after a SUCCESSFUL signed
  // upload, so a selected-but-not-yet-uploaded or failed file leaves it empty. Kept across submit
  // attempts so an already-successful upload is never restarted; cleared when the file is changed/removed.
  const [resumeUrl,      setResumeUrl]      = useState('')
  const [headshotUrl,    setHeadshotUrl]    = useState('')
  const [docError,       setDocError]       = useState(null)  // Section 4 required-documents message
  const resumeInputRef   = useRef(null)
  const headshotInputRef = useRef(null)
  const docSectionRef    = useRef(null)  // Section 4 container, for scroll-into-view + focus fallback
  const resumeBtnRef     = useRef(null)  // visible "Choose File" button (present only when unselected)
  const headshotBtnRef   = useRef(null)
  const [submitting,     setSubmitting]     = useState(false)
  const [submitted,      setSubmitted]      = useState(false)
  const [error,          setError]          = useState(null)
  const [blackoutInput,  setBlackoutInput]  = useState('')  // AVAILABILITY-CANON-1B: pending blackout date

  useEffect(() => {
    if (!portalMode) document.title = 'ASPIRE Intelligence'
    if (skipGates) return   // edit/locked: profile exists; no accepting-cohort gate
    supabase.from('cohorts').select('id, name').eq('accepting_submissions', true)
      .limit(1).single()
      .then(({ data }) => {
        if (data) { setCohortId(data.id); setCohortName(data.name); setOpen(true) }
        else setOpen(false)
      })
  }, [portalMode, skipGates])

  useEffect(() => {
    if (skipGates || !cohortId) return
    supabase.from('units').select('unit_name')
      .eq('is_participating', true).eq('cohort_id', cohortId).order('unit_name')
      .then(({ data }) => {
        setAvailableUnits((data || []).map(u => u.unit_name))
        setUnitsLoaded(true)
      })
  }, [cohortId, skipGates])

  const set        = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const toggleRole = r => setForm(p => ({ ...p, exp_roles: { ...p.exp_roles, [r]: !p.exp_roles[r] } }))

  // ── ACCIDENTAL-SUBMISSION FIX ──────────────────────────────────────────────────────
  // HTML implicit submission: Enter inside a single-line <input> in a form with a
  // submit button submits the whole form. That is exactly how a student submitted
  // mid-typing (the Availability Reason field was a single-line input, and it is
  // optional, so validation passed). Two-part fix:
  //   1. The reason field is now a real <textarea> (Enter inserts a newline).
  //   2. This form-level guard suppresses implicit submission from every remaining
  //      single-line input, so ONLY the explicit submit button submits. Keyboard
  //      users still activate the button itself with Enter/Space (the event target
  //      is then the BUTTON, which this guard never touches), so accessible
  //      keyboard operation is preserved.
  const preventImplicitSubmit = (e) => {
    if (e.key !== 'Enter') return
    if (e.target instanceof HTMLInputElement) e.preventDefault()
  }

  // Enter in the blackout-date input performs its adjacent explicit action (add the
  // date) instead of doing nothing; the form guard above stops the submission.
  const addBlackoutDate = () => {
    if (isValidIsoDate(blackoutInput) && !form.personal_blackout_dates.includes(blackoutInput)) {
      set('personal_blackout_dates', [...form.personal_blackout_dates, blackoutInput])
    }
    setBlackoutInput('')
  }

  // Shared composition of the stored prior-experience string (intake and portal save).
  const composePriorExperience = () => {
    const selectedRoles = Object.entries(form.exp_roles)
      .filter(([, v]) => v)
      .map(([k]) => k === 'Other' && form.exp_other_desc.trim() ? `Other (${form.exp_other_desc.trim()})` : k)
    return form.has_prior_experience === false
      ? 'No prior experience'
      : selectedRoles.length > 0 ? selectedRoles.join(', ') : 'Yes (no roles specified)'
  }

  // Owner refinement: authenticated FIRST submission from the portal. Uploads go
  // through the portal signer (authorized by the student link, not by intake
  // acceptance), and the submission itself goes to /api/portal/my-profile
  // { action:'submit' }, which enforces the same required fields, acknowledgments,
  // and documents rule as the public endpoint. Durable upload refs are reused across
  // attempts exactly like the public flow, and a failed upload never submits.
  const portalSubmit = async () => {
    setSubmitting(true)
    setError(null)

    let resume_url = resumeUrl
    let headshot_url = headshotUrl
    if (!resume_url && resumeFile) {
      try {
        const { path } = await signAndUploadPortalFile({ studentId: portal.student.id, kind: 'resume', file: resumeFile })
        resume_url = path
        setResumeUrl(path)
      } catch {
        failDocuments('Upload your resume before submitting.', 'resume'); return
      }
    }
    if (!headshot_url && headshotFile) {
      try {
        const { path } = await signAndUploadPortalFile({ studentId: portal.student.id, kind: 'headshot', file: headshotFile })
        headshot_url = path
        setHeadshotUrl(path)
      } catch {
        failDocuments('Upload your headshot before submitting.', 'headshot'); return
      }
    }
    // Defense in depth: a document already on the record also satisfies the server rule.
    const onFile = portal?.documents || {}
    if (!resume_url && !onFile.resume_on_file)     { failDocuments('Upload your resume before submitting.', 'resume'); return }
    if (!headshot_url && !onFile.headshot_on_file) { failDocuments('Upload your headshot before submitting.', 'headshot'); return }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/portal/my-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          action: 'submit',
          student_id: portal.student.id,
          expected_updated_at: portal.student.updated_at,
          first_name:                 form.first_name.trim(),
          last_name:                  form.last_name.trim(),
          preferred_first_name:       form.preferred_first_name.trim(),
          personal_email:             form.personal_email.trim(),
          phone:                      form.phone.trim(),
          date_of_birth:              form.date_of_birth,
          ssn_last4:                  form.ssn_last4.trim(),
          gender:                     form.gender,
          cs_affiliation:             form.cs_affiliation,
          cs_department:              form.cs_department.trim(),
          cs_role:                    form.cs_role.trim(),
          prior_healthcare_experience: composePriorExperience(),
          unit_preference_1:          form.unit_preference_1,
          unit_preference_2:          form.unit_preference_2,
          unit_preference_3:          form.unit_preference_3,
          cumulative_gpa:             form.cumulative_gpa,
          shift_availability:         form.shift_availability,
          interest_statement:         form.interest_statement.trim(),
          unavailable_weekdays:        form.unavailable_weekdays,
          unavailable_weekdays_reason: form.unavailable_weekdays_reason.trim(),
          personal_blackout_dates:     form.personal_blackout_dates,
          weekends_available:          form.weekends_available,
          nights_available:            form.nights_available,
          preferred_days:              form.preferred_days,
          availability_notes:          form.availability_notes.trim(),
          availability_ack:            form.availability_ack,
          privacy_ack:                 form.privacy_ack,
          privacy_ack_name:            form.privacy_ack_name.trim(),
          ...(resume_url   && { resume_url }),
          ...(headshot_url && { headshot_url }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || 'Something went wrong. Please try again or contact the ASPIRE team.')
        setSubmitting(false)
        return
      }
      setSubmitted(true)
      portal?.onSubmitted?.()
    } catch {
      setError('Something went wrong. Please try again or contact the ASPIRE team.')
      setSubmitting(false)
    }
  }

  // ── STUDENT-PORTAL-PROFILE-1: authenticated edit-save (post-submission, pre-lock) ──
  // Sends every editable field from the prefilled form, so an untouched field
  // round-trips its stored value and an emptied optional field is an EXPLICIT clear.
  // expected_updated_at makes a stale portal tab a 409, never a silent overwrite.
  const portalSave = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/portal/my-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          action: 'save',
          student_id: portal.student.id,
          expected_updated_at: portal.student.updated_at,
          first_name:                 form.first_name.trim(),
          last_name:                  form.last_name.trim(),
          preferred_first_name:       form.preferred_first_name.trim(),
          personal_email:             form.personal_email.trim(),
          phone:                      form.phone.trim(),
          date_of_birth:              form.date_of_birth,
          ssn_last4:                  form.ssn_last4.trim(),
          gender:                     form.gender,
          cs_affiliation:             form.cs_affiliation,
          cs_department:              form.cs_department.trim(),
          cs_role:                    form.cs_role.trim(),
          prior_healthcare_experience: composePriorExperience(),
          unit_preference_1:          form.unit_preference_1,
          unit_preference_2:          form.unit_preference_2,
          unit_preference_3:          form.unit_preference_3,
          cumulative_gpa:             form.cumulative_gpa,
          shift_availability:         form.shift_availability,
          interest_statement:         form.interest_statement.trim(),
          unavailable_weekdays:        form.unavailable_weekdays,
          unavailable_weekdays_reason: form.unavailable_weekdays_reason.trim(),
          personal_blackout_dates:     form.personal_blackout_dates,
          weekends_available:          form.weekends_available,
          nights_available:            form.nights_available,
          preferred_days:              form.preferred_days,
          availability_notes:          form.availability_notes.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.error === 'stale_write') portal?.onStale?.()
        setError(data.message || 'We could not save your changes. Please try again.')
        setSubmitting(false)
        return
      }
      setSubmitting(false)
      portal?.onSaved?.(data.updated_at)
    } catch {
      setError('We could not save your changes. Please try again.')
      setSubmitting(false)
    }
  }

  // Surface a required-documents failure: show the message in Section 4, scroll it into view, and move
  // focus to the first missing upload control (its visible button when unselected, else the section).
  const failDocuments = (message, firstMissing) => {
    setDocError(message)
    setSubmitting(false)
    docSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const btn = firstMissing === 'resume' ? resumeBtnRef.current : headshotBtnRef.current
    if (btn) btn.focus()
    else docSectionRef.current?.focus()
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (isPortalLocked || submitting) return   // read-only mode / double-submit guard

    if (!form.school_email.trim()) {
      setError('Please enter your school email address.'); return
    }
    if (!form.first_name.trim() || !form.last_name.trim() || !form.personal_email.trim() || !form.phone.trim()) {
      setError('Please fill in all required personal information fields.'); return
    }
    if (!form.date_of_birth) { setError('Please enter your date of birth.'); return }
    if (!/^\d{4}$/.test(form.ssn_last4.trim())) {
      setError('SSN last 4 digits must be exactly 4 numbers.'); return
    }
    if (form.has_prior_experience === null) {
      setError('Please indicate whether you have prior healthcare experience.'); return
    }
    if (!form.cs_affiliation) {
      setError('Please select your Cedars-Sinai affiliation status.'); return
    }
    if (CS_WITH_DEPT.includes(form.cs_affiliation)) {
      if (!form.cs_department.trim()) {
        setError('Please enter your department.'); return
      }
      if (!form.cs_role.trim()) {
        setError('Please enter your role or job title.'); return
      }
    }
    if (!form.unit_preference_1) {
      setError('Please select at least your first unit preference.'); return
    }
    if (!form.cumulative_gpa || isNaN(parseFloat(form.cumulative_gpa))) {
      setError('Please enter your cumulative GPA.'); return
    }
    if (!form.shift_availability) {
      setError('Please select your shift preference.'); return
    }
    if (!form.interest_statement.trim() || form.interest_statement.trim().length < 50) {
      setError('Please share why you are interested in Cedars-Sinai (at least 50 characters).'); return
    }
    // STUDENT-PORTAL-PROFILE-1: an authenticated edit reuses every field rule above,
    // then saves through the portal endpoint. Acknowledgment and document checks are
    // first-submission requirements; both are already durably recorded on the row.
    if (isPortalEdit) { await portalSave(); return }

    if (!form.availability_ack) {
      setError('Please acknowledge the availability statement before submitting.'); return
    }
    // STUDENT-FORM-INFORMATION-ACKNOWLEDGMENT: checkbox required; typed name trim-non-empty only (no match).
    if (!form.privacy_ack) {
      setError('Please complete the Student Information Use Acknowledgment before submitting.'); return
    }
    if (!form.privacy_ack_name.trim()) {
      setError('Please type your full name in the Student Information Use Acknowledgment.'); return
    }
    // Section 4 Documents are REQUIRED. Both a resume and a headshot must be provided. A durable
    // upload reference (from a prior successful upload) or a freshly selected file both count here;
    // a failed upload is caught below and never treated as complete. The API re-checks server-side.
    const missingDoc = evaluateRequiredDocuments({
      // Portal intake honors a document already durably on the record (same rule the
      // server enforces), so a returning student only supplies what is missing.
      hasResume:   !!resumeFile   || !!resumeUrl   || (portalMode === 'intake' && !!portal?.documents?.resume_on_file),
      hasHeadshot: !!headshotFile || !!headshotUrl || (portalMode === 'intake' && !!portal?.documents?.headshot_on_file),
    })
    if (missingDoc) { setError(null); failDocuments(missingDoc.message, missingDoc.field); return }
    setDocError(null)

    // Owner refinement: the authenticated portal first submission uploads through the
    // portal signer and submits through /api/portal/my-profile (the student link is
    // the authority; no public acceptance gate). The public path below is unchanged.
    if (portalMode === 'intake') { await portalSubmit(); return }

    setSubmitting(true)
    setError(null)

    // PHASE0B-WAVE-D: cohort + student resolution moved server-side. The
    // lookup endpoint applies the same exactly-one-cohort / exactly-one-student
    // semantics as student-intake-submit and returns ONLY opaque IDs (used
    // below solely to build the file-upload paths). The client no longer reads
    // the students table directly, so its anon RLS policy can be dropped.
    const cleanEmail = form.school_email.trim().toLowerCase()

    // Early validation: confirm the email resolves before uploading or
    // submitting, so the applicant sees the same message at this step as they
    // would at submit. The signed-upload endpoint re-resolves server-side; the
    // client no longer needs the returned ids (paths are server-constructed).
    try {
      const lookupRes = await fetch('/api/student-intake-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_email: cleanEmail }),
      })
      if (!lookupRes.ok) {
        const lookupData = await lookupRes.json().catch(() => ({}))
        setError(lookupData.message || 'We could not find your information in our system for the current cycle. Please contact the ASPIRE team to confirm your school email on file.')
        setSubmitting(false)
        return
      }
    } catch {
      setError('Something went wrong. Please try again or contact the ASPIRE team.')
      setSubmitting(false)
      return
    }

    // WAVE F-2: uploads go through a server-issued signed upload URL. The server
    // resolves the student by school email and constructs the object path; the
    // browser no longer chooses a path or writes storage directly. The stored
    // WAVE F-2 PASS 2: persist the server-returned CANONICAL object path
    // (<cohort>/<student>/<kind>.<ext>), never a public or signed URL. Reads resolve
    // this path through the server access endpoint. The compatibility resolver still
    // accepts any legacy public URL that predates this change.
    // Both documents are required, so an upload failure is now FATAL (never submit a partial
    // application). Reuse a reference from a prior successful upload so a completed upload is not
    // restarted; only upload a file that has not yet produced a durable reference.
    let resume_url = resumeUrl
    let headshot_url = headshotUrl

    if (!resume_url && resumeFile) {
      try {
        const { path } = await signAndUploadIntakeFile({ schoolEmail: cleanEmail, kind: 'resume', file: resumeFile })
        resume_url = path
        setResumeUrl(path)
      } catch {
        failDocuments('Upload your resume before submitting.', 'resume'); return
      }
    }
    if (!headshot_url && headshotFile) {
      try {
        const { path } = await signAndUploadIntakeFile({ schoolEmail: cleanEmail, kind: 'headshot', file: headshotFile })
        headshot_url = path
        setHeadshotUrl(path)
      } catch {
        failDocuments('Upload your headshot before submitting.', 'headshot'); return
      }
    }
    // Defense in depth: never submit unless BOTH durable references now exist.
    if (!resume_url)   { failDocuments('Upload your resume before submitting.', 'resume'); return }
    if (!headshot_url) { failDocuments('Upload your headshot before submitting.', 'headshot'); return }

    const prior_healthcare_experience = composePriorExperience()

    // WS1e-A0: submit via the dedicated public intake endpoint. The student is
    // re-resolved server-side by school_email within the accepting cohort; the
    // server sets submitted_via, status='Form Received', and logs the event.
    // (studentId/activeCohortId above are used only for the file-upload paths.)
    const payload = {
      school_email:               cleanEmail,
      first_name:                 form.first_name.trim(),
      last_name:                  form.last_name.trim(),
      preferred_first_name:       form.preferred_first_name.trim(),
      personal_email:             form.personal_email.trim(),
      phone:                      form.phone.trim(),
      date_of_birth:              form.date_of_birth,
      ssn_last4:                  form.ssn_last4.trim(),
      gender:                     form.gender,
      cs_affiliation:             form.cs_affiliation,
      cs_department:              form.cs_department.trim(),
      cs_role:                    form.cs_role.trim(),
      prior_healthcare_experience,
      unit_preference_1:          form.unit_preference_1,
      unit_preference_2:          form.unit_preference_2,
      unit_preference_3:          form.unit_preference_3,
      cumulative_gpa:             form.cumulative_gpa,
      shift_availability:         form.shift_availability,
      interest_statement:         form.interest_statement.trim(),
      // AVAILABILITY-CANON-1B: student-owned availability
      unavailable_weekdays:        form.unavailable_weekdays,
      unavailable_weekdays_reason: form.unavailable_weekdays_reason.trim(),
      personal_blackout_dates:     form.personal_blackout_dates,
      weekends_available:          form.weekends_available,
      nights_available:            form.nights_available,
      preferred_days:              form.preferred_days,
      availability_notes:          form.availability_notes.trim(),
      availability_ack:            form.availability_ack,
      privacy_ack:                 form.privacy_ack,
      privacy_ack_name:            form.privacy_ack_name.trim(),
      ...(resume_url   && { resume_url }),
      ...(headshot_url && { headshot_url }),
    }

    try {
      const res = await fetch('/api/student-intake-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || 'Something went wrong. Please try again or contact the ASPIRE team.')
        setSubmitting(false)
        return
      }
    } catch (submitErr) {
      setError('Something went wrong. Please try again or contact the ASPIRE team.')
      setSubmitting(false)
      return
    }
    setSubmitted(true)
    // Portal intake: tell My Profile the canonical record advanced so it can refetch
    // and move to the submitted/editable state (the success screen shows meanwhile).
    portal?.onSubmitted?.()
  }

  // Early states keep the public page chrome; inside the portal the same cards render
  // without the full-page wrapper (the portal shell provides the page).
  const wrapClass = portalMode ? undefined : 'uf-page'

  if (open === null) return (
    <div className={wrapClass}>
      <div className="uf-card" style={{ textAlign: 'center', padding: '60px 40px' }}>
        {!portalMode && <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />}
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      </div>
    </div>
  )

  if (open === false) return (
    <div className={wrapClass}>
      <div className="uf-card" style={{ textAlign: 'center', padding: '56px 40px' }}>
        {!portalMode && <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />}
        <h2 className="uf-title" style={{ marginBottom: 12 }}>{PAGE_TITLE}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6 }}>
          This form is not currently accepting submissions. Please contact the ASPIRE team.
        </p>
      </div>
    </div>
  )

  if (submitted) return (
    <div className={wrapClass}>
      <div className="uf-card uf-card-confirm">
        {!portalMode && <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />}
        <div className="uf-confirm-icon">✓</div>
        <h2 className="uf-confirm-title">Thank you, {form.first_name}.</h2>
        <p className="uf-confirm-msg">
          Your information has been received. The ASPIRE team will follow up with next steps.
        </p>
      </div>
    </div>
  )

  return (
    <div className={portalMode ? undefined : 'uf-page'}>
      <div className={portalMode ? 'sf-card' : 'uf-card sf-card'} style={portalMode ? { background: 'transparent' } : undefined}>
        {/* Portal states carry their own chrome (My Profile header, state badge); the
            public page keeps its logo and title untouched. */}
        {!portalMode && (
          <>
            <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
            <div className="uf-header">
              <h1 className="uf-title">{PAGE_TITLE}</h1>
              {cohortName && <div className="uf-cohort-badge">{cohortName}</div>}
              <p className="uf-subtitle">
                Please complete this form to provide information needed for your clinical rotation at
                Cedars-Sinai. This form is intended for your use only and should not be shared.
              </p>
            </div>
          </>
        )}

        {isPortalLocked && (
          <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#ede9fe',
            border: '1px solid #c4b5fd', borderRadius: 10, padding: '12px 14px', margin: '0 0 16px',
            fontSize: 13.5, lineHeight: 1.55, color: '#4c1d95' }}>
            <span aria-hidden="true" style={{ fontSize: 15 }}>🔒</span>
            <span>{PROFILE_LOCKED_MESSAGE}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} onKeyDown={preventImplicitSubmit} className="uf-form">
          {error && <div className="error-msg" style={{ marginBottom: 8 }}>{error}</div>}
          <fieldset disabled={isPortalLocked} style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>

          {/* ── Section 1: Personal Information ── */}
          <div className="uf-section">
            <div className="sf-section-title">Section 1: Personal Information</div>

            <div className="uf-field">
              <label className="uf-label">School or University Email Address *</label>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Enter the email address your school coordinator used to register you with ASPIRE.
              </p>
              <input className="uf-input" type="email" value={form.school_email}
                onChange={e => set('school_email', e.target.value)}
                readOnly={!!portalMode}
                style={portalMode ? { background: '#f3f4f6', cursor: 'not-allowed' } : undefined}
                aria-describedby={portalMode ? 'sf-email-bound' : undefined}
                placeholder="yourname@school.edu" />
              {portalMode && (
                <p id="sf-email-bound" style={{ fontSize: 12, color: '#6b7280', marginTop: 5 }}>
                  This is the email your ASPIRE record is registered under. Contact the ASPIRE team if it needs to change.
                </p>
              )}
            </div>

            <div className="sf-row-2">
              <div className="uf-field">
                <label className="uf-label">First Name *</label>
                <input className="uf-input" value={form.first_name}
                  onChange={e => set('first_name', e.target.value)} placeholder="First" />
              </div>
              <div className="uf-field">
                <label className="uf-label">Last Name *</label>
                <input className="uf-input" value={form.last_name}
                  onChange={e => set('last_name', e.target.value)} placeholder="Last" />
              </div>
            </div>

            {/* STUDENT-PREFERRED-FIRST-NAME-1A: optional preferred FIRST name (last name unchanged). */}
            <div className="uf-field">
              <label className="uf-label">Preferred first name (if different from legal first name)</label>
              <input className="uf-input" value={form.preferred_first_name}
                onChange={e => set('preferred_first_name', e.target.value)} placeholder="e.g. Emi" />
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 5, lineHeight: 1.4 }}>
                If you go by a different first name in conversation, you can enter it here. We’ll use it in emails, shift logs, and badges.
              </div>
            </div>

            <div className="sf-row-2">
              <div className="uf-field">
                <label className="uf-label">Personal Email *</label>
                <input className="uf-input" type="email" value={form.personal_email}
                  onChange={e => set('personal_email', e.target.value)} placeholder="you@email.com" />
              </div>
              <div className="uf-field">
                <label className="uf-label">Phone Number *</label>
                <input className="uf-input" type="tel" value={form.phone}
                  onChange={e => set('phone', e.target.value)} placeholder="(555) 000-0000" />
              </div>
            </div>

            <div className="uf-field">
              <label className="uf-label">Date of Birth *</label>
              <input className="uf-input" type="date" value={form.date_of_birth}
                onChange={e => set('date_of_birth', e.target.value)} />
            </div>

            <div className="uf-field">
              <label className="uf-label">Last 4 Digits of SSN *</label>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.45 }}>
                This information is used solely for system access creation and is handled securely.
              </p>
              <input className="uf-input uf-input-sm" type="text" inputMode="numeric"
                maxLength={4} placeholder="••••" value={form.ssn_last4}
                onChange={e => set('ssn_last4', e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>

            <div className="uf-field">
              <label className="uf-label">Gender</label>
              <select className="uf-input" value={form.gender} onChange={e => set('gender', e.target.value)}
  >
                <option value="">Select…</option>
                <option>Male</option><option>Female</option>
                <option>Non-binary</option><option>Prefer not to say</option><option>Other</option>
              </select>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div className="uf-field">
                <label className="uf-label">Cumulative GPA (on a 4.0 scale) *</label>
                <input className="uf-input" type="text" inputMode="decimal" pattern="[0-9.]*"
                  value={form.cumulative_gpa}
                  onChange={e => set('cumulative_gpa', e.target.value)}
                  placeholder="e.g. 3.75" />
              </div>
              <div className="uf-field">
                <label className="uf-label">Shift Preference *</label>
                <select className="uf-input" value={form.shift_availability}
                  onChange={e => set('shift_availability', e.target.value)}
                >
                  <option value="">Select…</option>
                  <option value="Day Shift Preferred">Day Shift Preferred</option>
                  <option value="Night Shift Preferred">Night Shift Preferred</option>
                  <option value="No Preference">No Preference</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Section 2: Background and Affiliation ── */}
          <div className="uf-section">
            <div className="sf-section-title">Section 2: Background and Affiliation</div>

            <div className="uf-field">
              <label className="uf-label">Do you have prior healthcare experience? *</label>
              <div className="uf-radio-group">
                <label className="uf-radio-label">
                  <input type="radio" name="has_exp" checked={form.has_prior_experience === true}
                    onChange={() => set('has_prior_experience', true)} /><span>Yes</span>
                </label>
                <label className="uf-radio-label">
                  <input type="radio" name="has_exp" checked={form.has_prior_experience === false}
                    onChange={() => set('has_prior_experience', false)} /><span>No</span>
                </label>
              </div>
            </div>

            {form.has_prior_experience === true && (
              <>
                <div className="uf-field">
                  <label className="uf-label">If yes, what role(s)?</label>
                  <div className="uf-checkbox-group">
                    {EXP_ROLES.map(r => (
                      <label key={r} className="uf-check-label">
                        <input type="checkbox" checked={form.exp_roles[r]} onChange={() => toggleRole(r)} />
                        <span>{r}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {form.exp_roles['Other'] && (
                  <div className="uf-field">
                    <label className="uf-label">If Other, please describe</label>
                    <input className="uf-input" value={form.exp_other_desc}
                      onChange={e => set('exp_other_desc', e.target.value)}
                      placeholder="Describe your experience…" />
                  </div>
                )}
              </>
            )}

            <div className="uf-field">
              <label className="uf-label">Current or prior Cedars-Sinai affiliation *</label>
              <div className="uf-radio-group">
                {CS_AFFILIATIONS.map(a => (
                  <label key={a} className="uf-radio-label">
                    <input type="radio" name="cs_affiliation" checked={form.cs_affiliation === a}
                      onChange={() => set('cs_affiliation', a)} /><span>{a}</span>
                  </label>
                ))}
              </div>
            </div>

            {CS_WITH_DEPT.includes(form.cs_affiliation) && (
              <div className="sf-row-2">
                <div className="uf-field">
                  <label className="uf-label">Department *</label>
                  <input className="uf-input" value={form.cs_department}
                    onChange={e => set('cs_department', e.target.value)}
                    placeholder="e.g. 6 NW, Labor and Delivery, Radiology" />
                </div>
                <div className="uf-field">
                  <label className="uf-label">Role or Job Title *</label>
                  <input className="uf-input" value={form.cs_role}
                    onChange={e => set('cs_role', e.target.value)}
                    placeholder="e.g. RN, Patient Care Tech, Volunteer" />
                </div>
              </div>
            )}
          </div>

          {/* ── Section 3: Unit Placement Preferences ── */}
          <div className="uf-section">
            <div className="sf-section-title">Section 3: Unit Placement Preferences</div>

            {unitsLoaded && availableUnits.length > 0 && (
              <div className="uf-info-box">
                The units listed below have confirmed their availability to host ASPIRE students for
                this rotation cycle. Units not listed have not opted in for this cycle or are still
                being confirmed. This list is updated as unit responses are received.
              </div>
            )}

            {!unitsLoaded ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading unit options…</p>
            ) : availableUnits.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.65 }}>
                Unit availability is still being finalized. You may submit the form now and update
                your preferences later.
              </p>
            ) : (
              <>
                <UnitPreferenceSelect
                  label="First Preference *"
                  value={form.unit_preference_1}
                  onChange={v => setForm(p => ({
                    ...p, unit_preference_1: v,
                    unit_preference_2: p.unit_preference_2 === v ? '' : p.unit_preference_2,
                    unit_preference_3: p.unit_preference_3 === v ? '' : p.unit_preference_3,
                  }))}
                  availableUnits={availableUnits}
                  excludeValues={[]}
                  placeholder="Select a unit…"
                />
                <UnitPreferenceSelect
                  label="Second Preference (optional)"
                  value={form.unit_preference_2}
                  onChange={v => setForm(p => ({
                    ...p, unit_preference_2: v,
                    unit_preference_3: p.unit_preference_3 === v ? '' : p.unit_preference_3,
                  }))}
                  availableUnits={availableUnits}
                  excludeValues={[form.unit_preference_1].filter(Boolean)}
                  placeholder="No preference"
                  optional
                />
                <UnitPreferenceSelect
                  label="Third Preference (optional)"
                  value={form.unit_preference_3}
                  onChange={v => set('unit_preference_3', v)}
                  availableUnits={availableUnits}
                  excludeValues={[form.unit_preference_1, form.unit_preference_2].filter(Boolean)}
                  placeholder="No preference"
                  optional
                />
              </>
            )}
          </div>

          {/* ── Section 4: Documents (required) ── */}
          {/* STUDENT-PORTAL-PROFILE-1: after submission, documents display as on-file
              records; replacement is staff-mediated (badge and interview prep depend
              on them), so edit/locked modes never re-open the upload flow. */}
          {(isPortalEdit || isPortalLocked) ? (
            <div className="uf-section">
              <div className="sf-section-title">Section 4: Documents</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                  <span aria-hidden="true">📄</span>
                  <span style={{ fontWeight: 600 }}>Resume</span>
                  <span style={{ color: portal?.documents?.resume_on_file ? '#16a34a' : '#b45309' }}>
                    {portal?.documents?.resume_on_file ? 'On file' : 'Not on file'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                  <span aria-hidden="true">🖼</span>
                  <span style={{ fontWeight: 600 }}>Headshot</span>
                  <span style={{ color: portal?.documents?.headshot_on_file ? '#16a34a' : '#b45309' }}>
                    {portal?.documents?.headshot_on_file ? 'On file' : 'Not on file'}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0', lineHeight: 1.5 }}>
                  To replace a submitted document, contact the ASPIRE team at aspire@cshs.org.
                </p>
              </div>
            </div>
          ) : (
          <div className="uf-section" ref={docSectionRef} tabIndex={-1}>
            <div className="sf-section-title">Section 4: Documents *</div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -4, marginBottom: 10, lineHeight: 1.5 }} id="sf-doc-help">
              Upload both documents to continue. Your headshot is required for badge creation, and your resume supports interview preparation.
            </p>
            {docError && (
              <div className="error-msg" role="alert" id="sf-doc-error" style={{ marginBottom: 10 }}>{docError}</div>
            )}
            <div className="doc-section">

              {/* Resume (required) */}
              <div className="doc-upload-area">
                <div className="doc-area-label">Resume *</div>
                <input ref={resumeInputRef} type="file" style={{ display: 'none' }}
                  accept=".pdf,.doc,.docx" aria-required="true" aria-describedby="sf-doc-help"
                  onChange={e => {
                    const f = e.target.files[0]
                    if (f && f.size > 10 * 1024 * 1024) { setError('Resume must be under 10MB.'); return }
                    // A new/removed file invalidates any prior durable upload for this slot.
                    setResumeFile(f || null); setResumeUrl(''); if (f) setDocError(null)
                  }} />
                {resumeFile ? (
                  <div className="doc-existing-file">
                    <span className="doc-file-link">📄 {resumeFile.name}</span>
                    <button type="button" className="doc-replace-btn"
                      onClick={() => { setResumeFile(null); setResumeUrl(''); if (resumeInputRef.current) resumeInputRef.current.value = '' }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => resumeInputRef.current?.click()}>
                    <span className="doc-zone-icon">📄</span>
                    <span className="doc-zone-text">Upload Resume (PDF or Word, max 10MB)</span>
                    <button type="button" className="doc-zone-btn" ref={resumeBtnRef}
                      onClick={e => { e.stopPropagation(); resumeInputRef.current?.click() }}>
                      Choose File
                    </button>
                  </div>
                )}
              </div>

              {/* Headshot (required) */}
              <div className="doc-upload-area">
                <div className="doc-area-label">Headshot *</div>
                <input ref={headshotInputRef} type="file" style={{ display: 'none' }}
                  accept=".jpg,.jpeg,.png" aria-required="true" aria-describedby="sf-doc-help"
                  onChange={e => {
                    const f = e.target.files[0]
                    if (f && f.size > 5 * 1024 * 1024) { setError('Headshot must be under 5MB.'); return }
                    // A new/removed file invalidates any prior durable upload for this slot.
                    setHeadshotFile(f || null); setHeadshotUrl(''); if (f) setDocError(null)
                  }} />
                {headshotFile ? (
                  <div className="doc-existing-file">
                    <span className="doc-file-link">🖼 {headshotFile.name}</span>
                    <button type="button" className="doc-replace-btn"
                      onClick={() => { setHeadshotFile(null); setHeadshotUrl(''); if (headshotInputRef.current) headshotInputRef.current.value = '' }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => headshotInputRef.current?.click()}>
                    <span className="doc-zone-icon">🖼</span>
                    <span className="doc-zone-text">Upload Headshot (JPG or PNG, max 5MB)</span>
                    <button type="button" className="doc-zone-btn" ref={headshotBtnRef}
                      onClick={e => { e.stopPropagation(); headshotInputRef.current?.click() }}>
                      Choose File
                    </button>
                  </div>
                )}
              </div>

            </div>
          </div>
          )}

          {/* ── Rotation Availability (AVAILABILITY-CANON-1B) ── */}
          <div className="uf-section">
            <div className="sf-section-title">Rotation Availability</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
              This helps ASPIRE identify possible scheduling conflicts before matching you with a
              preceptor. Your availability is considered during matching but cannot be guaranteed.
            </p>

            <div className="uf-field">
              <label className="uf-label">
                Which weekdays are you unavailable to rotate (class, work, or other commitments)?
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {WEEKDAYS.map(day => {
                  const on = form.unavailable_weekdays.includes(day)
                  return (
                    <button type="button" key={day}
                      onClick={() => set('unavailable_weekdays', toggleWeekday(form.unavailable_weekdays, day))}
                      style={{ padding: '6px 12px', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13,
                        fontWeight: 600, cursor: 'pointer',
                        background: on ? '#1D2567' : '#fff', color: on ? '#fff' : '#374151',
                        border: `1px solid ${on ? '#1D2567' : '#d1d5db'}` }}>
                      {day}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="uf-field">
              <label className="uf-label">Briefly explain your recurring unavailable days (optional)</label>
              {/* ACCIDENTAL-SUBMISSION FIX: this was a single-line <input>, so Enter here
                  triggered HTML implicit form submission mid-typing. A textarea makes
                  Enter insert a newline, the behavior a reason field implies. */}
              <textarea className="uf-textarea" rows={2} value={form.unavailable_weekdays_reason}
                onChange={e => set('unavailable_weekdays_reason', e.target.value)}
                placeholder="e.g. Class on Mondays and Tuesdays" />
            </div>

            <div className="uf-field">
              <label className="uf-label">Any personal blackout dates during your rotation window? (optional)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="uf-input" type="date" value={blackoutInput}
                  onChange={e => setBlackoutInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBlackoutDate() } }}
                  style={{ colorScheme: 'light', maxWidth: 200 }} />
                <button type="button" className="sf-add-btn" style={{ marginTop: 0 }} onClick={addBlackoutDate}>
                  + Add date
                </button>
              </div>
              {form.personal_blackout_dates.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {form.personal_blackout_dates.map(d => (
                    <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                      borderRadius: 16, background: '#f1f5f9', color: '#374151', fontSize: 12, fontFamily: 'DM Sans' }}>
                      {d}
                      <button type="button" onClick={() => set('personal_blackout_dates', form.personal_blackout_dates.filter(x => x !== d))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontWeight: 700, padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="sf-row-2">
              <div className="uf-field">
                <label className="uf-label">Available for weekend shifts?</label>
                <select className="uf-input"
                  value={form.weekends_available === null ? '' : (form.weekends_available ? 'yes' : 'no')}
                  onChange={e => set('weekends_available', e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">Select…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="uf-field">
                <label className="uf-label">Available for night shifts?</label>
                <select className="uf-input"
                  value={form.nights_available === null ? '' : (form.nights_available ? 'yes' : 'no')}
                  onChange={e => set('nights_available', e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">Select…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>

            <div className="uf-field">
              <label className="uf-label">Preferred rotation days (optional)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {WEEKDAYS.map(day => {
                  const on = form.preferred_days.includes(day)
                  return (
                    <button type="button" key={day}
                      onClick={() => set('preferred_days', toggleWeekday(form.preferred_days, day))}
                      style={{ padding: '6px 12px', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13,
                        fontWeight: 600, cursor: 'pointer',
                        background: on ? '#16a34a' : '#fff', color: on ? '#fff' : '#374151',
                        border: `1px solid ${on ? '#16a34a' : '#d1d5db'}` }}>
                      {day}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="uf-field">
              <label className="uf-label">Anything else ASPIRE should know about your availability? (optional)</label>
              <textarea className="uf-textarea" rows={2} value={form.availability_notes}
                onChange={e => set('availability_notes', e.target.value)}
                placeholder="Share any other scheduling considerations." />
            </div>

            {(isPortalEdit || isPortalLocked) ? (
              // A completed acknowledgment is a record, not a preference; it never re-opens.
              <div className="uf-field" style={{ fontSize: 13, color: '#166534', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span aria-hidden="true">✓</span>
                <span>Availability acknowledgment completed at submission.</span>
              </div>
            ) : (
              <div className="uf-field">
                <label className="uf-check-label" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <input type="checkbox" checked={form.availability_ack}
                    onChange={e => set('availability_ack', e.target.checked)} style={{ marginTop: 3 }} />
                  <span style={{ fontSize: 13, lineHeight: 1.55 }}>{AVAILABILITY_ACK_TEXT} <span style={{ color: '#ef4444' }}>*</span></span>
                </label>
              </div>
            )}
          </div>

          {/* ── Your Interest ── */}
          <div className="uf-section">
            <div className="sf-section-title">Your Interest</div>
            <div className="uf-field">
              <label className="uf-label">Why are you interested in completing your senior rotation at Cedars-Sinai? *</label>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Minimum 50 characters required.
              </p>
              <textarea className="uf-textarea" rows={5} value={form.interest_statement}
                onChange={e => set('interest_statement', e.target.value)}
                placeholder="Share what draws you to Cedars-Sinai and what you hope to gain from this experience." />
              <p style={{ fontSize: 12, color: form.interest_statement.length >= 50 ? '#16a34a' : 'var(--text-secondary)', marginTop: 4 }}>
                {form.interest_statement.length} / 50 minimum
              </p>
            </div>
          </div>

          {/* ── Student Information Use Acknowledgment (information notice; not consent/FERPA) ── */}
          <div className="uf-section">
            <div className="sf-section-title">{STUDENT_FORM_ACK_TITLE}</div>
            {(isPortalEdit || isPortalLocked) ? (
              <div style={{ fontSize: 13, color: '#166534', display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.55 }}>
                <span aria-hidden="true">✓</span>
                <span>
                  Acknowledged{form.privacy_ack_name ? ` by ${form.privacy_ack_name}` : ''}
                  {portal?.student?.student_form_privacy_ack_at
                    ? ` on ${new Date(portal.student.student_form_privacy_ack_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                    : ''}.
                </span>
              </div>
            ) : (
              <>
                {STUDENT_FORM_ACK_BODY.map((para, i) => (
                  <p key={i} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', margin: '0 0 10px' }}>{para}</p>
                ))}
                <div className="uf-field">
                  <label className="uf-check-label" style={{ alignItems: 'flex-start', gap: 10 }}>
                    <input type="checkbox" checked={form.privacy_ack}
                      onChange={e => set('privacy_ack', e.target.checked)} style={{ marginTop: 3 }} />
                    <span style={{ fontSize: 13, lineHeight: 1.55 }}>{STUDENT_FORM_ACK_CHECKBOX_LABEL} <span style={{ color: '#ef4444' }}>*</span></span>
                  </label>
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>{STUDENT_FORM_ACK_TYPED_NAME_TEXT}</p>
                <div className="uf-field">
                  <label className="uf-label">{STUDENT_FORM_ACK_FIELD_LABEL} *</label>
                  <input className="uf-input" value={form.privacy_ack_name}
                    onChange={e => set('privacy_ack_name', e.target.value)} placeholder="Your full name" />
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 5, lineHeight: 1.4 }}>{STUDENT_FORM_ACK_HELPER_TEXT}</div>
                </div>
              </>
            )}
          </div>
          </fieldset>

          {/* Locked: read-only, no submit control at all. Edit: explicit Save Changes.
              Intake (portal): Submit Profile. Public: unchanged Submit Form. */}
          {!isPortalLocked && (
            <div className="uf-submit-row">
              <button type="submit" className="uf-submit-btn" disabled={submitting}>
                {isPortalEdit
                  ? (submitting ? 'Saving…' : 'Save Changes')
                  : (submitting ? 'Submitting…' : (portalMode === 'intake' ? 'Submit Profile' : 'Submit Form'))}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
