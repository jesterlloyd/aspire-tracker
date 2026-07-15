// src/public-site/PublicSite.jsx
//
// PHASE1-PUBLIC-SITE (elevated): the public marketing site served at / and its
// subpages. Lazy-loaded from App.jsx so the staff app bundle does not grow, and
// vice versa. All copy lives in publicContent.js (one reviewable module); all
// icons and decorative art in PublicIcons.jsx (original SVG, no third-party or
// AI imagery).
//
// Routing contract (binding, unchanged):
//   - / is ALWAYS the public homepage, including for authenticated users.
//   - Authenticated visitors see "Open Portal" in the header instead of
//     "Log in" (via useAuth); everyone else sees Log in, which routes to
//     /login. No data is fetched anywhere on the public site.

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Icon from './PublicIcons'
import { celebrate } from './confetti'
import { composePublicEmail } from '../lib/outlookCompose'
import {
  SITE_NAME, SITE_TITLE, NAV_LINKS, HOME, ABOUT, ELIGIBILITY, APPLY,
  EXPERIENCE, PRECEPTORS, FAQ, CONTACT, FOOTER,
} from './publicContent'
import './publicSite.css'

// ── Illustration (approved transparent vector set) ───────────────────────────
// Each approved PNG has an organic, soft outer edge on a TRANSPARENT background,
// so it blends into the cream page with no mask, border, corner radius, shadow,
// or fade. The full composition (every student, badge, hand, and Cedars-Sinai
// context) is preserved at its natural aspect ratio; the CSS only scales it
// responsively. The alpha channel is kept (PNG, never JPEG, which would show a
// rectangle).
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

