// KEITH-HUMANIZER-1 (Owner, 2026-11-13): the Clever AI humanizer widget, mounted without loading
// the vendor's script into the staff app.
//
// The vendor's embed is `<script src="https://widgets.cleverhumanizer.ai/widget.js">`. That script
// is served `cache-control: no-store` and would run inside this app's own origin, where it could
// read anything a signed-in staff member can. All it does is build a sandboxed frame to the
// vendor's site and talk to it by postMessage, so this module is that loader, read on 2026-11-13
// and pinned here: the frame is cross-origin and sandboxed, and no vendor code runs in the app.
// If the vendor changes the handshake, the frame stops answering and the notice below shows;
// re-read their loader and bring this file up to date.
//
// The handshake: the host posts `clever:init` on load; the frame posts `clever:resize` with its
// height, and `clever:credit` with the boxes of its credit lines, which the host answers with what
// the page does to the frame (hidden, masked, cropped, covered). That answer is reported as it is.
//
// The embed page only allows itself to be framed by the production site (its own
// frame-ancestors), so on localhost the notice is what shows.

export const CLEVER_ORIGIN = 'https://widgets.cleverhumanizer.ai'

const MASKS = ['mask-image', '-webkit-mask-image', 'clip-path', '-webkit-mask-box-image', '-webkit-mask-box-image-source', 'mask-border', 'mask-border-source']
const LIFT = ':not(#clever-x)'.repeat(12)
const GRACE_MS = 1500

export function isCleverWidgetId(id) {
  return /^[a-f0-9]{32}$/.test(String(id || ''))
}

export function cleverEmbedUrl(id, theme) {
  if (!isCleverWidgetId(id)) return null
  const url = new URL('/embed/' + id, CLEVER_ORIGIN)
  if (/^(light|dark|auto)$/.test(theme || '')) url.searchParams.set('theme', theme)
  return url.href
}

function alpha(color) {
  if (!color || color === 'transparent') return 0
  const m = color.match(/\/\s*([\d.]+)(%?)\s*\)$/) || color.match(/^rgba\((?:[^,]+,){3}\s*([\d.]+)(%?)\s*\)$/)
  return m ? parseFloat(m[1]) / (m[2] ? 100 : 1) : 1
}

function inked(css) {
  return css.visibility !== 'hidden' && parseFloat(css.opacity) !== 0 && (
    css.backgroundImage !== 'none' || alpha(css.backgroundColor) > 0 || css.boxShadow !== 'none' ||
    ['Top', 'Right', 'Bottom', 'Left'].some(side => css['border' + side + 'Style'] !== 'none' && parseFloat(css['border' + side + 'Width']) > 0 && alpha(css['border' + side + 'Color']) > 0))
}

function paints(el) {
  if (/^(IMG|CANVAS|VIDEO|SVG|PICTURE|OBJECT|EMBED|IFRAME)$/i.test(el.tagName)) return true
  if (inked(getComputedStyle(el))) return true
  if (Array.from(el.childNodes).some(n => n.nodeType === 3 && n.nodeValue.trim())) return true
  return ['::before', '::after'].some(pseudo => {
    const css = getComputedStyle(el, pseudo)
    if (css.content === 'none' || css.content === 'normal') return false
    return inked(css) || (/^"(.+)"$/.test(css.content) && css.content.trim() !== '""')
  })
}

// The hit test again with pointer-events lifted, so an overlay that lets clicks through still counts.
function overlaid(frame, points) {
  const rule = `${LIFT},${LIFT}::before,${LIFT}::after{pointer-events:auto!important}`
  let sheet = null
  let lift = null
  try {
    try {
      sheet = new CSSStyleSheet()
      sheet.replaceSync(rule)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    } catch {
      sheet = null
      lift = document.createElement('style')
      lift.textContent = rule
      document.head.append(lift)
    }
    return points.map(p => {
      const stack = document.elementsFromPoint(p.x, p.y)
      const depth = stack.indexOf(frame)
      return depth < 0 || stack.slice(0, depth).some(paints)
    })
  } finally {
    if (sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== sheet)
    if (lift) lift.remove()
  }
}

function outlined(css, box, x, y) {
  if (css.outlineStyle === 'none' || alpha(css.outlineColor) === 0) return false
  const width = parseFloat(css.outlineWidth) || 0
  const inward = -(parseFloat(css.outlineOffset) || 0)
  if (width <= 0 || inward <= 0) return false
  const edge = Math.min(x - box.left, box.right - x, y - box.top, box.bottom - y)
  return edge < inward && edge > inward - width
}

