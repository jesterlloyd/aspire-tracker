// Portal cohort polish, Commit 3: the Academic Partner cohort-access gate is centered and converged
// with the public /school-form access card through one shared CohortAccessCard. Source guards prove:
// the shared card exists and is presentation-only; both surfaces render it; the AP gate is centered
// (checking + password + verifying states) and drops its old left-aligned card; the public page keeps
// its full-screen shell + logo but no longer hand-rolls the gate; the final-POST password
// re-verification and transient-password handling are intact.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const card = read('src/components/CohortAccessCard.jsx')
const ap = read('src/portal/ap/PlacementRequestsView.jsx')
const apCode = stripJs(ap)
const pub = read('src/components/SchoolFormPage.jsx')
const css = read('src/index.css')
const portalCss = read('src/portal/portal.css')

test('the shared CohortAccessCard exists and is presentation-only (no password storage, no RPC)', () => {
  assert.ok(existsSync(join(root, 'src/components/CohortAccessCard.jsx')))
  assert.match(card, /export default function CohortAccessCard\(/)
  // Renders the constrained centered card: title, cohort-name intro, password input, error, submit.
  assert.match(card, /className="cohort-access-card"/)
  assert.match(card, /className="cohort-access-title"/)
  assert.match(card, /className="cohort-access-intro"/)
  assert.match(card, /type="password"/)
  assert.match(card, /className=\{`cohort-access-input\$\{error \? ' is-error' : ''\}`\}/)
  assert.match(card, /className="cohort-access-submit"/)
  // Presentation only: no Supabase, no RPC, no storage, no logging of the password.
  assert.doesNotMatch(card, /supabase|\.rpc\(|localStorage|sessionStorage|console\./)
})

test('the shared card has a constrained, centered width consistent with /school-form', () => {
  assert.match(css, /\.cohort-access-card \{[^}]*max-width: 440px/)
  assert.match(css, /\.cohort-access-input\.is-error \{ border-color: var\(--cs-red/)
  // The portal centers the card in the workspace, below the page heading + Nightfall header.
  assert.match(portalCss, /\.ptl-plr-gate-center \{ display: flex; justify-content: center;/)
})

test('the Academic Partner gate renders the shared card, centered, in all gate/verifying states', () => {
  assert.match(ap, /import CohortAccessCard from '\.\.\/\.\.\/components\/CohortAccessCard'/)
  // checking + password states are both wrapped in the centered container.
  assert.match(ap, /if \(gate === 'checking'\) \{\s*\n\s*return <div className="ptl-plr-gate-center"><LoadingState/)
  assert.match(ap, /if \(gate === 'password'\) \{\s*\n\s*return \(\s*\n\s*<div className="ptl-plr-gate-center">\s*\n\s*<CohortAccessCard/)
  // The cohort name stays visible in the explanatory copy; the busy prop drives the verifying label.
  assert.match(ap, /intro=\{<>Enter the cohort password provided by the ASPIRE team to open the request form for \{cohortName\}\.<\/>\}/)
  assert.match(ap, /busy=\{pwdChecking\}/)
  // The old left-aligned embedded gate card is gone.
  assert.doesNotMatch(apCode, /ptl-plr-gate-form/)
  assert.doesNotMatch(apCode, /<h2 className="ptl-card-title">Cohort access<\/h2>/)
})

test('the AP final-POST password re-verification and transient-password handling are unchanged', () => {
  // Verified password kept only in transient state, re-attached to the POST, re-shown on server reject.
  assert.match(ap, /const \[verifiedPassword, setVerifiedPassword\] = useState\(''\)/)
  assert.match(ap, /if \(verifiedPassword\) payload\.password = verifiedPassword/)
  assert.match(ap, /setGate\('password'\); setVerifiedPassword\(''\)/)
  assert.match(ap, /rpc\('verify_school_form_password'/)
  assert.doesNotMatch(apCode, /localStorage|sessionStorage/)
})

test('the public /school-form keeps its full-screen shell + logo but reuses the shared card', () => {
  assert.match(pub, /import CohortAccessCard from '\.\/CohortAccessCard'/)
  // Still the full-screen public shell with the Cedars-Sinai logo passed into the shared card.
  assert.match(pub, /<div className="uf-page">\s*\n\s*<CohortAccessCard/)
  assert.match(pub, /logo=\{<img src="\/Cedars-Sinai\.png"/)
  // Public verify RPC + page-state transition preserved (behavior unchanged).
  assert.match(pub, /rpc\('verify_school_form_password'/)
  assert.match(pub, /setPageState\('verified'\)/)
  // The old hand-rolled inline gate markup is gone (no second copy of the card).
  assert.doesNotMatch(stripJs(pub), /Please enter the cohort password provided by the ASPIRE team\.[\s\S]{0,400}type="password"/)
})
