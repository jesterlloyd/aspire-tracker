import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import ProfileActionButton from '../ui/ProfileActionButton'

const LAST_CONTACT_KEY = 'aspire.connect.contacts.lastContactId'
import { supabase } from '../../lib/supabase'
import Tooltip from '../ui/Tooltip'

const F    = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// ── Category mapping ──────────────────────────────────────────────────────────

// ── Multi-category contact model ───────────────────────────────────────────────
// A contact may belong to more than one category.
// getContactCategories() returns all categories a contact belongs to.
// getPrimaryCategory() returns the single category used for grouping in All view.

const ACADEMIC_ROLES = new Set([
  'School Coordinator', 'Clinical Placement Coordinator', 'Clinical Placement Coordinators',
  'Program Assistant', 'Program Assistants',
  'Manager', 'Manager, Clinical Operations', 'Manager, Clinical Faculty',
  'Manager Clinical Faculty',
  'Clinical Faculty', 'Associate Professor',
  'Program Coordinator',
])

const UNIT_LEADERSHIP_ROLES = new Set([
  'Associate Director', 'Assistant Nurse Manager',
  'Unit NPD-P', 'Unit NPD Practitioner',
])

const PRECEPTOR_ROLES = new Set([
  'Preceptor', 'Clinical Preceptor',
])

const BNI_TEAM_ROLES = new Set([
  'NPD Practitioner', 'BNI Administration', 'BNI Team',
])

const NURSING_EXEC_ROLES = new Set([
  'Nursing Leadership', 'Nursing Executive', 'Executive Director',
  'Chief Nursing Officer',
])

// Returns all categories a contact belongs to (may be more than one)
function getContactCategories(contact) {
  const role = contact.role || ''
  const org  = (contact.organization || '').toLowerCase()
  const cats = new Set()

  if (ACADEMIC_ROLES.has(role))          cats.add('Academic Partners')
  if (UNIT_LEADERSHIP_ROLES.has(role))   cats.add('Unit Leadership')
  // NPD Practitioner assigned to a unit → also Unit Leadership
  if (role === 'NPD Practitioner' && contact.unit_name) cats.add('Unit Leadership')
  if (PRECEPTOR_ROLES.has(role))         cats.add('Preceptors')
  if (BNI_TEAM_ROLES.has(role))          cats.add('BNI Team')
  if (NURSING_EXEC_ROLES.has(role))      cats.add('Nursing Executives')
  // BNI executive contacts (e.g. Margo): nursing exec role + BNI/Brawerman org → both categories
  if (NURSING_EXEC_ROLES.has(role) && (org.includes('brawerman') || org.includes(' bni '))) {
    cats.add('BNI Team')
  }

  return cats.size > 0 ? [...cats] : ['Other']
}

// Primary category priority for grouping in All view (higher index = lower priority)
const CATEGORY_PRIORITY = [
  'Nursing Executives', 'BNI Team', 'Unit Leadership',
  'Preceptors', 'Academic Partners', 'Other',
]

function getPrimaryCategory(contact) {
  const cats = new Set(getContactCategories(contact))
  for (const cat of CATEGORY_PRIORITY) {
    if (cats.has(cat)) return cat
  }
  return 'Other'
}

// Role rank within Unit Leadership for sorting
const UNIT_ROLE_RANK = {
  'Associate Director':      1,
  'Assistant Nurse Manager': 2,
  'Unit NPD-P':              3,
  'Unit NPD Practitioner':   3,
}

const CATEGORY_ORDER = [
  'All',
  'Academic Partners',
  'Unit Leadership',
  'Preceptors',
  'BNI Team',
  'Nursing Executives',
  'Other',
]

// ── Role display config ───────────────────────────────────────────────────────

