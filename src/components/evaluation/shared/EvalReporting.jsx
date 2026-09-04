// src/components/evaluation/shared/EvalReporting.jsx
//
// Shared, ROLE-SAFE presentation primitives for the Unit Leader evaluations workspace. They
// match the main-app Evaluation Dashboard's visual language (navy #1D2567, Plus Jakarta Sans, 14px
// radius cards, tabular numerals) without reaching into it, so the main app is unchanged.
//
// These components render ONLY what they are handed. They hold no data, no authorization,
// and no staff controls; they can only show anonymous, quantitative, allowlisted values.

import { fmtMetric, metricKind, metricLabel } from '../../../lib/unitEvaluationDisplay'

const F = "'Plus Jakarta Sans', system-ui, sans-serif"
const NAVY = '#1D2567'

/** A KPI number card (released count, etc.). Presentational only. */
export function EvalKpiCard({ value, label, sub }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 14, background: '#F4F3F1', minWidth: 120,
      boxShadow: '0 1px 2px rgba(29,37,103,0.05)', fontFamily: F }}>
      <div style={{ fontSize: 32, fontWeight: 700, color: '#0E1428', lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: '#6b7280' }}>{label}</div>
      {sub && <div style={{ marginTop: 2, fontSize: 11, color: '#9ca3af' }}>{sub}</div>}
    </div>
  )
}

/** An instrument-availability card: a clickable card with a released count, active when selected. */
export function EvalInstrumentCard({ label, count, active, onClick }) {
  return (
    <button type="button" onClick={onClick} title={label}
      style={{ flex: '1 1 220px', minWidth: 200, textAlign: 'left', cursor: 'pointer',
        padding: '12px 14px', borderRadius: 10, fontFamily: F,
        border: `1px solid ${active ? NAVY : '#e5e7eb'}`,
        background: active ? '#EEF2FB' : '#fff',
        boxShadow: active ? '0 1px 3px rgba(29,37,103,0.18)' : '0 1px 2px rgba(29,37,103,0.04)',
        transition: 'background 0.12s, border-color 0.12s' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {count} released
        </span>
      </div>
    </button>
  )
}

/** A labelled select picker (instrument / timepoint / unit). */
export function EvalPicker({ label, value, onChange, options, ariaLabel }) {
  return (
    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, fontFamily: F }}>
      {label && <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280' }}>{label}</span>}
      <select value={value} onChange={e => onChange(e.target.value)} aria-label={ariaLabel || label}
        style={{ height: 34, padding: '0 10px', fontFamily: F, fontSize: 13, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', minWidth: 160 }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

/**
 * Quantitative Averages block. Each metric shows its label, average, and n; a 'context'
 * metric is tagged as context (never framed as an outcome/score). No composite score, no
 * directional bar (higher is not assumed better). Never shown below any threshold — there
 * is no suppression; n = 1 is displayed.
 */
export function EvalMetricAverages({ averages }) {
  const entries = Object.entries(averages || {})
  if (entries.length === 0) return null
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', fontFamily: F }}>
      {entries.map(([path, v]) => {
        const avg = typeof v === 'object' ? v.avg : v
        const n = typeof v === 'object' ? v.n : null
        return (
          <div key={path} style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid #eef0f2', background: '#fff' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#4A5560', display: 'flex', alignItems: 'center', gap: 6 }}>
              {metricLabel(path)}
              {metricKind(path) === 'context' && (
                <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9ca3af', border: '1px solid #e5e7eb', borderRadius: 6, padding: '1px 5px' }}>Context</span>
              )}
            </div>
            <div style={{ marginTop: 4, fontSize: 24, fontWeight: 700, color: '#0E1428', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{fmtMetric(avg)}</div>
            {n != null && <div style={{ fontSize: 11, color: '#9ca3af' }}>{n} response{n === 1 ? '' : 's'}</div>}
          </div>
        )
      })}
    </div>
  )
}

/** The anonymous quantitative response table. Rows carry no identifier; a click opens the modal. */
export function EvalQuantTable({ responses, metricPaths, onOpen }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
      <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontFamily: F }}>
        <thead>
          <tr style={{ background: '#fafafa' }}>
            <th className="aspire-th">Response</th>
            <th className="aspire-th">Unit</th>
            {metricPaths.map(p => <th key={p} className="aspire-th">{metricLabel(p)}</th>)}
            <th className="aspire-th"><span style={srOnly}>Open</span></th>
          </tr>
        </thead>
        <tbody>
          {responses.map(r => (
            <tr key={r.position} style={{ borderTop: '1px solid #eef0f2', cursor: 'pointer' }}
              onClick={() => onOpen?.(r)} tabIndex={0} role="button"
              aria-label={`Open ${r.anon_label}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(r) } }}>
              <td style={tdStyle}>{r.anon_label}</td>
              <td style={tdStyle}>{r.unit_key || '—'}</td>
              {metricPaths.map(p => <td key={p} style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(r.quantitative?.[p])}</td>)}
              <td style={{ ...tdStyle, textAlign: 'right', color: NAVY, fontWeight: 600 }}>View</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// State views ─────────────────────────────────────────────────────────────────
export function EvalLoading({ label = 'Loading evaluations…' }) {
  return <p role="status" style={{ color: '#6b7280', fontSize: 13, fontFamily: F }}>{label}</p>
}
export function EvalError({ onRetry }) {
  return (
    <div role="alert" style={{ fontSize: 13, color: '#991b1b', fontFamily: F }}>
      Evaluations could not be loaded.{' '}
      {onRetry && <button onClick={onRetry} style={{ background: 'none', border: 'none', color: NAVY, fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0 }}>Try again</button>}
    </div>
  )
}
export function EvalEmpty({ title = 'No released responses yet', detail }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 12, padding: 20, textAlign: 'center', fontFamily: F }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>{title}</div>
      {detail && <div style={{ marginTop: 4, fontSize: 12.5, color: '#6b7280', lineHeight: 1.5 }}>{detail}</div>}
    </div>
  )
}
export function EvalNoMetrics({ message }) {
  return (
    <div style={{ background: '#fffdf5', border: '1px solid #f3e8c8', borderRadius: 12, padding: 16, fontFamily: F }}>
      <p style={{ margin: 0, fontSize: 12.5, color: '#6b5b2a' }}>{message}</p>
    </div>
  )
}

const tdStyle = { padding: '9px 12px', fontSize: 12.5, color: '#191919', verticalAlign: 'middle' }
const srOnly = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }
