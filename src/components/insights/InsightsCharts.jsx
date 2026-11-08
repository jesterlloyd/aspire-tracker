// ASPIRE-INSIGHTS-1, Phase 2: the page's chart marks, as plain SVG.
//
// Colour is a role, never a value. --ins-c1..c8 are the dataviz reference palette's eight
// categorical slots, validated in order (adjacent pairs) light and dark; a school wears the slot
// of its place in the page's school list, so it keeps its colour in every card and under every
// filter. --ins-other is a comparison (the program, a filtered-out bar, a ninth school),
// --ins-r1..r5 the ordinal ramp (the funnel, the heatmap, match rank). The app's hashed school
// palette is NOT used: it fails the categorical gate (two adjacent hues at dE 2.3 for a deutan
// reader). Three of the light slots sit under 3:1 on white, so every coloured mark is also
// named by its label or legend and every chart has a Table view.
//
// Text is ink, never the series colour. Every mark carries data-tip; ChartCard shows it.
//
// Each chart takes a `height` to fill: the tallest card in a grid row decides it, and a chart
// never draws shorter than its own natural height (the *Height helpers, which ChartCard reserves).

const pick = (onPick, value) => onPick
  ? {
      role: 'button', tabIndex: 0,
      onClick: () => onPick(value),
      onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(value) } },
    }
  : {}

import { clamp, niceMax, HBAR_ROW, hbarTop, hbarHeight, funnelHeight, wrapLabel } from '../../lib/insights/chartGeometry'

// EVAL-LABEL-WRAP-1: a label's drawn width, measured in the page's own font at the chart's 12px.
// Without a canvas (a test, a server render) it falls back to the old 6.7px-a-character estimate.
let labelCtx
function labelWidth12(text, bold = false) {
  if (typeof document === 'undefined') return text.length * 6.7
  labelCtx ||= document.createElement('canvas').getContext?.('2d') || null
  if (!labelCtx) return text.length * 6.7
  labelCtx.font = `${bold ? 700 : 400} 12px ${getComputedStyle(document.body).fontFamily}`
  return labelCtx.measureText(text).width
}


/**
 * Horizontal bars. items: [{ id, label, value, display, n, suppressed, other, strong, color,
 * segments, pickValue, tip }]. `segments` ([{ key, value, color, tip }]) stacks a bar, 2px apart.
 * `max` is the scale's end; `cap` limits the fitted end (100 for a rate). `refValue` draws the
 * program line.
 */
function HBarLabel({ it, x, cy, avail }) {
  const lines = wrapLabel(it.label, avail, t => labelWidth12(t, it.strong))
  const cls = it.strong ? 'ins-lbs' : 'ins-lb'
  if (lines.length === 1) return <text className={cls} x={x} y={cy} textAnchor="end">{lines[0]}</text>
  return (
    <text className={cls} x={x} y={cy - 7} textAnchor="end">
      <tspan x={x}>{lines[0]}</tspan>
      <tspan x={x} dy={14}>{lines[1]}</tspan>
    </text>
  )
}

