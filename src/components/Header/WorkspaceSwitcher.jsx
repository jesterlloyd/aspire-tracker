// NGRP-WORKSPACE-1: explicit ASPIRE | NGRP workspace switcher in the header.
// A segmented control (never a scroll or swipe gesture): the active workspace
// is the solid white segment, so the current context is always legible against
// the Nightfall header. Switching is plain navigation - ASPIRE returns to the
// last operational tab, NGRP enters /ngrp/* - and the ASPIRE cohort picker to
// the right is untouched in both workspaces (an NGRP cycle is a different
// entity from an ASPIRE cohort; the cycle selector lives inside the NGRP
// workspace).
export default function WorkspaceSwitcher({ active, onSwitch }) {
  const seg = (id, label, sub) => {
    const on = active === id
    return (
      <button
        key={id}
        type="button"
        onClick={() => { if (!on) onSwitch(id) }}
        aria-pressed={on}
        aria-label={`${label} workspace${on ? ' (current)' : ''}`}
        style={{
          border: 'none', borderRadius: 999, padding: '4px 14px',
          fontFamily: 'DM Sans, sans-serif', fontSize: 12, fontWeight: 700,
          letterSpacing: '0.04em', lineHeight: 1.25, cursor: on ? 'default' : 'pointer',
          background: on ? '#FFFFFF' : 'transparent',
          color: on ? '#1D2567' : 'rgba(255,255,255,0.62)',
          boxShadow: on ? '0 1px 4px rgba(0,0,0,0.25)' : 'none',
          transition: 'background 0.15s ease, color 0.15s ease',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}
        onMouseEnter={e => { if (!on) e.currentTarget.style.color = 'rgba(255,255,255,0.9)' }}
        onMouseLeave={e => { if (!on) e.currentTarget.style.color = 'rgba(255,255,255,0.62)' }}
      >
        <span>{label}</span>
        <span style={{
          fontSize: 8, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase',
          color: on ? 'rgba(29,37,103,0.65)' : 'rgba(255,255,255,0.4)',
        }}>
          {sub}
        </span>
      </button>
    )
  }

  return (
    <div
      role="group"
      aria-label="Workspace"
      data-tour="workspace-switcher"
      style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: 3,
        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 999, flexShrink: 0,
      }}
    >
      {seg('aspire', 'ASPIRE', 'Pathway')}
      {seg('ngrp', 'NGRP', 'Residency')}
    </div>
  )
}
