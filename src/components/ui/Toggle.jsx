/**
 * Toggle — canonical on/off switch for ASPIRE Intelligence.
 *
 * Apple liquid-glass aesthetic: frosted-white OFF pill with green ambient glow,
 * green ON pill with stronger glow, smooth knob slide.
 *
 * Usage:
 *   <Toggle checked={val} onChange={setVal} />
 *   <Toggle checked={val} onChange={setVal} label="Automation" description="Sends emails automatically" size="md" />
 */

import { useState } from 'react'

// ── Size tokens ────────────────────────────────────────────────
const SIZES = {
  sm: { width: 32, height: 18, knob: 14, pad: 2, gap: 8,  labelSize: 12, descSize: 11 },
  md: { width: 44, height: 24, knob: 20, pad: 2, gap: 10, labelSize: 13, descSize: 11 },
  lg: { width: 56, height: 30, knob: 26, pad: 2, gap: 12, labelSize: 14, descSize: 12 },
}

// ── Green palette (muted, ASPIRE-safe) ─────────────────────────
const GREEN_PILL_START = '#22c55e'    // slightly lighter for gradient top
const GREEN_PILL_END   = '#16a34a'    // main ASPIRE success green
const GREEN_GLOW_WEAK  = 'rgba(22,163,74,0.14)'
const GREEN_GLOW_MED   = 'rgba(22,163,74,0.28)'
const GREEN_GLOW_STRONG = 'rgba(22,163,74,0.40)'

export default function Toggle({
  checked   = false,
  onChange,
  size      = 'md',
  disabled  = false,
  label,
  description,
  ariaLabel,
}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [focused, setFocused] = useState(false)

  const sz       = SIZES[size] || SIZES.md
  const knobOn   = sz.width - sz.knob - sz.pad  // translate-X when checked
  const scale    = pressed ? 0.97 : hovered ? 1.03 : 1

  // ── Pill styles ──────────────────────────────────────────────
  const offGlow  = hovered ? GREEN_GLOW_MED    : GREEN_GLOW_WEAK
  const onGlow   = hovered ? GREEN_GLOW_STRONG : GREEN_GLOW_MED

  const pillStyle = {
    position:   'relative',
    display:    'inline-block',
    width:      sz.width,
    height:     sz.height,
    borderRadius: sz.height / 2,
    flexShrink: 0,
    cursor:     disabled ? 'not-allowed' : 'pointer',
    transition: 'background 220ms ease-in-out, box-shadow 220ms ease-in-out, transform 150ms ease-in-out',
    transform:  `scale(${scale})`,
    opacity:    disabled ? 0.5 : 1,
    padding:    0,
    border:     'none',
    outline:    focused ? '2px solid #1D2567' : 'none',
    outlineOffset: 3,

    // Glass pill
    background: checked
      ? `linear-gradient(145deg, ${GREEN_PILL_START} 0%, ${GREEN_PILL_END} 100%)`
      : 'rgba(255,255,255,0.90)',

    // Inner highlight + border
    boxShadow: checked
      ? [
          'inset 0 1px 0 rgba(255,255,255,0.24)',
          'inset 0 -1px 0 rgba(0,0,0,0.08)',
          `0 0 0 1px ${GREEN_PILL_END}44`,
          `0 0 12px ${onGlow}`,
          '0 2px 4px rgba(0,0,0,0.10)',
        ].join(', ')
      : [
          'inset 0 1px 0 rgba(255,255,255,0.92)',
          'inset 0 -1px 0 rgba(0,0,0,0.04)',
          '0 0 0 1px rgba(0,0,0,0.08)',
          `0 0 8px ${offGlow}`,
        ].join(', '),

    backdropFilter:         'blur(10px)',
    WebkitBackdropFilter:   'blur(10px)',
  }

  // ── Knob styles ──────────────────────────────────────────────
  const knobStyle = {
    position:   'absolute',
    top:        (sz.height - sz.knob) / 2,
    left:       checked ? knobOn : sz.pad,
    width:      sz.knob,
    height:     sz.knob,
    borderRadius: '50%',
    background: '#ffffff',
    boxShadow:  [
      '0 1px 3px rgba(0,0,0,0.22)',
      '0 1px 2px rgba(0,0,0,0.14)',
      'inset 0 1px 0 rgba(255,255,255,0.85)',
    ].join(', '),
    transition: 'left 220ms ease-in-out',
    pointerEvents: 'none',
  }

  // ── Handlers ─────────────────────────────────────────────────
  const handleClick   = ()  => { if (!disabled) onChange?.(!checked) }
  const handleKeyDown = (e) => {
    if (disabled) return
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      onChange?.(!checked)
    }
  }
  const handleMouseEnter = ()  => { if (!disabled) setHovered(true) }
  const handleMouseLeave = ()  => { setHovered(false); setPressed(false) }
  const handleMouseDown  = ()  => { if (!disabled) setPressed(true) }
  const handleMouseUp    = ()  => setPressed(false)
  const handleFocus      = ()  => setFocused(true)
  const handleBlur       = ()  => { setFocused(false); setHovered(false); setPressed(false) }

  // ── Pill element ─────────────────────────────────────────────
  const pill = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={pillStyle}
    >
      <span style={knobStyle} aria-hidden="true" />
    </button>
  )

  // ── No label — just the pill ──────────────────────────────────
  if (!label && !description) return pill

  // ── With label (and optional description) ────────────────────
  return (
    <div
      style={{
        display:    'flex',
        alignItems: description ? 'flex-start' : 'center',
        gap:        sz.gap,
        cursor:     disabled ? 'not-allowed' : 'default',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Text stack — fills remaining space */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {label && (
          <div style={{
            fontSize:   sz.labelSize,
            fontWeight: 600,
            color:      'var(--text-heading, #191919)',
            lineHeight: 1.35,
          }}>
            {label}
          </div>
        )}
        {description && (
          <div style={{
            fontSize:  sz.descSize,
            color:     'var(--text-caption, #6b7280)',
            lineHeight: 1.45,
            marginTop:  label ? 2 : 0,
          }}>
            {description}
          </div>
        )}
      </div>

      {/* Pill on the right */}
      {pill}
    </div>
  )
}