const ROLE_COLORS = {
  // Academic Partners
  'School Coordinator':             { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Clinical Placement Coordinator': { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Program Coordinator':            { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Program Assistant':              { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager':                        { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager, Clinical Operations':   { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager, Clinical Faculty':      { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Manager Clinical Faculty':       { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Clinical Faculty':               { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Associate Professor':            { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  // Unit Leadership
  'Associate Director':             { color: '#0d7a8a', bg: '#E0F7FA', border: '#9dd6f2' },
  'Assistant Nurse Manager':        { color: '#166534', bg: '#EEF7F0', border: '#c6d9a8' },
  'Unit NPD-P':                     { color: '#065f46', bg: '#D1FAE5', border: '#6ee7b7' },
  'Unit NPD Practitioner':          { color: '#065f46', bg: '#D1FAE5', border: '#6ee7b7' },
  // Preceptors
  'Preceptor':                      { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  'Clinical Preceptor':             { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  // BNI Team
  'NPD Practitioner':               { color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
  'BNI Administration':             { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  'BNI Team':                       { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  // Nursing Executives
  'Nursing Leadership':             { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Nursing Executive':              { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Executive Director':             { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Chief Nursing Officer':          { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
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
  'Academic Partners':  { active: '#1D2567', activeText: '#fff', restText: '#6b7280' },
  'Unit Leadership':    { active: '#0d7a8a', activeText: '#fff', restText: '#6b7280' },
  'Preceptors':         { active: '#0e4e6e', activeText: '#fff', restText: '#6b7280' },
  'BNI Team':           { active: '#7C3AED', activeText: '#fff', restText: '#6b7280' },
  'Nursing Executives': { active: '#92400e', activeText: '#fff', restText: '#6b7280' },
  'Other':              { active: '#374151', activeText: '#fff', restText: '#6b7280' },
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
    } catch { /* Clipboard unavailable */ }
  }, [value])
  return (
    <Tooltip label={copied ? 'Copied!' : `Copy ${label}`} placement="top">
    <button
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 11, color: copied ? '#2F7D5C' : '#9ca3af', fontFamily: F,
        padding: '0 4px', fontWeight: 600,
      }}
    >
      {copied ? '✓' : '⎘'}
    </button>
    </Tooltip>
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
  const contextLine = contact.unit_name || contact.organization
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 12px', cursor: 'pointer', margin: '2px 6px',
        background: isSelected ? '#EEF2FB' : 'transparent',
        borderRadius: 8,
        outline: isSelected ? `1.5px solid rgba(29,37,103,0.18)` : 'none',
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
          fontFamily: F, overflow: 'hidden', position: 'relative',
        }}>
          {contact.avatar_url && (
            <img
              src={contact.avatar_url}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          )}
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

// ── Zone 2: Contact profile panel ────────────────────────────────────────────

function ContactProfile({ contact, navigate, onEdit }) {
  const relatedUnits = Array.isArray(contact.related_units) ? contact.related_units.filter(Boolean) : []
  const showAffiliation = contact.school_name || contact.program_type || contact.unit_name || relatedUnits.length > 0
  const hasWeeklyDigest = contact.notification_preferences?.weekly_digest !== false

  return (
    <div>

      {/* ── Profile hero ── */}
      <div style={{
        padding: '28px 24px 22px',
        borderBottom: '1px solid #f0ede8',
        textAlign: 'center',
        background: 'linear-gradient(160deg, #dceff8 0%, #f0f6fb 50%, #ffffff 100%)',
        borderRadius: '12px 12px 0 0',
      }}>
        {/* Avatar — shows image if avatar_url is present, falls back to initials */}
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: NAVY, margin: '0 auto 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, fontWeight: 700, color: '#fff', fontFamily: F,
          flexShrink: 0, overflow: 'hidden', position: 'relative',
          boxShadow: '0 0 0 3px #fff, 0 0 0 5px rgba(29,37,103,0.12)',
        }}>
          {contact.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt={contact.full_name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => {
                e.currentTarget.style.display = 'none'
                e.currentTarget.parentElement.querySelector('.avatar-initials').style.display = 'flex'
              }}
            />
          ) : null}
          <span
            className="avatar-initials"
            style={{
              display: contact.avatar_url ? 'none' : 'flex',
              alignItems: 'center', justifyContent: 'center',
              width: '100%', height: '100%',
              position: contact.avatar_url ? 'absolute' : 'static',
              inset: 0,
            }}
          >
            {initials(contact.full_name)}
          </span>
        </div>

        {/* Name */}
        <h2 style={{
          margin: 0, fontSize: 20, fontWeight: 700, color: '#191919',
          fontFamily: F, letterSpacing: '-0.01em', lineHeight: 1.2,
        }}>
          {contact.full_name}
        </h2>
        {contact.preferred_name && (
          <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, marginTop: 4 }}>
            goes by <strong style={{ color: '#374151' }}>{contact.preferred_name}</strong>
          </div>
        )}
        {contact.is_active === false && (
          <span style={{
            display: 'inline-block', marginTop: 6,
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
            background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb',
            fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.07em',
          }}>Inactive</span>
        )}

        {/* Role + qualifier */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <span style={roleChip(contact.role)}>{contact.role}</span>
          {contact.role_qualifier && (
            <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: F }}>
              · {contact.role_qualifier}
            </span>
          )}
        </div>

        {/* Organization */}
        <div style={{ marginTop: 6, fontSize: 13, color: '#6b7280', fontFamily: F }}>
          {contact.organization}
        </div>

        {/* ── Action buttons ── */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
          <ProfileActionButton
            variant="primary"
            icon="✉"
            label="Email"
            onClick={() => navigate(
              `/connect/outreach?mode=message&contactId=${contact.id}`,
              { state: { fromContact: { id: contact.id, name: contact.full_name, email: contact.email } } }
            )}
            disabled={!contact.email}
            disabledReason="No email on file"
          />

          <ProfileActionButton
            variant="secondary"
            icon="📞"
            label="Call"
            href={contact.phone ? `tel:${contact.phone}` : undefined}
            disabled={!contact.phone}
            disabledReason="No phone on file"
          />

          <ProfileActionButton
            variant="secondary"
            icon="✎"
            label="Edit"
            onClick={() => onEdit && onEdit(contact)}
          />

          {contact.linkedin_url && (
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '7px 14px', height: 34, borderRadius: 8,
                background: '#fff', border: '1px solid rgba(10,102,194,0.25)',
                textDecoration: 'none', transition: 'background 0.12s',
                boxSizing: 'border-box',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              <img src="/linkedin-logo.svg" alt="LinkedIn" height={17} style={{ display: 'block' }} />
            </a>
          )}
        </div>
      </div>

      {/* ── Contact methods ── */}
      <div style={{ padding: '20px 24px' }}>
        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '14px 16px', marginBottom: 16,
        }}>
          <SectionHeading>Contact</SectionHeading>
          {contact.email ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: contact.phone ? 8 : 0 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', width: 44, fontFamily: F, flexShrink: 0 }}>Email</span>
              <span style={{ fontSize: 13, color: '#374151', fontFamily: F, flex: 1 }}>
                {contact.email}
              </span>
              <CopyButton value={contact.email} label="email" />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, marginBottom: contact.phone ? 8 : 0 }}>
              No email on file
            </div>
          )}
          {contact.preferred_contact_method && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: contact.phone ? 8 : 0 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', width: 44, fontFamily: F, flexShrink: 0 }}>Prefers</span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                background: '#EEF2FB', color: NAVY, border: '1px solid #c3cdf0',
                fontFamily: F, textTransform: 'capitalize',
              }}>
                {contact.preferred_contact_method.replace(/_/g, ' ')}
              </span>
            </div>
          )}
          {contact.phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', width: 44, fontFamily: F, flexShrink: 0 }}>Phone</span>
              <span style={{ fontSize: 13, color: '#374151', fontFamily: F, flex: 1 }}>{contact.phone}</span>
              <CopyButton value={contact.phone} label="phone" />
            </div>
          )}
        </div>

        {/* ── Affiliation ── */}
        {showAffiliation && (
          <div style={{
            background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
            padding: '14px 16px', marginBottom: 16,
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
            {relatedUnits.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#9ca3af', width: 76, fontFamily: F, flexShrink: 0 }}>All units</span>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {relatedUnits.map(u => (
                    <span key={u} style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                      background: '#EEF2FB', color: NAVY, border: '1px solid #c3cdf0', fontFamily: F,
                    }}>{u}</span>
                  ))}
                </div>
              </div>
            )}
            {contact.school_name && (
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#9ca3af', width: 76, fontFamily: F, flexShrink: 0 }}>School</span>
                <span style={{ fontSize: 13, color: '#374151', fontFamily: F }}>
                  {contact.school_name}
                  {contact.program_type && <span style={{ color: '#9ca3af' }}> · {contact.program_type}</span>}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Last contact ── */}
        {(contact.last_contacted_at || contact.last_contact_summary) && (
          <div style={{
            background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
            padding: '14px 16px', marginBottom: 16,
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

        {/* ── Notes ── */}
        {contact.notes && (
          <div style={{
            background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
            padding: '14px 16px', marginBottom: 16,
          }}>
            <SectionHeading>Notes</SectionHeading>
            <div style={{ fontSize: 12, color: '#374151', fontFamily: F, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {contact.notes}
            </div>
          </div>
        )}

        {/* ── Notification preferences ── */}
        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '14px 16px', marginBottom: 8,
        }}>
          <SectionHeading>Notification Preferences</SectionHeading>
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
    </div>
  )
}

// ── Zone 3: Context panel (history + linked students) ────────────────────────

function ContactContext({ contact, commHistory, loadingComm, linkedStudents, loadingStudents }) {
  return (
    <div style={{ padding: '20px 18px' }}>

      {/* ── Communication history ── */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '14px 16px', marginBottom: 14,
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
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', fontFamily: F, marginBottom: 3 }}>
                  {log.subject || notifLabel(log.notification_type)}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <StatusBadge status={log.status} />
                  <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: F }}>{fmtDate(log.sent_at)}</span>
                  {log.opened_at && <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: F }}>· opened</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Linked students ── */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '14px 16px',
      }}>
        <SectionHeading>Linked Students</SectionHeading>
        {(() => {
          const isPreceptor = PRECEPTOR_ROLES.has(contact.role)
          const hasSource   = isPreceptor ? !!contact.email : !!contact.school_name
          if (!hasSource) return (
            <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', fontFamily: F, lineHeight: 1.6 }}>
              Linked students and cohort relationships will appear here when available.
            </p>
          )
          if (loadingStudents) return (
            <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', fontFamily: F }}>Loading…</p>
          )
          if (linkedStudents.length === 0) return (
            <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', fontFamily: F, lineHeight: 1.6 }}>
              {isPreceptor
                ? 'No students currently assigned to this preceptor.'
                : `No current students at ${contact.school_name} in the active cohort.`}
            </p>
          )
          return (
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginBottom: 8 }}>
                {linkedStudents.length} assigned student{linkedStudents.length !== 1 ? 's' : ''}
                {!isPreceptor && ` at ${contact.school_name}`}
              </div>
              {linkedStudents.slice(0, 12).map(s => (
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
              {linkedStudents.length > 12 && (
                <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginTop: 6 }}>
                  +{linkedStudents.length - 12} more
                </div>
              )}
            </div>
          )
        })()}
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
        width: 52, height: 52, borderRadius: '50%',
        background: '#EEF2FB', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, marginBottom: 16,
      }}>
        👤
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', fontFamily: F, marginBottom: 6 }}>
        {count > 0 ? 'Select a contact' : 'No contacts found'}
      </div>
      <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, maxWidth: 260, lineHeight: 1.6 }}>
        {count > 0
          ? 'Choose a contact from the list to view their profile and communication history.'
          : 'No contacts match your current search or filter.'}
      </div>
    </div>
  )
}

