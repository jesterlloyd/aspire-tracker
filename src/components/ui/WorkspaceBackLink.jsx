// UI-POLISH-2 — Shared "Back to <workspace>" link used by the app-level utility surfaces
// (ASPIRE Connect, ASPIRE Catalog, Settings). Consolidates three previously-duplicated copies
// into one consistent affordance: same ChevronLeft icon, spacing, text style, and hover.
//
// Behavior is UNCHANGED from the prior per-page links: it navigates to `path` (the caller's
// prior-workspace path) and labels itself "Back to {label}" to match that destination.
import { ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function WorkspaceBackLink({ path = '/aggregate', label = 'Aggregate' }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate(path)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary, #6B7280)',
        padding: '4px 0', fontFamily: 'DM Sans, sans-serif', transition: 'color 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-accent-primary, #1D2567)' }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary, #6B7280)' }}
    >
      <ChevronLeft size={14} strokeWidth={2.2} style={{ flexShrink: 0 }} />
      Back to {label}
    </button>
  )
}
