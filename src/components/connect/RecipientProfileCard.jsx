// RecipientProfileCard.jsx
// Rich recipient profile card for ASPIRE Connect → Outreach → Send to one recipient.
// Displays contact or student data with avatar, role badge, and key contact details.
// Visual style mirrors ContactProfile in ContactsView (gradient header, avatar ring, role chip).

import { useState, useEffect } from 'react'
import { categoryChipColors } from '../../lib/contactCategories'
import { useStudentFileUrl } from '../../lib/useStudentFile'
import { classifyStoredFileRef } from '../../lib/studentFileClient'

const F    = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'


function initials(name) {
  if (!name) return '?'
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).filter(Boolean).join('')
}

function RoleChip({ role, category }) {
  if (!role) return null
  const cfg = categoryChipColors(category)
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.07em',
      whiteSpace: 'nowrap',
    }}>
      {role}
    </span>
  )
}

function InfoRow({ label, value, link, error }) {
  if (!value && !link && !error) return null
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
      <span style={{
        fontSize: 10, color: '#9ca3af', fontFamily: F,
        flexShrink: 0, minWidth: 52, paddingTop: 1, lineHeight: 1.4,
      }}>
        {label}
      </span>
      {error ? (
        <span style={{ fontSize: 12, color: '#dc2626', fontFamily: F, lineHeight: 1.4 }}>{error}</span>
      ) : link ? (
        <a href={link} target="_blank" rel="noreferrer"
          style={{ fontSize: 12, color: NAVY, fontFamily: F, wordBreak: 'break-all', lineHeight: 1.4 }}>
          LinkedIn →
        </a>
      ) : (
        <span style={{ fontSize: 12, color: '#374151', fontFamily: F, wordBreak: 'break-all', lineHeight: 1.4 }}>
          {value}
        </span>
      )}
    </div>
  )
}

// Shared card and hero styles matching ContactProfile
const cardStyle = {
  background: '#fff',
  borderRadius: 12,
  border: '1px solid rgba(29,37,103,0.10)',
  overflow: 'hidden',
  boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
}

const heroStyle = {
  padding: '20px 20px 14px',
  textAlign: 'center',
  background: 'linear-gradient(160deg, #dceff8 0%, #f0f6fb 50%, #ffffff 100%)',
}