// ── Add / Edit Contact Modal ──────────────────────────────────────────────────

const PREFERRED_METHOD_OPTIONS = [
  { value: '',             label: 'No preference' },
  { value: 'email',       label: 'Email' },
  { value: 'phone',       label: 'Phone' },
  { value: 'text',        label: 'Text' },
  { value: 'teams',       label: 'Microsoft Teams' },
  { value: 'no_preference', label: 'No preference (explicit)' },
]

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 11px', border: '1.5px solid #e5e7eb',
  borderRadius: 8, fontSize: 13, fontFamily: F,
  color: '#191919', background: '#fff', outline: 'none',
}

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: '#374151', marginBottom: 4, fontFamily: F,
}

function ContactModal({ mode, initialData, onClose, onSaved }) {
  const isEdit = mode === 'edit'
  const [formData, setFormData] = useState(() => {
    if (!isEdit || !initialData) return { is_active: true }
    return {
      ...initialData,
      related_units: Array.isArray(initialData.related_units)
        ? initialData.related_units.join(', ')
        : (initialData.related_units || ''),
      weekly_digest: initialData.notification_preferences?.weekly_digest !== false,
    }
  })
  const [saving,         setSaving]         = useState(false)
  const [errMsg,         setErrMsg]         = useState(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadErr,      setUploadErr]      = useState(null)
  const [showAdvanced,   setShowAdvanced]   = useState(() => {
    // Open Advanced Details automatically if the contact has data in non-primary fields
    if (!isEdit || !initialData) return false
    return !!(initialData.avatar_url || initialData.school_name || initialData.program_type
           || initialData.unit_name || initialData.related_units)
  })

  const set = (field, value) => setFormData(prev => ({ ...prev, [field]: value }))

  // Role group drives which sections appear in the main form
  const roleGroup = (() => {
    const r = formData.role || ''
    if (ACADEMIC_ROLES.has(r)) return 'academic'
    if (['Associate Director', 'Assistant Nurse Manager'].includes(r)) return 'unit-clinical'
    if (['Unit NPD-P', 'Unit NPD Practitioner'].includes(r)) return 'unit-npd-p'
    if (PRECEPTOR_ROLES.has(r)) return 'preceptor'
    if (BNI_TEAM_ROLES.has(r)) return 'bni'
    if (NURSING_EXEC_ROLES.has(r)) return 'nursing-exec'
    return 'other'
  })()

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const validTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setUploadErr('Only JPEG, PNG, and WebP images are supported.')
      if (e.target) e.target.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadErr('Image must be under 2 MB.')
      if (e.target) e.target.value = ''
      return
    }
    setUploadErr(null)
    setUploadingPhoto(true)
    try {
      const ext      = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const uniqueId = initialData?.id || `new-${Date.now()}`
      const path     = `${uniqueId}-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('contact-avatars')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (uploadError) {
        setUploadErr(`Upload failed: ${uploadError.message}`)
        return
      }
      const { data: { publicUrl } } = supabase.storage.from('contact-avatars').getPublicUrl(path)
      set('avatar_url', publicUrl)
    } catch (err) {
      setUploadErr(`Upload error: ${err.message}`)
    } finally {
      setUploadingPhoto(false)
      if (e.target) e.target.value = ''
    }
  }

  function handleRemovePhoto() {
    set('avatar_url', '')
    setUploadErr(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErrMsg(null)
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setErrMsg('Session expired. Please refresh and try again.')
        return
      }
      const body = {
        ...(isEdit && initialData?.id ? { id: initialData.id } : {}),
        full_name:                formData.full_name || '',
        preferred_name:           formData.preferred_name || '',
        email:                    formData.email || '',
        phone:                    formData.phone || '',
        organization:             formData.organization || '',
        role:                     formData.role || '',
        role_qualifier:           formData.role_qualifier || '',
        school_name:              formData.school_name || '',
        program_type:             formData.program_type || '',
        unit_name:                formData.unit_name || '',
        related_units:            formData.related_units || '',
        linkedin_url:             formData.linkedin_url || '',
        avatar_url:               formData.avatar_url || '',
        preferred_contact_method: formData.preferred_contact_method || '',
        is_active:                formData.is_active !== false,
        notes:                    formData.notes || '',
        notification_preferences: { weekly_digest: formData.weekly_digest !== false },
      }
      const res = await fetch('/api/contacts-upsert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      })
      let payload = null
      try { payload = await res.json() } catch { /* ignore */ }
      if (res.status === 409) { setErrMsg(payload?.error || 'A contact with this email already exists.'); return }
      if (res.status === 401 || res.status === 403) { setErrMsg('You do not have permission to edit contacts.'); return }
      if (!res.ok) { setErrMsg(payload?.error || 'Failed to save contact. Please try again.'); return }
      onSaved(payload.contact, isEdit)
    } catch {
      setErrMsg('Network error. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12,
          padding: '28px 32px', maxWidth: 680, width: '90vw',
          maxHeight: '88vh', overflowY: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          fontFamily: F, boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: NAVY, fontFamily: F }}>
            {isEdit ? 'Edit Contact' : 'Add Contact'}
          </h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 20, color: '#9ca3af', lineHeight: 1, padding: '2px 6px',
          }}>×</button>
        </div>

        {/* Error */}
        {errMsg && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, padding: '10px 14px',
            fontSize: 12, color: '#dc2626', fontFamily: F,
            marginBottom: 18,
          }}>
            {errMsg}
          </div>
        )}

        <form onSubmit={handleSubmit}>

          {/* ── Photo ── */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 22 }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: NAVY, overflow: 'hidden', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26, fontWeight: 700, color: '#fff', fontFamily: F, position: 'relative',
            }}>
              {formData.avatar_url ? (
                <img src={formData.avatar_url} alt="Avatar preview"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { e.currentTarget.style.display = 'none' }} />
              ) : null}
              {!formData.avatar_url && <span>{initials(formData.full_name || '')}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 13px', borderRadius: 7,
                border: `1px solid ${uploadingPhoto ? '#e5e7eb' : NAVY}`,
                background: uploadingPhoto ? '#f9fafb' : '#fff',
                color: uploadingPhoto ? '#9ca3af' : NAVY,
                fontSize: 11, fontWeight: 600, fontFamily: F,
                cursor: uploadingPhoto ? 'not-allowed' : 'pointer',
              }}>
                {uploadingPhoto ? 'Uploading…' : '↑ Upload Photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }} disabled={uploadingPhoto} onChange={handlePhotoUpload} />
              </label>
              {formData.avatar_url && !uploadingPhoto && (
                <button type="button" onClick={handleRemovePhoto} style={{
                  padding: '6px 13px', borderRadius: 7, border: '1px solid #e5e7eb',
                  background: '#fff', color: '#6b7280', fontSize: 11, fontWeight: 600,
                  fontFamily: F, cursor: 'pointer',
                }}>Remove Photo</button>
              )}
            </div>
            {uploadErr && <div style={{ fontSize: 11, color: '#dc2626', fontFamily: F, marginTop: 6 }}>{uploadErr}</div>}
            <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 4 }}>JPEG, PNG, or WebP · max 2 MB</div>
          </div>

          {/* ── Section helper ── */}
          {[
            // Section headings rendered inline — this is a local style constant
          ].map(() => null)}

          {/* ── Identity ── */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Identity</div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Full Name <span style={{ color: '#dc2626' }}>*</span></label>
            <input required value={formData.full_name || ''} onChange={e => set('full_name', e.target.value)} placeholder="e.g. Susan Hunter" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Preferred Name</label>
            <input value={formData.preferred_name || ''} onChange={e => set('preferred_name', e.target.value)} placeholder="e.g. Sue" style={inputStyle} />
          </div>

          {/* ── Contact Information ── */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Contact Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Email</label>
              <input type="email" value={formData.email || ''} onChange={e => set('email', e.target.value)} placeholder="name@example.com" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Phone</label>
              <input value={formData.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="e.g. 310-555-0100" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Preferred Contact Method</label>
            <select value={formData.preferred_contact_method || ''} onChange={e => set('preferred_contact_method', e.target.value)} style={inputStyle}>
              {PREFERRED_METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* ── Role and Affiliation ── */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Role and Affiliation</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Organization</label>
              <input value={formData.organization || ''} onChange={e => set('organization', e.target.value)} placeholder="e.g. Azusa Pacific University" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Role</label>
              <input value={formData.role || ''} onChange={e => set('role', e.target.value)} placeholder="e.g. School Coordinator" style={inputStyle} />
            </div>
          </div>
          {/* Role Qualifier shown for all named roles */}
          {roleGroup !== 'other' && (
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Role Qualifier / Title Detail</label>
              <input value={formData.role_qualifier || ''} onChange={e => set('role_qualifier', e.target.value)} placeholder="e.g. BSN Programs" style={inputStyle} />
            </div>
          )}
          {/* Show Role Qualifier in advanced for 'other' role if has data */}
          {roleGroup === 'other' && formData.role_qualifier && (
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Role Qualifier / Title Detail</label>
              <input value={formData.role_qualifier || ''} onChange={e => set('role_qualifier', e.target.value)} placeholder="e.g. BSN Programs" style={inputStyle} />
            </div>
          )}

          {/* ── Program / Unit Details (conditional by role group) ── */}
          {(roleGroup === 'academic' || roleGroup === 'unit-clinical' || roleGroup === 'unit-npd-p'
            || roleGroup === 'preceptor'
            || (roleGroup !== 'academic' && (formData.school_name || formData.unit_name || formData.related_units || formData.program_type))) && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Program / Unit Details</div>
              {/* Academic: school name + program type */}
              {(roleGroup === 'academic' || formData.school_name) && (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>School Name</label>
                  <input value={formData.school_name || ''} onChange={e => set('school_name', e.target.value)} placeholder="e.g. APU" style={inputStyle} />
                </div>
              )}
              {(roleGroup === 'academic' || formData.program_type) && (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Program Type</label>
                  <input value={formData.program_type || ''} onChange={e => set('program_type', e.target.value)} placeholder="e.g. BSN, ABSN" style={inputStyle} />
                </div>
              )}
              {/* Unit leaders and NPD-Ps: unit name + related units */}
              {(['unit-clinical', 'unit-npd-p'].includes(roleGroup) || formData.unit_name) && (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Unit Name</label>
                  <input value={formData.unit_name || ''} onChange={e => set('unit_name', e.target.value)} placeholder="e.g. 5 SCCT" style={inputStyle} />
                </div>
              )}
              {(['unit-clinical', 'unit-npd-p'].includes(roleGroup) || formData.related_units) && (
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Related Units <span style={{ fontWeight: 400, color: '#9ca3af' }}>(comma-separated)</span></label>
                  <input value={formData.related_units || ''} onChange={e => set('related_units', e.target.value)} placeholder="e.g. 5 SCCT, 4 South, 7 North" style={inputStyle} />
                </div>
              )}
            </>
          )}

          {/* ── Online Profile ── */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Online Profile</div>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>LinkedIn URL</label>
            <input value={formData.linkedin_url || ''} onChange={e => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/..." style={inputStyle} />
          </div>

          {/* ── Notes ── */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Notes</div>
          <div style={{ marginBottom: 20 }}>
            <textarea value={formData.notes || ''} onChange={e => set('notes', e.target.value)}
              rows={3} placeholder="Optional context or notes about this contact."
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55, minHeight: 72 }} />
          </div>

          {/* ── Preferences ── */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Preferences</div>
          <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, fontFamily: F, color: '#374151' }}>
              <input type="checkbox" checked={formData.is_active !== false}
                onChange={e => set('is_active', e.target.checked)} style={{ width: 14, height: 14 }} />
              Active contact
            </label>
            {/* Weekly digest: shown for Academic Partners in main section; others see it in Advanced */}
            {(roleGroup === 'academic' || formData.weekly_digest === false) && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, fontFamily: F, color: '#374151' }}>
                <input type="checkbox" checked={formData.weekly_digest !== false}
                  onChange={e => set('weekly_digest', e.target.checked)} style={{ width: 14, height: 14 }} />
                Receives weekly digest
              </label>
            )}
          </div>

          {/* ── Advanced Details (collapsible) ── */}
          <div style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, color: '#6b7280', fontFamily: F,
                padding: '6px 0',
              }}
            >
              <span style={{ display: 'inline-block', transform: showAdvanced ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', fontSize: 10 }}>▶</span>
              Advanced Details
            </button>
            {showAdvanced && (
              <div style={{ paddingTop: 12, borderTop: '1px solid #f3f4f6', marginTop: 4 }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Avatar URL <span style={{ fontWeight: 400, color: '#9ca3af' }}>(set by Upload Photo above, or paste directly)</span></label>
                  <input value={formData.avatar_url || ''} onChange={e => set('avatar_url', e.target.value)} placeholder="https://…" style={inputStyle} />
                </div>
                {/* Weekly digest for non-academic roles */}
                {roleGroup !== 'academic' && formData.weekly_digest !== false && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, fontFamily: F, color: '#374151', marginBottom: 16 }}>
                    <input type="checkbox" checked={formData.weekly_digest !== false}
                      onChange={e => set('weekly_digest', e.target.checked)} style={{ width: 14, height: 14 }} />
                    Receives weekly digest
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 10,
            paddingTop: 20, marginTop: 8,
            borderTop: '1px solid #f3f4f6',
          }}>
            <button type="button" onClick={onClose} style={{
              padding: '8px 18px', borderRadius: 8,
              border: '1px solid #e5e7eb', background: '#fff',
              fontSize: 12, fontWeight: 600, fontFamily: F,
              color: '#374151', cursor: 'pointer',
            }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={{
              padding: '8px 20px', borderRadius: 8,
              border: 'none',
              background: saving ? '#e5e7eb' : NAVY,
              fontSize: 12, fontWeight: 600, fontFamily: F,
              color: saving ? '#9ca3af' : '#fff',
              cursor: saving ? 'not-allowed' : 'pointer',
              transition: 'background 0.12s',
            }}>
              {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Contact')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContactsView() {
  const navigate    = useNavigate()
  const location    = useLocation()
  const restoredRef = useRef(false)   // tracks whether initial selection restore has run

  const [showContactModal, setShowContactModal] = useState(false)
  const [editingContact,   setEditingContact]   = useState(null)

  const handleOpenAdd  = useCallback(() => { setEditingContact(null); setShowContactModal(true) }, [])
  const handleOpenEdit = useCallback(contact => { setEditingContact(contact); setShowContactModal(true) }, [])
  const handleModalClose = useCallback(() => { setShowContactModal(false); setEditingContact(null) }, [])

  const handleContactSaved = useCallback((savedContact, wasEdit) => {
    setContacts(prev =>
      wasEdit
        ? prev.map(c => c.id === savedContact.id ? savedContact : c)
        : [...prev, savedContact]
    )
    setSelectedId(savedContact.id)
    handleModalClose()
  }, [handleModalClose])

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

  // ── Fetch linked students ─────────────────────────────────────────────────
  // Academic Partners: students from the same school.
  // Preceptors: students currently assigned to this preceptor via preceptor_email.
  useEffect(() => {
    const contact = contacts.find(c => c.id === selectedId)
    if (!contact) { setLinkedStudents([]); return }

    const isPreceptor = PRECEPTOR_ROLES.has(contact.role)

    if (isPreceptor && contact.email) {
      // Match students whose preceptor_email matches this contact's email
      setLoadingStudents(true)
      supabase
        .from('students')
        .select('id, first_name, last_name, status, matched_unit_id')
        .ilike('preceptor_email', contact.email)
        .not('status', 'in', '(Not Proceeding,Declined)')
        .order('last_name')
        .order('first_name')
        .limit(15)
        .then(({ data }) => {
          setLinkedStudents(data || [])
          setLoadingStudents(false)
        })
      return
    }

    if (contact.school_name) {
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
      return
    }

    setLinkedStudents([])
  }, [selectedId, contacts])

  // ── Restore selected contact on initial load ───────────────────────────────
  // Priority: URL ?contactId → localStorage → first contact in list.
  // Runs once after the contacts fetch completes; never re-runs on filter changes.
  useEffect(() => {
    if (loading || contacts.length === 0 || restoredRef.current) return
    restoredRef.current = true

    // 1. URL search param
    const urlId = new URLSearchParams(location.search).get('contactId')
    if (urlId && contacts.find(c => c.id === urlId)) {
      setSelectedId(urlId)
      return
    }

    // 2. localStorage
    const savedId = localStorage.getItem(LAST_CONTACT_KEY)
    if (savedId && contacts.find(c => c.id === savedId)) {
      setSelectedId(savedId)
      navigate(`/connect/contacts?contactId=${savedId}`, { replace: true })
      return
    }

    // 3. First contact as default
    setSelectedId(contacts[0].id)
    navigate(`/connect/contacts?contactId=${contacts[0].id}`, { replace: true })
  }, [loading, contacts]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ──────────────────────────────────────────────────────────
  const selected = contacts.find(c => c.id === selectedId) || null

  // Category counts: each contact may appear in multiple categories
  const categoryCounts = {}
  contacts.forEach(c => {
    getContactCategories(c).forEach(cat => {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1
    })
  })

  const activeCategories = CATEGORY_ORDER.filter(cat =>
    cat === 'All' || (categoryCounts[cat] || 0) > 0
  )

  const filtered = contacts.filter(c => {
    const q = search.trim().toLowerCase()
    if (q) {
      const relatedStr = Array.isArray(c.related_units) ? c.related_units.join(' ') : ''
      const searchText = [
        c.full_name, c.preferred_name, c.email, c.organization,
        c.role, c.unit_name, relatedStr, c.school_name, c.notes,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!searchText.includes(q)) return false
    }
    if (categoryFilter !== 'All' && !getContactCategories(c).includes(categoryFilter)) return false
    return true
  })

  // Unit Leadership sort: by unit_name → role rank → full_name
  let sortedFiltered = filtered
  if (categoryFilter === 'Unit Leadership') {
    sortedFiltered = [...filtered].sort((a, b) => {
      const uA = a.unit_name || (Array.isArray(a.related_units) ? a.related_units[0] : '') || ''
      const uB = b.unit_name || (Array.isArray(b.related_units) ? b.related_units[0] : '') || ''
      const unitCmp = uA.localeCompare(uB)
      if (unitCmp !== 0) return unitCmp
      const rA = UNIT_ROLE_RANK[a.role] || 99
      const rB = UNIT_ROLE_RANK[b.role] || 99
      if (rA !== rB) return rA - rB
      return (a.full_name || '').localeCompare(b.full_name || '')
    })
  }

  const showGrouped = categoryFilter === 'All' && !search.trim()

  const listItems = []
  if (showGrouped) {
    // Group by primary category — each contact appears exactly once
    const grouped = {}
    sortedFiltered.forEach(c => {
      const cat = getPrimaryCategory(c)
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
    sortedFiltered.forEach(c => listItems.push({ type: 'row', contact: c }))
  }

  // ── Three-zone CRM layout ─────────────────────────────────────────────────
  return (
    <>
    <div style={{
      display: 'flex', height: '100%', fontFamily: F, overflow: 'hidden',
      padding: '10px 12px', gap: 10,
      background: 'var(--bg-app, #F4F1EC)',
      boxSizing: 'border-box',
    }}>

      {/* ── Zone 1: Directory (left) ──────────────────────────────────── */}
      <div style={{
        flex: '0 0 320px', flexShrink: 0,
        borderRadius: 12,
        border: '1px solid rgba(29,37,103,0.10)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        display: 'flex', flexDirection: 'column',
        background: '#fff',
        overflow: 'hidden',
      }}>

        {/* Directory header with Add Contact */}
        <div style={{
          padding: '12px 14px 8px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(29,37,103,0.06)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', fontFamily: F, letterSpacing: '-0.01em' }}>
            Contacts
          </span>
          <button
            onClick={handleOpenAdd}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 9px', borderRadius: 6,
              border: `1px solid ${NAVY}`,
              background: NAVY, color: '#fff',
              fontSize: 10, fontWeight: 600, fontFamily: F,
              cursor: 'pointer', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            + Add
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 14px 8px', flexShrink: 0 }}>
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

        {/* Category filter pills */}
        <div style={{ padding: '4px 12px 8px', flexShrink: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: F, marginBottom: 5 }}>Category</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
        </div>{/* end flex wrap */}
        </div>{/* end category section */}

        {/* Contact count */}
        <div style={{ padding: '0 14px 6px', fontSize: 10.5, color: '#9ca3af', fontFamily: F, flexShrink: 0 }}>
          {loading ? 'Loading…' : error ? 'Failed to load' : `${filtered.length} of ${contacts.length}`}
        </div>

        {/* Contact list (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
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
                  onClick={() => {
                    setSelectedId(item.contact.id)
                    localStorage.setItem(LAST_CONTACT_KEY, item.contact.id)
                    navigate(`/connect/contacts?contactId=${item.contact.id}`, { replace: true })
                  }}
                />
              )
            )
          )}
        </div>
      </div>

      {/* ── Zone 2: Contact Profile (center) ──────────────────────────── */}
      <div style={{
        flex: '1 1 0', minWidth: 0,
        overflowY: 'auto',
        background: '#fff',
        borderRadius: 12,
        border: '1px solid rgba(29,37,103,0.10)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      }}>
        {selected ? (
          <ContactProfile contact={selected} navigate={navigate} onEdit={handleOpenEdit} />
        ) : (
          <NoSelection count={filtered.length} />
        )}
      </div>

      {/* ── Zone 3: Context — history + linked students (right) ───────── */}
      <div style={{
        flex: '0 0 280px', minWidth: 0,
        overflowY: 'auto',
        background: '#fff',
        borderRadius: 12,
        border: '1px solid rgba(29,37,103,0.10)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      }}>
        {selected ? (
          <ContactContext
            contact={selected}
            commHistory={commHistory}
            loadingComm={loadingComm}
            linkedStudents={linkedStudents}
            loadingStudents={loadingStudents}
          />
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            height: '100%', padding: '40px 20px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, lineHeight: 1.6 }}>
              Select a contact to view activity and linked students.
            </div>
          </div>
        )}
      </div>

    </div>{/* end three-zone layout */}

    {/* Add / Edit Contact Modal */}
    {showContactModal && (
      <ContactModal
        mode={editingContact ? 'edit' : 'add'}
        initialData={editingContact}
        onClose={handleModalClose}
        onSaved={handleContactSaved}
      />
    )}
    </>
  )
}
