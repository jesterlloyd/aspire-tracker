// src/public-site/confetti.js
//
// A tiny, dependency-free, one-shot confetti burst for the eligibility
// self-check completion. Canvas-based so it never affects layout or causes
// horizontal overflow; self-removes when the animation ends. No external
// libraries (CSP-safe). Honors prefers-reduced-motion by doing nothing.

const COLORS = ['#1D2567', '#B3282D', '#26307a', '#ff9ea1', '#c9a227']

export function celebrate(anchorEl) {
  if (typeof window === 'undefined') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '70',
  })
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.floor(window.innerWidth * dpr)
  canvas.height = Math.floor(window.innerHeight * dpr)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  document.body.appendChild(canvas)

  // Origin: center of the completion card if we have one, else screen center.
  let ox = window.innerWidth / 2
  let oy = window.innerHeight * 0.4
  if (anchorEl && anchorEl.getBoundingClientRect) {
    const r = anchorEl.getBoundingClientRect()
    ox = r.left + r.width / 2
    oy = r.top + Math.min(r.height / 2, 120)
  }

  const N = 90
  const particles = Array.from({ length: N }, (_, i) => {
    const angle = (Math.PI * 2 * i) / N + (i % 5) * 0.03
    const speed = 4 + (i % 7)
    return {
      x: ox, y: oy,
      vx: Math.cos(angle) * speed * (0.6 + (i % 3) * 0.2),
      vy: Math.sin(angle) * speed - 3,
      size: 5 + (i % 4),
      rot: i, vr: (i % 2 ? 1 : -1) * (0.1 + (i % 5) * 0.03),
      color: COLORS[i % COLORS.length],
      life: 0,
    }
  })

  const GRAVITY = 0.16
  const MAX_LIFE = 150
  let raf = 0

  const tick = () => {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    let alive = false
    for (const p of particles) {
      p.life += 1
      if (p.life > MAX_LIFE) continue
      alive = true
      p.vy += GRAVITY
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - p.life / MAX_LIFE)
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
      ctx.restore()
    }
    if (alive) {
      raf = window.requestAnimationFrame(tick)
    } else {
      window.cancelAnimationFrame(raf)
      canvas.remove()
    }
  }
  raf = window.requestAnimationFrame(tick)
}
