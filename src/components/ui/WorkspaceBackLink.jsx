// UI-POLISH-2 / 2b - Shared "Back to <workspace>" return control used by the app-level utility
// surfaces (ASPIRE Connect, ASPIRE Catalog, Settings). Consolidates three previously-duplicated
// copies into one consistent, deliberate pill (not floating gray text).
//
// Behavior is UNCHANGED from the prior per-page links: it navigates to `path` (the caller's
// prior-workspace path) and labels itself "Back to {label}" to match that destination.
import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const NAVY = 'var(--color-accent-primary, #1D2567)'

export default function WorkspaceBackLink({ path = '/aggregate', label = 'At a Glance' }) {
  const navigate = useNavigate()
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={() => navigate(path)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px 7px 10px', borderRadius: 999, cursor: 'pointer',
        fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 600,
        background: hover ? 'var(--color-bg-elevated, #EEF1FB)' : 'var(--bg-card, #fff)',
        border: `1px solid ${hover ? 'var(--border-accent, #c7d0ee)' : 'var(--border-input, #e2e0d9)'}`,
        color: hover ? NAVY : 'var(--color-text-primary, #374151)',
        boxShadow: '0 1px 2px rgba(25,25,25,0.05)',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      <ChevronLeft size={16} strokeWidth={2.4} style={{ flexShrink: 0, color: NAVY }} />
      Back to {label}
    </button>
  )
}
