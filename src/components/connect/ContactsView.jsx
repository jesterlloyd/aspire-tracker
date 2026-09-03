import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Mail, Pencil, Phone } from 'lucide-react'
import ProfileActionButton from '../ui/ProfileActionButton'
import { useToast } from '../../hooks/useToast'
import { ToastContainer } from '../Toast'

const LAST_CONTACT_KEY = 'aspire.connect.contacts.lastContactId'
import { supabase } from '../../lib/supabase'
import Tooltip from '../ui/Tooltip'
import { isValidEmail } from '../../lib/notifications/studentRecipient'
import { normalizeEmailForLookup } from '../../lib/emailUtils'
import {
  PRECEPTOR_ROLES, contactRoleChipColors,
  getPrimaryCategory, getContactCategories,
  CONTACT_CATEGORY_ORDER, canonicalCategory,
  titleOptionsFor, titleAllowsFreeText,
  affiliationKind, showsUnitAffiliation, contactServicesMeta, showsDivisionsField,
  contactDivisionList,
  contactUnitList, splitUnitList, CSMC_AFFILIATION,
  categoryPluralLabel, contactListSubline, sortContactsForCategory, sortContactsForSearch,
} from '../../lib/contactCategories'
import { UNIT_SCOPE_OPTIONS } from '../../lib/portalScopeCatalog'
import { CONTACT_DIVISION_OPTIONS } from '../../lib/contactScopeFilter'
import { SCHOOL_PICKER_OPTIONS, schoolPickerLabel } from '../../lib/schoolIdentity'
import MultiScopePicker from '../shared/MultiScopePicker'
import { toneGradient } from '../../lib/connectTones'
import ConnectPanel, { ConnectPanelIcon } from './ConnectPanel'

const F    = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'

// ── Category mapping ──────────────────────────────────────────────────────────

// ── Multi-category contact model ───────────────────────────────────────────────
// The role Sets + inferPrimaryCategory / getPrimaryCategory / getContactCategories now live in
// the shared src/lib/contactCategories.js module (imported above) so the Contacts page and the
// Send-to-Many Contacts source share one source of truth. Behavior is unchanged.

// CONTACTS-CANON-1: the chip row derives from the shared canonical order, and
// per-category sorting lives in the shared sortContactsForCategory comparator.
const CATEGORY_ORDER = ['All', ...CONTACT_CATEGORY_ORDER]

// Category-level chip fallback - used when the contact's role string isn't in the shared role map.
// Ensures contacts with non-standard role titles (e.g., "Professor & Assistant Director")
// still receive the correct category color rather than the generic gray default.

