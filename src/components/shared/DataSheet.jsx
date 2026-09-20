// src/components/shared/DataSheet.jsx
//
// TABLE-CANON-1 (2026-09-19): every table in the app is this component at one of three
// levels. docs/design/table-canon-spec.md is the standard and docs/mockups/table-canon.html
// renders it. This file is the first build, at the full-sheet level, for Evaluation >
// Responses; other screens convert to it by swapping markup, one screen per session.
//
// Levels (the caller decides by the spec's three questions, never by taste):
//   full    stands alone at full width and holds a record you read or export:
//           tractor holes, a crease every eight rows, paired bands
//   plain   sits inside a card, a panel or a narrow column: bands and rules, no holes
//   inline  five rows or fewer inside another component: bands only
//
// The eight invariants hold at every level: paired banding; name · qualifier in the first
// column; one number per column; every header sorts; status is one word in a pill; missing
// is an en dash; expansion is a bordered panel; pagination is a crease.
//
// BANDING is written to the row as data-band, computed from the row's index within its
// page, rather than by :nth-child. An expanded detail panel is a sibling row, and a sibling
// shifts every :nth-child band below it; the attribute keeps rows 1 and 2 of every four
// banded whatever is open.
//
// COLUMNS are one array shared by the header and every row (spec §6), so they cannot
// drift. Each column declares a minimum (`min`, px) and a share of the spare width
// (`grow`), and the template is `minmax(min, grow fr)`: a WEIGHTED SPREAD (Owner,
// 2026-09-20). Every column grows from its minimum in proportion, so the name column stays
// widest and the figures never bunch at one edge. Below the width the visible columns need,
// the lowest-priority columns are dropped whole (priority 1 is never dropped); nothing
// shrinks and nothing scrolls sideways.
//
// SORT is client-side over the rows it is given. Controlled (`sort` + `onSortChange`) when
// the caller needs the order too, for an export that mirrors the view; uncontrolled
// otherwise. The rules live in dataSheetSort.js so the caller's copy of the order is the
// same code.

