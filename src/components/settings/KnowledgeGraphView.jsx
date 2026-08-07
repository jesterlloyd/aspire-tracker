// KNOWLEDGE-GRAPH-1: the Knowledge Center Graph View.
//
// An Obsidian-style picture of the governed vault: nodes are knowledge pages,
// edges are ONLY explicit governed relationships - resolved [[wikilinks]] from
// knowledge_links and superseded_by. Nothing inferred, nothing decorative. A
// sparse corpus draws sparse; the graph earns richness as authors link pages.
//
// Rendering is a hand-rolled <canvas> force layout (src/lib/knowledgeGraphLayout.js):
// the corpus is dozens of pages, so a dependency-free simulation beats adding a
// graph library to the bundle for one Settings surface.
//
// VISUAL ENCODING - every signal carries at least one non-color cue:
//   fill color   = category (the deep ACCENT_PALETTE solids, one per category)
//   radius       = degree (how connected the page is)
//   draft        = hollow: white fill + colored ring
//   deprecated   = faded fill + short-dash ring
//   archived     = gray fill (terminal state outranks category)
//   superseded   = amber outer halo
//   unresolved links = small amber tick on the node's shoulder
//   supersedes edge  = dashed, arrowhead toward the replacing page
//
// Clicking a node opens the SAME entry drawer as the list - one editing
// paradigm, two projections of the same governed data.
//
// ACCESSIBILITY, stated honestly: a canvas graph is a visual modality. The
// List view remains the complete, accessible surface for the same data; this
// view carries an aria summary, a keyboard-usable search-and-open path, and
// nothing exists here that cannot be reached from the list.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Maximize2, CircleDot } from 'lucide-react'
import SurfaceCard from '../ui/SurfaceCard'
import { CATEGORY_LABELS } from './knowledgeCategories'
import { computeLayout, boundsOf, fitTransform, nodeRadius, buildAdjacency, neighborhood } from '../../lib/knowledgeGraphLayout'

// Category palette: the seven deep accent solids already canonized by
// FilterKPICard, plus one neutral slate for FAQ (the catch-all category).
// Deliberately muted and mutually distinguishable - no rainbow.
const CATEGORY_COLORS = {
  program_overview: '#1D2567',      // nightfall - the anchor
  eligibility_placement: '#2F7D5C', // sage
  interview_selection: '#930045',   // chroma - interviews are ASPIRE's accent domain
  rotations_matching: '#275E63',    // marina
  student_requirements: '#8B5E1A',  // dawn (deepened amber)
  communication_guidance: '#4A5D8F',// periwinkle
  terminology_navigation: '#6B4F8F',// lavender
  faq: '#556070',                   // neutral slate for the catch-all
}
const ARCHIVED_GRAY = '#9ca3af'
const AMBER = '#b45309'
const EDGE_COLOR = 'rgba(107,114,128,0.30)'
const EDGE_DIM = 'rgba(107,114,128,0.10)'
const CANVAS_BG = '#fdfcfa'

const secondary = 'var(--color-text-secondary, #6b7280)'

function nodeFill(node) {
  if (node.state === 'archived') return ARCHIVED_GRAY
  return CATEGORY_COLORS[node.category] || '#556070'
}

// Label policy: hover/selection and their neighbors always; hubs always; all
// labels once zoomed in enough to read them without clutter.
function shouldLabel(node, { hoverSet, selectedId, scale, hubDegree }) {
  if (node.id === selectedId) return true
  if (hoverSet && hoverSet.has(node.id)) return true
  if (node.degree >= hubDegree) return true
  return scale >= 1.15
}

