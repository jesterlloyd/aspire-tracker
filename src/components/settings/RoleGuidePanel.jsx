// ROLE-GUIDE-1: read-only reference for the resolved staff role model.
//
// Renders src/lib/roleGuide.js, whose every cell is resolved against the one
// server capability table (lib/server/access.js) by test/roleGuide.test.mjs.
// Nothing here grants access or reads a permission at runtime, and nothing
// here exposes implementation or security detail: it explains the model to
// the person granting access, in their language.
import { useState } from 'react'
import { ROLE_ORDER, ROLE_SUMMARY, CAPABILITY_MATRIX, MODEL_NOTES } from '../../lib/roleGuide'
import {
  PORTAL_ROLE_ORDER,
  PORTAL_ROLE_SUMMARY,
  PORTAL_CAPABILITY_MATRIX,
  PORTAL_MODEL_NOTES,
} from '../../lib/portalRoleGuide'
import { ROLE_BADGE } from './accountsShared'

const F = 'Plus Jakarta Sans, sans-serif'
const secondary = 'var(--color-text-secondary, #6b7280)'

// One restrained treatment per level: strength reads at a glance without a
// rainbow. "No access" is deliberately quiet rather than alarming - it is the
// correct, expected state for most cells.
const LEVEL_STYLE = {
  'Full':       { bg: '#065F46', color: '#ffffff' },
  'Manage':     { bg: '#D1FAE5', color: '#065F46' },
  'Per skill':  { bg: '#EEF2FF', color: '#3730A3' },
  'Read':       { bg: '#F1F5F9', color: '#475569' },
  'Limited':    { bg: '#FEF3C7', color: '#7C5A1F' },
  'Own record': { bg: '#E8F1FF', color: '#1D4ED8' },
  'Assigned scope': { bg: '#D1FAE5', color: '#065F46' },
  'ASPIRE-wide read': { bg: '#F1F5F9', color: '#475569' },
  'View or edit': { bg: '#EDE9FE', color: '#5B21B6' },
  'No access':  { bg: 'transparent', color: '#9ca3af' },
}

const PORTAL_BADGE = {
  student: { bg: '#E8F1FF', text: '#1D4ED8' },
  unit_leader: { bg: '#D1FAE5', text: '#065F46' },
  academic_partner: { bg: '#FEF3C7', text: '#7C5A1F' },
  nursing_academic: { bg: '#EDE9FE', text: '#5B21B6' },
}

function LevelCell({ level }) {
  const s = LEVEL_STYLE[level] || LEVEL_STYLE['No access']
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 74, padding: '2px 9px', borderRadius: 999,
      background: s.bg, color: s.color, fontSize: 11.5,
      fontWeight: level === 'No access' ? 400 : 600, whiteSpace: 'nowrap',
    }}>
      {level === 'No access' ? '—' : level}
      {level === 'No access' && <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>No access</span>}
    </span>
  )
}

export default function RoleGuidePanel() {
  const [guideType, setGuideType] = useState('staff')
  const isPortalGuide = guideType === 'portal'
  const roleOrder = isPortalGuide ? PORTAL_ROLE_ORDER : ROLE_ORDER
  const roleSummary = isPortalGuide ? PORTAL_ROLE_SUMMARY : ROLE_SUMMARY
  const capabilityMatrix = isPortalGuide ? PORTAL_CAPABILITY_MATRIX : CAPABILITY_MATRIX
  const modelNotes = isPortalGuide ? PORTAL_MODEL_NOTES : MODEL_NOTES
  const th = { textAlign: 'left', padding: '9px 12px', fontSize: 11.5, fontWeight: 600, color: secondary, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', fontSize: 13, borderTop: '1px solid var(--color-border-subtle, #f3f4f6)', verticalAlign: 'top' }

  return (
    <div style={{ fontFamily: F }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
            {isPortalGuide ? 'Portal role guide' : 'Staff role guide'}
          </div>
          <div style={{ fontSize: 12.5, color: secondary }}>
            {isPortalGuide
              ? 'Scoped portal access stays separate from the staff application.'
              : 'Staff roles control access inside ASPIRE Intelligence.'}
          </div>
        </div>
        <div
          role="group"
          aria-label="Role guide type"
          style={{ display: 'inline-flex', padding: 3, borderRadius: 8, background: 'var(--color-bg-subtle, #f3f4f6)', border: '1px solid var(--color-border-default, #e5e7eb)' }}
        >
          {[
            { key: 'staff', label: 'Staff Roles' },
            { key: 'portal', label: 'Portal Roles' },
          ].map(option => {
            const active = guideType === option.key
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                onClick={() => setGuideType(option.key)}
                style={{
                  border: 0,
                  borderRadius: 6,
                  padding: '7px 13px',
                  background: active ? '#1D2567' : 'transparent',
                  color: active ? '#fff' : secondary,
                  fontFamily: F,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Role cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 20 }}>
        {roleOrder.map(role => {
          const r = roleSummary[role]
          const badge = isPortalGuide ? PORTAL_BADGE[role] : (ROLE_BADGE[role] || ROLE_BADGE.viewer)
          return (
            <div key={role} style={{
              background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, rgba(29,37,103,0.08))',
              borderRadius: 10, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', padding: '2px 10px', borderRadius: 999, background: badge.bg, color: badge.text, fontSize: 12, fontWeight: 600 }}>
                  {r.label}
                </span>
                {!isPortalGuide && !r.assignable && (
                  <span style={{ fontSize: 11, color: secondary, border: '1px solid var(--color-border-default, #e5e7eb)', borderRadius: 999, padding: '1px 8px' }}>
                    Not assignable
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{r.tagline}</div>
              <div style={{ fontSize: 12.5, color: secondary, lineHeight: 1.55 }}>{r.detail}</div>
            </div>
          )
        })}
      </div>

      {/* Matrix */}
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Effective permissions</div>
      <div style={{
        background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, rgba(29,37,103,0.08))',
        borderRadius: 10, overflowX: 'auto', marginBottom: 16,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={th}>Capability</th>
              {roleOrder.map(role => <th key={role} style={{ ...th, textAlign: 'center' }}>{roleSummary[role].label}</th>)}
            </tr>
          </thead>
          <tbody>
            {capabilityMatrix.map(row => (
              <tr key={row.key}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{row.label}</div>
                  {row.note && <div style={{ fontSize: 12, color: secondary, marginTop: 2, maxWidth: 340, lineHeight: 1.5 }}>{row.note}</div>}
                </td>
                {roleOrder.map(role => (
                  <td key={role} style={{ ...td, textAlign: 'center' }}>
                    <LevelCell level={row.levels[role]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* How the model works - properties of the design, in plain language. */}
      <div style={{
        background: 'var(--color-bg-elevated, #eef2fb)', border: '1px solid var(--color-border-default, #dbe3f5)',
        borderRadius: 10, padding: '12px 14px', fontSize: 12.5, lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>How roles work</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--color-text-primary, #374151)' }}>
          {modelNotes.map((note, i) => <li key={i} style={{ marginBottom: 4 }}>{note}</li>)}
        </ul>
      </div>
    </div>
  )
}