import { Fragment, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { PAGE_ROWS, nextSort, sortRows, bandFor } from './dataSheetSort'
import './dataSheet.css'

const CHEVRON_W = 28
const GAP = 10
// The content inset inside the sheet's own padding (the hole strips on a full sheet), so a
// title never sits against the holes and a button never sits against the edge. Mirrors
// --ds-inset in dataSheet.css per level.
const INSET = { full: 20, plain: 8, inline: 0 }

// One column's track. A column may still pass a literal `width`; the canon form is min + grow.
export function columnTrack(col) {
  if (col.width) return col.width
  const min = col.min || 80
  const grow = col.grow ?? 1
  return grow > 0 ? `minmax(${min}px, ${grow}fr)` : `${min}px`
}

export function Pill({ tone = 'off', children }) {
  return <span className={`ds-pill ds-pill-${tone}`}>{children}</span>
}

// Missing is an en dash in muted ink, never an empty cell (§3.6).
export function Missing() {
  return <span className="ds-dim">–</span>
}

export function DetailField({ label, children }) {
  return (
    <div className="ds-dt">
      <span className="ds-k">{label}</span>
      <span>{children}</span>
    </div>
  )
}

// Drop the lowest-priority columns whole until what is left fits the container.
function useVisibleColumns(columns, expandable, ref, inset) {
  const [width, setWidth] = useState(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  if (width == null) return columns
  const need = cols =>
    cols.reduce((s, c) => s + (c.min || 80), 0) + GAP * (cols.length - 1 + (expandable ? 1 : 0)) + inset * 2 + (expandable ? CHEVRON_W : 0)
  let visible = columns
  while (need(visible) > width) {
    const droppable = visible.filter(c => (c.priority ?? 1) > 1)
    if (droppable.length === 0) break
    const worst = Math.max(...droppable.map(c => c.priority ?? 1))
    const idx = visible.map(c => c.priority ?? 1).lastIndexOf(worst)
    visible = visible.filter((_, i) => i !== idx)
  }
  return visible
}

export default function DataSheet({
  level = 'full',
  title,
  caption,
  toolbar,
  columns,
  rows,
  rowKey = row => row.id,
  sort,
  onSortChange,
  defaultSort = null,
  expandable = false,
  expandedKeys,
  onToggleExpand,
  renderExpanded,
  expandLabel,
  pageRows = PAGE_ROWS,
  emptyMessage = 'Nothing to show',
  footer,
  className = '',
  'aria-label': ariaLabel,
}) {
  const ref = useRef(null)
  const [innerSort, setInnerSort] = useState(defaultSort)
  const [live, setLive] = useState('')
  const activeSort = sort === undefined ? innerSort : sort
  const visible = useVisibleColumns(columns, expandable, ref, INSET[level] ?? INSET.full)
  const sorted = sortRows(rows, columns, activeSort)
  const grid = visible.map(columnTrack).join(' ') + (expandable ? ` ${CHEVRON_W}px` : '')
  const colCount = visible.length + (expandable ? 1 : 0)
  const full = level === 'full'

  function changeSort(col) {
    const next = nextSort(activeSort, col.key)
    if (onSortChange) onSortChange(next)
    else setInnerSort(next)
    setLive(`Sorted by ${col.title || col.label}, ${next.dir === 'asc' ? 'ascending' : 'descending'}`)
  }

  function toggle(row) {
    const key = rowKey(row)
    const opening = !expandedKeys?.has(key)
    onToggleExpand?.(key, row)
    setLive(`${expandLabel ? expandLabel(row) : 'Row detail'}: ${opening ? 'shown' : 'hidden'}`)
  }

  // A page break every ten rows renders as a crease, on the full sheet only.
  const pages = []
  if (full && pageRows > 0) {
    for (let i = 0; i < sorted.length; i += pageRows) pages.push(sorted.slice(i, i + pageRows))
  } else {
    pages.push(sorted)
  }

  return (
    <section ref={ref} className={`ds ${className}`.trim()} data-level={level} aria-label={ariaLabel || title}>
      {full && (
        <>
          <span className="ds-holes ds-holes-l" aria-hidden="true" />
          <span className="ds-holes ds-holes-r" aria-hidden="true" />
        </>
      )}

      {(title || caption || toolbar) && (
        <div className="ds-head">
          {(title || caption) && (
            <div className="ds-title">
              {title && <h3>{title}</h3>}
              {caption && <span className="ds-cap">{caption}</span>}
            </div>
          )}
          {toolbar && <div className="ds-toolbar">{toolbar}</div>}
        </div>
      )}

      <div role="table" aria-label={ariaLabel || title} className="ds-table">
        <div role="rowgroup">
          <div role="row" className="ds-row ds-hrow" style={{ gridTemplateColumns: grid }}>
            {visible.map(col => {
              const on = activeSort?.key === col.key
              const dir = on ? activeSort.dir : null
              const next = on && dir === 'asc' ? 'descending' : 'ascending'
              return (
                <div
                  key={col.key}
                  role="columnheader"
                  aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={col.align === 'right' ? 'ds-right' : undefined}
                  title={col.title}
                >
                  <button
                    type="button"
                    className="ds-sort"
                    data-on={on ? 1 : 0}
                    onClick={() => changeSort(col)}
                    aria-label={`Sort by ${col.title || col.label} ${next}`}
                  >
                    {col.label}
                    <span aria-hidden="true">{on ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
                  </button>
                </div>
              )
            })}
            {expandable && <div role="columnheader" aria-label="Detail" />}
          </div>
        </div>

        {sorted.length === 0 && (
          <div role="rowgroup">
            <div role="row" className="ds-empty">
              <div role="cell" aria-colspan={colCount}>{emptyMessage}</div>
            </div>
          </div>
        )}

        {sorted.length > 0 && pages.map((page, p) => (
          <Fragment key={p}>
            {p > 0 && (
              <div className="ds-crease" role="presentation" aria-hidden="true"><span>continued</span></div>
            )}
            <div role="rowgroup" className="ds-body">
              {page.map((row, i) => {
                const key = rowKey(row)
                const open = !!expandedKeys?.has(key)
                return (
                  <Fragment key={key}>
                    <div role="row" className="ds-row" data-band={bandFor(i)} style={{ gridTemplateColumns: grid }}>
                      {visible.map(col => (
                        <div key={col.key} role="cell" className={col.align === 'right' ? 'ds-right' : undefined}>
                          {col.render ? col.render(row) : row[col.key]}
                        </div>
                      ))}
                      {expandable && (
                        <div role="cell">
                          <button
                            type="button"
                            className="ds-exp"
                            aria-expanded={open}
                            aria-label={expandLabel ? expandLabel(row) : 'Show detail'}
                            onClick={() => toggle(row)}
                          >
                            {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                          </button>
                        </div>
                      )}
                    </div>
                    {expandable && open && (
                      <div role="row" className="ds-detail-row">
                        <div role="cell" aria-colspan={colCount} className="ds-detail">
                          {renderExpanded?.(row)}
                        </div>
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>
          </Fragment>
        ))}
      </div>

      {footer && <div className="ds-foot">{footer}</div>}
      <p className="sr-only" aria-live="polite">{live}</p>
    </section>
  )
}
