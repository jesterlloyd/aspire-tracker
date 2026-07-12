// src/public-site/PublicSite.jsx
//
// PHASE1-PUBLIC-SITE: the public marketing site served at / and its subpages.
// Lazy-loaded from App.jsx so the staff app bundle does not grow, and vice
// versa. All copy lives in publicContent.js (one reviewable module).
//
// Routing contract (binding):
//   - / is ALWAYS the public homepage, including for authenticated users.
//   - Authenticated visitors see "Open Portal" in the header instead of
//     "Log in" (via useAuth); everyone else sees Log in, which routes to
//     /login. No data is fetched anywhere on the public site.

import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  SITE_NAME, NAV_LINKS, HOME, ABOUT, ELIGIBILITY, APPLY,
  EXPERIENCE, PRECEPTORS, FAQ, CONTACT, FOOTER,
} from './publicContent'
import './publicSite.css'

const PAGE_TITLES = {
  home:        'ASPIRE at Cedars-Sinai',
  about:       'About ASPIRE',
  eligibility: 'Eligibility, ASPIRE at Cedars-Sinai',
  apply:       'How to Apply, ASPIRE at Cedars-Sinai',
  experience:  'The Experience, ASPIRE at Cedars-Sinai',
  preceptors:  'For Preceptors, ASPIRE at Cedars-Sinai',
  faq:         'FAQ, ASPIRE at Cedars-Sinai',
  contact:     'Contact, ASPIRE at Cedars-Sinai',
}

