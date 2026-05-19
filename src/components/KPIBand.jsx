// Shared KPI band primitives — used by Aggregate (Program at a Glance),
// Embed (Matching at a Glance), and clickable filter cards on Student Profiles / Interview Room.
// Tokens: src/lib/designTokens.js
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { colors, radii, shadows, type as t, styles } from '../lib/designTokens'

// ── Passive band helpers ──────────────────────────────────────────────────────

export function useUpdatedLabel(cohortId) {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('just now')
  useEffect(() => {
    function compute() {
      const all = queryClient.getQueryCache().getAll()
      const relevant = all.filter(q =>
        Array.isArray(q.queryKey) &&
        q.queryKey.some(k => k === cohortId) &&
        q.state.status === 'success' &&
        q.state.dataUpdatedAt
      )
      const ts = relevant.length ? Math.max(...relevant.map(q => q.state.dataUpdatedAt)) : 0
      if (!ts) return setLabel('—')
      const s = Math.floor((Date.now() - ts) / 1000)
      if (s < 10) setLabel('just now')
      else if (s < 60) setLabel(`${s}s ago`)
      else if (s < 3600) setLabel(`${Math.floor(s / 60)}m ago`)
      else setLabel(`${Math.floor(s / 3600)}h ago`)
    }
    compute()
    const id = setInterval(compute, 5000)
    return () => clearInterval(id)
  }, [cohortId, queryClient])
  return label
}

export function KPICell({ value, label, sub, accent, compact }) {
  const valueColor =
    accent === 'sage'    ? colors.sage :
    accent === 'warning' ? colors.dawn :
                           colors.ink2
  const pad    = compact ? '10px 16px' : '20px 22px'
  const numStyle = compact
    ? { ...styles.bigNumber, fontSize: '24px', lineHeight: 1.1 }
    : styles.bigNumber
  return (
    <div style={{ background: 'var(--bg-card, '+colors.surface+')', padding: pad, display: 'flex', flexDirection: 'column', gap: compact ? 2 : 4 }}>
      <div style={{ ...numStyle, color: valueColor }}>
        {value ?? 0}
      </div>
      <div style={{ ...styles.eyebrow, marginTop: compact ? 4 : 8 }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: t.sizes.small, color: colors.ink4, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Interactive filter card ───────────────────────────────────────────────────

// Per-card accent palette. Each entry defines resting tint, solid active fill,
// resting text color, and hover halo color.
// Dawn active uses a deepened shade for WCAG-legible contrast with white text.
const ACCENT_PALETTE = {
  nightfall: {
    tint:      '#EDEEF4',
    solid:     colors.ink2,           // #1D2567
    text:      colors.ink2,
    halo:      'rgba(29,37,103,0.08)',
  },
  sage: {
    tint:      colors.tintSage,       // #EEF7F0
    solid:     colors.sage,           // #2F7D5C
    text:      colors.sage,
    halo:      'rgba(47,125,92,0.10)',
  },
  marina: {
    tint:      colors.tintMarina,     // #EDF5F4
    solid:     colors.marina,         // #275E63
    text:      colors.marina,
    halo:      'rgba(39,94,99,0.10)',
  },
  dawn: {
    tint:      colors.tintDawn,       // #FBF5E8
    solid:     '#8B5E1A',             // deepened amber for white-text legibility
    text:      '#8B5E1A',
    halo:      'rgba(139,94,26,0.10)',
  },
  chroma: {
    tint:      colors.tintChroma,     // #F8EDF2
    solid:     colors.chroma,         // #930045
    text:      colors.chroma,
    halo:      'rgba(147,0,69,0.10)',
  },
  lavender: {
    tint:      '#F0EDF5',
    solid:     '#6B4F8F',
    text:      '#6B4F8F',
    halo:      'rgba(107,79,143,0.10)',
  },
  periwinkle: {
    tint:      '#EDF0F7',
    solid:     '#4A5D8F',
    text:      '#4A5D8F',
    halo:      'rgba(74,93,143,0.10)',
  },
}

export function FilterKPICard({ value, label, sub, accent = 'nightfall', active, onClick }) {
  const p = ACCENT_PALETTE[accent] || ACCENT_PALETTE.nightfall

  return (
    <button
      onClick={onClick}
      style={{
        background:   active ? p.solid    : p.tint,
        border:       `1px solid ${active ? p.solid : 'rgba(29,37,103,0.06)'}`,
        borderRadius: radii.card,
        padding:      '14px 18px',
        textAlign:    'left',
        cursor:       'pointer',
        fontFamily:   t.family,
        boxShadow:    active ? shadows.s2 : shadows.s1,
        transition:   'transform 0.18s cubic-bezier(0.2, 0.7, 0.2, 1), box-shadow 0.18s ease, background 0.18s ease, border-color 0.15s ease',
        willChange:   'transform, box-shadow',
        display:      'flex', flexDirection: 'column', gap: 4,
        position:     'relative',
        overflow:     'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = `${shadows.s3}, 0 0 0 4px ${p.halo}`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = active ? shadows.s2 : shadows.s1
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'translateY(0)' }}
      onMouseUp={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
    >
      <div style={{
        ...styles.bigNumber,
        color: active ? '#fff' : p.text,
      }}>
        {value ?? 0}
      </div>
      <div style={{
        ...styles.eyebrow,
        color: active ? 'rgba(255,255,255,0.88)' : colors.ink3,
        marginTop: 8,
      }}>
        {label}
      </div>
      {sub && (
        <div style={{
          fontSize: t.sizes.small,
          color: active ? 'rgba(255,255,255,0.72)' : colors.ink4,
          marginTop: 2,
        }}>
          {sub}
        </div>
      )}
    </button>
  )
}
