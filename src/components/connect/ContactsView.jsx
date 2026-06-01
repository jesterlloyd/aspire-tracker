import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const F    = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// ── Category mapping ──────────────────────────────────────────────────────────
// Maps contacts.role values to the UI filter category label.

const CATEGORY_MAP = {
  'School Coordinator':   'Academic Partners',
  'Associate Director':   'Unit Leaders',
  'Assistant Nurse Manager': 'Unit Leaders',
  'Unit NPD-P':           'Unit NPD-Ps',
  'NPD Practitioner':     'BNI Team',
  'BNI Administration':   'BNI Team',
  'Nursing Leadership':   'Nursing Leadership',
}

const CATEGORY_ORDER = [
  'All',
  'Academic Partners',
  'Unit Leaders',
  'Unit NPD-Ps',
  'BNI Team',
  'Nursing Leadership',
  'Other',
]

function roleToCategory(role) {
  return CATEGORY_MAP[role] || 'Other'
}

// ── Role display config ───────────────────────────────────────────────────────

const ROLE_COLORS = {
  'School Coordinator':    { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Associate Director':    { color: '#0d7a8a', bg: '#E0F7FA', border: '#9dd6f2' },
  'Assistant Nurse Manager': { color: '#166534', bg: '#EEF7F0', border: '#c6d9a8' },
  'Unit NPD-P':            { color: '#065f46', bg: '#D1FAE5', border: '#6ee7b7' },
  'NPD Practitioner':      { color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
  'BNI Administration':    { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  'Nursing Leadership':    { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
}

function roleChip(role) {
  const cfg = ROLE_COLORS[role] || { color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
  return {
    display: 'inline-block',
    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
    background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
    fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.07em',
    whiteSpace: 'nowrap', flexShrink: 0,
  }
}

// ── Category pill accent colors ───────────────────────────────────────────────

const CATEGORY_ACCENT = {
  'Academic Partners': { active: '#1D2567', activeText: '#fff', restText: '#6b7280' },
  'Unit Leaders':      { active: '#0d7a8a', activeText: '#fff', restText: '#6b7280' },
  'Unit NPD-Ps':       { active: '#065f46', activeText: '#fff', restText: '#6b7280' },
  'BNI Team':          { active: '#7C3AED', activeText: '#fff', restText: '#6b7280' },
  'Nursing Leadership':{ active: '#92400e', activeText: '#fff', restText: '#6b7280' },
  'Other':             { active: '#374151', activeText: '#fff', restText: '#6b7280' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'America/Los_Angeles',
  })
}

function fmtRelative(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const diff = Math.floor((Date.now() - d) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 30) return `${diff}d ago`
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`
  return `${Math.floor(diff / 365)}y ago`
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
}

// ── Notification type labels ──────────────────────────────────────────────────

const NOTIF_LABELS = {
  coordinator_weekly_digest: 'Weekly Digest',
  coordinator_weekly_digest_test: 'Weekly Digest (Test)',
}

function notifLabel(type) {
  return NOTIF_LABELS[type] || type?.replace(/_/g, ' ') || '—'
}

// ── Copy helper ───────────────────────────────────────────────────────────────

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* Clipboard unavailable — user can select manually */ }
  }, [value])
  return (
    <button
      onClick={handleCopy}
      title={`Copy ${label}`}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 11, color: copied ? '#2F7D5C' : '#9ca3af', fontFamily: F,
        padding: '0 4px', fontWeight: 600,
      }}
    >
      {copied ? '✓' : '⎘'}
    </button>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const isGood = ['sent', 'delivered', 'opened', 'clicked'].includes(status)
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
      background: isGood ? '#EEF7F0' : '#fef2f2',
      color:      isGood ? '#2F7D5C' : '#dc2626',
      border:     `1px solid ${isGood ? '#c6d9a8' : '#fecaca'}`,
      fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {status || '—'}
    </span>
  )
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: '#9ca3af',
      letterSpacing: '0.13em', textTransform: 'uppercase',
      marginBottom: 8, fontFamily: F,
    }}>
      {children}
    </div>
  )
}

// ── Category section header (in contact list) ─────────────────────────────────

function CategoryDivider({ label, count }) {
  return (
    <div style={{
      padding: '8px 14px 4px',
      display: 'flex', alignItems: 'center', gap: 8,
      borderTop: '1px solid rgba(29,37,103,0.06)',
      marginTop: 4,
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, color: '#9ca3af',
        textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: F,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 9, fontWeight: 700, padding: '0px 5px', borderRadius: 3,
        background: '#f3f4f6', color: '#9ca3af', fontFamily: F,
      }}>
        {count}
      </span>
    </div>
  )
}

// ── Contact list row ──────────────────────────────────────────────────────────

function ContactRow({ contact, isSelected, onClick }) {
  // Unit contacts: show unit_name as context line; others: show organization
  const contextLine = contact.unit_name || contact.organization
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 16px', cursor: 'pointer',
        background: isSelected ? '#EEF2FB' : 'transparent',
        borderLeft: `3px solid ${isSelected ? NAVY : 'transparent'}`,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f9fafb' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: isSelected ? NAVY : '#e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: isSelected ? '#fff' : '#6b7280',
          fontFamily: F,
        }}>
          {initials(contact.full_name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600, fontSize: 12.5, color: '#191919', fontFamily: F,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.3, marginBottom: 2,
          }}>
            {contact.preferred_name
              ? `${contact.preferred_name} ${contact.full_name.split(' ').slice(1).join(' ')}`
              : contact.full_name
            }
          </div>
          <div style={{
            fontSize: 10.5, color: '#6b7280', fontFamily: F, lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {contextLine}
          </div>
          <div style={{ marginTop: 4 }}>
            <span style={roleChip(contact.role)}>{contact.role}</span>
            {contact.is_active === false && (
              <span style={{
                marginLeft: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px',
                borderRadius: 4, background: '#f3f4f6', color: '#9ca3af',
                border: '1px solid #e5e7eb', fontFamily: F,
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>Inactive</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Contact detail panel ──────────────────────────────────────────────────────

function ContactDetail({ contact, commHistory, loadingComm, linkedStudents, loadingStudents }) {
  const hasWeeklyDigest = contact.notification_preferences?.weekly_digest !== false
  const relatedUnits = Array.isArray(contact.related_units) ? contact.related_units.filter(Boolean) : []
  const showAffiliation = contact.school_name || contact.program_type || contact.unit_name || relatedUnits.length > 0

  return (
    <div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 22 }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
          background: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, fontWeight: 700, color: '#fff', fontFamily: F,
        }}>
          {initials(contact.full_name)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#191919', fontFamily: F, letterSpacing: '-0.01em' }}>
              {contact.full_name}
            </h2>
            {contact.preferred_name && (
              <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: F }}>
                · goes by <strong style={{ color: '#374151' }}>{contact.preferred_name}</strong>
              </span>
            )}
            {contact.is_active === false && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb',
                fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.07em',
              }}>Inactive</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={roleChip(contact.role)}>{contact.role}</span>
            {contact.role_qualifier && (
              <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: F }}>· {contact.role_qualifier}</span>
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: '#6b7280', fontFamily: F }}>
            {contact.organization}
          </div>
        </div>
      </div>

      {/* Contact methods */}
      <div style={{
        background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '14px 16px', marginBottom: 18,
      }}>
        <SectionHeading>Contact</SectionHeading>
        {contact.email ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#9ca3af', width: 44, fontFamily: F, flexShrink: 0 }}>Email</span>
            <a href={`mailto:${contact.email}`} style={{ fontSize: 13, color: NAVY, fontFamily: F, textDecoration: 'none', flex: 1 }}>
              {contact.email}
            </a>
            <CopyButton value={contact.email} label="email" />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, marginBottom: 8 }}>No email on file</div>
        )}
        {contact.phone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#9ca3af', width: 44, fontFamily: F, flexShrink: 0 }}>Phone</span>
            <span style={{ fontSize: 13, color: '#374151', fontFamily: F, flex: 1 }}>{contact.phone}</span>
            <CopyButton value={contact.phone} label="phone" />
          </div>
        )}
      </div>

      {/* Affiliation — unit_name, related_units, school_name */}
      {showAffiliation && (
        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '14px 16px', marginBottom: 18,
        }}>
          <SectionHeading>Affiliation</SectionHeading>

          {contact.unit_name && (
            <div style={{ display: 'flex', gap: 8, marginBottom: relatedUnits.length > 0 ? 8 : 6 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', width: 76, fontFamily: F, flexShrink: 0 }}>
                {relatedUnits.length > 0 ? 'Primary unit' : 'Unit'}
              </span>
              <span style={{ fontSize: 13, color: '#374151', fontFamily: F }}>{contact.unit_name}</span>
            </div>
          )}

          {/* Related units (multi-unit contacts like Omar Tinio, Alice Chan, etc.) */}
          {relatedUnits.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', width: 76, fontFamily: F, flexShrink: 0 }}>All units</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {relatedUnits.map(u => (
                  <span key={u} style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                    background: '#EEF2FB', color: NAVY, border: '1px solid #c3cdf0',
                    fontFamily: F,
                  }}>{u}</span>
                ))}
              </div>
            </div>
          )}

          {contact.school_name && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 0 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', width: 76, fontFamily: F, flexShrink: 0 }}>School</span>
              <span style={{ fontSize: 13, color: '#374151', fontFamily: F }}>
                {contact.school_name}
                {contact.program_type && <span style={{ color: '#9ca3af' }}> · {contact.program_type}</span>}
              </span>
            </div>
          )}
        </div>
      )}

      {/* CRM / last contact */}
      {(contact.last_contacted_at || contact.last_contact_summary) && (
        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '14px 16px', marginBottom: 18,
        }}>
          <SectionHeading>Last Contact</SectionHeading>
          {contact.last_contacted_at && (
            <div style={{ fontSize: 13, color: '#374151', fontFamily: F, marginBottom: 4 }}>
              <strong style={{ fontWeight: 600 }}>{fmtRelative(contact.last_contacted_at)}</strong>
              <span style={{ color: '#9ca3af' }}> · {fmtDate(contact.last_contacted_at)}</span>
              {contact.last_contact_type && (
                <span style={{ color: '#9ca3af' }}> · {contact.last_contact_type.replace(/_/g, ' ')}</span>
              )}
            </div>
          )}
          {contact.last_contact_summary && (
            <div style={{ fontSize: 12, color: '#6b7280', fontFamily: F, lineHeight: 1.5 }}>
              {contact.last_contact_summary}
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {contact.notes && (
        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '14px 16px', marginBottom: 18,
        }}>
          <SectionHeading>Notes</SectionHeading>
          <div style={{ fontSize: 12, color: '#374151', fontFamily: F, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {contact.notes}
          </div>
        </div>
      )}

      {/* Notification preferences */}
      <div style={{
        background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '14px 16px', marginBottom: 18,
      }}>
        <SectionHeading>Notification Preferences</SectionHeading>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
            background: hasWeeklyDigest ? '#EEF7F0' : '#f3f4f6',
            color:      hasWeeklyDigest ? '#166534' : '#9ca3af',
            border:    `1px solid ${hasWeeklyDigest ? '#c6d9a8' : '#e5e7eb'}`,
            fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.07em',
          }}>
            Weekly digest {hasWeeklyDigest ? 'on' : 'off'}
          </span>
        </div>
      </div>

      {/* Linked students */}
      <div style={{
        background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '14px 16px', marginBottom: 18,
      }}>
        <SectionHeading>Linked Students</SectionHeading>
        {!contact.school_name ? (
          <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', fontFamily: F, lineHeight: 1.6 }}>
            Linked students and cohort relationships will appear here when available.
          </p>
        ) : loadingStudents ? (
          <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', fontFamily: F }}>Loading…</p>
        ) : linkedStudents.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', fontFamily: F, lineHeight: 1.6 }}>
            No current students at {contact.school_name} in the active cohort.
          </p>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginBottom: 8 }}>
              {linkedStudents.length} student{linkedStudents.length !== 1 ? 's' : ''} at {contact.school_name}
            </div>
            {linkedStudents.slice(0, 8).map(s => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '5px 0', borderBottom: '1px solid #f3f4f6',
                fontSize: 12, color: '#374151', fontFamily: F,
              }}>
                <span>{s.last_name}, {s.first_name}</span>
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                  background: '#f3f4f6', color: '#6b7280', fontFamily: F,
                }}>
                  {s.status || '—'}
                </span>
              </div>
            ))}
            {linkedStudents.length > 8 && (
              <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginTop: 6 }}>
                +{linkedStudents.length - 8} more
              </div>
            )}
          </div>
        )}
      </div>

      {/* Communication history */}
      <div style={{
        background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '14px 16px', marginBottom: 8,
      }}>
        <SectionHeading>Communication History</SectionHeading>
        {loadingComm ? (
          <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', fontFamily: F }}>Loading…</p>
        ) : commHistory.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', fontFamily: F, lineHeight: 1.6 }}>
            No communication history on file. Sent emails and digest records will appear here.
          </p>
        ) : (
          <div>
            {commHistory.map(log => (
              <div key={log.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', fontFamily: F, marginBottom: 2 }}>
                      {log.subject || notifLabel(log.notification_type)}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <StatusBadge status={log.status} />
                      <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: F }}>{fmtDate(log.sent_at)}</span>
                      {log.opened_at && (
                        <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: F }}>· opened</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Empty state (no contact selected) ────────────────────────────────────────

function NoSelection({ count }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: '40px 24px', textAlign: 'center',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        background: '#EEF2FB', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, marginBottom: 16,
      }}>
        👤
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', fontFamily: F, marginBottom: 6 }}>
        {count > 0 ? 'Select a contact' : 'No contacts found'}
      </div>
      <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, maxWidth: 280, lineHeight: 1.6 }}>
        {count > 0
          ? 'Choose a contact from the list to view details and communication history.'
          : 'No contacts match your current search or filter.'}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContactsView() {
  const [contacts,        setContacts]        = useState([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)
  const [search,          setSearch]          = useState('')
  const [categoryFilter,  setCategoryFilter]  = useState('All')
  const [selectedId,      setSelectedId]      = useState(null)
  const [commHistory,     setCommHistory]     = useState([])
  const [loadingComm,     setLoadingComm]     = useState(false)
  const [linkedStudents,  setLinkedStudents]  = useState([])
  const [loadingStudents, setLoadingStudents] = useState(false)

  // ── Fetch all contacts ──────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    supabase
      .from('contacts')
      .select('*')
      .order('organization')
      .order('full_name')
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setContacts(data || [])
        setLoading(false)
      })
  }, [])

  // ── Fetch communication history on contact select ──────────────────────────
  useEffect(() => {
    if (!selectedId) { setCommHistory([]); return }
    setLoadingComm(true)
    supabase
      .from('notification_log')
      .select('id, notification_type, subject, status, sent_at, delivered_at, opened_at')
      .eq('contact_id', selectedId)
      .order('sent_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setCommHistory(data || [])
        setLoadingComm(false)
      })
  }, [selectedId])

  // ── Fetch linked students by school_name ───────────────────────────────────
  useEffect(() => {
    const contact = contacts.find(c => c.id === selectedId)
    if (!contact?.school_name) { setLinkedStudents([]); return }
    setLoadingStudents(true)
    supabase
      .from('students')
      .select('id, first_name, last_name, status')
      .eq('school', contact.school_name)
      .order('last_name')
      .order('first_name')
      .limit(12)
      .then(({ data }) => {
        setLinkedStudents(data || [])
        setLoadingStudents(false)
      })
  }, [selectedId, contacts])

  // ── Derived values ──────────────────────────────────────────────────────────
  const selected = contacts.find(c => c.id === selectedId) || null

  // Category counts from ALL loaded contacts (not affected by search)
  const categoryCounts = contacts.reduce((acc, c) => {
    const cat = roleToCategory(c.role)
    acc[cat] = (acc[cat] || 0) + 1
    return acc
  }, {})

  // Active category labels (excluding categories with 0 contacts)
  const activeCategories = CATEGORY_ORDER.filter(cat =>
    cat === 'All' || (categoryCounts[cat] || 0) > 0
  )

  // Filtered contacts: apply search + category filter
  const filtered = contacts.filter(c => {
    const q = search.trim().toLowerCase()
    if (q) {
      const match =
        c.full_name?.toLowerCase().includes(q) ||
        c.preferred_name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.organization?.toLowerCase().includes(q) ||
        c.school_name?.toLowerCase().includes(q) ||
        c.unit_name?.toLowerCase().includes(q) ||
        c.role?.toLowerCase().includes(q) ||
        c.notes?.toLowerCase().includes(q)
      if (!match) return false
    }
    if (categoryFilter !== 'All' && roleToCategory(c.role) !== categoryFilter) return false
    return true
  })

  // When showing "All" with no search: group contacts by category with dividers
  const showGrouped = categoryFilter === 'All' && !search.trim()

  // Build grouped list items: [{type:'divider', label, count} | {type:'row', contact}]
  const listItems = []
  if (showGrouped) {
    const grouped = {}
    filtered.forEach(c => {
      const cat = roleToCategory(c.role)
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(c)
    })
    CATEGORY_ORDER.filter(cat => cat !== 'All').forEach(cat => {
      const group = grouped[cat]
      if (!group || group.length === 0) return
      listItems.push({ type: 'divider', label: cat, count: group.length })
      group.forEach(c => listItems.push({ type: 'row', contact: c }))
    })
  } else {
    filtered.forEach(c => listItems.push({ type: 'row', contact: c }))
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: F, overflow: 'hidden' }}>

      {/* ── Left: list + search + filter ──────────────────────────────── */}
      <div style={{
        width: 280, flexShrink: 0,
        borderRight: '1px solid rgba(29,37,103,0.08)',
        display: 'flex', flexDirection: 'column',
        background: '#fff',
      }}>

        {/* Search */}
        <div style={{ padding: '14px 14px 10px' }}>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 12, color: '#9ca3af', pointerEvents: 'none', lineHeight: 0,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts…"
              style={{
                width: '100%', boxSizing: 'border-box',
                paddingLeft: 30, paddingRight: 10, paddingTop: 8, paddingBottom: 8,
                border: '1.5px solid #e5e7eb', borderRadius: 8,
                fontSize: 12, fontFamily: F, color: '#191919',
                background: '#f9fafb', outline: 'none',
              }}
              onFocus={e => { e.target.style.borderColor = NAVY; e.target.style.background = '#fff' }}
              onBlur={e =>  { e.target.style.borderColor = '#e5e7eb'; e.target.style.background = '#f9fafb' }}
            />
          </div>
        </div>

        {/* Category filter pills with live counts */}
        <div style={{
          padding: '0 12px 10px', display: 'flex', gap: 4, flexWrap: 'wrap',
        }}>
          {activeCategories.map(cat => {
            const isActive = categoryFilter === cat
            const accent = CATEGORY_ACCENT[cat] || CATEGORY_ACCENT['Other']
            const count = cat === 'All' ? contacts.length : (categoryCounts[cat] || 0)
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                style={{
                  padding: '3px 7px', borderRadius: 5,
                  border: isActive ? 'none' : '1px solid #e5e7eb',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontWeight: 600, fontFamily: F,
                  background: isActive ? accent.active : '#f9fafb',
                  color:      isActive ? accent.activeText : accent.restText,
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                <span>{cat}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700,
                  padding: '0 4px', borderRadius: 3,
                  background: isActive ? 'rgba(255,255,255,0.22)' : '#e5e7eb',
                  color: isActive ? '#fff' : '#9ca3af',
                }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Contact count */}
        <div style={{ padding: '0 14px 6px', fontSize: 10.5, color: '#9ca3af', fontFamily: F }}>
          {loading ? 'Loading…' : error ? 'Failed to load' : `${filtered.length} of ${contacts.length} contacts`}
        </div>

        {/* Contact list (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '20px 16px', fontSize: 12, color: '#9ca3af', fontFamily: F }}>Loading contacts…</div>
          ) : error ? (
            <div style={{ padding: '20px 16px', fontSize: 12, color: '#dc2626', fontFamily: F }}>
              Failed to load: {error}
            </div>
          ) : listItems.length === 0 ? (
            <div style={{ padding: '20px 16px', fontSize: 12, color: '#9ca3af', fontFamily: F, lineHeight: 1.6 }}>
              No contacts match your search.
            </div>
          ) : (
            listItems.map((item, idx) =>
              item.type === 'divider' ? (
                <CategoryDivider key={`div-${item.label}`} label={item.label} count={item.count} />
              ) : (
                <ContactRow
                  key={item.contact.id}
                  contact={item.contact}
                  isSelected={item.contact.id === selectedId}
                  onClick={() => setSelectedId(item.contact.id)}
                />
              )
            )
          )}
        </div>
      </div>

      {/* ── Right: detail panel ────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: '#FAFAF7' }}>
        {selected ? (
          <ContactDetail
            contact={selected}
            commHistory={commHistory}
            loadingComm={loadingComm}
            linkedStudents={linkedStudents}
            loadingStudents={loadingStudents}
          />
        ) : (
          <NoSelection count={filtered.length} />
        )}
      </div>

    </div>
  )
}
