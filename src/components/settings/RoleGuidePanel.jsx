// ROLE-GUIDE-1: read-only reference for the resolved staff role model.
//
// Renders src/lib/roleGuide.js, whose every cell is resolved against the one
// server capability table (lib/server/access.js) by test/roleGuide.test.mjs.
// Nothing here grants access or reads a permission at runtime, and nothing
// here exposes implementation or security detail: it explains the model to
// the person granting access, in their language.
import { ROLE_ORDER, ROLE_SUMMARY, CAPABILITY_MATRIX, MODEL_NOTES } from '../../lib/roleGuide'
import { ROLE_BADGE } from './accountsShared'

const F = 'DM Sans, sans-serif'
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
  'No access':  { bg: 'transparent', color: '#9ca3af' },
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
  const th = { textAlign: 'left', padding: '9px 12px', fontSize: 11.5, fontWeight: 600, color: secondary, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', fontSize: 13, borderTop: '1px solid var(--color-border-subtle, #f3f4f6)', verticalAlign: 'top' }

  return (
    <div style={{ fontFamily: F }}>
      {/* Role cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 20 }}>
        {ROLE_ORDER.map(role => {
          const r = ROLE_SUMMARY[role]
          const badge = ROLE_BADGE[role] || ROLE_BADGE.viewer
          return (
            <div key={role} style={{
              background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, rgba(29,37,103,0.08))',
              borderRadius: 10, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', padding: '2px 10px', borderRadius: 999, background: badge.bg, color: badge.text, fontSize: 12, fontWeight: 600 }}>
                  {r.label}
                </span>
                {!r.assignable && (
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
              {ROLE_ORDER.map(role => <th key={role} style={{ ...th, textAlign: 'center' }}>{ROLE_SUMMARY[role].label}</th>)}
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_MATRIX.map(row => (
              <tr key={row.key}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{row.label}</div>
                  {row.note && <div style={{ fontSize: 12, color: secondary, marginTop: 2, maxWidth: 340, lineHeight: 1.5 }}>{row.note}</div>}
                </td>
                {ROLE_ORDER.map(role => (
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
          {MODEL_NOTES.map((note, i) => <li key={i} style={{ marginBottom: 4 }}>{note}</li>)}
        </ul>
      </div>
    </div>
  )
}
