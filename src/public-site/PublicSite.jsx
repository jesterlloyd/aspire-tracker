// src/public-site/PublicSite.jsx
//
// ASPIRE-PUBLIC-REDESIGN ("The Pathway"): the public marketing site served at
// / and its subpages. Lazy-loaded from App.jsx so the staff app bundle does
// not grow, and vice versa. All copy lives in publicContent.js (one
// reviewable module); all icons and decorative art in PublicIcons.jsx
// (original SVG, no third-party or AI imagery).
//
// Routing contract (binding, unchanged):
//   - / is ALWAYS the public homepage, including for authenticated users.
//   - Authenticated visitors see "Open Portal" in the header instead of
//     "Log in" (via useAuth); everyone else sees Log in, which routes to
//     /login. No data is fetched anywhere on the public site.
//
// Motion contract:
//   - Every scroll reveal and entrance is gated behind BOTH the .ps-js class
//     (added on mount) and prefers-reduced-motion: no-preference, so content
//     is never hidden without JavaScript or for reduced-motion visitors.
//   - IntersectionObserver adds .is-in once per element; the journey track
//     fill runs off a passive scroll listener with rAF batching.

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Icon, { StatBadge } from './PublicIcons'
import { celebrate } from './confetti'
import { composePublicEmail } from '../lib/outlookCompose'
import {
  SITE_NAME, SITE_TITLE, NAV_LINKS, HOME, ABOUT, ELIGIBILITY, APPLY,
  EXPERIENCE, PRECEPTORS, FAQ, CONTACT, FOOTER,
} from './publicContent'
import './publicSite.css'

// ── Illustration (approved transparent vector set) ───────────────────────────
// Each approved PNG has an organic, soft outer edge on a TRANSPARENT
// background, so it blends into the cream page with no mask, border, corner
// radius, shadow, or fade. The full composition is preserved at its natural
// aspect ratio; the CSS only scales it responsively and layers soft radial
// washes BEHIND it (never over it).
function Art({ base, alt, className = '', eager = false }) {
  return (
    <img
      className={`ps-art ${className}`}
      src={`/public-site/illustrations/${base}.png`}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  )
}

const PAGE_TITLES = {
  home:        SITE_TITLE,
  about:       'About ASPIRE | ASPIRE at Cedars-Sinai',
  eligibility: 'Eligibility | ASPIRE at Cedars-Sinai',
  apply:       'How to Apply | ASPIRE at Cedars-Sinai',
  experience:  'The Experience | ASPIRE at Cedars-Sinai',
  preceptors:  'For Preceptors | ASPIRE at Cedars-Sinai',
  faq:         'FAQ | ASPIRE at Cedars-Sinai',
  contact:     'Contact | ASPIRE at Cedars-Sinai',
}

// ── Reveal-on-scroll ──────────────────────────────────────────────────────────
// Renders any element with the .ps-rv class and adds .is-in when it enters the
// viewport (once). The hidden initial state only exists under .ps-js AND
// prefers-reduced-motion: no-preference (see CSS), so this is purely
// progressive enhancement. `delay` staggers siblings via --rv-d.
//
// Implementation note: a shared passive scroll/resize listener does the
// viewport checks directly (a handful of rect reads, only while unrevealed
// elements remain), with a low-frequency timer backstop because backgrounded
// or embedded browsers can suspend rAF, scroll events, and
// IntersectionObserver entirely. Everything detaches as soon as every
// registered element has revealed.
// Each pending entry is { el, fire }: fire flips the owning component's own
// state, so the class survives React re-renders (a manually mutated classList
// would be wiped by the next render).
const revealPending = new Set()
let revealQueued = false
let revealTimer = 0
let revealListening = false

// Some embedded/background renderers report innerHeight 0; clientHeight is
// the reliable fallback.
function viewportHeight() {
  return window.innerHeight || document.documentElement.clientHeight || 800
}

function revealStop() {
  if (!revealListening) return
  window.removeEventListener('scroll', revealSchedule)
  window.removeEventListener('resize', revealSchedule)
  window.clearInterval(revealTimer)
  revealTimer = 0
  revealListening = false
}

function revealCheck() {
  revealQueued = false
  const vh = viewportHeight()
  for (const entry of revealPending) {
    const r = entry.el.getBoundingClientRect()
    if (r.top < vh * 0.88 && r.bottom > 0) {
      revealPending.delete(entry)
      entry.fire()
    }
  }
  if (revealPending.size === 0) revealStop()
}

function revealSchedule() {
  if (revealQueued) return
  revealQueued = true
  window.setTimeout(revealCheck, 40)
}

