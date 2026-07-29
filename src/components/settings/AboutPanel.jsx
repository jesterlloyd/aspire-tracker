// SETTINGS-UNIFIED-DESIGN-1: Settings -> About. Moved verbatim (behavior, styles, and the
// copy-to-clipboard interaction unchanged) out of GeneralPanel's former AboutSection, now
// its own Workspace-group rail destination instead of a General subsetting. This keeps
// the rail focused - General becomes "Preferences and support," while build/deployment
// metadata gets a dedicated, discoverable home.
//
// About reads ONLY build-time public vars via src/lib/buildInfo.js (VITE_BUILD_* - inlined at
// build, never secret) + the canonical URL. No new API, endpoint, secret, or private env is
// introduced.
import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import SurfaceCard from '../ui/SurfaceCard'
import {
  APP_NAME, APP_DESCRIPTION, CANONICAL_URL,
  BUILD_SHA, BUILD_ENV, environmentLabel, formatBuildTime,
} from '../../lib/buildInfo'

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
    <SurfaceCard padding="6px 18px 14px">
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
    </SurfaceCard>
  )
}

// SETTINGS-VISUAL-DENSITY-1: heading comes from the General hub (shared baseline with
// Settings | General); the generic subtitle is removed. The build rows and copy button
// are unchanged; the custom bordered container became the canonical SurfaceCard.
export default function AboutPanel() {
  return (
    <section aria-label="About">
      <AboutSection />
    </section>
  )
}
