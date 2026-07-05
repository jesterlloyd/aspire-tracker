// src/components/connect/ConnectPanel.jsx
//
// CONNECT-OUTREACH-CONTACTS-PANEL-POLISH - presentation-only panel shell.
// Standardizes ONLY the tinted-gradient frame + header (icon + sentence-case title + muted helper).
// The body (children) is fully free; the component dictates nothing about inner content, and all
// inner surfaces stay white - the tint is the shell only. No behavior, state, or handlers.

import { toneGradient, toneChip } from '../../lib/connectTones'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// Navy line icons - identical navy + size/weight across ALL panels (the unifying constant).
// Lucide-style 24x24 stroke paths; keyed by tone (override with the `icon` prop if needed).
const ICON_PATHS = {
  audience: (<>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>),
  message: (<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  draft: (<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
  preview: (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>),
  contacts: (<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>),
  communications: (<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>),
  linkedStudents: (<>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>),
  // Named icons (override the tone default via the `icon` prop)
  addressBook: (<>
    <rect width="18" height="18" x="3" y="4" rx="2" /><circle cx="10" cy="10" r="2" />
    <path d="M7 16.3c.5-1 1.5-1.3 3-1.3s2.5.3 3 1.3" /><path d="M16 8h2" /><path d="M16 12h2" />
  </>),
  mail: (<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>),
  users: (<>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>),
  userSearch: (<>
    <circle cx="10" cy="7" r="4" /><path d="M10.3 15H7a4 4 0 0 0-4 4v2" />
    <circle cx="17" cy="18" r="3" /><path d="m21 22-1.9-1.9" />
  </>),
  clipboardCheck: (<>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="m9 14 2 2 4-4" />
  </>),
}

export default function ConnectPanel({ tone = 'audience', title, helper, icon, padding = 20, style, children }) {
  return (
    <div style={{
      background: toneGradient(tone),
      border: '1px solid rgba(29,37,103,0.10)',
      borderRadius: 12,
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      padding,
      fontFamily: F,
      boxSizing: 'border-box',
      ...style,
    }}>
      {(title || helper) && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <ConnectPanelIcon name={icon || tone} tone={tone} />
            {title && (
              <span style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, letterSpacing: '-0.01em', fontFamily: F }}>{title}</span>
            )}
          </div>
          {helper && <div style={{ fontSize: 10, color: '#6b7280', fontFamily: F, marginTop: 4 }}>{helper}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

// Reusable navy panel icon inside a subtle tone-harmonized circular chip - identical chip size,
// icon size, and stroke across all ConnectPanel usage (incl. panels that own their own header
// markup, e.g. the Contacts directory header). The icon itself stays navy.
export function ConnectPanelIcon({ name, tone, size = 14 }) {
  const paths = ICON_PATHS[name] || null
  if (!paths) return null
  const chip = toneChip(tone)
  return (
    <span style={{
      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: chip.bg, border: `1px solid ${chip.border}`,
    }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {paths}
      </svg>
    </span>
  )
}