function Avatar({ url, name }) {
  const [imgError, setImgError] = useState(false)
  // Reset error state whenever the URL changes (new contact/student loaded)
  useEffect(() => { setImgError(false) }, [url])
  const hasPhoto = !!(url && url.trim() !== '' && !imgError)
  return (
    <div style={{
      width: 64, height: 64, borderRadius: '50%',
      background: NAVY, margin: '0 auto 12px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 20, fontWeight: 700, color: '#fff', fontFamily: F,
      flexShrink: 0, overflow: 'hidden', position: 'relative',
      boxShadow: '0 0 0 3px #fff, 0 0 0 5px rgba(29,37,103,0.12)',
    }}>
      {hasPhoto ? (
        <img src={url} alt={name}
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          {initials(name)}
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RecipientProfileCard({
  recipientType,    // 'contact' | 'student' | null
  contact,          // full contact record from contacts table (may be null while fetching)
  fromContact,      // minimal { id, name, email } from router state
  displayStudent,   // the student to show: selectedStudent (survey) or effectiveStudent (DM)
  fetchedStudent,   // full student record fetched for DM mode
  studentFetchFailed,
  outreachMode,     // 'message' | 'survey'
}) {

  // WAVE F-2: a student recipient's headshot resolves through the server access
  // endpoint (staff read). The contact-branch Avatar below still uses the contact
  // avatar (a different bucket) and is unaffected. Hook runs before any early
  // return so it is unconditional.
  const rpcStudentId = displayStudent?.id || fetchedStudent?.id || null
  const rpcStoredHeadshot = displayStudent?.headshot_url || fetchedStudent?.headshot_url || null
  const { url: studentHeadshotSignedUrl } = useStudentFileUrl({
    studentId: rpcStudentId, kind: 'headshot',
    enabled: recipientType === 'student' && Boolean(rpcStudentId) && classifyStoredFileRef(rpcStoredHeadshot) !== 'empty',
    refreshKey: rpcStoredHeadshot,
  })

  // ── No recipient selected ─────────────────────────────────────────────────
  if (!recipientType && !fromContact && !displayStudent && !fetchedStudent) {
    return (
      <div style={cardStyle}>
        <div style={{ ...heroStyle, padding: '18px 16px' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', background: '#e5e7eb',
            margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, lineHeight: 1.5 }}>
            {outreachMode === 'survey'
              ? 'Select a student below to see recipient details.'
              : 'Return to Contacts or Student Profiles and click Email.'}
          </div>
        </div>
      </div>
    )
  }

  // ── Student fetch error ───────────────────────────────────────────────────
  if (studentFetchFailed && recipientType === 'student') {
    return (
      <div style={cardStyle}>
        <div style={{ padding: '14px 16px', background: '#fef2f2', borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: '#dc2626', fontFamily: F, lineHeight: 1.5 }}>
            Student context unavailable. Return to Student Profiles and click Email.
          </div>
        </div>
      </div>
    )
  }

  // ── Contact recipient ─────────────────────────────────────────────────────
  if (recipientType === 'contact' || (fromContact && recipientType !== 'student')) {

    if (!fromContact && !contact) {
      return (
        <div style={cardStyle}>
          <div style={{ ...heroStyle, padding: '18px 16px' }}>
            <div style={{ fontSize: 12, color: '#8B5E1A', fontFamily: F, lineHeight: 1.5, background: '#FBF5E8', border: '1px solid #f0c9b0', borderRadius: 8, padding: '10px 12px' }}>
              Contact context unavailable. Return to Contacts and click Email.
            </div>
          </div>
        </div>
      )
    }

    const name           = contact?.full_name || fromContact?.name || '-'
    const email          = contact?.email || fromContact?.email
    const avatar         = contact?.avatar_url
    const role           = contact?.role
    const category       = contact?.category
    const roleQualifier  = contact?.role_qualifier
    const organization   = contact?.organization
    const phone          = contact?.phone
    const unitName       = contact?.unit_name
    const schoolName     = contact?.school_name
    const linkedinUrl    = contact?.linkedin_url
    const services       = contact?.services

    const hasBody = !!(email || phone || organization || unitName || schoolName || linkedinUrl || services)

    return (
      <div style={cardStyle}>
        {/* Hero */}
        <div style={heroStyle}>
          <Avatar url={avatar} name={name} />

          <h3 style={{
            margin: 0, fontSize: 16, fontWeight: 700, color: '#191919',
            fontFamily: F, lineHeight: 1.2, letterSpacing: '-0.01em',
          }}>
            {name}
          </h3>

          {/* Role chip + qualifier */}
          {role && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <RoleChip role={role} category={category} />
              {roleQualifier && (
                <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: F }}>· {roleQualifier}</span>
              )}
            </div>
          )}

          {/* Contact type badge */}
          <div style={{ marginTop: 8 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              background: '#EEF2FB', color: '#1D2567', border: '1px solid #c3cdf0',
              fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              Contact
            </span>
          </div>
        </div>

        {/* Details */}
        {hasBody && (
          <div style={{ padding: '12px 16px 10px' }}>
            {email
              ? <InfoRow label="Email" value={email} />
              : <InfoRow label="Email" error="No email on file" />
            }
            {phone && <InfoRow label="Phone" value={phone} />}
            {services && (
              <InfoRow label="Services" value={services} />
            )}
            {organization && <InfoRow label="Org" value={organization} />}
            {schoolName && <InfoRow label="School" value={schoolName} />}
            {unitName && <InfoRow label="Unit" value={unitName} />}
            {linkedinUrl && <InfoRow label="LinkedIn" link={linkedinUrl} />}
          </div>
        )}
        {!hasBody && !email && (
          <div style={{ padding: '10px 16px 12px' }}>
            <InfoRow label="Email" error="No email on file" />
          </div>
        )}
      </div>
    )
  }

  // ── Student recipient ─────────────────────────────────────────────────────

  const student = displayStudent || fetchedStudent
  if (!student) {
    // Loading state
    return (
      <div style={cardStyle}>
        <div style={{ ...heroStyle, padding: '18px 16px' }}>
          <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F }}>Loading recipient…</div>
        </div>
      </div>
    )
  }

  const sName      = student.name || `${student.first_name || ''} ${student.last_name || ''}`.trim() || '-'
  // CONNECT-COMMS-1B: student correspondence is SCHOOL-FIRST. Show the school email by default;
  // personal is a clearly-labeled fallback only when school is missing. (Authoritative resolution
  // is server-side; this card mirrors the canon so it never silently implies a personal send.)
  const sSchoolEmail   = (student.school_email || '').trim()
  const sPersonalEmail = (student.personal_email || '').trim()
  const sEmail         = sSchoolEmail || sPersonalEmail || (student.email || '').trim() || null
  const sEmailSource   = sSchoolEmail
    ? { label: 'School email', warn: false }
    : sPersonalEmail
      ? { label: 'Personal (fallback)', warn: true }
      : null
  const sSchool    = student.school
  const sStatus    = student.status
  // headshot resolves through the server access endpoint (WAVE F-2); the signed
  // URL is computed above via useStudentFileUrl.
  const sAvatarUrl = studentHeadshotSignedUrl

  return (
    <div style={cardStyle}>
      {/* Hero */}
      <div style={heroStyle}>
        <Avatar url={sAvatarUrl} name={sName} />

        <h3 style={{
          margin: 0, fontSize: 16, fontWeight: 700, color: '#191919',
          fontFamily: F, lineHeight: 1.2, letterSpacing: '-0.01em',
        }}>
          {sName}
        </h3>

        {/* Student + status badges */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: '#FEF3C7', color: '#92400e', border: '1px solid #fde68a',
            fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Student
          </span>
          {sStatus && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
              fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {sStatus}
            </span>
          )}
        </div>
      </div>

      {/* Details */}
      <div style={{ padding: '12px 16px 10px' }}>
        {sEmail
          ? <InfoRow label="Email" value={sEmail} />
          : <InfoRow label="Email" error="No email on file" />
        }
        {sEmailSource?.warn && (
          <div style={{ fontSize: 10.5, color: '#92400e', fontFamily: F, lineHeight: 1.4, margin: '0 0 6px' }}>
            School email missing, using personal email.
          </div>
        )}
        {sSchool && <InfoRow label="School" value={sSchool} />}
      </div>
    </div>
  )
}