// What the page does to the frame, for the boxes the frame asks about.
function inspect(frame, rects) {
  const box = frame.getBoundingClientRect()
  const scale = frame.clientWidth ? box.width / frame.clientWidth : 1
  let opacity = 1
  let masked = false
  let hidden = false
  const filters = []
  let clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
  const frameCss = getComputedStyle(frame)
  for (let el = frame; el; el = el.parentElement) {
    const css = el === frame ? frameCss : getComputedStyle(el)
    opacity *= parseFloat(css.opacity) || 0
    if (css.visibility === 'hidden' || css.display === 'none') hidden = true
    if (MASKS.some(name => { const v = css.getPropertyValue(name); return v && v !== 'none' }) || (css.clip !== 'auto' && css.position === 'absolute')) masked = true
    if (css.filter && css.filter !== 'none') filters.push(css.filter)
    if (el !== frame && el !== document.body && el !== document.documentElement &&
        (css.overflowX !== 'visible' || css.overflowY !== 'visible' || /paint|strict|content/.test(css.contain))) {
      const b = el.getBoundingClientRect()
      clip = { left: Math.max(clip.left, b.left), top: Math.max(clip.top, b.top), right: Math.min(clip.right, b.right), bottom: Math.min(clip.bottom, b.bottom) }
    }
  }
  const points = rects.map(r => {
    const x = box.left + (r.x + r.width / 2) * scale
    const y = box.top + (r.y + r.height / 2) * scale
    const offscreen = x < 0 || y < 0 || x > innerWidth || y > innerHeight
    const clipped = x < clip.left || x > clip.right || y < clip.top || y > clip.bottom
    const inView = !offscreen && !clipped
    return { x, y, offscreen, clipped, inView, covered: inView && (document.elementsFromPoint(x, y)[0] !== frame || outlined(frameCss, box, x, y)) }
  })
  const pending = points.filter(p => p.inView && !p.covered)
  if (pending.length) overlaid(frame, pending).forEach((over, i) => { pending[i].covered = over })
  return {
    masked, hidden, opacity, filter: filters.join(' '), scale,
    offscreen: points.some(p => p.offscreen), cropped: points.some(p => p.clipped), covered: points.some(p => p.covered),
  }
}

// Mounts the widget's frame in `node`. `onState` hears 'loading', 'ready' or 'unavailable'.
// Returns the function that takes it out again.
export function mountCleverWidget(node, { id, theme = 'light', scheme = 'light', label = 'Clever AI widget', onState } = {}) {
  const src = cleverEmbedUrl(id, theme)
  if (!node || !src) { onState?.('unavailable'); return () => {} }

  const channel = Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2, '0')).join('')
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-label', label)
  frame.className = 'clever-frame'
  frame.style.height = '540px'
  frame.style.opacity = '0'
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox')
  frame.setAttribute('allow', 'clipboard-write')
  frame.referrerPolicy = 'origin'

  let grace = null
  let answered = false
  onState?.('loading')

  const onLoad = () => {
    frame.contentWindow?.postMessage({ type: 'clever:init', channel, scheme }, CLEVER_ORIGIN)
    clearTimeout(grace)
    // A frame that loads and never answers is showing an error (removed, not allowed here, down).
    grace = setTimeout(() => { if (!answered) { frame.style.display = 'none'; onState?.('unavailable') } }, GRACE_MS)
  }

  const receive = event => {
    if (event.source !== frame.contentWindow || event.origin !== CLEVER_ORIGIN || event.data?.channel !== channel) return
    if (event.data.type === 'clever:credit') {
      const rects = Array.isArray(event.data.rects)
        ? event.data.rects.slice(0, 10).map(r => ({ x: +r.x || 0, y: +r.y || 0, width: +r.width || 0, height: +r.height || 0 }))
        : []
      let report
      try { report = inspect(frame, rects) } catch { report = null }
      frame.contentWindow?.postMessage({ type: 'clever:host', channel, report }, CLEVER_ORIGIN)
      return
    }
    if (event.data.type !== 'clever:resize') return
    const height = event.data.height
    if (Number.isFinite(height) && height >= 100 && height <= 20000) {
      answered = true
      clearTimeout(grace)
      frame.style.display = 'block'
      frame.style.height = height + 'px'
      frame.style.opacity = '1'
      onState?.('ready')
    }
  }

  frame.addEventListener('load', onLoad)
  window.addEventListener('message', receive)
  frame.src = src
  node.append(frame)

  return () => {
    clearTimeout(grace)
    frame.removeEventListener('load', onLoad)
    window.removeEventListener('message', receive)
    frame.remove()
  }
}