export function HBar({ items, width, height = 0, max, cap = null, refValue = null, refLabel = '', onPick, labelWidth, pickLabel = 'Filter to this' }) {
  // Fit the longest label, within 45% of the width; a label wider than that wraps to two lines.
  const longest = Math.max(0, ...items.map(i => labelWidth12(String(i.label || ''), i.strong)))
  const lw = labelWidth || Math.round(Math.min(width * 0.45, Math.max(80, longest + 14)))
  const vw = 96
  const top = hbarTop(items, refValue)
  const natural = hbarHeight(items, refValue)
  const H = Math.max(natural, height)
  const rowH = items.length ? clamp((H - top - 4) / items.length, HBAR_ROW, 64) : HBAR_ROW
  const barH = clamp(rowH * 0.56, 14, 26)
  const plot = Math.max(60, width - lw - vw)
  const biggest = Math.max(0, ...items.filter(i => !i.suppressed).map(i => i.value || 0), refValue || 0)
  const end = max || niceMax(biggest, cap)
  const x = v => lw + plot * (Math.max(0, Math.min(v, end)) / end)
  // A reference line has nothing to compare against when every bar is withheld.
  const showRef = refValue != null && items.some(i => !i.suppressed)
  const body = top + items.length * rowH
  return (
    <svg className="ins-svg" width={width} height={H} role="img" aria-label="Bar chart">
      {items.map((it, i) => {
        const y = top + i * rowH
        const cy = y + rowH / 2 + 4
        const by = y + (rowH - barH) / 2
        const canPick = onPick && it.pickValue != null
        const fill = it.other ? 'var(--ins-other)' : (it.color || 'var(--ins-c1)')
        let segX = lw
        return (
          <g key={it.id || it.label} data-tip={it.tip || `${it.label}: ${it.display}${it.n != null ? ` (n = ${it.n})` : ''}`}
            className={canPick ? 'ins-pick' : undefined}
            {...(canPick ? { ...pick(onPick, it.pickValue), 'aria-label': `${it.label}: ${it.display}. ${pickLabel}.` } : {})}>
            <rect className="ins-hit" x={0} y={y} width={width} height={rowH} />
            <HBarLabel it={it} x={lw - 10} cy={cy} avail={lw - 14} />
            {it.suppressed
              ? <text className="ins-vmuted" x={lw} y={cy}>Too few to rate (n = {it.n || 0})</text>
              : (
                <>
                  {it.segments?.length
                    ? it.segments.map((sg, k) => {
                        const w = x(sg.value) - lw
                        const r = <rect key={sg.key} className="ins-mk ins-seg" x={segX} y={by} width={Math.max(1, w - (k < it.segments.length - 1 ? 2 : 0))} height={barH}
                          rx={k === it.segments.length - 1 ? 3 : 0} fill={it.other ? 'var(--ins-other)' : sg.color} />
                        segX += w
                        return r
                      })
                    : <rect className="ins-mk" x={lw} y={by} width={Math.max(2, x(it.value) - lw)} height={barH} rx={3} fill={fill} />}
                  <text className="ins-val" x={x(it.value) + 6} y={cy}>
                    {it.display}
                    {it.n != null && <tspan className="ins-ax" dx={6}>n = {it.n}</tspan>}
                  </text>
                </>
              )}
          </g>
        )
      })}
      {showRef && (
        <g aria-hidden="true">
          {/* Only through rows with a bar: a withheld row's words are never struck through. */}
          {items.map((it, i) => (it.suppressed ? null : (
            <line key={i} className="ins-ref" x1={x(refValue)} x2={x(refValue)} y1={i === 0 ? top - 4 : top + i * rowH} y2={top + (i + 1) * rowH} />
          )))}
          <text className="ins-ax" x={x(refValue)} y={12} textAnchor="middle">{refLabel}</text>
        </g>
      )}
      <line className="ins-bl" x1={lw} x2={lw} y1={top} y2={body} aria-hidden="true" />
    </svg>
  )
}

