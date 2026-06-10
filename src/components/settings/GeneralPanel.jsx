// WS2.4: Settings → General is now an About/reference panel. The Appearance control moved
// to Settings → Appearance (single canonical home). This panel shows only static, already-
// safe metadata: the app name, a short description, and the deployed environment/build —
// the latter read from the EXISTING build-time vars (VITE_BUILD_ENV / VITE_BUILD_SHA,
// defined in vite.config.js from Vercel's standard VERCEL_ENV / VERCEL_GIT_COMMIT_SHA).
// No new API, endpoint, secret, or build tooling is introduced. When those vars are not
// injected (local dev), they read 'development' / 'dev' — version metadata beyond this is
// intentionally deferred (see WS2.4 report).
const APP_NAME = 'ASPIRE Intelligence'
const buildEnv = import.meta.env.VITE_BUILD_ENV
const buildSha = import.meta.env.VITE_BUILD_SHA

const rowStyle = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16,
  padding: '11px 0', borderTop: '1px solid var(--color-border-subtle, #f3f4f6)',
}
const labelStyle = { fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', fontWeight: 500 }
const valueStyle = { fontSize: 13, color: 'var(--color-text-primary, #191919)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }

export default function GeneralPanel() {
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

      {/* About */}
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
            Workspace for managing the ASPIRE Program — cohorts, student profiles, interviews, rotations, and outreach.
          </span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Environment</span>
          <span style={valueStyle}>{buildEnv}</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Build</span>
          <span style={{ ...valueStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: 0.2 }}>{buildSha}</span>
        </div>
      </div>
    </section>
  )
}