// ── Header with a compact mobile menu popover ────────────────────────────────
// The desktop header is unchanged (inline nav + Open Portal/Log in). On mobile
// the closed header shows only the compact Cedars-Sinai + ASPIRE brand and one
// hamburger button; every navigation link and the emphasized Open Portal action
// live inside a compact right-aligned dropdown popover (the same interaction
// scale/quality as the Student Portal profile menu). The popover leaves the page
// visible behind it and closes on Escape, an outside click, route selection, or
// the toggle, returning focus to the hamburger.
function PublicHeader() {
  const { user } = useAuth()
  const location = useLocation()
  // Key the open state to the current path: any navigation yields a fresh
  // false without a cascading setState-in-effect.
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
    // Compact popover: focus the first item, close on Escape (return focus) or
    // an outside click. No scroll lock and no modal; the page stays visible.
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
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <header className="ps-header">
      <div className="ps-header-inner">
        <Link to="/" className="ps-brand" aria-label="ASPIRE at Cedars-Sinai home">
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" width="112" height="30" />
          <span className="ps-brand-sep" aria-hidden="true" />
          <span className="ps-brand-name">ASPIRE</span>
        </Link>

        {/* Desktop inline nav (unchanged) */}
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
          {/* Desktop-only inline action; hidden on mobile (moves into the menu). */}
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
// targets with a plain anchor, so approved email CTAs behave like normal
// public-website email links.
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
// otherwise); never navigates the current tab. If the browser blocks the popup,
// a brief, keyboard-reachable fallback shows the address as selectable text.
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

// ── Home ──────────────────────────────────────────────────────────────────────
function HomePage() {
  return (
    <>
      <section className="ps-hero" aria-labelledby="ps-hero-title">
        <div className="ps-hero-inner">
          <div className="ps-hero-copy">
            <p className="ps-eyebrow">{HOME.heroEyebrow}</p>
            <h1 id="ps-hero-title" className="ps-h1">{HOME.heroTitle}</h1>
            <p className="ps-lead">{HOME.heroBody}</p>
            <div className="ps-cta-row">
              <CtaLink cta={HOME.heroPrimaryCta} variant="primary" />
              <CtaLink cta={HOME.heroSecondaryCta} variant="ghost" />
            </div>
          </div>
          <div className="ps-hero-art">
            <div className="ps-hero-figure">
              <Art base="hero" eager
                alt="Illustration of a diverse group of senior nursing students walking together in a Cedars-Sinai hospital environment" />
            </div>
          </div>
        </div>
      </section>

      <section className="ps-section" aria-labelledby="ps-aud-title">
        <div className="ps-section-head">
          <h2 id="ps-aud-title" className="ps-h2">{HOME.audienceTitle}</h2>
          <p className="ps-section-intro">{HOME.audienceIntro}</p>
        </div>
        <div className="ps-audience-grid">
          {HOME.audiences.map(a => (
            <article className="ps-audience-card" key={a.title}>
              <span className="ps-audience-icon"><Icon name={a.icon} /></span>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
              <CtaLink cta={a.cta} />
            </article>
          ))}
        </div>
      </section>

      <section className="ps-section ps-section-tint" aria-labelledby="ps-glance-title">
        <div className="ps-section-head">
          <h2 id="ps-glance-title" className="ps-h2">{HOME.glanceTitle}</h2>
          <p className="ps-section-intro">{HOME.glanceIntro}</p>
        </div>
        <div className="ps-glance-grid">
          {HOME.glanceCards.map(c => (
            <article className="ps-glance-card" key={c.title}>
              <span className="ps-glance-icon"><Icon name={c.icon} /></span>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ps-section" aria-labelledby="ps-journey-title">
        <div className="ps-section-head">
          <h2 id="ps-journey-title" className="ps-h2">{HOME.journeyTitle}</h2>
          <p className="ps-section-intro">{HOME.journeyIntro}</p>
        </div>
        <Journey />
        <p className="ps-inline-note">{HOME.journeyNote}</p>
      </section>

      <PreceptorBand />

      <section className="ps-section" aria-labelledby="ps-faq-title">
        <div className="ps-section-head ps-section-head-row">
          <h2 id="ps-faq-title" className="ps-h2">{HOME.faqTitle}</h2>
          <Link to="/faq" className="ps-arrow-link">{HOME.faqCtaLabel} <span aria-hidden="true">→</span></Link>
        </div>
        <FaqAccordion items={HOME.faqPreview.map(p => ({ q: p.q, a: p.a ?? FAQ.items[p.i].a }))} idPrefix="home-faq" />
      </section>
    </>
  )
}

// ── ASPIRE journey ────────────────────────────────────────────────────────────
// Desktop: the six steps render as the familiar grid rail. Mobile: the SAME
// list becomes a horizontally swipeable scroll-snap stepper (one card at a
// time) with previous/next controls, a segmented progress rail, and a
// "Step X of 6" live region, so the journey no longer stacks into a tall
// six-card column. The list semantics are unchanged for screen readers; the
// controls are a visual affordance layered on top. Smooth scrolling defers to
// prefers-reduced-motion.
function Journey() {
  const scrollerRef = useRef(null)
  const [index, setIndex] = useState(0)
  const count = HOME.journey.length

  const currentIndex = () => {
    const el = scrollerRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return 0
    const progress = el.scrollLeft / (el.scrollWidth - el.clientWidth)
    return Math.round(progress * (count - 1))
  }

  const onScroll = () => {
    const next = currentIndex()
    setIndex(prev => (prev === next ? prev : next))
  }

  const scrollToStep = (i) => {
    const el = scrollerRef.current
    if (!el) return
    const clamped = Math.max(0, Math.min(count - 1, i))
    const target = (el.scrollWidth - el.clientWidth) * (clamped / (count - 1))
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div className="ps-journey-wrap">
      <ol className="ps-journey" ref={scrollerRef} onScroll={onScroll} tabIndex={0}
        aria-label={HOME.journeyTitle}>
        {HOME.journey.map((s, i) => (
          <li className="ps-journey-step" key={s.title}>
            <div className="ps-journey-node">
              <span className="ps-journey-num">{i + 1}</span>
              <span className="ps-journey-icon"><Icon name={s.icon} /></span>
            </div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="ps-journey-controls">
        <button type="button" className="ps-journey-btn" onClick={() => scrollToStep(index - 1)}
          disabled={index === 0} aria-label="Previous step">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ps-journey-progress">
          <span className="ps-journey-count" aria-live="polite">Step {index + 1} of {count}</span>
          <div className="ps-journey-rail" aria-hidden="true">
            {HOME.journey.map((s, i) => (
              <button type="button" key={s.title} tabIndex={-1}
                className={`ps-journey-seg ${i === index ? 'ps-journey-seg-on' : ''}`}
                onClick={() => scrollToStep(i)} aria-label={`Go to step ${i + 1}`} />
            ))}
          </div>
        </div>
        <button type="button" className="ps-journey-btn" onClick={() => scrollToStep(index + 1)}
          disabled={index === count - 1} aria-label="Next step">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function PreceptorBand() {
  return (
    <section className="ps-band" aria-labelledby="ps-band-title">
      <div className="ps-band-inner">
        {/* Subtle Cedars-Sinai white mark watermark (approved brand asset),
            replacing the former generic outlined circle. Decorative only:
            aria-hidden, non-interactive, understated opacity, sits behind the
            copy (z-index below .ps-band-copy) so it never affects contrast. */}
        <img className="ps-band-mark" src="/cs-logo-white-mark.png" alt=""
          aria-hidden="true" draggable="false" />
        <div className="ps-band-copy">
          <p className="ps-eyebrow ps-eyebrow-light">{HOME.preceptorBandEyebrow}</p>
          <h2 id="ps-band-title">{HOME.preceptorBandTitle}</h2>
          <p>{HOME.preceptorBandBody}</p>
          <CtaLink cta={HOME.preceptorBandCta} variant="ondark" />
        </div>
      </div>
    </section>
  )
}

// ── Reusable page header ──────────────────────────────────────────────────────
function PageHead({ eyebrow, title, intro }) {
  const paras = Array.isArray(intro) ? intro : (intro ? [intro] : [])
  return (
    <div className="ps-page-head">
      <p className="ps-eyebrow">{eyebrow}</p>
      <h1 className="ps-h1">{title}</h1>
      {paras.map((p, i) => (
        <p key={i} className={i === 0 ? 'ps-lead' : 'ps-body ps-head-extra'}>{p}</p>
      ))}
    </div>
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

function FeatureGrid({ id, heading, items }) {
  return (
    <div className="ps-about-build" aria-labelledby={id}>
      <h2 id={id} className="ps-h3">{heading}</h2>
      <div className="ps-feature-grid">
        {items.map(d => (
          <article className="ps-feature-card" key={d.title}>
            <span className="ps-feature-icon"><Icon name={d.icon} /></span>
            <h3>{d.title}</h3>
            <p>{d.body}</p>
          </article>
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
          <div className="ps-head-art">
            <Art base="about" alt={ABOUT.alt} />
          </div>
        </div>

        <FeatureGrid id="ps-about-sets-apart" heading={ABOUT.setsApartHeading} items={ABOUT.setsApart} />
        <FeatureGrid id="ps-about-build" heading={ABOUT.buildHeading} items={ABOUT.build} />
      </section>

      <section className="ps-section ps-prose">
        {ABOUT.sections.map(s => (
          <div className="ps-prose-block" key={s.heading}>
            <h2 className="ps-h2">{s.heading}</h2>
            <p className="ps-body">{s.body}</p>
          </div>
        ))}
      </section>
    </>
  )
}

// ── Interactive eligibility self-check ────────────────────────────────────────
// Each requirement is an accessible checkbox. When ALL are checked, a restrained
// confetti burst fires (reduced-motion honored inside celebrate()), an aria-live
// region announces completion, and the completion card is revealed. This is a
// self-assessment only; copy never implies it confirms official eligibility.
function EligibilitySelfCheck() {
  const items = ELIGIBILITY.checklist
  const [checked, setChecked] = useState(() => items.map(() => false))
  const complete = checked.every(Boolean)
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

      {/* Polite live region: announces completion without stealing focus. */}
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
          <h3>{ELIGIBILITY.ready.heading}</h3>
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
          {/* Left: self-check. Right: programs card, then affiliate-schools
              card directly below it, same card style (no full-width band). */}
          <div className="ps-split-main">
            <EligibilitySelfCheck />
          </div>
          <aside className="ps-split-side" aria-labelledby="ps-schools-title">
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
          </aside>
        </div>
      </section>

      <section className="ps-section ps-elig-notes">
        <div className="ps-info-note">
          <h2 className="ps-h3">{ELIGIBILITY.rotationHeading}</h2>
          <p>{ELIGIBILITY.rotationBody}</p>
        </div>
        <div className="ps-info-note">
          <h2 className="ps-h3">{ELIGIBILITY.finalHeading}</h2>
          <p>{ELIGIBILITY.requirementsNote}</p>
        </div>
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
            <li className="ps-rail-step" key={s.title}>
              <span className="ps-rail-num">{i + 1}</span>
              <div className="ps-rail-body">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
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
          <div className="ps-exp-art">
            <Art base="experience" alt={EXPERIENCE.alt} />
          </div>
        </div>
        <div className="ps-feature-grid">
          {EXPERIENCE.items.map(b => (
            <article className="ps-feature-card" key={b.title}>
              <span className="ps-feature-icon"><Icon name={b.icon} /></span>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="ps-section ps-section-tint">
        <div className="ps-continuity">
          <h2 className="ps-h2">{EXPERIENCE.continuityHeading}</h2>
          <p className="ps-body">{EXPERIENCE.continuityBody}</p>
        </div>
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
          <div className="ps-head-art">
            <Art base="preceptors" alt={PRECEPTORS.alt} />
          </div>
        </div>
        <h2 className="ps-h3">{PRECEPTORS.benefitsHeading}</h2>
        <div className="ps-feature-grid">
          {PRECEPTORS.benefits.map(b => (
            <article className="ps-feature-card" key={b.title}>
              <span className="ps-feature-icon"><Icon name={b.icon} /></span>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="ps-section">
        <div className="ps-minicta ps-minicta-col">
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
        </div>
      </section>
    </>
  )
}

function FaqPage() {
  return (
    <section className="ps-section ps-section-narrow">
      <PageHead eyebrow={FAQ.eyebrow} title={FAQ.title} intro={FAQ.intro} />
      <FaqAccordion items={FAQ.items} idPrefix="faq-page" />
    </section>
  )
}

function ContactPage() {
  return (
    <>
      {/* 1. Compact hero (no illustration on Contact) */}
      <section className="ps-section ps-contact-hero">
        <PageHead eyebrow={CONTACT.eyebrow} title={CONTACT.title} intro={CONTACT.intro} />
      </section>

      {/* 2. Choose your path: three equal audience cards */}
      <section className="ps-section ps-contact-cards-section">
        <div className="ps-choose-grid">
          {CONTACT.cards.map(c => (
            <article className="ps-choose-card" key={c.title}>
              <span className="ps-contact-icon"><Icon name={c.icon} /></span>
              <h2 className="ps-choose-title">{c.title}</h2>
              <p>{c.body}</p>
              <SmartLink to={c.cta.path} className="ps-btn ps-btn-primary ps-btn-block ps-choose-cta">{c.cta.label}</SmartLink>
            </article>
          ))}
        </div>
      </section>

      {/* 3. Distinct portal sign-in banner (full-width navy) */}
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

      {/* 4. Direct contact: two email columns */}
      <section className="ps-section">
        <div className="ps-contact-direct">
          {[CONTACT.direct.aspire, CONTACT.direct.preceptor].map(col => (
            <div className="ps-contact-col" key={col.email}>
              <h2 className="ps-h3">{col.heading}</h2>
              <p className="ps-body">{col.body}</p>
              <p className="ps-contact-addr">{col.email}</p>
              <EmailButton to={col.email} subject="ASPIRE Inquiry" label={col.ctaLabel} variant="primary" />
            </div>
          ))}
        </div>

        {/* 5. Guidance strip */}
        <p className="ps-guidance-strip">{CONTACT.guidance}</p>
      </section>
    </>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────
function PublicFooter() {
  return (
    <footer className="ps-footer">
      <div className="ps-footer-inner">
        <div className="ps-footer-brand">
          <div className="ps-brand">
            <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" width="112" height="30" />
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

  useEffect(() => {
    document.title = PAGE_TITLES[page] || SITE_NAME
  }, [page])

  // New page, top of page (SPA navigation preserves scroll otherwise).
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  return (
    <div className="ps-root">
      <a href="#ps-main" className="ps-skip-link">Skip to content</a>
      <PublicHeader />
      <main className="ps-main" id="ps-main"><Page /></main>
      <PublicFooter />
    </div>
  )
}
