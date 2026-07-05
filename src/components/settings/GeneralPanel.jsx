// ASPIRE-GENERAL-SETTINGS-1: Settings → General is the primary Settings section (unchanged rail
// item / route key `general`, Apple-iOS-style). It now hosts internal sub-sections:
//
//   • About  - real, already-safe app/deployment metadata (implemented).
//   • Storage - DEFERRED: honest Supabase storage usage needs a new admin/service-role endpoint
//               (none exists) - out of scope here, so it is NOT rendered.
//   • Usage  - DEFERRED: no app-accessible source for Claude console spend/usage exists, and adding
//               billing/API-key access is out of scope - so it is NOT rendered.
//
// This codebase deliberately avoids "coming soon"/placeholder sections (see settingsSections.js), so
// Storage/Usage are SCAFFOLDED in the registry below (implemented:false) but not shown. The Apple-like
// segmented sub-nav renders only when ≥2 sub-sections are implemented; with About alone it renders
// About directly - no lonely single-tab control, no empty/broken sections. Flipping Storage/Usage to
// implemented:true (once a real, safe data source exists) makes the sub-nav appear automatically.
//
// About reads ONLY build-time public vars via src/lib/buildInfo.js (VITE_BUILD_* - inlined at build,
// never secret) + the canonical URL. No new API, endpoint, secret, or private env is introduced.
import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import {
  APP_NAME, APP_DESCRIPTION, CANONICAL_URL,
  BUILD_SHA, BUILD_ENV, environmentLabel, formatBuildTime,
} from '../../lib/buildInfo'

// General sub-sections. Only `about` is implemented today; `storage` and `usage` are scaffolded
// (implemented:false) so they can be enabled later without restructuring - no placeholder is rendered.
const GENERAL_SUBSECTIONS = [
  { key: 'about',   label: 'About',   implemented: true },
  { key: 'storage', label: 'Storage', implemented: false },
  { key: 'usage',   label: 'Usage',   implemented: false },
]

const rowStyle = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16,
  padding: '11px 0', borderTop: '1px solid var(--color-border-subtle, #f3f4f6)',
}
const labelStyle = { fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', fontWeight: 500 }
const valueStyle = { fontSize: 13, color: 'var(--color-text-primary, #191919)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }
const monoStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: 0.2 }

function AboutSection() {
  const [copied, setCopied] = useState(false)
  const buildTime = formatBuildTime()

  const copySha = async () => {
    try {
      await navigator.clipboard.writeText(BUILD_SHA)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (e.g. insecure context) - no-op, the value is still visible */
    }
  }

  return (
    <div style={{
      border: '1px solid var(--color-border-default, #e5e7eb)',
      borderRadius: 12, padding: '6px 18px 14px',
      background: 'var(--color-bg-surface, #ffffff)',
    }}>
      <div style={{ ...rowStyle, borderTop: 'none' }}>
        <span style={labelStyle}>Application</span>
        <span style={valueStyle}>{APP_NAME}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Description</span>
        <span style={{ ...valueStyle, fontWeight: 500, color: 'var(--color-text-secondary, #6b7280)', maxWidth: 380 }}>
          {APP_DESCRIPTION}
        </span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Website</span>
        <a href={CANONICAL_URL} target="_blank" rel="noopener noreferrer"
          style={{
            ...valueStyle, display: 'inline-flex', alignItems: 'center', gap: 5,
            color: 'var(--color-accent-primary, #1D2567)', textDecoration: 'none',
          }}>
          {CANONICAL_URL.replace(/^https?:\/\//, '')}
          <ExternalLink size={13} strokeWidth={2.2} style={{ flexShrink: 0 }} />
        </a>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Environment</span>
        <span style={valueStyle}>{environmentLabel(BUILD_ENV)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Build</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...valueStyle, ...monoStyle }}>{BUILD_SHA}</span>
          <button
            type="button" onClick={copySha}
            aria-label={copied ? 'Build ID copied' : 'Copy build ID'} title={copied ? 'Copied' : 'Copy build ID'}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, padding: 0, borderRadius: 7, cursor: 'pointer',
              border: '1px solid var(--color-border-default, #e5e7eb)',
              background: 'var(--color-bg-surface, #ffffff)',
              color: copied ? '#16a34a' : 'var(--color-text-secondary, #6b7280)',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {copied ? <Check size={14} strokeWidth={2.4} /> : <Copy size={14} strokeWidth={2} />}
          </button>
        </span>
      </div>

      {buildTime && (
        <div style={rowStyle}>
          <span style={labelStyle}>Built</span>
          <span style={{ ...valueStyle, fontWeight: 500, color: 'var(--color-text-secondary, #6b7280)' }}>{buildTime}</span>
        </div>
      )}
    </div>
  )
}

export default function GeneralPanel() {
  const implemented = GENERAL_SUBSECTIONS.filter(s => s.implemented)
  const [active, setActive] = useState('about')
  const current = implemented.some(s => s.key === active) ? active : 'about'

  return (
    <section aria-labelledby="settings-general-heading">
      <h2 id="settings-general-heading" style={{
        margin: '0 0 4px', fontSize: 17, fontWeight: 700,
        color: 'var(--color-text-primary, #191919)', fontFamily: 'DM Sans, sans-serif',
      }}>
        General
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
        About ASPIRE Intelligence and this deployment.
      </p>

      {/* Apple-style segmented sub-nav - rendered only when ≥2 sub-sections are implemented (avoids a
          lonely single tab and any "coming soon" placeholder). Scaffolded for Storage/Usage. */}
      {implemented.length > 1 && (
        <div role="tablist" aria-label="General sub-sections" style={{
          display: 'inline-flex', marginBottom: 18,
          border: '1px solid rgba(29,37,103,0.14)', borderRadius: 8, overflow: 'hidden',
        }}>
          {implemented.map((s, i) => {
            const on = s.key === current
            return (
              <button
                key={s.key} role="tab" aria-selected={on}
                onClick={() => setActive(s.key)}
                style={{
                  padding: '8px 20px', border: 'none', cursor: 'pointer',
                  borderLeft: i === 0 ? 'none' : '1px solid rgba(29,37,103,0.14)',
                  background: on ? '#1D2567' : 'var(--color-bg-surface, #f9fafb)',
                  color: on ? '#fff' : 'var(--color-text-secondary, #6b7280)',
                  fontSize: 12.5, fontWeight: 600, fontFamily: 'DM Sans, sans-serif',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      )}

      {current === 'about' && <AboutSection />}
    </section>
  )
}
