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

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Icon, { HeroArt, LoopMotif } from './PublicIcons'
import {
  SITE_NAME, SITE_TITLE, NAV_LINKS, HOME, ABOUT, ELIGIBILITY, APPLY,
  EXPERIENCE, PRECEPTORS, FAQ, CONTACT, FOOTER,
} from './publicContent'
import './publicSite.css'

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

// ── Header with accessible mobile nav ─────────────────────────────────────────
function PublicHeader() {
  const { user } = useAuth()
  const location = useLocation()
  // Key the open state to the current path: any navigation yields a fresh
  // false without a cascading setState-in-effect.
  const [openFor, setOpenFor] = useState(null)
  const open = openFor === location.pathname

  return (
    <header className="ps-header">
      <div className="ps-header-inner">
        <Link to="/" className="ps-brand" aria-label="ASPIRE at Cedars-Sinai home">
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" width="112" height="30" />
          <span className="ps-brand-sep" aria-hidden="true" />
          <span className="ps-brand-name">ASPIRE</span>
        </Link>

        <nav className={`ps-nav ${open ? 'ps-nav-open' : ''}`} aria-label="Primary" id="ps-primary-nav">
          {NAV_LINKS.map(l => (
            <Link key={l.path} to={l.path}
              aria-current={location.pathname === l.path ? 'page' : undefined}
              className={location.pathname === l.path ? 'ps-nav-active' : undefined}>
              {l.label}
            </Link>
          ))}
          {user
            ? <Link to="/portal" className="ps-login-btn ps-login-btn-mobile">Open Portal</Link>
            : <Link to="/login"  className="ps-login-btn ps-login-btn-mobile">Log in</Link>}
        </nav>

        <div className="ps-header-actions">
          {user
            ? <Link to="/portal" className="ps-login-btn">Open Portal</Link>
            : <Link to="/login"  className="ps-login-btn">Log in</Link>}
          <button type="button" className="ps-nav-toggle"
            aria-expanded={open} aria-controls="ps-primary-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpenFor(v => (v === location.pathname ? null : location.pathname))}>
            <span className="ps-nav-toggle-bar" />
            <span className="ps-nav-toggle-bar" />
            <span className="ps-nav-toggle-bar" />
          </button>
        </div>
      </div>
    </header>
  )
}

function CtaLink({ cta, variant = 'text' }) {
  if (variant === 'text') {
    return (
      <Link to={cta.path} className="ps-arrow-link">
        {cta.label} <span aria-hidden="true">→</span>
      </Link>
    )
  }
  return <Link to={cta.path} className={`ps-btn ps-btn-${variant}`}>{cta.label}</Link>
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
            <p className="ps-hero-trust">{HOME.heroTrust}</p>
          </div>
          <div className="ps-hero-art" aria-hidden="false">
            <HeroArt className="ps-hero-illustration" />
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
              {c.stat && <div className="ps-glance-stat">{c.stat}</div>}
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </article>
          ))}
        </div>
        <p className="ps-inline-note">{HOME.glanceNote}</p>
      </section>

      <section className="ps-section" aria-labelledby="ps-journey-title">
        <div className="ps-section-head">
          <h2 id="ps-journey-title" className="ps-h2">{HOME.journeyTitle}</h2>
          <p className="ps-section-intro">{HOME.journeyIntro}</p>
        </div>
        <ol className="ps-journey">
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
        <p className="ps-inline-note">{HOME.journeyNote}</p>
      </section>

      <PreceptorBand />

      <section className="ps-section" aria-labelledby="ps-faq-title">
        <div className="ps-section-head ps-section-head-row">
          <h2 id="ps-faq-title" className="ps-h2">{HOME.faqTitle}</h2>
          <Link to="/faq" className="ps-arrow-link">{HOME.faqCtaLabel} <span aria-hidden="true">→</span></Link>
        </div>
        <FaqAccordion items={FAQ.items.slice(0, 3)} idPrefix="home-faq" />
      </section>
    </>
  )
}

