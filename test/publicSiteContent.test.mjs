// ASPIRE-PUBLIC-SITE: static-source + asset guards for the consolidated public
// site revision (approved copy, page journeys, illustration swap, Experience
// image transparency, and login-page hierarchy).
// Run: node --test test/publicSiteContent.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const content = read('src/public-site/publicContent.js')
const site = read('src/public-site/PublicSite.jsx')
const login = read('src/pages/Login.jsx')
const outlook = read('src/lib/outlookCompose.js')
const EM_DASH = /—/

test('global copy discipline', async (t) => {
  await t.test('never uses "ASPIRE Program"', () => {
    for (const [name, src] of [['content', content], ['site', site], ['login', login]]) {
      assert.doesNotMatch(src.replace(/never written as .ASPIRE Program./g, ''), /ASPIRE Program/, `${name} contains "ASPIRE Program"`)
    }
  })
  await t.test('no em dash character in edited public-site copy', () => {
    assert.doesNotMatch(content, EM_DASH)
    assert.doesNotMatch(site, EM_DASH)
    assert.doesNotMatch(login, EM_DASH)
  })
})

test('homepage', async (t) => {
  await t.test('approved hero headline and CTAs', () => {
    assert.match(content, /heroTitle: 'Complete your senior clinical rotation where you hope to begin your nursing career\.'/)
    assert.match(content, /label: 'See if you are eligible'/)
    assert.match(content, /label: 'How to apply'/)
  })
  await t.test('pathway cards use the approved bodies and CTAs', () => {
    assert.match(content, /audienceTitle: 'Find your pathway'/)
    for (const cta of ['Explore the student pathway', 'Learn about precepting', 'Partner with ASPIRE', 'Work with ASPIRE']) {
      assert.match(content, new RegExp(`label: '${cta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
    }
  })
  await t.test('at-a-glance drops the oversized "90+" and its redundant closing note', () => {
    // No standalone 90+ metric in the data or the markup.
    assert.doesNotMatch(content, /stat: '90\+'/)
    assert.doesNotMatch(content, /glanceNote/)
    assert.doesNotMatch(site, /ps-glance-stat/)
    assert.doesNotMatch(site, /c\.stat/)
    assert.doesNotMatch(site, /HOME\.glanceNote/)
    // Card 1 heading is a normal card heading (same hierarchy as the others).
    assert.match(content, /title: 'At least 90 bedside clinical hours'/)
  })
  await t.test('six-step journey aligned with the actual application process', () => {
    for (const step of [
      'Your school confirms eligibility and submits a request',
      'You complete the ASPIRE intake form',
      'You interview with the ASPIRE Team',
      'ASPIRE coordinates your unit and preceptor match',
      'You complete your clinical rotation',
      'You prepare for your next step',
    ]) assert.match(content, new RegExp(`title: '${step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
    // Step 1 body: school confirms eligibility AND submits the placement request.
    assert.match(content, /confirms your eligibility and clinical requirements, then submits a placement request through the ASPIRE portal\./)
    // Step 2 body now includes scheduling information.
    assert.match(content, /learning needs, placement preferences, and scheduling information\./)
    assert.match(content, /journeyNote: 'Participation in ASPIRE does not guarantee/)
  })
  await t.test('homepage preceptor callout copy + watermark', () => {
    assert.match(content, /preceptorBandTitle: 'Help shape a future colleague\.'/)
    assert.match(site, /cs-logo-white-mark\.png/)
  })
  await t.test('FAQ preview shows the three approved questions', () => {
    assert.match(content, /faqPreview:/)
    for (const q of ['How do I apply to ASPIRE\\?', 'How are the unit and preceptor selected\\?', 'Can current Cedars-Sinai employees participate in ASPIRE\\?']) {
      assert.match(content, new RegExp(`q: '${q}'`))
    }
    // The preview uses a dedicated answer when one is defined, else the shared FAQ answer.
    assert.match(site, /HOME\.faqPreview\.map\(p => \(\{ q: p\.q, a: p\.a \?\? FAQ\.items\[p\.i\]\.a \}\)\)/)
  })
  await t.test('the "How do I apply" preview answer does NOT begin with "No.", but the full FAQ does', () => {
    // Dedicated homepage-preview answer opens with "Applying", not "No.".
    assert.match(content, /q: 'How do I apply to ASPIRE\?',[\s\S]*?a: 'Applying begins with your school’s clinical placement coordinator\./)
    // The full FAQ "Can I apply directly to ASPIRE?" answer still opens with "No.".
    assert.match(content, /q: 'Can I apply directly to ASPIRE\?',\s*a: 'No\. Applying begins with your school’s clinical placement coordinator\./)
  })
})

test('coordinator terminology and support/compensation copy', async (t) => {
  await t.test('public copy standardizes on "clinical placement coordinator"', () => {
    // No non-clinical variants remain in the public copy.
    assert.doesNotMatch(content, /school’s placement coordinator/)
    assert.doesNotMatch(content, /school placement coordinator/)
    assert.match(content, /school’s clinical placement coordinator/)
    // Later within-section references may use "your coordinator".
    assert.match(content, /your coordinator/)
  })
  await t.test('glance heading renamed to "Support beyond the rotation"', () => {
    assert.match(content, /title: 'Support beyond the rotation'/)
    assert.doesNotMatch(content, /NPD guidance beyond the rotation/)
  })
  await t.test('preceptor NPD heading spelled out, and revised compensation copy', () => {
    assert.match(content, /title: 'Dedicated Nursing Professional Development support'/)
    assert.doesNotMatch(content, /Dedicated NPD support/)
    assert.match(content, /Cedars-Sinai nurses may be eligible for additional compensation for qualifying preceptor assignments, in accordance with applicable policy\./)
    assert.doesNotMatch(content, /may receive additional compensation for qualifying preceptor assignments, subject to applicable policy/)
  })
})

test('eligibility completion accessibility', async (t) => {
  await t.test('the short completion status is screen-reader-only (visually hidden aria-live)', () => {
    // The short announce sentence renders only inside the ps-visually-hidden live region.
    assert.match(site, /<p className="ps-visually-hidden" role="status" aria-live="polite">\s*\{complete \? ELIGIBILITY\.ready\.announce : ''\}/)
    // ...and is NOT placed in the visible ready card.
    assert.doesNotMatch(site, /ps-ready-card[\s\S]*?ready\.announce/)
  })
  await t.test('the visible completion panel keeps the approved copy', () => {
    assert.match(content, /heading: 'Ready to take the next step\?'/)
    assert.match(content, /body:\s*'Based on your responses, you may be eligible to participate in ASPIRE\. Final eligibility is/)
    assert.match(content, /support: 'Applying to ASPIRE begins with your school, not through a public application portal\.'/)
    assert.match(content, /ctaLabel: 'See how to apply'/)
    assert.match(site, /ps-ready-support/)
  })
})

test('about page', async (t) => {
  await t.test('new hero headline, two-paragraph intro, care-team alt', () => {
    assert.match(content, /title: 'A supported bridge from nursing school to professional practice\.'/)
    assert.match(content, /intro: \[\s*'ASPIRE, the Affiliate Students/)
    assert.match(content, /alt: 'A senior nursing student discussing clinical learning with a nurse and members of the care team\.'/)
  })
  await t.test('both differentiator sections render', () => {
    assert.match(content, /setsApartHeading: 'What sets ASPIRE apart'/)
    assert.match(content, /buildHeading: 'What students build through ASPIRE'/)
    for (const item of ['One-to-one preceptorship', 'Meaningful unit immersion', 'Early professional enculturation', 'Develop a sense of belonging']) {
      assert.match(content, new RegExp(`title: '${item}'`))
    }
    assert.match(site, /ABOUT\.setsApart/)
    assert.match(site, /ABOUT\.build/)
  })
})

test('eligibility page', async (t) => {
  await t.test('six approved self-check statements and completion copy', () => {
    assert.match(content, /final term of an eligible nursing program at a school currently participating in ASPIRE/)
    assert.match(content, /cumulative GPA of at least 3\.0 on a 4\.0 scale/)
    assert.match(content, /support: 'Applying to ASPIRE begins with your school, not through a public application portal\.'/)
  })
  await t.test('renamed program-pathway and schools headings + school-specific note', () => {
    assert.match(content, /programsHeading: 'Eligible nursing program pathways'/)
    assert.match(content, /schoolsHeading: 'Current ASPIRE-eligible schools'/)
    assert.match(content, /Participation and program eligibility may vary by school, campus, academic term/)
    assert.match(content, /finalHeading: 'Final eligibility verification'/)
  })
  await t.test('confetti stays reduced-motion safe', () => {
    assert.match(read('src/public-site/confetti.js'), /prefers-reduced-motion: reduce/)
  })
  await t.test('no universal "prior employment is never required" statement', () => {
    assert.doesNotMatch(content, /job classification does not determine/)
    assert.doesNotMatch(content, /employment[^.]*never required/i)
    assert.doesNotMatch(content, /does not require (prior )?Cedars-Sinai employment/i)
  })
})

test('how to apply page', async (t) => {
  await t.test('three approved steps and the placement disclaimer', () => {
    assert.match(content, /title: 'Applying to ASPIRE begins with your school\.'/)
    for (const s of ['Contact your clinical placement coordinator', 'Complete the ASPIRE intake form', 'Interview with the ASPIRE Team']) {
      assert.match(content, new RegExp(`title: '${s}'`))
    }
    assert.match(content, /A specific placement is not guaranteed\./)
  })
})

test('experience page', async (t) => {
  await t.test('approved headline, alt, six items, and continuity', () => {
    assert.match(content, /title: 'Hands-on practice, one-to-one mentorship, and meaningful unit immersion\.'/)
    assert.match(content, /alt: 'A Nursing Professional Development practitioner, an RN preceptor, and a senior nursing student/)
    for (const item of ['Hands-on bedside practice', 'One-to-one preceptorship', 'Meaningful unit immersion', 'NPD coaching and unit rounding', 'Professional relationships']) {
      assert.match(content, new RegExp(`title: '${item}'`))
    }
    assert.match(content, /continuityHeading: 'Preceptor continuity'/)
    assert.match(site, /EXPERIENCE\.items\.map/)
  })
})

test('preceptors page', async (t) => {
  await t.test('never refers to advanced practice nurses', () => {
    assert.doesNotMatch(content, /advanced practice/i)
  })
  await t.test('compensation item and two contact addresses', () => {
    assert.match(content, /title: 'Potential additional compensation'/)
    assert.match(content, /emailAspire: 'aspire@cshs\.org'/)
    assert.match(content, /emailPreceptor: 'preceptor@cshs\.org'/)
    assert.match(content, /ctaSupport: 'For questions about preceptor training/)
    assert.match(site, /label=\{PRECEPTORS\.ctaAspireLabel\}/)
    assert.match(site, /label=\{PRECEPTORS\.ctaPreceptorLabel\}/)
  })
})

test('faq page', async (t) => {
  await t.test('has 14 approved items including the new additions', () => {
    // Count q: entries only within the FAQ export (the HOME.faqPreview entries
    // live earlier, in the HOME block, and must not be counted here).
    const faqBlock = content.slice(content.indexOf('export const FAQ'), content.indexOf('export const CONTACT'))
    const qs = [...faqBlock.matchAll(/^\s+q: '/gm)]
    assert.equal(qs.length, 14, `expected 14 FAQ items, got ${qs.length}`)
    for (const q of [
      'Can I apply directly to ASPIRE\\?',
      'Can I participate if I have already graduated or hold an RN license\\?',
      'Can I complete my rotation in more than one unit\\?',
      'What happens if my ASPIRE unit is not hiring new graduate nurses\\?',
      'Does ASPIRE guarantee a specific placement, employment, or residency admission\\?',
      'Is ASPIRE the only pathway to the New Graduate RN Residency Program\\?',
    ]) assert.match(content, new RegExp(`q: '${q}'`))
  })
  await t.test('removed questions are absent', () => {
    assert.doesNotMatch(content, /Do I need an RN license before/)
    assert.doesNotMatch(content, /prior Cedars-Sinai employment or volunteer/i)
  })
})

test('contact page journey', async (t) => {
  await t.test('approved hero + three audience cards + guidance strip', () => {
    assert.match(content, /title: 'Find the right place to start\.'/)
    for (const card of ['Students and school coordinators', 'Cedars-Sinai employees', 'Preceptors and unit leaders']) {
      assert.match(content, new RegExp(`title: '${card}'`))
    }
    assert.match(content, /guidance: 'For prospective student eligibility and placement questions/)
  })
  await t.test('sign-in banner and two email routes', () => {
    assert.match(content, /heading: 'Already part of ASPIRE\?'/)
    assert.match(content, /ctaLabel: 'Sign in to ASPIRE'/)
    assert.match(content, /email: 'aspire@cshs\.org'/)
    assert.match(content, /email: 'preceptor@cshs\.org'/)
  })
  await t.test('desktop DOM order: hero -> cards -> sign-in banner -> direct contact -> guidance', () => {
    const iHero = site.indexOf('ps-contact-hero')
    const iCards = site.indexOf('ps-choose-grid')
    const iBand = site.indexOf('ps-signin-band')
    const iDirect = site.indexOf('ps-contact-direct')
    const iGuide = site.indexOf('ps-guidance-strip')
    assert.ok(iHero > 0 && iHero < iCards && iCards < iBand && iBand < iDirect && iDirect < iGuide, 'contact sections out of order')
  })
})

test('email compose routing', async (t) => {
  await t.test('public email helper routes cshs.org to Outlook, else safe new-tab mailto', () => {
    assert.match(outlook, /export function composePublicEmail/)
    assert.match(outlook, /MICROSOFT_365_DOMAINS\.has\(emailDomain\(to\)\)/)
    assert.match(outlook, /buildOutlookComposeUrl\(\{ to, subject, body \}\)/)
    assert.match(outlook, /openInNewTab\(url\)/)
  })
  await t.test('public pages use the centralized helper, no raw same-tab mailto CTA', () => {
    assert.match(site, /import \{ composePublicEmail \} from '\.\.\/lib\/outlookCompose'/)
    assert.doesNotMatch(site, /className="ps-btn[^"]*" href=\{`mailto:/)
  })
})

test('login page', async (t) => {
  await t.test('brand hierarchy: logo, ASPIRE Intelligence title, Portal badge, supporting copy', () => {
    assert.match(login, /src="\/cs-logo-large\.png" alt="Cedars-Sinai"/)
    assert.match(login, /<h1 className="lg-brand-name">ASPIRE Intelligence<\/h1>/)
    assert.match(login, /<span className="lg-brand-badge">Portal<\/span>/)
    assert.match(login, /One secure sign-in for invited ASPIRE students, preceptors, unit/)
  })
  await t.test('reuses the homepage student-group illustration as the login hero', () => {
    assert.match(login, /lg-brand-art[\s\S]*?src="\/public-site\/illustrations\/hero\.png"/)
    assert.doesNotMatch(login, /login-panel\.jpg/)
  })
  await t.test('institute attribution sits BELOW the illustration, not grouped with the logo', () => {
    const iLogo = login.indexOf('cs-logo-large.png')
    const iArt = login.indexOf('lg-brand-art')
    const iInst = login.indexOf('Geri &amp; Richard Brawerman Nursing Institute')
    assert.ok(iLogo < iArt && iArt < iInst, 'institute must follow the illustration')
  })
  await t.test('right panel wording, placeholders, and CTA', () => {
    assert.match(login, /<h2 className="lg-form-title">Sign in<\/h2>/)
    assert.match(login, /Use the email address that received your ASPIRE invitation\./)
    assert.match(login, /placeholder="your@email\.com"/)
    assert.match(login, /placeholder="Enter your password"/)
    assert.match(login, /\{loading \? 'Signing in\.\.\.' : 'Sign in'\}/)
    assert.match(login, /Access is limited to invited ASPIRE participants, partners, and staff\./)
    assert.match(login, /Need account assistance\? Contact/)
  })
  await t.test('preserves the "Public site" return link', () => {
    assert.match(login, /<span aria-hidden="true">←<\/span> Public site/)
  })
})

test('experience illustration has real transparency', async (t) => {
  const buf = readFileSync(join(here, '..', 'public/public-site/illustrations/experience.png'))
  await t.test('PNG is 8-bit RGBA (a real alpha channel, not a baked checkerboard)', () => {
    assert.equal(buf.toString('ascii', 12, 16), 'IHDR')
    const bitDepth = buf[24]
    const colorType = buf[25]
    assert.equal(bitDepth, 8, 'expected 8-bit depth')
    assert.equal(colorType, 6, 'expected color type 6 (truecolor + alpha)')
  })
  await t.test('the top-left corner pixel is fully transparent (alpha 0)', () => {
    // Collect IDAT, inflate. For row 0 / col 0 every PNG filter predictor is 0,
    // so the first pixel's channels equal the raw filtered bytes:
    // [0]=filter, [1..4]=R,G,B,A. A practical corner-transparency check.
    let off = 8
    const idat = []
    while (off < buf.length) {
      const len = buf.readUInt32BE(off)
      const type = buf.toString('ascii', off + 4, off + 8)
      if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len))
      if (type === 'IEND') break
      off += 12 + len
    }
    const raw = zlib.inflateSync(Buffer.concat(idat))
    assert.equal(raw[4], 0, 'top-left alpha must be 0')
  })
})