function PublicHeader() {
  const { user } = useAuth()
  const location = useLocation()
  return (
    <header className="ps-header">
      <div className="ps-header-inner">
        <Link to="/" className="ps-brand" aria-label="ASPIRE at Cedars-Sinai home">
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" />
          <span className="ps-brand-name">ASPIRE</span>
        </Link>
        <nav className="ps-nav" aria-label="Public site">
          {NAV_LINKS.map(l => (
            <Link key={l.path} to={l.path}
              className={location.pathname === l.path ? 'ps-nav-active' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        {user
          ? <Link to="/portal" className="ps-login-btn">Open Portal</Link>
          : <Link to="/login"  className="ps-login-btn">Log in</Link>}
      </div>
    </header>
  )
}

function PublicFooter() {
  return (
    <footer className="ps-footer">
      <div className="ps-footer-inner">
        <div className="ps-footer-links">
          {NAV_LINKS.map(l => <Link key={l.path} to={l.path}>{l.label}</Link>)}
          <Link to="/login">Log in</Link>
        </div>
        <div className="ps-footer-meta">
          <div>{FOOTER.disclaimer}</div>
          <div>{FOOTER.attribution}</div>
        </div>
      </div>
    </footer>
  )
}

function HomePage() {
  return (
    <>
      <section className="ps-section">
        <div className="ps-kicker">{HOME.heroKicker}</div>
        <h1 className="ps-h1">{HOME.heroTitle}</h1>
        <p className="ps-lead">{HOME.heroBody}</p>
        <div className="ps-cta-row">
          <Link to={HOME.heroPrimaryCta.path} className="ps-btn ps-btn-primary">{HOME.heroPrimaryCta.label}</Link>
          <Link to={HOME.heroSecondaryCta.path} className="ps-btn ps-btn-ghost">{HOME.heroSecondaryCta.label}</Link>
        </div>
      </section>
      <section className="ps-section">
        <h2 className="ps-h2">{HOME.glanceTitle}</h2>
        <div className="ps-card-grid">
          {HOME.glanceCards.map(c => (
            <div className="ps-card" key={c.title}><h3>{c.title}</h3><p>{c.body}</p></div>
          ))}
        </div>
      </section>
      <section className="ps-section">
        <h2 className="ps-h2">{HOME.stepsTitle}</h2>
        <div className="ps-steps">
          {HOME.steps.map(s => (
            <div className="ps-step" key={s.title}><h3>{s.title}</h3><p>{s.body}</p></div>
          ))}
        </div>
      </section>
      <div className="ps-band">
        <div className="ps-section">
          <h2>{HOME.preceptorBandTitle}</h2>
          <p>{HOME.preceptorBandBody}</p>
          <Link to={HOME.preceptorBandCta.path} className="ps-btn ps-btn-primary">{HOME.preceptorBandCta.label}</Link>
        </div>
      </div>
    </>
  )
}

function AboutPage() {
  return (
    <section className="ps-section">
      <h1 className="ps-h1">{ABOUT.title}</h1>
      <p className="ps-lead">{ABOUT.intro}</p>
      {ABOUT.sections.map(s => (
        <div key={s.heading} style={{ marginBottom: 28 }}>
          <h2 className="ps-h2">{s.heading}</h2>
          {s.body && <p className="ps-body">{s.body}</p>}
          {s.bullets && <ul className="ps-list">{s.bullets.map(b => <li key={b}>{b}</li>)}</ul>}
        </div>
      ))}
    </section>
  )
}

function EligibilityPage() {
  return (
    <section className="ps-section">
      <h1 className="ps-h1">{ELIGIBILITY.title}</h1>
      <p className="ps-lead">{ELIGIBILITY.intro}</p>
      <h2 className="ps-h2">{ELIGIBILITY.checklistHeading}</h2>
      <ul className="ps-list">{ELIGIBILITY.checklist.map(c => <li key={c}>{c}</li>)}</ul>
      <div className="ps-callout">
        <h3>{ELIGIBILITY.limitationHeading}</h3>
        <p>{ELIGIBILITY.limitationBody}</p>
      </div>
      <h2 className="ps-h2">{ELIGIBILITY.programsHeading}</h2>
      <ul className="ps-list">{ELIGIBILITY.programs.map(p => <li key={p}>{p}</li>)}</ul>
      <p className="ps-note">{ELIGIBILITY.requirementsNote}</p>
    </section>
  )
}

function ApplyPage() {
  return (
    <section className="ps-section">
      <h1 className="ps-h1">{APPLY.title}</h1>
      <p className="ps-lead">{APPLY.intro}</p>
      <div className="ps-steps" style={{ gridTemplateColumns: '1fr' }}>
        {APPLY.steps.map(s => (
          <div className="ps-step" key={s.title}><h3>{s.title}</h3><p>{s.body}</p></div>
        ))}
      </div>
    </section>
  )
}

function ExperiencePage() {
  return (
    <section className="ps-section">
      <h1 className="ps-h1">{EXPERIENCE.title}</h1>
      <p className="ps-lead">{EXPERIENCE.intro}</p>
      <ul className="ps-list">{EXPERIENCE.bullets.map(b => <li key={b}>{b}</li>)}</ul>
      <div style={{ marginTop: 30 }}>
        <h2 className="ps-h2">{EXPERIENCE.continuityHeading}</h2>
        <p className="ps-body">{EXPERIENCE.continuityBody}</p>
      </div>
    </section>
  )
}

function PreceptorsPage() {
  return (
    <>
      <section className="ps-section">
        <h1 className="ps-h1">{PRECEPTORS.title}</h1>
        <p className="ps-lead">{PRECEPTORS.intro}</p>
        <h2 className="ps-h2">{PRECEPTORS.benefitsHeading}</h2>
        <ul className="ps-list">{PRECEPTORS.benefits.map(b => <li key={b}>{b}</li>)}</ul>
      </section>
      <div className="ps-band">
        <div className="ps-section">
          <h2>{PRECEPTORS.ctaHeading}</h2>
          <p>{PRECEPTORS.ctaBody}</p>
        </div>
      </div>
    </>
  )
}

function FaqPage() {
  return (
    <section className="ps-section">
      <h1 className="ps-h1">{FAQ.title}</h1>
      {FAQ.items.map(item => (
        <div className="ps-faq-item" key={item.q}>
          <h3>{item.q}</h3>
          <p>{item.a}</p>
        </div>
      ))}
    </section>
  )
}

function ContactPage() {
  return (
    <section className="ps-section">
      <h1 className="ps-h1">{CONTACT.title}</h1>
      {CONTACT.sections.map(s => (
        <div key={s.heading} style={{ marginBottom: 26 }}>
          <h2 className="ps-h2">{s.heading}</h2>
          <p className="ps-body">{s.body}</p>
        </div>
      ))}
      <p className="ps-note">{CONTACT.loginNote}</p>
    </section>
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
      <PublicHeader />
      <main className="ps-main"><Page /></main>
      <PublicFooter />
    </div>
  )
}