export default function KnowledgeGraphView({
  nodes, edges, loading, error,
  onOpenEntry, onRetry,
  stateFilter = 'all', categoryFilter = 'all', tagFilter = 'all', search = '',
  selectedEntryId = null,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const posRef = useRef(new Map())
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const dragRef = useRef(null)
  const sizeRef = useRef({ w: 800, h: 560 })

  const [hoverId, setHoverId] = useState(null)
  const [tooltip, setTooltip] = useState(null) // { x, y, node }
  const [scope, setScope] = useState('global') // 'global' | 'local'
  const [depth, setDepth] = useState(1)        // local-graph hops
  const [showUnlinked, setShowUnlinked] = useState(true)

  const adjacency = useMemo(() => buildAdjacency(edges || []), [edges])

  // The local neighborhood follows whichever node is selected (drawer open).
  const localSet = useMemo(() => {
    if (scope !== 'local' || !selectedEntryId) return null
    return neighborhood(selectedEntryId, edges || [], depth)
  }, [scope, selectedEntryId, edges, depth])

  // Panel filters DIM rather than remove, so the layout never reshuffles under
  // a filter click and the mental map survives. Scope (local) and the unlinked
  // toggle HIDE, and trigger a re-fit instead.
  const matchesFilters = useCallback((node) => {
    if (stateFilter === 'review') {
      if (!(node.expired || node.due_for_review)) return false
    } else if (stateFilter !== 'all' && node.state !== stateFilter) return false
    if (categoryFilter !== 'all' && node.category !== categoryFilter) return false
    if (tagFilter !== 'all' && !(node.tags || []).includes(tagFilter)) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hit = (node.title || '').toLowerCase().includes(q)
        || (node.slug || '').toLowerCase().includes(q)
      if (!hit) return false
    }
    return true
  }, [stateFilter, categoryFilter, tagFilter, search])

  const isVisible = useCallback((node) => {
    if (localSet && !localSet.has(node.id)) return false
    if (!showUnlinked && node.degree === 0 && node.id !== selectedEntryId) return false
    return true
  }, [localSet, showUnlinked, selectedEntryId])

  const hubDegree = useMemo(() => {
    const degrees = (nodes || []).map(n => n.degree).sort((a, b) => b - a)
    // "Hub" = top of the distribution, but never a threshold so low that every
    // node qualifies on a lightly-linked corpus.
    return Math.max(3, degrees[Math.min(4, degrees.length - 1)] || 3)
  }, [nodes])

  const anyFilterActive = stateFilter !== 'all' || categoryFilter !== 'all' || tagFilter !== 'all' || !!search.trim()

  // ── Drawing ────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !nodes) return
    const ctx = canvas.getContext('2d')
    const { w, h } = sizeRef.current
    const dpr = window.devicePixelRatio || 1
    const { scale, tx, ty } = viewRef.current
    const pos = posRef.current

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = CANVAS_BG
    ctx.fillRect(0, 0, w, h)
    ctx.translate(tx, ty)
    ctx.scale(scale, scale)

    const hoverSet = hoverId ? new Set([hoverId, ...(adjacency.get(hoverId) || [])]) : null
    const visible = new Set()
    for (const n of nodes) if (isVisible(n)) visible.add(n.id)

    // Edges first, under the nodes.
    for (const e of edges || []) {
      if (!visible.has(e.source) || !visible.has(e.target)) continue
      const a = pos.get(e.source); const b = pos.get(e.target)
      if (!a || !b) continue
      const dimmed = hoverSet && !(hoverSet.has(e.source) && hoverSet.has(e.target))
      ctx.strokeStyle = dimmed ? EDGE_DIM : EDGE_COLOR
      ctx.lineWidth = (hoverSet && !dimmed ? 1.8 : 1.1) / scale
      ctx.setLineDash(e.type === 'supersedes' ? [5 / scale, 4 / scale] : [])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.setLineDash([])
      // Supersession points at the page that replaced this one.
      if (e.type === 'supersedes') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x)
        const r = nodeRadius((nodes.find(n => n.id === e.target) || {}).degree) + 4
        const tipX = b.x - Math.cos(ang) * r
        const tipY = b.y - Math.sin(ang) * r
        const s = 5 / scale
        ctx.fillStyle = dimmed ? EDGE_DIM : 'rgba(107,114,128,0.55)'
        ctx.beginPath()
        ctx.moveTo(tipX, tipY)
        ctx.lineTo(tipX - Math.cos(ang - 0.45) * s * 2, tipY - Math.sin(ang - 0.45) * s * 2)
        ctx.lineTo(tipX - Math.cos(ang + 0.45) * s * 2, tipY - Math.sin(ang + 0.45) * s * 2)
        ctx.closePath()
        ctx.fill()
      }
    }

    // Nodes.
    for (const n of nodes) {
      if (!visible.has(n.id)) continue
      const p = pos.get(n.id)
      if (!p) continue
      const r = nodeRadius(n.degree)
      const fill = nodeFill(n)
      const filteredOut = anyFilterActive && !matchesFilters(n)
      const dimmedByHover = hoverSet && !hoverSet.has(n.id)
      const alpha = filteredOut ? 0.10 : dimmedByHover ? 0.22 : n.state === 'deprecated' ? 0.55 : 1

      ctx.globalAlpha = alpha

      // Superseded pages carry an amber halo: "this has a successor".
      if (n.superseded_by) {
        ctx.strokeStyle = AMBER
        ctx.lineWidth = 1.4 / scale
        ctx.beginPath()
        ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2)
        ctx.stroke()
      }

      if (n.state === 'draft') {
        // Hollow: a page that is not yet governed guidance.
        ctx.fillStyle = '#ffffff'
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = fill
        ctx.lineWidth = 2 / scale
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke()
      } else {
        ctx.fillStyle = fill
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill()
        if (n.state === 'deprecated') {
          ctx.strokeStyle = fill
          ctx.lineWidth = 1.2 / scale
          ctx.setLineDash([3 / scale, 3 / scale])
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2); ctx.stroke()
          ctx.setLineDash([])
        }
      }

      // Selection ring.
      if (n.id === selectedEntryId || n.id === hoverId) {
        ctx.strokeStyle = '#1D2567'
        ctx.lineWidth = 2.2 / scale
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 5.5, 0, Math.PI * 2); ctx.stroke()
      }

      // Unresolved-link tick: honest signal that this page names targets the
      // vault cannot draw.
      if (n.broken_count > 0) {
        ctx.fillStyle = AMBER
        ctx.beginPath()
        ctx.arc(p.x + r * 0.85, p.y - r * 0.85, Math.max(2.4, 3.2 / scale), 0, Math.PI * 2)
        ctx.fill()
      }

      // Labels.
      if (shouldLabel(n, { hoverSet, selectedId: selectedEntryId, scale, hubDegree }) && !filteredOut) {
        const fontPx = Math.max(10.5, 12 / scale)
        ctx.font = `500 ${fontPx}px "DM Sans", sans-serif`
        ctx.textAlign = 'center'
        ctx.lineWidth = 3 / scale
        ctx.strokeStyle = 'rgba(253,252,250,0.9)'
        ctx.strokeText(n.title, p.x, p.y + r + fontPx + 2)
        ctx.fillStyle = dimmedByHover ? '#9ca3af' : '#374151'
        ctx.fillText(n.title, p.x, p.y + r + fontPx + 2)
      }
      ctx.globalAlpha = 1
    }
  }, [nodes, edges, adjacency, hoverId, selectedEntryId, isVisible, matchesFilters, anyFilterActive, hubDegree])

  // ── Layout + fit ───────────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const visiblePos = new Map()
    for (const n of nodes || []) {
      if (isVisible(n)) {
        const p = posRef.current.get(n.id)
        if (p) visiblePos.set(n.id, p)
      }
    }
    const { w, h } = sizeRef.current
    const t = fitTransform(boundsOf(visiblePos), w, h)
    viewRef.current = { scale: t.scale, tx: t.tx, ty: t.ty }
    draw()
  }, [nodes, isVisible, draw])

  useEffect(() => {
    if (!nodes || !nodes.length) return
    posRef.current = computeLayout(nodes, edges || [])
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  // Scope / visibility changes re-frame the picture.
  useEffect(() => { fit() }, [scope, depth, showUnlinked, fit])
  useEffect(() => { draw() }, [draw])

  // Canvas sizing (DPR-aware, responsive to the container).
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const resize = () => {
      const w = wrap.clientWidth
      // Height follows the CONTAINER, not a prop: the panel has no idea which
      // Keith layout mode it is in, and the canvas shouldn't need telling.
      const h = w < 720 ? 460 : 560
      const dpr = window.devicePixelRatio || 1
      sizeRef.current = { w, h }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      fit()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [fit])

  // ── Interaction ────────────────────────────────────────────────────────────
  const toWorld = useCallback((clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const { scale, tx, ty } = viewRef.current
    return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale }
  }, [])

  const hitNode = useCallback((wx, wy) => {
    let best = null; let bestD = Infinity
    for (const n of nodes || []) {
      if (!isVisible(n)) continue
      const p = posRef.current.get(n.id)
      if (!p) continue
      const r = nodeRadius(n.degree) + 3
      const d = Math.hypot(p.x - wx, p.y - wy)
      if (d <= r && d < bestD) { best = n; bestD = d }
    }
    return best
  }, [nodes, isVisible])

  // Wheel zoom needs a NON-passive listener or preventDefault is ignored and
  // the page scrolls under the graph - exactly the scroll weirdness to avoid.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const v = viewRef.current
      const factor = Math.exp(-e.deltaY * 0.0016)
      const next = Math.min(4, Math.max(0.15, v.scale * factor))
      // Zoom around the cursor.
      v.tx = mx - ((mx - v.tx) / v.scale) * next
      v.ty = my - ((my - v.ty) / v.scale) * next
      v.scale = next
      draw()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [draw])

  const onPointerDown = (e) => {
    const { x, y } = toWorld(e.clientX, e.clientY)
    const node = hitNode(x, y)
    dragRef.current = node
      ? { kind: 'node', id: node.id, moved: false }
      : { kind: 'pan', startX: e.clientX, startY: e.clientY, tx0: viewRef.current.tx, ty0: viewRef.current.ty, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e) => {
    const drag = dragRef.current
    if (!drag) {
      const { x, y } = toWorld(e.clientX, e.clientY)
      const node = hitNode(x, y)
      setHoverId(node ? node.id : null)
      setTooltip(node ? { x: e.clientX, y: e.clientY, node } : null)
      canvasRef.current.style.cursor = node ? 'pointer' : 'grab'
      return
    }
    drag.moved = true
    if (drag.kind === 'pan') {
      viewRef.current.tx = drag.tx0 + (e.clientX - drag.startX)
      viewRef.current.ty = drag.ty0 + (e.clientY - drag.startY)
    } else {
      const { x, y } = toWorld(e.clientX, e.clientY)
      posRef.current.set(drag.id, { x, y })
    }
    draw()
  }

  const onPointerUp = (e) => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag && drag.kind === 'node' && !drag.moved) {
      const node = (nodes || []).find(n => n.id === drag.id)
      // A click, not a drag: open the SAME drawer the list opens.
      if (node) onOpenEntry?.(node)
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // ── Summary line (also the accessible description) ─────────────────────────
  const summary = useMemo(() => {
    const ns = nodes || []
    const orphans = ns.filter(n => n.is_orphan).length
    const broken = ns.reduce((sum, n) => sum + (n.broken_count || 0), 0)
    const wiki = (edges || []).filter(e => e.type === 'wikilink').length
    const sup = (edges || []).filter(e => e.type === 'supersedes').length
    return { count: ns.length, wiki, sup, orphans, broken }
  }, [nodes, edges])

  if (loading) {
    return <div style={{ padding: '48px 0', textAlign: 'center', color: secondary, fontSize: 13 }}>Loading the knowledge graph…</div>
  }
  if (error) {
    return (
      <SurfaceCard padding="16px 18px" style={{ fontSize: 13, color: secondary }}>
        We couldn’t load the knowledge graph. <button type="button" onClick={onRetry} style={{ border: 'none', background: 'none', color: 'var(--color-accent-primary, #1D2567)', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'DM Sans, sans-serif', fontSize: 13 }}>Try again</button>
      </SurfaceCard>
    )
  }

  const btn = (active) => ({
    padding: '5px 11px', borderRadius: 8, fontFamily: 'DM Sans, sans-serif', fontSize: 12.5,
    fontWeight: 600, cursor: 'pointer', border: '1px solid var(--color-border-default, #e5e7eb)',
    background: active ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-bg-surface, #ffffff)',
    color: active ? '#ffffff' : 'var(--color-text-primary, #374151)',
  })

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" style={btn(false)} onClick={fit} aria-label="Fit graph to view">
          <Maximize2 size={12} style={{ verticalAlign: '-1px', marginRight: 5 }} />Fit
        </button>
        <button type="button" style={btn(!showUnlinked)} aria-pressed={!showUnlinked}
          onClick={() => setShowUnlinked(v => !v)}>
          {showUnlinked ? 'Hide unlinked' : 'Showing linked only'}
        </button>
        {selectedEntryId && (
          <>
            <span style={{ width: 1, height: 18, background: 'var(--color-border-default, #e5e7eb)' }} aria-hidden="true" />
            <button type="button" style={btn(scope === 'global')} onClick={() => setScope('global')}>Global</button>
            <button type="button" style={btn(scope === 'local')} onClick={() => setScope('local')}>
              <CircleDot size={12} style={{ verticalAlign: '-1px', marginRight: 5 }} />Local
            </button>
            {scope === 'local' && (
              <button type="button" style={btn(false)} onClick={() => setDepth(d => (d === 1 ? 2 : 1))}
                aria-label={`Local graph depth ${depth} hop${depth === 1 ? '' : 's'}, toggle`}>
                {depth} hop{depth === 1 ? '' : 's'}
              </button>
            )}
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: secondary, fontVariantNumeric: 'tabular-nums' }}>
          {summary.count} pages · {summary.wiki} link{summary.wiki === 1 ? '' : 's'}
          {summary.sup > 0 ? ` · ${summary.sup} supersession${summary.sup === 1 ? '' : 's'}` : ''}
          {summary.orphans > 0 ? ` · ${summary.orphans} unlinked` : ''}
          {summary.broken > 0 ? ` · ${summary.broken} unresolved` : ''}
        </span>
      </div>

      {/* The canvas */}
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <SurfaceCard padding={0} style={{ overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Knowledge graph: ${summary.count} pages connected by ${summary.wiki} wikilinks and ${summary.sup} supersessions; ${summary.orphans} pages are unlinked. Use the List view for full keyboard access to the same entries.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => { setHoverId(null); setTooltip(null); dragRef.current = null }}
            style={{ display: 'block', touchAction: 'none' }}
          />
        </SurfaceCard>

        {tooltip && (
          <div style={{
            position: 'fixed', left: tooltip.x + 14, top: tooltip.y + 14, zIndex: 40,
            background: 'var(--color-bg-surface, #ffffff)', border: '1px solid var(--color-border-default, #e5e7eb)',
            borderRadius: 10, boxShadow: '0 4px 14px rgba(25,25,25,0.10)', padding: '8px 11px',
            fontFamily: 'DM Sans, sans-serif', fontSize: 12.5, pointerEvents: 'none', maxWidth: 260,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{tooltip.node.title}</div>
            <div style={{ color: secondary, fontSize: 11.5 }}>
              {CATEGORY_LABELS[tooltip.node.category] || tooltip.node.category}
              {' · '}{tooltip.node.state}
              {' · '}{tooltip.node.degree} connection{tooltip.node.degree === 1 ? '' : 's'}
              {tooltip.node.broken_count > 0 && <span style={{ color: AMBER }}> · {tooltip.node.broken_count} unresolved link{tooltip.node.broken_count === 1 ? '' : 's'}</span>}
              {tooltip.node.superseded_by && <span style={{ color: AMBER }}> · superseded</span>}
            </div>
          </div>
        )}
      </div>

      {/* Legend: category colors + the non-color state cues */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10, alignItems: 'center' }}>
        {Object.entries(CATEGORY_COLORS).map(([key, color]) => (
          <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: secondary }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} aria-hidden="true" />
            {CATEGORY_LABELS[key]}
          </span>
        ))}
        <span style={{ fontSize: 11.5, color: secondary }}>
          size = connections · hollow = draft · dashed ring = deprecated · gray = archived · dashed edge → superseded by
        </span>
      </div>
    </div>
  )
}