function PreceptorBand() {
  return (
    <section className="ps-band" aria-labelledby="ps-band-title">
      <div className="ps-band-inner">
        <LoopMotif className="ps-band-motif" />
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
  return (
    <div className="ps-page-head">
      <p className="ps-eyebrow">{eyebrow}</p>
      <h1 className="ps-h1">{title}</h1>
      {intro && <p className="ps-lead">{intro}</p>}
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

function AboutPage() {
  return (
    <>
      <section className="ps-section">
        <PageHead eyebrow={ABOUT.eyebrow} title={ABOUT.title} intro={ABOUT.intro} />
      </section>
      <section className="ps-section ps-section-tint" aria-labelledby="ps-about-designed">
        <h2 id="ps-about-designed" className="ps-h2">{ABOUT.designedTitle}</h2>
        <div className="ps-feature-grid">
          {ABOUT.designed.map(d => (
            <article className="ps-feature-card" key={d.title}>
              <span className="ps-feature-icon"><Icon name={d.icon} /></span>
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </article>
          ))}
        </div>
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

function EligibilityPage() {
  return (
    <>
      <section className="ps-section">
        <PageHead eyebrow={ELIGIBILITY.eyebrow} title={ELIGIBILITY.title} intro={ELIGIBILITY.intro} />
        <div className="ps-split">
          <div className="ps-split-main">
            <h2 className="ps-h3">{ELIGIBILITY.checklistHeading}</h2>
            <ul className="ps-check-list">
              {ELIGIBILITY.checklist.map(c => (
                <li key={c}><span className="ps-check" aria-hidden="true" />{c}</li>
              ))}
            </ul>
          </div>
          <aside className="ps-split-side">
            <div className="ps-callout">
              <h3>{ELIGIBILITY.limitationHeading}</h3>
              <p>{ELIGIBILITY.limitationBody}</p>
            </div>
            <div className="ps-side-card">
              <h3>{ELIGIBILITY.programsHeading}</h3>
              <ul className="ps-plain-list">
                {ELIGIBILITY.programs.map(p => <li key={p}>{p}</li>)}
              </ul>
            </div>
          </aside>
        </div>
        <p className="ps-note">{ELIGIBILITY.requirementsNote}</p>
      </section>
      <MiniCta heading={ELIGIBILITY.ctaHeading} body={ELIGIBILITY.ctaBody}
        label={ELIGIBILITY.ctaLabel} path={ELIGIBILITY.ctaPath} />
    </>
  )
}

function ApplyPage() {
  return (
    <>
      <section className="ps-section">
        <PageHead eyebrow={APPLY.eyebrow} title={APPLY.title} intro={APPLY.intro} />
        <div className="ps-highlight" role="note">
          <span className="ps-highlight-icon"><Icon name="school" /></span>
          <p>Applying to ASPIRE starts at your school, not with an application portal.</p>
        </div>
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
        <PageHead eyebrow={EXPERIENCE.eyebrow} title={EXPERIENCE.title} intro={EXPERIENCE.intro} />
        <div className="ps-feature-grid">
          {EXPERIENCE.bullets.map(b => (
            <article className="ps-feature-card ps-feature-row" key={b.text}>
              <span className="ps-feature-icon"><Icon name={b.icon} /></span>
              <p>{b.text}</p>
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
        <PageHead eyebrow={PRECEPTORS.eyebrow} title={PRECEPTORS.title} intro={PRECEPTORS.intro} />
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
      <MiniCta heading={PRECEPTORS.ctaHeading} body={PRECEPTORS.ctaBody}
        label={PRECEPTORS.ctaLabel} path={PRECEPTORS.ctaPath} />
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
    <section className="ps-section">
      <PageHead eyebrow={CONTACT.eyebrow} title={CONTACT.title} intro={CONTACT.intro} />
      <div className="ps-contact-grid">
        {CONTACT.cards.map(c => (
          <article className="ps-contact-card" key={c.title}>
            <span className="ps-contact-icon"><Icon name={c.icon} /></span>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
            <Link to={c.cta.path} className="ps-btn ps-btn-primary ps-btn-block">{c.cta.label}</Link>
          </article>
        ))}
      </div>
      <p className="ps-note">{CONTACT.note}</p>
    </section>
  )
}

function MiniCta({ heading, body, label, path }) {
  return (
    <section className="ps-section">
      <div className="ps-minicta">
        <div>
          <h2 className="ps-h3">{heading}</h2>
          <p>{body}</p>
        </div>
        <Link to={path} className="ps-btn ps-btn-primary">{label}</Link>
      </div>
    </section>
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
          <p>{FOOTER.brandBlurb}</p>
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
            <p className="ps-footer-contact">{FOOTER.contactBody}</p>
            <Link to={FOOTER.contactCta.path} className="ps-arrow-link">
              {FOOTER.contactCta.label} <span aria-hidden="true">→</span>
            </Link>
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