/** The pipeline: one bar per step on the ordinal ramp, with "% of prior · −drop". */
export function Funnel({ steps, width, height = 0 }) {
  const lw = Math.min(190, Math.max(130, width * 0.3))
  const vw = 170
  const shown = steps.filter(s => s.count != null)
  const H = Math.max(funnelHeight(steps), height)
  const rowH = shown.length ? clamp((H - 6) / shown.length, 34, 60) : 34
  const barH = clamp(rowH * 0.6, 20, 30)
  const plot = Math.max(60, width - lw - vw)
  const end = Math.max(1, ...shown.map(s => s.count))
  const ramp = ['--ins-r1', '--ins-r1', '--ins-r2', '--ins-r2', '--ins-r3', '--ins-r4', '--ins-r5', '--ins-r5']
  return (
    <svg className="ins-svg" width={width} height={H} role="img" aria-label="Pipeline from application to NGRP hire">
      {shown.map((s, i) => {
        const y = i * rowH + 3
        const w = Math.max(2, plot * (s.count / end))
        const cy = y + rowH / 2 + 4
        const prior = s.ofPrior && !s.ofPrior.suppressed ? `${Math.round(s.ofPrior.rate)}% of prior${s.drop ? ` · −${s.drop}` : ''}` : ''
        const step = steps.indexOf(s)
        return (
          <g key={s.key} data-tip={`${s.label}: ${s.count}${prior ? `\n${prior}` : ''}`}>
            <rect className="ins-hit" x={0} y={y} width={width} height={rowH} />
            <text className="ins-lb" x={lw - 10} y={cy} textAnchor="end">{s.label}</text>
            <rect className="ins-mk" x={lw} y={y + (rowH - barH) / 2} width={w} height={barH} rx={3} fill={`var(${ramp[step] || '--ins-r5'})`} />
            <text className="ins-val ins-strong" x={lw + w + 8} y={cy}>
              {s.count}
              {prior && <tspan className="ins-ax" dx={10}>{prior}</tspan>}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Lines on one percent axis (0 to the next of 20, 40, 60, 80 or 100 above the highest point). series: [{ name, color, values: [rate|null], ns: [n] }].
 * A withheld point is a gap, never a zero. Every series is labelled at its end.
 */
export function Lines({ series, labels, width, height = 220 }) {
  const l = 40
  const r = 76
  const t = 12
  const b = 28
  const pw = Math.max(80, width - l - r)
  const ph = height - t - b
  const x = i => l + (labels.length === 1 ? pw / 2 : (pw * i) / (labels.length - 1))
  // The axis ends at the next of 20/40/60/80/100 above the highest point, so low rates are not a
  // flat line; each end divides into four whole-number steps.
  const peak = Math.max(0, ...series.flatMap(s => s.values.filter(v => v != null)))
  const yEnd = [20, 40, 60, 80, 100].find(q => q >= peak * 1.04) || 100
  const y = v => t + ph * (1 - v / yEnd)
  const ends = series.map(s => {
    const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean)
    return pts.length ? { s, y: pts[pts.length - 1][1], x: pts[pts.length - 1][0] } : null
  }).filter(Boolean).sort((a, c) => a.y - c.y)
  ends.forEach((e, i) => { e.ly = i && e.y - ends[i - 1].ly < 14 ? ends[i - 1].ly + 14 : e.y })
  // A stack that runs past the plot's floor is lifted, so it never sits on the axis labels.
  const over = ends.length ? ends[ends.length - 1].ly - (t + ph - 2) : 0
  if (over > 0) ends.forEach(e => { e.ly -= over })
  const step = pw / Math.max(1, labels.length - 1)
  return (
    <svg className="ins-svg" width={width} height={height} role="img" aria-label="Line chart of NGRP rates by cohort">
      {[0, 0.25, 0.5, 0.75, 1].map(q => q * yEnd).map(g => (
        <g key={g} aria-hidden="true">
          <line className="ins-gl" x1={l} x2={l + pw} y1={y(g)} y2={y(g)} />
          <text className="ins-ax" x={l - 6} y={y(g) + 4} textAnchor="end">{g}%</text>
        </g>
      ))}
      {labels.map((lb, i) => <text key={lb + i} className="ins-ax" x={x(i)} y={height - 8} textAnchor="middle">{lb}</text>)}
      {series.map(s => {
        const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean)
        if (!pts.length) return null
        return (
          <g key={s.name}>
            {/* A gap where a cohort is withheld: draw each unbroken run on its own. */}
            {runs(s.values).map((run, k) => (
              <polyline key={k} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"
                points={run.map(i => `${x(i)},${y(s.values[i])}`).join(' ')} />
            ))}
            {pts.map(([px, py], k) => <circle key={k} cx={px} cy={py} r={4} fill={s.color} className="ins-dot" />)}
          </g>
        )
      })}
      {ends.map(e => <text key={e.s.name} className="ins-lb ins-ink" x={e.x + 8} y={e.ly + 4}>{e.s.name}</text>)}
      {labels.map((lb, i) => (
        <rect key={`h${i}`} className="ins-hit" x={x(i) - step / 2} y={t} width={step} height={ph}
          data-tip={`${lb}\n${series.map(s => `${s.name}: ${s.values[i] == null ? (s.ns?.[i] ? 'too few' : '–') : `${Math.round(s.values[i])}%`}${s.ns?.[i] != null ? ` (n = ${s.ns[i]})` : ''}`).join('\n')}`} />
      ))}
    </svg>
  )
}

function runs(values) {
  const out = []
  let cur = []
  values.forEach((v, i) => {
    if (v == null) { if (cur.length) out.push(cur); cur = [] } else cur.push(i)
  })
  if (cur.length) out.push(cur)
  return out.filter(r => r.length > 1)
}

/** Columns for a count per cohort. items: [{ label, value, tip }] */
export function Columns({ items, width, height = 120 }) {
  const l = 8
  const t = 18
  const b = 24
  const pw = width - l * 2
  const ph = height - t - b
  const end = Math.max(1, ...items.map(i => i.value || 0))
  const bw = Math.min(44, (pw / Math.max(1, items.length)) * 0.6)
  return (
    <svg className="ins-svg" width={width} height={height} role="img" aria-label="Students placed per cohort">
      <line className="ins-bl" x1={l} x2={l + pw} y1={t + ph} y2={t + ph} aria-hidden="true" />
      {items.map((it, i) => {
        const cx = l + (pw * (i + 0.5)) / items.length
        const h = it.value == null ? 0 : (ph * it.value) / end
        return (
          <g key={it.label + i} data-tip={it.tip}>
            <rect className="ins-hit" x={cx - pw / items.length / 2} y={t} width={pw / items.length} height={ph} />
            {it.value != null && <rect className="ins-mk" x={cx - bw / 2} y={t + ph - h} width={bw} height={Math.max(1, h)} rx={3} fill="var(--ins-c1)" />}
            <text className="ins-val" x={cx} y={t + ph - h - 4} textAnchor="middle">{it.value == null ? '–' : it.value}</text>
            <text className="ins-ax" x={cx} y={height - 7} textAnchor="middle">{it.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** A school by unit grid of counts, on the sequential ramp. Every cell prints its count. */
export function Heat({ rows, cols, cells, width, onPickRow, onPickCol }) {
  // Fit the longest school name (about 6.7px a character), within 40% of the width.
  const longest = Math.max(0, ...rows.map(r => String(r).length))
  const lw = Math.round(Math.min(width * 0.4, Math.max(110, longest * 6.7 + 16)))
  const top = 34
  const ch = 30
  const cw = Math.max(36, (width - lw) / Math.max(1, cols.length))
  const W = Math.max(width, lw + cw * cols.length)
  const H = top + rows.length * ch + 2
  const end = Math.max(1, ...cells.flat())
  const step = v => (v ? Math.min(5, 1 + Math.floor((v / end) * 4.999)) : 0)
  return (
    <svg className="ins-svg" width={W} height={H} role="img" aria-label="Students placed by school and unit">
      {cols.map((c, j) => (
        <text key={c} className={`ins-ax${onPickCol ? ' ins-pick' : ''}`} x={lw + cw * j + cw / 2} y={20} textAnchor="middle"
          {...pick(onPickCol, c)} aria-label={onPickCol ? `${c}. Filter to this unit.` : undefined}>{c}</text>
      ))}
      {rows.map((rw, i) => (
        <g key={rw}>
          <text className={`ins-lb${onPickRow ? ' ins-pick' : ''}`} x={lw - 10} y={top + i * ch + ch / 2 + 4} textAnchor="end"
            {...pick(onPickRow, rw)} aria-label={onPickRow ? `${rw}. Filter to this school.` : undefined}>{rw}</text>
          {cols.map((c, j) => {
            const v = cells[i]?.[j] || 0
            const k = step(v)
            return (
              <g key={c} data-tip={`${rw} → ${c}: ${v} ${v === 1 ? 'student' : 'students'}`}>
                <rect x={lw + cw * j + 1} y={top + i * ch + 1} width={cw - 2} height={ch - 2} rx={3}
                  className={k ? `ins-heat ins-heat-${k}` : 'ins-heat ins-heat-0'} />
                {v > 0 && <text className={`ins-heat-t ins-heat-t-${k}`} x={lw + cw * j + cw / 2} y={top + i * ch + ch / 2 + 4} textAnchor="middle">{v}</text>}
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}