function revealRegister(el, fire) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    fire()
    return () => {}
  }
  const entry = { el, fire }
  revealPending.add(entry)
  if (!revealListening) {
    window.addEventListener('scroll', revealSchedule, { passive: true })
    window.addEventListener('resize', revealSchedule)
    revealTimer = window.setInterval(revealCheck, 300)
    revealListening = true
  }
  revealSchedule()
  return () => {
    revealPending.delete(entry)
    if (revealPending.size === 0) revealStop()
  }
}

function Reveal({ as: Tag = 'div', className = '', delay = 0, children, ...rest }) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    return revealRegister(el, () => setInView(true))
  }, [])

  return (
    <Tag ref={ref} className={`ps-rv ${className}${inView ? ' is-in' : ''}`}
      style={delay ? { '--rv-d': `${delay}ms` } : undefined} {...rest}>
      {children}
    </Tag>
  )
}

// Small drawn pathway stroke used under section headings. Navy-to-red, echoing
// the journey track. Each instance gets its own gradient id.
function Flourish({ id }) {
  return (
    <svg className="ps-flourish" viewBox="0 0 96 14" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`ps-fl-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1D2567" />
          <stop offset="1" stopColor="#B3282D" />
        </linearGradient>
      </defs>
      <path d="M2 10 C 20 3, 38 12, 56 7 S 86 4, 94 6" stroke={`url(#ps-fl-${id})`} />
    </svg>
  )
}

// ── Header with a compact mobile menu popover ────────────────────────────────
function PublicHeader() {
  const { user } = useAuth()
  const location = useLocation()
  const [openFor, setOpenFor] = useState(null)
  const open = openFor === location.pathname
  const panelRef = useRef(null)
  const toggleRef = useRef(null)

  const close = () => {
    setOpenFor(null)
    if (toggleRef.current) toggleRef.current.focus()
  }

  useEffect(() => {
    if (!open) return undefined
    const t = setTimeout(() => panelRef.current?.querySelector('[role="menuitem"]')?.focus(), 10)
    const onKeyDown = (e) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    const onDocDown = (e) => {
      if (panelRef.current?.contains(e.target) || toggleRef.current?.contains(e.target)) return
      setOpenFor(null)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onDocDown)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onDocDown)
    }
  }, [open])

  return (
    <header className="ps-header">
      <div className="ps-header-inner">
        <Link to="/" className="ps-brand" aria-label="ASPIRE at Cedars-Sinai home">
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" width="112" height="30" />
          <span className="ps-brand-sep" aria-hidden="true" />
          <span className="ps-brand-name">ASPIRE</span>
        </Link>

        <nav className="ps-nav" aria-label="Primary">
          {NAV_LINKS.map(l => (
            <Link key={l.path} to={l.path}
              aria-current={location.pathname === l.path ? 'page' : undefined}
              className={location.pathname === l.path ? 'ps-nav-active' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ps-header-actions">
          {user
            ? <Link to="/portal" className="ps-login-btn">Open Portal</Link>
            : <Link to="/login"  className="ps-login-btn">Log in</Link>}

          <div className="ps-menu-wrap">
            <button type="button" className="ps-nav-toggle" ref={toggleRef}
              aria-haspopup="menu" aria-expanded={open} aria-controls="ps-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpenFor(v => (v === location.pathname ? null : location.pathname))}>
              <span className="ps-nav-toggle-bar" />
              <span className="ps-nav-toggle-bar" />
              <span className="ps-nav-toggle-bar" />
            </button>

            {open && (
              <div id="ps-menu" ref={panelRef} className="ps-menu" role="menu" aria-label="Site menu">
                {NAV_LINKS.map(l => (
                  <Link key={l.path} to={l.path} role="menuitem" className="ps-menu-item"
                    onClick={() => setOpenFor(null)}
                    aria-current={location.pathname === l.path ? 'page' : undefined}>
                    {l.label}
                  </Link>
                ))}
                <div className="ps-menu-foot">
                  {user
                    ? <Link to="/portal" role="menuitem" className="ps-btn ps-btn-primary ps-btn-block" onClick={() => setOpenFor(null)}>Open Portal</Link>
                    : <Link to="/login"  role="menuitem" className="ps-btn ps-btn-primary ps-btn-block" onClick={() => setOpenFor(null)}>Log in</Link>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

// Renders internal routes with the SPA Link and mailto (or other external)
// targets with a plain anchor.
function SmartLink({ to, className, children }) {
  if (typeof to === 'string' && to.startsWith('mailto:')) {
    return <a href={to} className={className}>{children}</a>
  }
  return <Link to={to} className={className}>{children}</Link>
}

function CtaLink({ cta, variant = 'text' }) {
  if (variant === 'text') {
    return (
      <SmartLink to={cta.path} className="ps-arrow-link">
        {cta.label} <span aria-hidden="true">→</span>
      </SmartLink>
    )
  }
  return <SmartLink to={cta.path} className={`ps-btn ps-btn-${variant}`}>{cta.label}</SmartLink>
}

// Email CTA for the public Preceptors and Contact pages. Uses the centralized
// compose helper (Outlook Web in a new tab for cshs.org, safe new-tab mailto
// otherwise); never navigates the current tab.
function EmailButton({ to, subject, label, variant = 'primary' }) {
  const [blocked, setBlocked] = useState(false)
  const onClick = () => {
    const res = composePublicEmail({ to, subject })
    setBlocked(!res.opened)
  }
  return (
    <div className="ps-email-cta">
      <button type="button" className={`ps-btn ps-btn-${variant}`} onClick={onClick}
        aria-label={`${label} (opens an email compose in a new tab)`}>{label}</button>
      {blocked && (
        <p className="ps-email-fallback" role="alert">
          Your browser blocked the email window. Email <span className="ps-email-addr">{to}</span> directly.
        </p>
      )}
    </div>
  )
}

// ── Home: hero ────────────────────────────────────────────────────────────────
// Editorial entrance: eyebrow, serif headline whose closing phrase carries an
// italic voice and a hand-drawn underline sweep, staged copy rise, and the
// approved hero illustration layered over a soft organic wash with the
// floating 90+ hours badge. A slim pathway scroll cue leads into the page.
function HomeHero() {
  return (
    <section className="ps-hero" aria-labelledby="ps-hero-title">
      <div className="ps-hero-inner">
        <div className="ps-hero-copy">
          <p className="ps-eyebrow">{HOME.heroEyebrow}</p>
          <h1 id="ps-hero-title" className="ps-h1 ps-hero-title">
            {HOME.heroTitleLead}
            <span className="ps-em">{HOME.heroTitleEmphasis}</span>
            <svg className="ps-hero-underline" viewBox="0 0 300 16" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="ps-hero-ul" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#1D2567" />
                  <stop offset="1" stopColor="#B3282D" />
                </linearGradient>
              </defs>
              <path d="M4 11 C 60 4, 140 14, 200 8 S 280 5, 296 8" stroke="url(#ps-hero-ul)" />
            </svg>
          </h1>
          <p className="ps-lead">{HOME.heroBody}</p>
          <div className="ps-cta-row">
            <CtaLink cta={HOME.heroPrimaryCta} variant="primary" />
            <CtaLink cta={HOME.heroSecondaryCta} variant="ghost" />
          </div>
          <p className="ps-hero-note">
            <Icon name="school" size={18} />
            {HOME.heroNote}
          </p>
        </div>
        <div className="ps-hero-art">
          <div className="ps-hero-stage">
            <Art base="hero" eager
              alt="Illustration of a diverse group of senior nursing students walking together in a Cedars-Sinai hospital environment" />
            <StatBadge className="ps-hero-badge" />
          </div>
        </div>
      </div>
      <div className="ps-scrollcue" aria-hidden="true">
        <p className="ps-scrollcue-label">{HOME.scrollCueLabel}</p>
        <span className="ps-scrollcue-line" />
      </div>
    </section>
  )
}

// ── Home: interactive pathway finder ─────────────────────────────────────────
// The four audiences become a choose-your-path selector: an accessible tablist
// on the left, a responding panel on the right. Arrow keys move and select;
// the panel re-rises gently on change (motion-gated).
function PathwayFinder() {
  const [index, setIndex] = useState(0)
  const tabRefs = useRef([])
  const count = HOME.audiences.length

  const select = (i) => {
    const next = (i + count) % count
    setIndex(next)
    tabRefs.current[next]?.focus()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); select(index + 1) }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); select(index - 1) }
    else if (e.key === 'Home') { e.preventDefault(); select(0) }
    else if (e.key === 'End') { e.preventDefault(); select(count - 1) }
  }

  const active = HOME.audiences[index]

  return (
    <div className="ps-finder">
      <div className="ps-finder-tabs" role="tablist" aria-label={HOME.audienceTitle}>
        {HOME.audiences.map((a, i) => (
          <button
            key={a.title}
            type="button"
            role="tab"
            id={`ps-ftab-${i}`}
            aria-selected={i === index}
            aria-controls="ps-fpanel"
            tabIndex={i === index ? 0 : -1}
            ref={el => { tabRefs.current[i] = el }}
            className="ps-finder-tab"
            onClick={() => setIndex(i)}
            onKeyDown={onKeyDown}
          >
            <span className="ps-finder-tab-icon"><Icon name={a.icon} /></span>
            {a.title}
            <span className="ps-finder-tab-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
      <div className="ps-finder-panel" role="tabpanel" id="ps-fpanel"
        aria-labelledby={`ps-ftab-${index}`}>
        <div className="ps-finder-panel-inner" key={active.title}>
          <h3 className="ps-finder-panel-title">{active.panelTitle || active.title}</h3>
          <p className="ps-finder-panel-body">{active.body}</p>
          <CtaLink cta={active.cta} />
        </div>
      </div>
    </div>
  )
}

// ── Home: expectation mosaic ─────────────────────────────────────────────────
// "ASPIRE at a glance" becomes an asymmetric mosaic: the 90+ hours commitment
// anchors as a navy feature cell with its ring graphic; the three remaining
// expectations sit as quieter supporting cells.
function HoursRing() {
  return (
    <svg className="ps-mosaic-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ps-ring-dark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffb3b6" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="47" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="10" />
      <circle cx="60" cy="60" r="47" fill="none" stroke="url(#ps-ring-dark)" strokeWidth="10"
        strokeLinecap="round" strokeDasharray="222 295" transform="rotate(-90 60 60)" />
      <text x="60" y="58" textAnchor="middle" fontFamily="DM Sans, sans-serif"
        fontSize="27" fontWeight="700" fill="#ffffff">90+</text>
      <text x="60" y="78" textAnchor="middle" fontFamily="DM Sans, sans-serif"
        fontSize="11.5" fontWeight="600" fill="#cdd2ea">hours</text>
    </svg>
  )
}

function ExpectationMosaic() {
  const [feature, ...rest] = HOME.glanceCards
  return (
    <div className="ps-mosaic">
      <Reveal className="ps-mosaic-hours" as="article">
        <HoursRing />
        <h3>{feature.title}</h3>
        <p>{feature.body}</p>
      </Reveal>
      {rest.map((c, i) => (
        <Reveal className="ps-mosaic-cell" as="article" key={c.title} delay={90 + i * 90}>
          <span className="ps-mosaic-icon"><Icon name={c.icon} /></span>
          <div>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </div>
        </Reveal>
      ))}
    </div>
  )
}

// ── Home: the ASPIRE journey ─────────────────────────────────────────────────
// The six steps become a vertical pathway: a track that fills navy-to-red as
// the visitor scrolls, with alternating step cards whose nodes light up as
// they enter view. On mobile the track moves to the left edge. The fill runs
// off a passive scroll listener with rAF batching; reduced-motion visitors
// see the track fully drawn.
function JourneyTimeline() {
  const wrapRef = useRef(null)
  const trackRef = useRef(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const track = trackRef.current
    if (!wrap || !track) return undefined

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      track.style.setProperty('--ps-fill', '1')
      return undefined
    }

    // Timer-scheduled (not rAF) with an interval backstop: backgrounded or
    // embedded browsers can suspend rAF and scroll events entirely.
    let queued = false
    const update = () => {
      queued = false
      const r = wrap.getBoundingClientRect()
      if (r.height <= 0) return
      const progressed = Math.min(Math.max(viewportHeight() * 0.78 - r.top, 0), r.height)
      track.style.setProperty('--ps-fill', String(progressed / r.height))
    }
    const schedule = () => {
      if (queued) return
      queued = true
      window.setTimeout(update, 40)
    }
    const timer = window.setInterval(update, 300)
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return (
    <div className="ps-journey-wrap" ref={wrapRef}>
      <div className="ps-journey-track" ref={trackRef} aria-hidden="true" />
      <ol className="ps-journey" aria-label={HOME.journeyTitle}>
        {HOME.journey.map((s, i) => (
          <Reveal as="li" className="ps-journey-step" key={s.title} delay={60}>
            <div className="ps-journey-card">
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
            <div className="ps-journey-node">
              <span className="ps-journey-num" aria-hidden="true">{i + 1}</span>
              <Icon name={s.icon} />
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  )
}

function PreceptorBand() {
  return (
    <section className="ps-band" aria-labelledby="ps-band-title">
      <div className="ps-band-inner">
        {/* Subtle Cedars-Sinai white mark watermark (approved brand asset).
            Decorative only: aria-hidden, non-interactive, understated opacity,
            sits behind the copy so it never affects contrast. */}
        <img className="ps-band-mark" src="/cs-logo-white-mark.png" alt=""
          aria-hidden="true" draggable="false" />
        <Reveal className="ps-band-copy">
          <p className="ps-eyebrow ps-eyebrow-light">{HOME.preceptorBandEyebrow}</p>
          <h2 id="ps-band-title">{HOME.preceptorBandTitle}</h2>
          <p>{HOME.preceptorBandBody}</p>
          <CtaLink cta={HOME.preceptorBandCta} variant="ondark" />
        </Reveal>
      </div>
    </section>
  )
}

function HomePage() {
  return (
    <>
      <HomeHero />

      <section className="ps-section" aria-labelledby="ps-aud-title">
        <Reveal className="ps-section-head">
          <p className="ps-eyebrow">{HOME.audienceEyebrow}</p>
          <h2 id="ps-aud-title" className="ps-h2">{HOME.audienceTitle}</h2>
          <p className="ps-section-intro">{HOME.audienceIntro}</p>
        </Reveal>
        <Reveal delay={120}>
          <PathwayFinder />
        </Reveal>
      </section>

      <section className="ps-section ps-section-white" aria-labelledby="ps-glance-title">
        <Reveal className="ps-section-head">
          <p className="ps-eyebrow">{HOME.glanceEyebrow}</p>
          <h2 id="ps-glance-title" className="ps-h2">{HOME.glanceTitle}</h2>
          <p className="ps-section-intro">{HOME.glanceIntro}</p>
        </Reveal>
        <ExpectationMosaic />
      </section>

      <section className="ps-section" aria-labelledby="ps-journey-title">
        <Reveal className="ps-section-head">
          <p className="ps-eyebrow">{HOME.journeyEyebrow}</p>
          <h2 id="ps-journey-title" className="ps-h2">{HOME.journeyTitle}</h2>
          <p className="ps-section-intro">{HOME.journeyIntro}</p>
          <Flourish id="journey" />
        </Reveal>
        <JourneyTimeline />
        <p className="ps-inline-note">{HOME.journeyNote}</p>
      </section>

      <PreceptorBand />

      <section className="ps-section" aria-labelledby="ps-faq-title">
        <div className="ps-faq-preview">
          <Reveal className="ps-faq-preview-head">
            <p className="ps-eyebrow">{HOME.faqEyebrow}</p>
            <h2 id="ps-faq-title" className="ps-h2">{HOME.faqTitle}</h2>
            <Link to="/faq" className="ps-arrow-link">{HOME.faqCtaLabel} <span aria-hidden="true">→</span></Link>
          </Reveal>
          <Reveal delay={120}>
            <FaqAccordion items={HOME.faqPreview.map(p => ({ q: p.q, a: p.a ?? FAQ.items[p.i].a }))} idPrefix="home-faq" />
          </Reveal>
        </div>
      </section>

      <section className="ps-closing" aria-labelledby="ps-closing-title">
        <Reveal className="ps-closing-inner">
          <Flourish id="closing" />
          <h2 id="ps-closing-title" className="ps-h2">{HOME.closingTitle}</h2>
          <p className="ps-closing-body">{HOME.closingBody}</p>
          <div className="ps-cta-row">
            <CtaLink cta={HOME.closingPrimaryCta} variant="primary" />
            <CtaLink cta={HOME.closingSecondaryCta} variant="ghost" />
          </div>
        </Reveal>
      </section>
    </>
  )
}

// ── Reusable page header ──────────────────────────────────────────────────────
function PageHead({ eyebrow, title, intro }) {
  const paras = Array.isArray(intro) ? intro : (intro ? [intro] : [])
  return (
    <Reveal className="ps-page-head">
      <p className="ps-eyebrow">{eyebrow}</p>
      <h1 className="ps-h1">{title}</h1>
      {paras.map((p, i) => (
        <p key={i} className={i === 0 ? 'ps-lead' : 'ps-body ps-head-extra'}>{p}</p>
      ))}
    </Reveal>
  )
}

// ── Accessible FAQ accordion (native details/summary = keyboard-ready) ────────
function FaqAccordion({ items, idPrefix }) {
  return (
    <div className="ps-faq-list">
      {items.map(item => (
        <details className="ps-faq-item" key={item.q} name={idPrefix}>
          <summary>
            <span>{item.q}</span>
            <span className="ps-faq-marker" aria-hidden="true" />
          </summary>
          <div className="ps-faq-answer"><p>{item.a}</p></div>
        </details>
      ))}
    </div>
  )
}

// ── Editorial ledger (replaces identical icon-card grids) ─────────────────────
// A two-column ledger of numbered entries divided by hairlines: serif italic
// ordinals carry the editorial rhythm, icons stay as quiet supporting marks.
function Ledger({ id, heading, items }) {
  return (
    <div className="ps-ledger" aria-labelledby={heading ? id : undefined}>
      {heading && <h2 id={id} className="ps-h3 ps-ledger-heading">{heading}</h2>}
      <div className="ps-ledger-grid">
        {items.map((d, i) => (
          <Reveal as="article" className="ps-ledger-item" key={d.title} delay={(i % 2) * 90}>
            <span className="ps-ledger-ord" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <h3><Icon name={d.icon} size={20} />{d.title}</h3>
            <p>{d.body}</p>
          </Reveal>
        ))}
      </div>
    </div>
  )
}

function AboutPage() {
  return (
    <>
      <section className="ps-section">
        <div className="ps-head-split">
          <PageHead eyebrow={ABOUT.eyebrow} title={ABOUT.title} intro={ABOUT.intro} />
          <Reveal className="ps-head-art" delay={140}>
            <Art base="about" alt={ABOUT.alt} />
          </Reveal>
        </div>
        <Ledger id="ps-about-sets-apart" heading={ABOUT.setsApartHeading} items={ABOUT.setsApart} />
      </section>

      <section className="ps-pull" aria-label="ASPIRE in one sentence">
        <Reveal as="blockquote">
          {ABOUT.pullLead}<strong>{ABOUT.pullEmphasis}</strong>{ABOUT.pullTail}
        </Reveal>
      </section>

      <section className="ps-section">
        <Ledger id="ps-about-build" heading={ABOUT.buildHeading} items={ABOUT.build} />
      </section>

      <section className="ps-section ps-prose">
        {ABOUT.sections.map((s, i) => (
          <Reveal className="ps-prose-block" key={s.heading} delay={i * 100}>
            <h2 className="ps-h2">{s.heading}</h2>
            <p className="ps-body">{s.body}</p>
          </Reveal>
        ))}
      </section>
    </>
  )
}

// ── Interactive eligibility self-check ────────────────────────────────────────
// Each requirement is an accessible checkbox with a live progress rail. When
// ALL are checked, a restrained confetti burst fires (reduced-motion honored
// inside celebrate()), an aria-live region announces completion, and the
// completion card is revealed. Self-assessment only; copy never implies it
// confirms official eligibility.
function EligibilitySelfCheck() {
  const items = ELIGIBILITY.checklist
  const [checked, setChecked] = useState(() => items.map(() => false))
  const done = checked.filter(Boolean).length
  const complete = done === items.length
  const wasComplete = useRef(false)
  const cardRef = useRef(null)

  useEffect(() => {
    if (complete && !wasComplete.current) {
      celebrate(cardRef.current)
    }
    wasComplete.current = complete
  }, [complete])

  const toggle = (i) => setChecked(prev => prev.map((v, idx) => (idx === i ? !v : v)))

  return (
    <div className="ps-selfcheck">
      <h2 className="ps-h3">{ELIGIBILITY.checklistHeading}</h2>
      <p className="ps-selfcheck-intro">{ELIGIBILITY.checklistIntro}</p>
      <div className="ps-selfcheck-progress">
        <div className="ps-selfcheck-bar" aria-hidden="true">
          <span style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
        <span className="ps-selfcheck-count">{done} of {items.length}</span>
      </div>
      <ul className="ps-check-list">
        {items.map((c, i) => (
          <li key={c}>
            <label className="ps-check-label">
              <input type="checkbox" className="ps-check-input"
                checked={checked[i]} onChange={() => toggle(i)} />
              <span className="ps-check-box" aria-hidden="true" />
              <span className="ps-check-text">{c}</span>
            </label>
          </li>
        ))}
      </ul>

      <p className="ps-visually-hidden" role="status" aria-live="polite">
        {complete ? ELIGIBILITY.ready.announce : ''}
      </p>

      {complete && (
        <div className="ps-ready-card" ref={cardRef}>
          <span className="ps-ready-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
              <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h3 className="ps-h3">{ELIGIBILITY.ready.heading}</h3>
          <p className="ps-ready-body">{ELIGIBILITY.ready.body}</p>
          <p className="ps-ready-support">{ELIGIBILITY.ready.support}</p>
          <Link to={ELIGIBILITY.ready.ctaPath} className="ps-btn ps-btn-primary">
            {ELIGIBILITY.ready.ctaLabel}
          </Link>
        </div>
      )}
    </div>
  )
}

function EligibilityPage() {
  return (
    <>
      <section className="ps-section">
        <PageHead eyebrow={ELIGIBILITY.eyebrow} title={ELIGIBILITY.title} intro={ELIGIBILITY.intro} />
        <div className="ps-split">
          <Reveal className="ps-split-main" delay={80}>
            <EligibilitySelfCheck />
          </Reveal>
          <Reveal as="aside" className="ps-split-side" aria-labelledby="ps-schools-title" delay={180}>
            <div className="ps-side-card">
              <h3>{ELIGIBILITY.programsHeading}</h3>
              <ul className="ps-plain-list">
                {ELIGIBILITY.programs.map(p => <li key={p}>{p}</li>)}
              </ul>
            </div>
            <div className="ps-side-card">
              <h3 id="ps-schools-title">{ELIGIBILITY.schoolsHeading}</h3>
              <ul className="ps-plain-list">
                {ELIGIBILITY.schools.map(s => <li key={s}>{s}</li>)}
              </ul>
              <p className="ps-side-note">{ELIGIBILITY.schoolsNote}</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="ps-section ps-elig-notes">
        <Reveal className="ps-info-note">
          <h2 className="ps-h3">{ELIGIBILITY.rotationHeading}</h2>
          <p>{ELIGIBILITY.rotationBody}</p>
        </Reveal>
        <Reveal className="ps-info-note" delay={100}>
          <h2 className="ps-h3">{ELIGIBILITY.finalHeading}</h2>
          <p>{ELIGIBILITY.requirementsNote}</p>
        </Reveal>
      </section>
    </>
  )
}

function ApplyPage() {
  return (
    <>
      <section className="ps-section">
        <PageHead eyebrow={APPLY.eyebrow} title={APPLY.title} intro={APPLY.intro} />
        <ol className="ps-steps-rail">
          {APPLY.steps.map((s, i) => (
            <Reveal as="li" className="ps-rail-step" key={s.title} delay={i * 110}>
              <span className="ps-rail-num" aria-hidden="true">{i + 1}</span>
              <div className="ps-rail-body">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
        <p className="ps-inline-note">{APPLY.placementNote}</p>
      </section>
    </>
  )
}

function ExperiencePage() {
  return (
    <>
      <section className="ps-section">
        <div className="ps-exp-hero">
          <PageHead eyebrow={EXPERIENCE.eyebrow} title={EXPERIENCE.title} intro={EXPERIENCE.intro} />
          <Reveal className="ps-exp-art" delay={140}>
            <Art base="experience" alt={EXPERIENCE.alt} />
          </Reveal>
        </div>
        <Ledger id="ps-exp-items" items={EXPERIENCE.items} />
      </section>
      <section className="ps-section ps-section-tint">
        <Reveal className="ps-continuity">
          <h2 className="ps-h2">{EXPERIENCE.continuityHeading}</h2>
          <p className="ps-body">{EXPERIENCE.continuityBody}</p>
        </Reveal>
      </section>
    </>
  )
}

function PreceptorsPage() {
  return (
    <>
      <section className="ps-section">
        <div className="ps-head-split">
          <PageHead eyebrow={PRECEPTORS.eyebrow} title={PRECEPTORS.title} intro={PRECEPTORS.intro} />
          <Reveal className="ps-head-art" delay={140}>
            <Art base="preceptors" alt={PRECEPTORS.alt} />
          </Reveal>
        </div>
        <Ledger id="ps-prec-benefits" heading={PRECEPTORS.benefitsHeading} items={PRECEPTORS.benefits} />
      </section>
      <section className="ps-section">
        <Reveal className="ps-minicta ps-minicta-col">
          <div>
            <h2 className="ps-h3">{PRECEPTORS.ctaHeading}</h2>
            <p>{PRECEPTORS.ctaBody}</p>
            <p className="ps-minicta-sub">{PRECEPTORS.ctaSupport}</p>
          </div>
          <div className="ps-minicta-actions">
            <EmailButton to={PRECEPTORS.emailAspire} subject="ASPIRE Preceptor Interest"
              label={PRECEPTORS.ctaAspireLabel} variant="primary" />
            <EmailButton to={PRECEPTORS.emailPreceptor} subject="ASPIRE Preceptor Question"
              label={PRECEPTORS.ctaPreceptorLabel} variant="ghost" />
          </div>
        </Reveal>
      </section>
    </>
  )
}

function FaqPage() {
  return (
    <section className="ps-section ps-section-narrow">
      <PageHead eyebrow={FAQ.eyebrow} title={FAQ.title} intro={FAQ.intro} />
      <Reveal delay={100}>
        <FaqAccordion items={FAQ.items} idPrefix="faq-page" />
      </Reveal>
    </section>
  )
}

function ContactPage() {
  return (
    <>
      <section className="ps-section ps-contact-hero">
        <PageHead eyebrow={CONTACT.eyebrow} title={CONTACT.title} intro={CONTACT.intro} />
      </section>

      <section className="ps-section ps-contact-cards-section">
        <div className="ps-choose-grid">
          {CONTACT.cards.map((c, i) => (
            <Reveal as="article" className="ps-choose-card" key={c.title} delay={i * 100}>
              <span className="ps-contact-icon"><Icon name={c.icon} /></span>
              <h2 className="ps-choose-title">{c.title}</h2>
              <p>{c.body}</p>
              <SmartLink to={c.cta.path} className="ps-btn ps-btn-primary ps-btn-block ps-choose-cta">{c.cta.label}</SmartLink>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="ps-signin-band" aria-labelledby="ps-signin-title">
        <div className="ps-signin-inner">
          <div className="ps-signin-copy">
            <span className="ps-signin-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
                <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
                <circle cx="12" cy="15.4" r="1.3" />
              </svg>
            </span>
            <div>
              <h2 id="ps-signin-title" className="ps-signin-heading">{CONTACT.signin.heading}</h2>
              <p className="ps-signin-body">{CONTACT.signin.body}</p>
            </div>
          </div>
          <Link to={CONTACT.signin.ctaPath} className="ps-btn ps-btn-ondark ps-signin-cta">{CONTACT.signin.ctaLabel}</Link>
        </div>
      </section>

      <section className="ps-section">
        <div className="ps-contact-direct">
          {[CONTACT.direct.aspire, CONTACT.direct.preceptor].map((col, i) => (
            <Reveal className="ps-contact-col" key={col.email} delay={i * 100}>
              <h2 className="ps-h3">{col.heading}</h2>
              <p className="ps-body">{col.body}</p>
              <p className="ps-contact-addr">{col.email}</p>
              <EmailButton to={col.email} subject="ASPIRE Inquiry" label={col.ctaLabel} variant="primary" />
            </Reveal>
          ))}
        </div>

        <p className="ps-guidance-strip">{CONTACT.guidance}</p>
      </section>
    </>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────
function PublicFooter() {
  return (
    <footer className="ps-footer">
      <div className="ps-footer-tagline">
        <p>{FOOTER.tagline}</p>
      </div>
      <div className="ps-footer-inner">
        <div className="ps-footer-brand">
          <div className="ps-brand">
            <img src="/cs-logo-rev.png" alt="Cedars-Sinai" width="112" height="30" />
            <span className="ps-brand-sep" aria-hidden="true" />
            <span className="ps-brand-name">ASPIRE</span>
          </div>
        </div>
        <nav className="ps-footer-cols" aria-label="Footer">
          {FOOTER.columns.map(col => (
            <div className="ps-footer-col" key={col.heading}>
              <h3>{col.heading}</h3>
              <ul>
                {col.links.map((l, i) => (
                  <li key={`${l.path}-${l.label}-${i}`}><Link to={l.path}>{l.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
          <div className="ps-footer-col">
            <h3>{FOOTER.contactHeading}</h3>
            <ul>
              <li>
                <Link to={FOOTER.contactCta.path} className="ps-arrow-link">
                  {FOOTER.contactCta.label} <span aria-hidden="true">→</span>
                </Link>
              </li>
              <li>
                <a href={`mailto:${FOOTER.contactEmail}`}>{FOOTER.contactEmail}</a>
              </li>
            </ul>
          </div>
        </nav>
      </div>
      <div className="ps-footer-legal">
        <p>{FOOTER.disclaimer}</p>
        <p>{FOOTER.attribution}</p>
      </div>
    </footer>
  )
}

const PAGES = {
  home:        HomePage,
  about:       AboutPage,
  eligibility: EligibilityPage,
  apply:       ApplyPage,
  experience:  ExperiencePage,
  preceptors:  PreceptorsPage,
  faq:         FaqPage,
  contact:     ContactPage,
}

export default function PublicSite({ page = 'home' }) {
  const Page = PAGES[page] || HomePage
  const { pathname } = useLocation()
  const rootRef = useRef(null)

  // .ps-js gates every hidden initial state: without JS (or before hydration)
  // all content renders fully visible. Added as a direct DOM class (the
  // className prop stays constant, so React never rewrites it away).
  useEffect(() => { rootRef.current?.classList.add('ps-js') }, [])

  useEffect(() => {
    document.title = PAGE_TITLES[page] || SITE_NAME
  }, [page])

  // New page, top of page (SPA navigation preserves scroll otherwise).
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  return (
    <div ref={rootRef} className="ps-root">
      <a href="#ps-main" className="ps-skip-link">Skip to content</a>
      <PublicHeader />
      <main className="ps-main" id="ps-main"><Page /></main>
      <PublicFooter />
    </div>
  )
}