function roleChip(role, category) {
  const cfg = contactRoleChipColors(role, category)
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
  'Academic Partner':  { active: '#1D2567', activeText: '#fff', restText: '#6b7280' },
  'Unit Leader':       { active: '#0d7a8a', activeText: '#fff', restText: '#6b7280' },
  'Preceptor':         { active: '#0e4e6e', activeText: '#fff', restText: '#6b7280' },
  'BNI Team':          { active: '#7C3AED', activeText: '#fff', restText: '#6b7280' },
  'Nursing Executive': { active: '#92400e', activeText: '#fff', restText: '#6b7280' },
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
  return NOTIF_LABELS[type] || type?.replace(/_/g, ' ') || '-'
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
      {status || '-'}
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
  // CONTACTS-CANON-1 row shape: name, then the Role/Title pill, then the
  // per-category subline (school / unit(s) / Programs / Services / affiliation).
  const contextLine = contactListSubline(contact)
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 12px', cursor: 'pointer', margin: '2px 6px',
        background: isSelected ? '#EEF2FB' : 'transparent',
        borderRadius: 8,
        outline: isSelected ? `1.5px solid rgba(29,37,103,0.18)` : 'none',
        transition: 'background 0.1s',
        opacity: contact.is_active === false ? 0.6 : 1,
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
          <div style={{ marginTop: 2 }}>
            {contact.role && <span style={roleChip(contact.role, getPrimaryCategory(contact))}>{contact.role}</span>}
            {contact.is_active === false && (
              <span style={{
                marginLeft: contact.role ? 4 : 0, fontSize: 9, fontWeight: 700, padding: '1px 5px',
                borderRadius: 4, background: '#f3f4f6', color: '#9ca3af',
                border: '1px solid #e5e7eb', fontFamily: F,
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>Inactive</span>
            )}
          </div>
          {contextLine && (
            <div style={{
              fontSize: 10.5, color: '#6b7280', fontFamily: F, lineHeight: 1.3, marginTop: 3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {contextLine}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Zone 2: Contact profile panel ────────────────────────────────────────────

function ContactProfile({ contact, navigate, onEdit, onDeactivate }) {
  const relatedUnits = Array.isArray(contact.related_units) ? contact.related_units.filter(Boolean) : []
  const showAffiliation = contact.school_name || contact.program_type || contact.unit_name || relatedUnits.length > 0 || contact.services
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
        {/* Avatar - shows image if avatar_url is present, falls back to initials */}
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
          <span style={roleChip(contact.role, getPrimaryCategory(contact))}>{contact.role}</span>
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
            icon={<Mail size={15} aria-hidden="true" />}
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
            icon={<Phone size={15} aria-hidden="true" />}
            label="Call"
            href={contact.phone ? `tel:${contact.phone}` : undefined}
            disabled={!contact.phone}
            disabledReason="No phone on file"
          />

          <ProfileActionButton
            variant="secondary"
            icon={<Pencil size={15} aria-hidden="true" />}
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
            {contact.services && (
              <div style={{ display: 'flex', gap: 8, marginTop: contact.school_name ? 6 : 0 }}>
                <span style={{ fontSize: 11, color: '#9ca3af', width: 76, fontFamily: F, flexShrink: 0 }}>
                  {contactServicesMeta(getPrimaryCategory(contact), contact.role)?.label || 'Services'}
                </span>
                <span style={{ fontSize: 13, color: '#374151', fontFamily: F }}>{contact.services}</span>
              </div>
            )}
            {contactDivisionList(contact).length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: (contact.school_name || contact.services) ? 6 : 0 }}>
                <span style={{ fontSize: 11, color: '#9ca3af', width: 76, fontFamily: F, flexShrink: 0 }}>Divisions</span>
                <span style={{ fontSize: 13, color: '#374151', fontFamily: F }}>{contactDivisionList(contact).join(', ')}</span>
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

        {/* ── Deactivate / Reactivate ── */}
        {onDeactivate && (
          <div style={{ paddingTop: 14, borderTop: '1px solid #f3f4f6', marginTop: 8 }}>
            <button
              onClick={onDeactivate}
              style={{
                display: 'block', width: '100%',
                padding: '8px 14px', borderRadius: 8,
                border: contact.is_active === false ? `1.5px solid ${NAVY}` : '1px solid #e5e7eb',
                background: '#fff',
                fontSize: 11, fontWeight: 600, fontFamily: F,
                color: contact.is_active === false ? NAVY : '#9ca3af',
                cursor: 'pointer', transition: 'all 0.12s', textAlign: 'center',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = contact.is_active === false ? NAVY : '#dc2626'
                e.currentTarget.style.color = contact.is_active === false ? NAVY : '#dc2626'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = contact.is_active === false ? NAVY : '#e5e7eb'
                e.currentTarget.style.color = contact.is_active === false ? NAVY : '#9ca3af'
              }}
            >
              {contact.is_active === false ? 'Reactivate Contact' : 'Deactivate Contact'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Zone 3: Context panel (history + linked students) ────────────────────────

function ContactContext({ contact, navigate, commHistory, loadingComm, linkedStudents, loadingStudents }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Recent Communications (communications tone / blush) ── */}
      <ConnectPanel tone="communications" title="Recent Communications" icon="mail">
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
        {/* View all → Outreach Sent History, pre-filtered to this contact (Phase D.1) */}
        {navigate && (
          <button
            onClick={() => navigate(`/connect/outreach?tab=sent_history&contact_id=${contact.id}`)}
            style={{
              marginTop: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: '#1D2567', fontFamily: F,
            }}
          >
            View all communications for this contact →
          </button>
        )}
      </ConnectPanel>

      {/* ── Linked Students (linkedStudents tone / sage) ── */}
      <ConnectPanel tone="linkedStudents" title="Linked Students" icon="users">
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
                    {s.status || '-'}
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
      </ConnectPanel>

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

// ── Repair Preceptor Contacts Modal ──────────────────────────────────────────
// Backfill/repair tool for preceptors added before automatic contact sync.
// Compares the preceptors table against contacts by lowercase-trimmed email.
// Shows a bucketed preview and only writes after Owner confirmation.

function SyncPreceptorsModal({ onClose, onSynced }) {
  const [phase,   setPhase]   = useState('loading')  // loading | preview | syncing | done
  const [preview, setPreview] = useState({ toInsert: [], alreadyExists: [], missingEmail: [] })
  const [result,  setResult]  = useState({ inserted: 0, skippedExisting: 0, skippedMissing: 0, failed: 0, failedNames: [] })
  const [loadErr, setLoadErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function loadPreview() {
      try {
        const [{ data: precs, error: precsErr }, { data: existingContacts, error: contactsErr }] = await Promise.all([
          supabase.from('preceptors').select('id, full_name, email, unit_name, phone').order('full_name'),
          supabase.from('contacts').select('email').not('email', 'is', null),
        ])
        if (precsErr)    throw new Error(`Preceptors: ${precsErr.message}`)
        if (contactsErr) throw new Error(`Contacts: ${contactsErr.message}`)
        if (cancelled)   return
        const existingEmails = new Set(
          (existingContacts || []).map(c => c.email?.toLowerCase().trim()).filter(Boolean)
        )
        const toInsert = [], alreadyExists = [], missingEmail = []
        for (const p of (precs || [])) {
          if (!p.email?.trim()) { missingEmail.push(p); continue }
          if (existingEmails.has(p.email.toLowerCase().trim())) { alreadyExists.push(p); continue }
          toInsert.push(p)
        }
        if (!cancelled) { setPreview({ toInsert, alreadyExists, missingEmail }); setPhase('preview') }
      } catch (err) {
        if (!cancelled) { setLoadErr(err.message); setPhase('preview') }
      }
    }
    loadPreview()
    return () => { cancelled = true }
  }, [])

  async function handleSync() {
    setPhase('syncing')
    let sessionToken
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setLoadErr('Session expired. Please refresh.'); setPhase('preview'); return }
      sessionToken = session.access_token
    } catch { setLoadErr('Failed to get session. Please refresh.'); setPhase('preview'); return }

    let inserted = 0, raceSkipped = 0, failed = 0
    const failedNames = []
    for (const p of preview.toInsert) {
      try {
        const body = {
          full_name:    p.full_name,
          email:        p.email.toLowerCase().trim(),
          // CONTACTS-CANON-1: the CN level is unknown for an auto-synced
          // preceptor, so the canonical state is "no title" (CN II / CN III
          // are set by hand); the category is the singular canonical key and
          // the Cedars-Sinai affiliation is derived server-side.
          role:         '',
          category:     'Preceptor',
          is_active:    true,
          notes:        'Imported from Rotations > Preceptors.',
          ...(p.unit_name ? { unit_name: p.unit_name } : {}),
          ...(p.phone     ? { phone:     p.phone     } : {}),
        }
        const res = await fetch('/api/contacts-upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
          body: JSON.stringify(body),
        })
        if (res.status === 409) { raceSkipped++; continue }  // added between preview and sync
        if (!res.ok)            { failed++; failedNames.push(p.full_name); continue }
        inserted++
      } catch { failed++; failedNames.push(p.full_name) }
    }
    setResult({
      inserted,
      skippedExisting: preview.alreadyExists.length + raceSkipped,
      skippedMissing:  preview.missingEmail.length,
      failed,
      failedNames,
    })
    setPhase('done')
    if (inserted > 0) onSynced()
  }

  const isSyncing    = phase === 'syncing'
  const confirmLabel = isSyncing
    ? 'Syncing…'
    : preview.toInsert.length > 0
      ? `Add ${preview.toInsert.length} Missing Preceptor${preview.toInsert.length !== 1 ? 's' : ''} to Contacts`
      : 'Nothing to Add'

  return (
    <div
      onClick={!isSyncing ? onClose : undefined}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 500, width: '90vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', fontFamily: F }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0E1428', fontFamily: F }}>Repair Preceptor Contacts</h2>
          {!isSyncing && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1, padding: '0 2px' }} aria-label="Close">×</button>
          )}
        </div>

        {/* Loading */}
        {phase === 'loading' && (
          <div style={{ fontSize: 13, color: '#6b7280', padding: '16px 0' }}>Loading preceptor and contact data…</div>
        )}

        {/* Error banner */}
        {loadErr && (
          <div style={{ fontSize: 13, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>{loadErr}</div>
        )}

        {/* Syncing */}
        {phase === 'syncing' && (
          <div style={{ fontSize: 13, color: '#6b7280', padding: '8px 0' }}>Syncing preceptors to Contacts…</div>
        )}

        {/* Preview */}
        {phase === 'preview' && !loadErr && (
          <>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px', lineHeight: 1.6, fontStyle: 'italic' }}>
              Only needed for preceptors added before automatic contact sync was enabled, or to repair missing contacts. New preceptors now sync automatically when saved.
            </p>
            <p style={{ fontSize: 13, color: '#374151', margin: '0 0 16px', lineHeight: 1.6 }}>
              This will create new Contact records for preceptors who have an email and are not already in Contacts.{' '}
              <strong>Existing Contacts will not be overwritten.</strong>
            </p>

            {/* Bucket summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 8, background: preview.toInsert.length > 0 ? '#f0fdf4' : '#f9fafb', border: `1px solid ${preview.toInsert.length > 0 ? '#bbf7d0' : '#e5e7eb'}` }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: preview.toInsert.length > 0 ? '#166534' : '#6b7280', minWidth: 22, textAlign: 'right' }}>{preview.toInsert.length}</span>
                <span style={{ fontSize: 12, color: preview.toInsert.length > 0 ? '#166534' : '#6b7280' }}>will be added to Contacts</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#6b7280', minWidth: 22, textAlign: 'right' }}>{preview.alreadyExists.length}</span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>already in Contacts, will be skipped</span>
              </div>
              {preview.missingEmail.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#92400e', minWidth: 22, textAlign: 'right' }}>{preview.missingEmail.length}</span>
                  <span style={{ fontSize: 12, color: '#92400e' }}>missing email, cannot be synced</span>
                </div>
              )}
            </div>

            {/* Will-be-added list */}
            {preview.toInsert.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Will be added</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
                  {preview.toInsert.slice(0, 12).map(p => (
                    <div key={p.id} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, color: '#191919' }}>{p.full_name}</span>
                      {p.email && <span style={{ color: '#9ca3af', fontSize: 11 }}>{p.email}</span>}
                    </div>
                  ))}
                  {preview.toInsert.length > 12 && (
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>+ {preview.toInsert.length - 12} more</div>
                  )}
                </div>
              </div>
            )}

            {/* Missing email list */}
            {preview.missingEmail.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Missing email, skipped</div>
                <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>{preview.missingEmail.map(p => p.full_name).join(' · ')}</div>
              </div>
            )}

            {preview.toInsert.length === 0 && (
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                All preceptors with email addresses are already in Contacts. Nothing to sync.
              </div>
            )}
          </>
        )}

        {/* Done summary */}
        {phase === 'done' && (
          <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#166534', marginBottom: 10 }}>Sync complete</div>
            <div>✓ <strong>{result.inserted}</strong> preceptor{result.inserted !== 1 ? 's' : ''} added to Contacts</div>
            <div style={{ color: '#6b7280' }}>- <strong>{result.skippedExisting}</strong> already in Contacts (skipped)</div>
            <div style={{ color: '#6b7280' }}>- <strong>{result.skippedMissing}</strong> missing email (skipped)</div>
            {result.failed > 0 && (
              <div style={{ marginTop: 8, color: '#dc2626' }}>✗ <strong>{result.failed}</strong> failed: {result.failedNames.join(', ')}</div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          {phase === 'done' ? (
            <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: `1.5px solid ${NAVY}`, background: NAVY, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer' }}>Done</button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={isSyncing}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 500, fontFamily: F, cursor: isSyncing ? 'not-allowed' : 'pointer', opacity: isSyncing ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSync}
                disabled={isSyncing || phase !== 'preview' || preview.toInsert.length === 0}
                style={{ padding: '8px 20px', borderRadius: 8, border: `1.5px solid ${NAVY}`, background: NAVY, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: (isSyncing || phase !== 'preview' || preview.toInsert.length === 0) ? 'not-allowed' : 'pointer', opacity: (isSyncing || phase !== 'preview' || preview.toInsert.length === 0) ? 0.65 : 1 }}
              >
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Deactivate / Reactivate Confirmation Modal ────────────────────────────────

function DeactivateModal({ contact, action, onConfirm, onClose, saving }) {
  const isDeactivate = action === 'deactivate'
  return (
    <div
      onClick={!saving ? onClose : undefined}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 420, width: '90vw', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', fontFamily: F }}
      >
        <h2 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700, color: '#0E1428', fontFamily: F }}>
          {isDeactivate ? 'Deactivate this contact?' : 'Reactivate this contact?'}
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.65 }}>
          {isDeactivate
            ? `This will hide ${contact.full_name} from active contact lists and outreach. Their data is preserved and you can reactivate them any time.`
            : `This will return ${contact.full_name} to active contact lists and outreach.`
          }
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, fontWeight: 600, fontFamily: F, color: '#374151', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: isDeactivate ? '#dc2626' : NAVY, fontSize: 12, fontWeight: 600, fontFamily: F, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.65 : 1 }}
          >
            {saving
              ? (isDeactivate ? 'Deactivating…' : 'Reactivating…')
              : (isDeactivate ? 'Deactivate' : 'Reactivate')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add / Edit Contact Modal ──────────────────────────────────────────────────
// CONTACTS-CANON-1: category, title, affiliation, and units all come from the
// shared canonical vocabulary (src/lib/contactCategories.js). Preferred
// Contact Method is retired (decision 2026-08-25).

// School options for the affiliation dropdown: the operative identities the
// rest of the app persists (students.school, digest matching).
const SCHOOL_AFFILIATION_OPTIONS = SCHOOL_PICKER_OPTIONS
const DIVISION_PICKER_OPTIONS = CONTACT_DIVISION_OPTIONS.map(d => ({ value: d, label: d }))

// Sentinel select value for "type a custom title" where the canon allows it.
const CUSTOM_TITLE = '__custom__'
const CUSTOM_SCHOOL = '__other_school__'

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
    if (!isEdit || !initialData) {
      return { is_active: true, units: [], divisions: [], affiliation_mode: 'csmc' }
    }
    const storedCat = canonicalCategory(initialData.category) || ''
    const storedRole = initialData.role || ''
    // Other's affiliation escape: derive the mode from what is stored.
    const affiliationMode = initialData.school_name
      ? 'school'
      : (!initialData.organization || initialData.organization === CSMC_AFFILIATION ? 'csmc' : 'custom')
    return {
      ...initialData,
      category: storedCat,
      // The multi-unit model: [primary unit_name, ...related_units].
      units: contactUnitList(initialData),
      divisions: contactDivisionList(initialData),
      // A stored title outside the dropdown in a free-text category opens the
      // custom input; in a fixed category it stays as a passthrough option.
      role_custom: Boolean(storedRole)
        && !titleOptionsFor(storedCat).includes(storedRole)
        && titleAllowsFreeText(storedCat),
      // NA-CONTACTS-SCOPE-1: a stored school outside the catalog opens in the
      // Other free-text state instead of dangling as a "(legacy)" option.
      school_custom: Boolean(initialData.school_name)
        && !SCHOOL_AFFILIATION_OPTIONS.includes(initialData.school_name),
      affiliation_mode: affiliationMode,
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
    return !!initialData.avatar_url
  })

  const set = (field, value) => setFormData(prev => ({ ...prev, [field]: value }))

  // Category drives the title dropdown, the derived affiliation, the unit
  // picker, and the Services field.
  const cat = formData.category || ''
  const titles = titleOptionsFor(cat)
  const roleValue = formData.role || ''
  const roleIsListed = titles.includes(roleValue)
  const showCustomTitleInput = titleAllowsFreeText(cat) && (formData.role_custom === true)
  const affKind = cat ? affiliationKind(cat) : null
  // NA-CONTACTS-SCOPE-1: the Other free-text school state and its select handler.
  const schoolIsCustom = formData.school_custom === true
  const handleSchoolSelect = (value) => {
    if (value === CUSTOM_SCHOOL) setFormData(prev => ({ ...prev, school_custom: true, school_name: '' }))
    else setFormData(prev => ({ ...prev, school_custom: false, school_name: value }))
  }
  // Unit picker: Unit Leader and Preceptor by canon; a Nursing Executive sees
  // it ONLY when units were already stored when the modal opened (the
  // acting-AD passthrough, e.g. Charina Emerson / Float Pool), so units can
  // be edited or CLEARED (the clear still saves) but never newly added to an
  // executive.
  const hadUnitsAtOpen = isEdit && contactUnitList(initialData || {}).length > 0
  const showUnits = cat
    ? (showsUnitAffiliation(cat) || (cat === 'Nursing Executive' && hadUnitsAtOpen))
    : false
  const servicesMeta = contactServicesMeta(cat, roleValue)
  const showServices = Boolean(servicesMeta)
  // NA-CONTACTS-SCOPE-4: the explicit divisions an executive covers, so the
  // portal Contacts division filter finds them even when their Services line
  // names something that is not a division ("Clinical Operations").
  const showDivisions = showsDivisionsField(cat, roleValue)

  const handleCategoryChange = (newCat) => {
    setFormData(prev => {
      const keepRole = prev.role
        && (titleOptionsFor(newCat).includes(prev.role) || prev.role === (initialData?.role || ''))
      return {
        ...prev,
        category: newCat,
        role: keepRole ? prev.role : '',
        role_custom: false,
      }
    })
  }

  const handleTitleSelect = (value) => {
    if (value === CUSTOM_TITLE) {
      setFormData(prev => ({ ...prev, role_custom: true, role: '' }))
    } else {
      setFormData(prev => ({ ...prev, role_custom: false, role: value }))
    }
  }

  // Warn when the selected category would drop currently-populated fields
  // from the form (their data is preserved unless the save touches them).
  const hiddenPopulatedFields = []
  if (cat) {
    if (affKind !== 'school' && affKind !== 'choice' && formData.school_name) {
      hiddenPopulatedFields.push('School')
    }
    if (cat !== 'Academic Partner' && cat !== 'Other' && formData.program_type) {
      hiddenPopulatedFields.push('Program Type')
    }
    if (!showUnits && (formData.units || []).length > 0) {
      hiddenPopulatedFields.push('Unit Affiliation')
    }
    if (!showServices && formData.services) {
      hiddenPopulatedFields.push('Services / Programs')
    }
    if (!showDivisions && (formData.divisions || []).length > 0) {
      hiddenPopulatedFields.push('Divisions')
    }
  }

  // Save needs a name, a category, and a valid affiliation for its kind.
  const affiliationValid =
    affKind === 'school' ? !!formData.school_name?.trim() :
    affKind === 'choice' ? (
      formData.affiliation_mode === 'school' ? !!formData.school_name?.trim() :
      formData.affiliation_mode === 'custom' ? !!formData.organization?.trim() :
      true
    ) : true
  const canSave = !saving &&
    !!formData.full_name?.trim() &&
    !!formData.category &&
    affiliationValid

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
      // The affiliation the server derives (Academic Partner -> school on both
      // columns; fixed Cedars-Sinai; Other -> the chosen escape).
      const affiliation =
        affKind === 'school' ? { school_name: formData.school_name || '' } :
        affKind === 'csmc' ? {} :
        formData.affiliation_mode === 'school' ? { school_name: formData.school_name || '', organization: '' } :
        formData.affiliation_mode === 'custom' ? { school_name: '', organization: formData.organization || '' } :
        { school_name: '', organization: CSMC_AFFILIATION }
      // Multi-unit model: primary + rest, only when the category carries units.
      const unitCols = showUnits ? splitUnitList(formData.units || []) : {}
      const body = {
        ...(isEdit && initialData?.id ? { id: initialData.id } : {}),
        full_name:                formData.full_name || '',
        preferred_name:           formData.preferred_name || '',
        email:                    formData.email || '',
        phone:                    formData.phone || '',
        role:                     formData.role || '',
        category:                 formData.category || '',
        role_qualifier:           formData.role_qualifier || '',
        program_type:             formData.program_type || '',
        ...affiliation,
        ...(showUnits ? { unit_name: unitCols.unit_name || '', related_units: unitCols.related_units } : {}),
        ...(showDivisions || (isEdit && contactDivisionList(initialData || {}).length > 0)
          ? { divisions: showDivisions ? (formData.divisions || []) : [] }
          : {}),
        ...(showServices || (isEdit && initialData?.services)
          ? { services: showServices ? (formData.services || '') : '' }
          : {}),
        linkedin_url:             formData.linkedin_url || '',
        avatar_url:               formData.avatar_url || '',
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
            // Section headings rendered inline - this is a local style constant
          ].map(() => null)}

          {/* ── Category ── */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Category</div>
          <div style={{ marginBottom: 4 }}>
            <label style={labelStyle}>Category <span style={{ color: '#dc2626' }}>*</span></label>
            <select
              value={formData.category || ''}
              onChange={e => handleCategoryChange(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select category…</option>
              {CONTACT_CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginTop: 4, lineHeight: 1.4 }}>
              Category determines how this contact is organized and which fields appear below.
            </div>
          </div>
          {hiddenPopulatedFields.length > 0 && (
            <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '8px 12px', marginBottom: 16, marginTop: 8 }}>
              Changing category will hide the following populated fields from this form:{' '}
              <strong>{hiddenPopulatedFields.join(', ')}</strong>. Their data will be preserved in the database.
            </div>
          )}

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
          {/* ── Role and Affiliation ── */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Role and Affiliation</div>

          {/* Role/Title: the category's canonical dropdown. A stored legacy
              title stays selectable (passthrough) until corrected; free text
              exists only where the canon allows it. */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Role / Title</label>
            <select
              value={showCustomTitleInput ? CUSTOM_TITLE : (roleValue || '')}
              onChange={e => handleTitleSelect(e.target.value)}
              style={inputStyle}
              disabled={!cat}
            >
              <option value="">{cat ? 'Select…' : 'Select a category first'}</option>
              {titles.map(t => <option key={t} value={t}>{t}</option>)}
              {roleValue && !roleIsListed && !showCustomTitleInput && (
                <option value={roleValue}>{roleValue} (legacy)</option>
              )}
              {titleAllowsFreeText(cat) && <option value={CUSTOM_TITLE}>Other</option>}
            </select>
            {showCustomTitleInput && (
              <input
                value={roleValue}
                onChange={e => set('role', e.target.value)}
                placeholder="Type the role or title"
                style={{ ...inputStyle, marginTop: 8 }}
                aria-label="Custom role or title"
              />
            )}
          </div>

          {/* Affiliation: derived per category. */}
          {affKind === 'school' && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Affiliation (School) <span style={{ color: '#dc2626' }}>*</span></label>
              {/* NA-CONTACTS-SCOPE-1: schools outside the ASPIRE catalog are welcome -
                  Other opens a free-text school name (stored as typed; it canonicalizes
                  automatically if the school later joins the catalog). */}
              <select
                value={schoolIsCustom ? CUSTOM_SCHOOL : (formData.school_name || '')}
                onChange={e => handleSchoolSelect(e.target.value)}
                style={inputStyle}
              >
                <option value="">Select school…</option>
                {SCHOOL_AFFILIATION_OPTIONS.map(s => <option key={s} value={s}>{schoolPickerLabel(s)}</option>)}
                <option value={CUSTOM_SCHOOL}>Other</option>
              </select>
              {schoolIsCustom && (
                <input
                  value={formData.school_name || ''}
                  onChange={e => set('school_name', e.target.value)}
                  placeholder="Type the school name"
                  style={{ ...inputStyle, marginTop: 8 }}
                  aria-label="Other school name"
                />
              )}
              <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginTop: 4, lineHeight: 1.4 }}>Used for linked students and weekly digest matching.</div>
            </div>
          )}
          {affKind === 'csmc' && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Affiliation</label>
              <div style={{ ...inputStyle, background: '#f9fafb', color: '#374151' }}>{CSMC_AFFILIATION}</div>
            </div>
          )}
          {affKind === 'choice' && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Affiliation <span style={{ color: '#dc2626' }}>*</span></label>
              <select value={formData.affiliation_mode || 'csmc'} onChange={e => set('affiliation_mode', e.target.value)} style={inputStyle}>
                <option value="csmc">{CSMC_AFFILIATION}</option>
                <option value="school">School</option>
                <option value="custom">Other organization (free text)</option>
              </select>
              {formData.affiliation_mode === 'school' && (
                <>
                  <select value={schoolIsCustom ? CUSTOM_SCHOOL : (formData.school_name || '')} onChange={e => handleSchoolSelect(e.target.value)} style={{ ...inputStyle, marginTop: 8 }} aria-label="School">
                    <option value="">Select school…</option>
                    {SCHOOL_AFFILIATION_OPTIONS.map(s => <option key={s} value={s}>{schoolPickerLabel(s)}</option>)}
                    <option value={CUSTOM_SCHOOL}>Other</option>
                  </select>
                  {schoolIsCustom && (
                    <input
                      value={formData.school_name || ''}
                      onChange={e => set('school_name', e.target.value)}
                      placeholder="Type the school name"
                      style={{ ...inputStyle, marginTop: 8 }}
                      aria-label="Other school name"
                    />
                  )}
                </>
              )}
              {formData.affiliation_mode === 'custom' && (
                <input
                  value={formData.organization || ''}
                  onChange={e => set('organization', e.target.value)}
                  placeholder="e.g. Los Angeles County DHS"
                  style={{ ...inputStyle, marginTop: 8 }}
                  aria-label="Organization"
                />
              )}
            </div>
          )}

          {/* Unit affiliation: Unit Leader and Preceptor only; multi-unit. */}
          {showUnits && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle} htmlFor="contact-units">Unit Affiliation <span style={{ fontWeight: 400, color: '#9ca3af' }}>(one or more units)</span></label>
              <MultiScopePicker
                id="contact-units"
                inputStyle={inputStyle}
                options={UNIT_SCOPE_OPTIONS}
                selected={formData.units || []}
                onChange={next => set('units', next)}
                placeholder="Search units"
              />
            </div>
          )}

          {/* Services (Nursing Executive + Executive Director) or Programs
              (every BNI Team contact); one stored field, per-category label. */}
          {showServices && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>{servicesMeta.label}</label>
              <input
                value={formData.services || ''}
                onChange={e => set('services', e.target.value)}
                placeholder={servicesMeta.label === 'Programs'
                  ? 'e.g. ASPIRE, NGRP, Preceptor Program'
                  : 'e.g. BNI, Surgical Services, OLAR'}
                style={inputStyle}
              />
            </div>
          )}

          {/* Divisions (Nursing Executive + Executive Director): the explicit
              answer the Contacts division filter matches on, beside the
              free-text Services line above. */}
          {showDivisions && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle} htmlFor="contact-divisions">Divisions <span style={{ fontWeight: 400, color: '#9ca3af' }}>(one or more)</span></label>
              <MultiScopePicker
                id="contact-divisions"
                inputStyle={inputStyle}
                options={DIVISION_PICKER_OPTIONS}
                selected={formData.divisions || []}
                onChange={next => set('divisions', next)}
                placeholder="Search divisions"
              />
            </div>
          )}

          {/* Role Qualifier - label and visibility driven by category */}
          {(cat === 'Academic Partner' || cat === 'BNI Team' || cat === 'Nursing Executive' || cat === 'Other' || !!formData.role_qualifier) && (
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>{cat === 'Academic Partner' ? 'Program Focus' : 'Title Detail'}</label>
              <input
                value={formData.role_qualifier || ''}
                onChange={e => set('role_qualifier', e.target.value)}
                placeholder={cat === 'Academic Partner' ? 'e.g. BSN Programs' : 'e.g. Additional title or specialization'}
                style={inputStyle}
              />
            </div>
          )}

          {/* ── Program Details (Academic Partner and Other) ── */}
          {(cat === 'Academic Partner' || cat === 'Other' || !!formData.program_type) && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>Program Details</div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Program Type</label>
                <input value={formData.program_type || ''} onChange={e => set('program_type', e.target.value)} placeholder="e.g. BSN, ABSN" style={inputStyle} />
              </div>
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
            {/* Weekly digest: always shown in main Preferences for all contact roles */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, fontFamily: F, color: '#374151' }}>
              <input type="checkbox" checked={formData.weekly_digest !== false}
                onChange={e => set('weekly_digest', e.target.checked)} style={{ width: 14, height: 14 }} />
              Receives weekly digest
            </label>
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
            <button
              type="submit"
              disabled={!canSave}
              title={
                !formData.full_name?.trim() ? 'Enter a name to continue' :
                !formData.category ? 'Select a category to continue' :
                !affiliationValid ? (affKind === 'school'
                  ? 'A school is required for an Academic Partner contact'
                  : 'Choose or enter an affiliation to continue') :
                undefined
              }
              style={{
                padding: '8px 20px', borderRadius: 8,
                border: 'none',
                background: canSave ? NAVY : '#e5e7eb',
                fontSize: 12, fontWeight: 600, fontFamily: F,
                color: canSave ? '#fff' : '#9ca3af',
                cursor: canSave ? 'pointer' : 'not-allowed',
                transition: 'background 0.12s',
              }}
            >
              {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Contact')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContactsView({ refreshKey = 0 }) {
  const navigate    = useNavigate()
  const location    = useLocation()
  const restoredRef = useRef(false)   // tracks whether initial selection restore has run
  const { toasts, removeToast, toast } = useToast()

  const [showContactModal, setShowContactModal] = useState(false)
  const [editingContact,   setEditingContact]   = useState(null)
  const [showSyncModal,    setShowSyncModal]    = useState(false)
  const [showInactive,     setShowInactive]     = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState(null)  // { contact, action }
  const [deactivating,     setDeactivating]     = useState(false)

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

  const handleDeactivateConfirm = useCallback(async () => {
    if (!deactivateTarget) return
    const { contact, action } = deactivateTarget
    const newIsActive = action === 'reactivate'
    setDeactivating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        toast.error('Error', 'Session expired. Please refresh and try again.')
        return
      }
      const res = await fetch('/api/contacts-upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: contact.id, is_active: newIsActive }),
      })
      let payload = null
      try { payload = await res.json() } catch {}
      if (!res.ok) {
        toast.error('Error', payload?.error || `Failed to ${action} contact.`)
        return
      }
      setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, is_active: newIsActive } : c))
      setDeactivateTarget(null)
      if (!newIsActive && !showInactive) setSelectedId(null)
      toast.success(
        newIsActive ? 'Reactivated' : 'Deactivated',
        newIsActive
          ? `${contact.full_name} has been reactivated.`
          : `${contact.full_name} has been deactivated.`
      )
    } catch {
      toast.error('Error', 'Network error. Please try again.')
    } finally {
      setDeactivating(false)
    }
  }, [deactivateTarget, showInactive, toast])

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
  }, [refreshKey]) // refreshKey triggers re-fetch when Connect refresh button is clicked

  // ── Fetch communication history on contact select ──────────────────────────
  useEffect(() => {
    if (!selectedId) { setCommHistory([]); return }
    setLoadingComm(true)
    supabase
      .from('notification_log')
      .select('id, notification_type, subject, status, sent_at, delivered_at, opened_at')
      .eq('contact_id', selectedId)
      .order('sent_at', { ascending: false })
      .limit(5)
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
        .select('id, first_name, preferred_first_name, last_name, status, matched_unit_id')
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
        .select('id, first_name, preferred_first_name, last_name, status')
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
      // Only update the URL when the Contacts tab is actually active.
      // If the user navigated directly to Outreach or another tab, do NOT
      // replace their URL with a contact URL - that would stomp the explicit route.
      if (location.pathname.startsWith('/connect/contacts')) {
        navigate(`/connect/contacts?contactId=${savedId}`, { replace: true })
      }
      return
    }

    // 3. First contact as default
    setSelectedId(contacts[0].id)
    if (location.pathname.startsWith('/connect/contacts')) {
      navigate(`/connect/contacts?contactId=${contacts[0].id}`, { replace: true })
    }
  }, [loading, contacts]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── React to ?contactId changes after initial mount ────────────────────────
  // Universal Search (and other deep links) can change the URL contactId while
  // ContactsView is already mounted. The restore effect above runs only once, so
  // without this the selection would not follow the new URL. Acts only on an
  // explicit, valid, changed id; absence of contactId is intentionally left to
  // the restore effect / existing state (direct nav to /connect/contacts keeps
  // the current selection). A non-existent/deleted id silently no-ops.
  useEffect(() => {
    const urlId = new URLSearchParams(location.search).get('contactId')
    if (urlId && urlId !== selectedId && contacts.some(c => c.id === urlId)) {
      setSelectedId(urlId)
    }
  }, [location.search, contacts]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ──────────────────────────────────────────────────────────
  const selected = contacts.find(c => c.id === selectedId) || null

  // Category counts - respect the showInactive toggle so pills count only visible contacts
  const categoryCounts = {}
  contacts
    .filter(c => showInactive || c.is_active !== false)
    .forEach(c => {
      getContactCategories(c).forEach(cat => {
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1
      })
    })
  const inactiveCount   = contacts.filter(c => c.is_active === false).length
  const activeCount     = contacts.length - inactiveCount

  const activeCategories = CATEGORY_ORDER.filter(cat =>
    cat === 'All' || (categoryCounts[cat] || 0) > 0
  )

  const filtered = contacts.filter(c => {
    // Hide inactive contacts when toggle is OFF
    if (!showInactive && c.is_active === false) return false
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

  // CONTACTS-CANON-1 ordering: each category has an approved sort (Unit
  // Leaders by unit then AD > ANM > NPD-P/CNS; BNI by ED > Lead Admin > NPD-P
  // > Project Coordinator; Nursing Executives by SVP > VP > EDs > Managers;
  // Academic Partners by school; Preceptors and Others by name), from the ONE
  // shared comparator. The flat All view (search active) stays name-sorted.
  // The flat All view while searching is unit-aware: a query naming a unit
  // (e.g. "Float Pool") surfaces that unit's leadership chain first, acting
  // executive on top; otherwise displayed-name order.
  const sortedFiltered = categoryFilter === 'All'
    ? sortContactsForSearch(filtered, search)
    : sortContactsForCategory(filtered, categoryFilter)

  const showGrouped = categoryFilter === 'All' && !search.trim()

  const listItems = []
  if (showGrouped) {
    // Group by primary category - each contact appears exactly once, and each
    // group is ordered by its own category's approved sort.
    const grouped = {}
    sortedFiltered.forEach(c => {
      const cat = getPrimaryCategory(c)
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(c)
    })
    CATEGORY_ORDER.filter(cat => cat !== 'All').forEach(cat => {
      const group = grouped[cat]
      if (!group || group.length === 0) return
      listItems.push({ type: 'divider', label: categoryPluralLabel(cat), count: group.length })
      sortContactsForCategory(group, cat).forEach(c => listItems.push({ type: 'row', contact: c }))
    })
  } else {
    sortedFiltered.forEach(c => listItems.push({ type: 'row', contact: c }))
  }

  // ── Copy visible emails (COPY-FILTERED-EMAILS) ────────────────────────────
  // Copies the valid, deduped emails of exactly the currently-visible filtered contacts
  // (sortedFiltered → respects search + category + show-inactive + sort order), as a
  // comma-separated list with no spaces. Read-only: no send, no mutation, no backend.
  const handleCopyVisibleEmails = async () => {
    if (sortedFiltered.length === 0) {
      toast.info('No contacts found.', 'There are no visible contacts to copy.')
      return
    }
    const emails = []
    const seen = new Set()
    let skipped = 0
    for (const c of sortedFiltered) {
      if (!isValidEmail(c.email)) { skipped++; continue }
      const norm = normalizeEmailForLookup(c.email)
      if (seen.has(norm)) continue   // dedupe (not counted as skipped)
      seen.add(norm)
      emails.push(c.email.trim())
    }
    if (emails.length === 0) {
      toast.info('No valid emails in visible results.', 'None of the visible contacts have a valid email on file.')
      return
    }
    try {
      await navigator.clipboard.writeText(emails.join(','))
      const n = emails.length
      const base = `Copied ${n} email${n === 1 ? '' : 's'}.`
      const tail = skipped > 0 ? ` Skipped ${skipped} without valid email.` : ''
      toast.success(base + tail, 'Paste into the To/CC field of your email.')
    } catch {
      toast.error('Copy failed', 'Your browser blocked clipboard access.')
    }
  }

  // ── Three-zone CRM layout ─────────────────────────────────────────────────
  return (
    <>
    {/* LAYOUT-SHELL-CONSISTENCY-1B: three-zone CRM grid. Layout (columns, gap, height, overflow,
        20px inset, responsive reflow) lives in .connect-three-zone (index.css). Three columns on
        large desktop, two columns at <=1024px (context under profile), one column at <=768px. */}
    <div className="connect-three-zone">

      {/* ── Zone 1: Directory (left) ──────────────────────────────────── */}
      {/* Tinted shell only (butter); inner list/search/rows keep their own surfaces. */}
      <div className="c3-col c3-contacts" style={{
        borderRadius: 12,
        border: '1px solid rgba(29,37,103,0.10)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        display: 'flex', flexDirection: 'column',
        background: toneGradient('contacts'),
      }}>

        {/* Directory header with Add Contact */}
        <div style={{
          padding: '12px 14px 8px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(29,37,103,0.06)',
          flexShrink: 0,
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <ConnectPanelIcon name="addressBook" tone="contacts" />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, fontFamily: F, letterSpacing: '-0.01em' }}>
              Contacts
            </span>
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
            const count = cat === 'All' ? (showInactive ? contacts.length : activeCount) : (categoryCounts[cat] || 0)
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
                <span>{cat === 'All' ? 'All Contacts' : categoryPluralLabel(cat)}</span>
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

        {/* Show inactive toggle - only when inactive contacts exist */}
        {inactiveCount > 0 && (
          <div style={{ padding: '2px 14px 6px', flexShrink: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={e => setShowInactive(e.target.checked)}
                style={{ width: 12, height: 12, accentColor: NAVY }}
              />
              <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, fontWeight: 500 }}>
                Show inactive ({inactiveCount})
              </span>
            </label>
          </div>
        )}

        {/* Contact count + copy-visible-emails action */}
        <div style={{ padding: '0 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10.5, color: '#9ca3af', fontFamily: F }}>
            {loading ? 'Loading…' : error ? 'Failed to load' : `${filtered.length} of ${showInactive ? contacts.length : activeCount}`}
          </span>
          {!loading && !error && filtered.length > 0 && (
            <button
              type="button"
              onClick={handleCopyVisibleEmails}
              title="Copy the emails of the visible contacts (comma-separated)"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 6,
                border: `1px solid ${NAVY}`, background: '#fff', color: NAVY,
                fontSize: 10, fontWeight: 600, fontFamily: F,
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = NAVY; e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = NAVY }}
            >
              Copy visible emails
            </button>
          )}
        </div>

        {/* Contact list (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, position: 'relative' }}>
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

        {/* Repair tool - muted footer link for backfilling pre-auto-sync preceptors */}
        <div style={{ padding: '6px 14px 8px', borderTop: '1px solid rgba(29,37,103,0.05)', flexShrink: 0, textAlign: 'center' }}>
          <button
            onClick={() => setShowSyncModal(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#c0c7d0', fontFamily: F, padding: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = '#6b7280'}
            onMouseLeave={e => e.currentTarget.style.color = '#c0c7d0'}
          >
            Repair Preceptor Contacts
          </button>
        </div>

      </div>

      {/* ── Zone 2: Contact Profile (center) ──────────────────────────── */}
      <div className="c3-col c3-profile" style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid rgba(29,37,103,0.10)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      }}>
        {selected ? (
          <ContactProfile
            contact={selected}
            navigate={navigate}
            onEdit={handleOpenEdit}
            onDeactivate={() => setDeactivateTarget({
              contact: selected,
              action: selected.is_active === false ? 'reactivate' : 'deactivate',
            })}
          />
        ) : (
          <NoSelection count={filtered.length} />
        )}
      </div>

      {/* ── Zone 3: Context - history + linked students (right) ───────── */}
      {/* No white outer shell - each card is its own standalone tinted ConnectPanel. */}
      <div className="c3-col c3-context">
        {selected ? (
          <ContactContext
            contact={selected}
            navigate={navigate}
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

    {/* Deactivate / Reactivate Modal */}
    {deactivateTarget && (
      <DeactivateModal
        contact={deactivateTarget.contact}
        action={deactivateTarget.action}
        onConfirm={handleDeactivateConfirm}
        onClose={() => { if (!deactivating) setDeactivateTarget(null) }}
        saving={deactivating}
      />
    )}

    {/* Repair Preceptor Contacts Modal */}
    {showSyncModal && (
      <SyncPreceptorsModal
        onClose={() => setShowSyncModal(false)}
        onSynced={() => {
          setShowSyncModal(false)
          supabase.from('contacts').select('*').order('organization').order('full_name')
            .then(({ data }) => { if (data) setContacts(data) })
        }}
      />
    )}
    <ToastContainer toasts={toasts} removeToast={removeToast} />
    </>
  )
}
