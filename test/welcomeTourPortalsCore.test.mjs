// WELCOME-TOUR-PORTALS-1: guards for the CORE half of the multi-experience welcome
// tour - the per-experience acknowledgement ledger (src/lib/onboardingTours.js) and
// the CustomOnboardingTour spotlight engine (src/components/CustomOnboardingTour.jsx).
// Static-source plus pure-function, matching the repository stack.
//
// Run: node --test test/welcomeTourPortalsCore.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  TOUR_EXPERIENCES, TOUR_VERSION,
  parseTourAcks, serializeTourAcks, isTourAcknowledged,
  tourSnoozeKey, isTourSnoozed, shouldAutoStartTour,
  getTourSteps,
} from '../src/lib/onboardingTours.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')

const engineSrc = read('../src/components/CustomOnboardingTour.jsx')
const appSrc = read('../src/App.jsx')
const toursHelpSrc = read('../src/components/settings/ToursHelpPanel.jsx')

// ── Ledger parse / serialize ─────────────────────────────────────────────────

test('parseTourAcks / serializeTourAcks', async (t) => {
  await t.test('round-trips a ledger string through parse and back', () => {
    const acks = parseTourAcks('staff:v3,student:v1')
    assert.deepEqual(acks, { staff: 'v3', student: 'v1' })
    assert.equal(serializeTourAcks(acks), 'staff:v3,student:v1')
  })

  await t.test('serialize is stable-sorted by experience key regardless of insertion order', () => {
    const acks = { unit_leader: 'v1', academic_partner: 'v1', staff: 'v3' }
    assert.equal(serializeTourAcks(acks), 'academic_partner:v1,staff:v3,unit_leader:v1')
  })

  await t.test('a bare legacy value with no colon parses as a staff acknowledgement', () => {
    assert.deepEqual(parseTourAcks('v2'), { staff: 'v2' })
    assert.deepEqual(parseTourAcks('v1'), { staff: 'v1' })
  })

  await t.test('null, undefined, and empty string parse to an empty map', () => {
    assert.deepEqual(parseTourAcks(null), {})
    assert.deepEqual(parseTourAcks(undefined), {})
    assert.deepEqual(parseTourAcks(''), {})
  })

  await t.test('serialize of an empty or falsy map is an empty string', () => {
    assert.equal(serializeTourAcks({}), '')
    assert.equal(serializeTourAcks(null), '')
  })
})

// ── Acknowledgement ───────────────────────────────────────────────────────────

test('isTourAcknowledged', async (t) => {
  await t.test('true when the ledger token matches the current TOUR_EXPERIENCES version', () => {
    const profile = { onboarding_tour_version: 'staff:v4' }
    assert.equal(isTourAcknowledged(profile, 'staff'), true)
  })

  await t.test('false when the ledger token is stale (pre-bump v2 staff row)', () => {
    const profile = { onboarding_tour_version: 'v2' } // bare legacy -> { staff: 'v2' }
    assert.equal(isTourAcknowledged(profile, 'staff'), false)
  })

  await t.test('false when the experience has no ledger entry at all', () => {
    const profile = { onboarding_tour_version: 'staff:v4' }
    assert.equal(isTourAcknowledged(profile, 'student'), false)
  })

  await t.test('one experience acknowledgement never acknowledges another', () => {
    const studentAcked = { onboarding_tour_version: 'student:v2' }
    assert.equal(isTourAcknowledged(studentAcked, 'staff'), false)

    const staffAcked = { onboarding_tour_version: 'staff:v4' }
    assert.equal(isTourAcknowledged(staffAcked, 'student'), false)
  })

  await t.test('a mixed ledger acknowledges only the experiences it names', () => {
    const profile = { onboarding_tour_version: 'staff:v4,unit_leader:v2' }
    assert.equal(isTourAcknowledged(profile, 'staff'), true)
    assert.equal(isTourAcknowledged(profile, 'unit_leader'), true)
    assert.equal(isTourAcknowledged(profile, 'student'), false)
    assert.equal(isTourAcknowledged(profile, 'academic_partner'), false)
  })
})

test('TOUR_EXPERIENCES and the legacy TOUR_VERSION alias', () => {
  // WELCOME-TOUR-FOLLOWUP-1 bumps: staff v4 (Rotation subtab copy), portals v2
  // (Send Feedback + Messages shortcut steps) - each corrected tour re-shows once.
  assert.equal(TOUR_EXPERIENCES.staff, 'v4')
  assert.equal(TOUR_EXPERIENCES.student, 'v2')
  assert.equal(TOUR_EXPERIENCES.unit_leader, 'v2')
  assert.equal(TOUR_EXPERIENCES.academic_partner, 'v2')
  assert.equal(TOUR_VERSION, TOUR_EXPERIENCES.staff)
})

test('tourSnoozeKey / isTourSnoozed', async (t) => {
  await t.test('the key is namespaced per experience', () => {
    assert.equal(tourSnoozeKey('staff'), 'onboarding_tour_snoozed:staff')
    assert.equal(tourSnoozeKey('student'), 'onboarding_tour_snoozed:student')
  })
})

test('shouldAutoStartTour', async (t) => {
  await t.test('false with no profile', () => {
    assert.equal(shouldAutoStartTour(null, 'staff'), false)
  })

  await t.test('false while tour fields have not loaded yet (completed undefined)', () => {
    assert.equal(shouldAutoStartTour({}, 'staff'), false)
  })

  await t.test('true for a fresh profile with fields loaded and nothing acknowledged', () => {
    assert.equal(shouldAutoStartTour({ onboarding_tour_completed: false }, 'staff'), true)
  })

  await t.test('false once the current version is acknowledged for that experience', () => {
    const profile = { onboarding_tour_completed: true, onboarding_tour_version: 'staff:v4' }
    assert.equal(shouldAutoStartTour(profile, 'staff'), false)
  })
})

// ── getTourSteps: staff ────────────────────────────────────────────────────────

function stepTargets(steps) {
  return steps.map(s => s.target)
}

test('getTourSteps: staff role sets', async (t) => {
  const owner = { full_name: 'Ada Lovelace', is_owner: true }
  const admin = { full_name: 'Ada Lovelace', role: 'admin' }
  const coLead = { full_name: 'Ada Lovelace', role: 'co-lead' }
  const interviewer = { full_name: 'Ada Lovelace', role: 'interviewer' }
  const viewer = { full_name: 'Ada Lovelace', role: 'viewer' }

  await t.test('privileged (owner/admin/co-lead) keeps Catalog, Rotation, Evaluation, Connect', () => {
    for (const profile of [owner, admin, coLead]) {
      const targets = stepTargets(getTourSteps('staff', { userProfile: profile }))
      assert.ok(targets.includes('[data-tour="catalog"]'))
      assert.ok(targets.includes('[data-tour="tab-embed"]'))
      assert.ok(targets.includes('[data-tour="tab-evaluation"]'))
      assert.ok(targets.includes('[data-tour="connect"]'))
    }
  })

  await t.test('interviewer gets Catalog but not Rotation, Evaluation, or Connect', () => {
    const targets = stepTargets(getTourSteps('staff', { userProfile: interviewer }))
    assert.ok(targets.includes('[data-tour="catalog"]'))
    assert.ok(!targets.includes('[data-tour="tab-embed"]'))
    assert.ok(!targets.includes('[data-tour="tab-evaluation"]'))
    assert.ok(!targets.includes('[data-tour="connect"]'))
  })

  await t.test('viewer gets Evaluation but not Catalog, Rotation, or Connect', () => {
    const targets = stepTargets(getTourSteps('staff', { userProfile: viewer }))
    assert.ok(!targets.includes('[data-tour="catalog"]'))
    assert.ok(!targets.includes('[data-tour="tab-embed"]'))
    assert.ok(targets.includes('[data-tour="tab-evaluation"]'))
    assert.ok(!targets.includes('[data-tour="connect"]'))
  })

  await t.test('every staff variant keeps the tab-aggregate and tab-student-profiles anchors', () => {
    for (const profile of [owner, interviewer, viewer]) {
      const targets = stepTargets(getTourSteps('staff', { userProfile: profile }))
      assert.ok(targets.includes('[data-tour="tab-aggregate"]'))
      assert.ok(targets.includes('[data-tour="tab-student-profiles"]'))
    }
  })

  await t.test('the staff copy says "At a Glance", mentions CS-Link Access, and points restart at Tours & Help', () => {
    const steps = getTourSteps('staff', { userProfile: owner })
    const allText = steps.map(s => `${s.title} ${s.content}`).join(' ')
    assert.match(allText, /At a Glance/)
    assert.match(allText, /CS-Link Access/)
    assert.match(allText, /Tours & Help/)
  })

  await t.test('no staff step title or content contains the standalone word "Aggregate"', () => {
    for (const profile of [owner, interviewer, viewer]) {
      const steps = getTourSteps('staff', { userProfile: profile })
      for (const step of steps) {
        assert.doesNotMatch(step.title, /\bAggregate\b/)
        assert.doesNotMatch(step.content, /\bAggregate\b/)
      }
    }
  })

  await t.test('no staff step still claims the tour restarts from the user menu', () => {
    const steps = getTourSteps('staff', { userProfile: owner })
    const allText = steps.map(s => s.content).join(' ')
    assert.doesNotMatch(allText, /restart.*from your user menu/i)
  })
})

// ── getTourSteps: student ────────────────────────────────────────────────────

test('getTourSteps: student', async (t) => {
  const profile = { full_name: 'Sam Rivera' }
  const targets = stepTargets(getTourSteps('student', { userProfile: profile }))

  await t.test('includes the four portal anchors', () => {
    assert.ok(targets.includes('[data-tour="portal-nav-home"]'))
    assert.ok(targets.includes('[data-tour="portal-nav-messages"]'))
    assert.ok(targets.includes('[data-tour="portal-nav-action"]'))
    assert.ok(targets.includes('[data-tour="portal-profile-menu"]'))
  })

  await t.test('welcome greets the student by first name', () => {
    const steps = getTourSteps('student', { userProfile: profile })
    assert.match(steps[0].title, /Sam/)
  })
})

// ── getTourSteps: unit_leader ─────────────────────────────────────────────────

test('getTourSteps: unit_leader', async (t) => {
  const profile = { full_name: 'Robin Chen' }
  const targets = stepTargets(getTourSteps('unit_leader', { userProfile: profile }))

  await t.test('includes all six section anchors plus the unit switcher', () => {
    for (const anchor of [
      'portal-nav-home', 'portal-nav-preceptors', 'portal-nav-messages',
      'portal-nav-evaluations', 'portal-nav-placements', 'portal-nav-capacity',
    ]) {
      assert.ok(targets.includes(`[data-tour="${anchor}"]`), `missing ${anchor}`)
    }
    assert.ok(targets.includes('[data-tour="portal-unit-switcher"]'))
    assert.ok(targets.includes('[data-tour="portal-profile-menu"]'))
  })
})

// ── getTourSteps: academic_partner ────────────────────────────────────────────

test('getTourSteps: academic_partner', async (t) => {
  const profile = { full_name: 'Jamie Park' }

  await t.test('includes Students and Placement Requests', () => {
    const targets = stepTargets(getTourSteps('academic_partner', { userProfile: profile }))
    assert.ok(targets.includes('[data-tour="portal-nav-students"]'))
    assert.ok(targets.includes('[data-tour="portal-nav-placement-requests"]'))
    assert.ok(targets.includes('[data-tour="portal-scope-selector"]'))
  })

  await t.test('Messages is included only when apMessagesEnabled is true', () => {
    const withMessages = stepTargets(getTourSteps('academic_partner', { userProfile: profile, apMessagesEnabled: true }))
    assert.ok(withMessages.includes('[data-tour="portal-nav-messages"]'))

    const withoutMessages = stepTargets(getTourSteps('academic_partner', { userProfile: profile, apMessagesEnabled: false }))
    assert.ok(!withoutMessages.includes('[data-tour="portal-nav-messages"]'))

    const defaulted = stepTargets(getTourSteps('academic_partner', { userProfile: profile }))
    assert.ok(!defaulted.includes('[data-tour="portal-nav-messages"]'), 'fail-closed by default')
  })
})

// ── Engine source assertions ──────────────────────────────────────────────────

test('CustomOnboardingTour engine behavior', async (t) => {
  await t.test('accepts experience and context props and derives steps from getTourSteps', () => {
    assert.match(engineSrc, /experience\s*=\s*'staff'/)
    assert.match(engineSrc, /context\s*=\s*\{\}/)
    assert.match(engineSrc, /getTourSteps\(experience, \{ userProfile, apMessagesEnabled \}\)/)
  })

  await t.test('never renders a centered tooltip for a missing target - it skips instead', () => {
    // The old defect combined "target is body" and "target rect is null" into one
    // centered-tooltip condition. That combined condition must be gone.
    assert.doesNotMatch(engineSrc, /isCentered \|\| !targetRect/)
    // A non-centered step with no rect renders nothing (settles next tick), never a centered tooltip.
    assert.match(engineSrc, /if \(!isCentered && !targetRect\) return null;/)
    // Centering is driven by isCentered alone now.
    assert.match(engineSrc, /if \(isCentered\) \{/)
  })

  await t.test('missing/hidden targets are detected via getClientRects and zero-size rect, and walked past', () => {
    assert.match(engineSrc, /getClientRects\(\)\.length === 0/)
    assert.match(engineSrc, /rect\.width > 0 && rect\.height > 0/)
    assert.match(engineSrc, /settleForward = useCallback/)
    assert.match(engineSrc, /settleBackward = useCallback/)
  })

  await t.test('re-evaluates availability on window resize', () => {
    assert.match(engineSrc, /window\.addEventListener\('resize', handler\)/)
    assert.match(engineSrc, /if \(!run \|\| !currentStep\) return;\s*\n\s*if \(isStepAvailable\(currentStep\)\) return;/)
  })

  await t.test('the progress readout counts only currently-available steps', () => {
    assert.match(engineSrc, /availableSteps = useMemo\(\(\) => steps\.filter\(isStepAvailable\)/)
    assert.match(engineSrc, /\{progressCurrent\} \/ \{progressTotal\}/)
  })

  await t.test('keyboard: ArrowRight/Enter, ArrowLeft, and Escape are wired', () => {
    assert.match(engineSrc, /e\.key === 'ArrowRight' \|\| e\.key === 'Enter'/)
    assert.match(engineSrc, /e\.key === 'ArrowLeft'/)
    assert.match(engineSrc, /e\.key === 'Escape'/)
    assert.match(engineSrc, /setShowSkipModal\(true\)/)
  })

  await t.test('the tooltip is a focusable, labeled dialog', () => {
    assert.match(engineSrc, /role="dialog"/)
    assert.match(engineSrc, /aria-modal="true"/)
    assert.match(engineSrc, /aria-label=\{currentStep\.title\}/)
    assert.match(engineSrc, /tabIndex=\{-1\}/)
    assert.match(engineSrc, /tooltipRef\.current\?\.focus\(\)/)
  })

  await t.test('persistence merges the per-experience ledger rather than overwriting the column', () => {
    assert.match(engineSrc, /const acks = parseTourAcks\(userProfile\.onboarding_tour_version\)/)
    assert.match(engineSrc, /acks\[experience\] = TOUR_EXPERIENCES\[experience\]/)
    assert.match(engineSrc, /onboarding_tour_version:\s*serializeTourAcks\(acks\)/)
    assert.match(engineSrc, /onboarding_tour_version: serializeTourAcks\(acks\) \}\)/)
  })

  await t.test('completed/completed_at and dismissed booleans are still written', () => {
    assert.match(engineSrc, /onboarding_tour_completed:\s*true/)
    assert.match(engineSrc, /onboarding_tour_completed_at:\s*new Date\(\)\.toISOString\(\)/)
    assert.match(engineSrc, /onboarding_tour_dismissed: true/)
  })

  await t.test('snooze writes the per-experience key, and staff also writes the legacy plain key', () => {
    assert.match(engineSrc, /sessionStorage\.setItem\(tourSnoozeKey\(experience\), 'true'\)/)
    assert.match(engineSrc, /if \(experience === 'staff'\) sessionStorage\.setItem\('onboarding_tour_snoozed', 'true'\)/)
  })

  await t.test('debug noise is gone: no console.log and no alert, exactly one console.error path per save', () => {
    assert.doesNotMatch(engineSrc, /console\.log/)
    assert.doesNotMatch(engineSrc, /\balert\(/)
    assert.match(engineSrc, /console\.error\('\[Tour\] Save failed:', error\)/)
  })

  await t.test('no em dash anywhere in the engine source', () => {
    assert.doesNotMatch(engineSrc, /—/)
  })
})

// ── App.jsx staff wiring ──────────────────────────────────────────────────────

test('App.jsx staff auto-start wiring', async (t) => {
  await t.test('uses shouldAutoStartTour for staff instead of a bare TOUR_VERSION compare', () => {
    assert.match(appSrc, /import \{ shouldAutoStartTour \} from '\.\/lib\/onboardingTours'/)
    assert.match(appSrc, /shouldAutoStartTour\(currentUserProfile, 'staff'\)/)
    // The old bare-version compare is gone; TOUR_VERSION itself may still be
    // named in an explanatory comment, so assert against the pattern, not the token.
    assert.doesNotMatch(appSrc, /onboarding_tour_version === TOUR_VERSION/)
  })

  await t.test('keeps the existing auth_user_id / activeCohortId / fields-loaded guards', () => {
    assert.match(appSrc, /if \(!currentUserProfile\?\.auth_user_id \|\| !activeCohortId\) return/)
    assert.match(appSrc, /if \(currentUserProfile\.onboarding_tour_completed === undefined\) return/)
  })

  await t.test('mounts CustomOnboardingTour with experience="staff"', () => {
    assert.match(appSrc, /<CustomOnboardingTour run=\{tourRunning\} onClose=\{\(\) => setTourRunning\(false\)\} experience="staff" \/>/)
  })

  await t.test('restartTour itself is untouched (still switches to overview then starts the tour)', () => {
    assert.match(appSrc, /const restartTour = \(\) => \{ switchTab\('overview'\); setTimeout\(\(\) => setTourRunning\(true\), 400\) \}/)
  })
})

test('ToursHelpPanel copy is not stale', async (t) => {
  await t.test('the rendered Welcome Tour description no longer calls the destination tab "Aggregate"', () => {
    const description = toursHelpSrc.slice(
      toursHelpSrc.indexOf('Replay the guided walkthrough'),
      toursHelpSrc.indexOf('</div>', toursHelpSrc.indexOf('Replay the guided walkthrough'))
    )
    assert.doesNotMatch(description, /\bAggregate\b/)
    assert.match(description, /At a Glance/)
  })
})

test('no em dash in this feature\'s core files', () => {
  const onboardingSrc = read('../src/lib/onboardingTours.js')
  for (const s of [onboardingSrc, engineSrc, toursHelpSrc]) {
    assert.doesNotMatch(s, /—/)
  }
})

// ── WELCOME-TOUR-PORTALS-1 refinement: honest profile-menu copy, geometry-tick
// availability, and native-Enter safety ───────────────────────────────────────

test('profile-menu copy matches the actions each portal menu actually offers', () => {
  const profile = { full_name: 'Alex Rivera' }
  const profileStep = (steps) => steps.find(s => s.target === '[data-tour="portal-profile-menu"]')

  // Student: the menu offers Edit Profile (onEditProfile is wired), so "edit" is honest.
  const student = profileStep(getTourSteps('student', { userProfile: profile }))
  assert.match(student.content, /Edit your profile/)

  // Unit Leader: the menu opens a Profile SECTION (onProfile), no inline edit -
  // the copy must say open, never edit.
  const ul = profileStep(getTourSteps('unit_leader', { userProfile: profile }))
  assert.match(ul.content, /Open your Profile/)
  assert.doesNotMatch(ul.content, /[Ee]dit/)

  // Academic Partner: no onProfile and no onEditProfile is wired at all - the
  // menu is public-site link, restart, sign out. No profile-editing claim.
  for (const enabled of [true, false]) {
    const ap = profileStep(getTourSteps('academic_partner', { userProfile: profile, apMessagesEnabled: enabled }))
    assert.doesNotMatch(ap.content, /[Ee]dit/)
    assert.match(ap.content, /public site/)
    assert.match(ap.content, /restart this tour/)
    assert.match(ap.content, /sign out/)
  }
})

test('geometry tick is a real dependency of availability and the re-settle effect', () => {
  // The tick value must be held (not discarded) ...
  assert.match(engineSrc, /const \[geometryTick, setGeometryTick\] = useState\(0\)/)
  assert.doesNotMatch(engineSrc, /const \[, setGeometryTick\]/)
  // ... feed the availability memo ALONGSIDE run and stepIndex, so the "n / N"
  // progress recalculates at tour start (the memo first computes before the
  // nav targets exist), on normal navigation, and on resize/rotation ...
  assert.match(engineSrc, /useMemo\(\(\) => steps\.filter\(isStepAvailable\), \[run, steps, stepIndex, geometryTick\]\)/)
  // ... and re-run the re-settle effect, so a target hidden while the tour is
  // open advances past the hidden step instead of stalling.
  assert.match(engineSrc, /\}, \[run, stepIndex, steps, geometryTick\]\)/)
})

test('global Enter shortcut yields to native activation on interactive elements', () => {
  // Focused button/link/form control: the engine returns early and lets the
  // native Enter click fire exactly once (no double-advance, and Enter on the
  // focused Back button must not act as a global Next).
  assert.match(engineSrc, /isInteractive/)
  assert.match(engineSrc, /closest\('button, a\[href\], input, select, textarea, \[role="button"\]'\)/)
  assert.match(engineSrc, /if \(e\.key === 'Enter' && isInteractive\(e\.target\)\) return/)
  // The guard runs BEFORE the generic Enter/ArrowRight handling.
  const guardIdx = engineSrc.indexOf("if (e.key === 'Enter' && isInteractive(e.target)) return")
  const advanceIdx = engineSrc.indexOf("if (e.key === 'ArrowRight' || e.key === 'Enter')")
  assert.ok(guardIdx > -1 && advanceIdx > -1 && guardIdx < advanceIdx)
})

test('a restarted tour rewinds to the first step', () => {
  // The engine stays mounted between runs, so flipping run back on must reset
  // stepIndex (and any open skip modal) or a finished tour would "restart" on
  // its own final step.
  assert.match(engineSrc, /if \(run\) \{ setStepIndex\(0\); setShowSkipModal\(false\); \}/)
})

// ── WELCOME-TOUR-FOLLOWUP-1: utility-launcher steps + Rotation subtab copy ────

test('staff Rotation step names all three subtabs and never says matching board', () => {
  const owner = { full_name: 'Ada Lovelace', is_owner: true }
  const steps = getTourSteps('staff', { userProfile: owner })
  const rotation = steps.find(s => s.target === '[data-tour="tab-embed"]')
  assert.match(rotation.content, /Placement Board/)
  assert.match(rotation.content, /Preceptors/)
  assert.match(rotation.content, /Activity/)
  // Activity is canEdit-gated in RotationTab.jsx; the copy says so honestly.
  assert.match(rotation.content, /Owners and Admins/)
  for (const s of steps) {
    assert.doesNotMatch(String(s.content) + String(s.title), /[Mm]atching [Bb]oard/)
  }
})

test('every portal tour walks the Send Feedback launcher via the shared anchor', () => {
  const profile = { full_name: 'Alex Rivera' }
  for (const [exp, ctx] of [
    ['student', { userProfile: profile }],
    ['unit_leader', { userProfile: profile }],
    ['academic_partner', { userProfile: profile, apMessagesEnabled: false }],
    ['academic_partner', { userProfile: profile, apMessagesEnabled: true }],
  ]) {
    const targets = getTourSteps(exp, ctx).map(s => s.target)
    assert.ok(targets.includes('[data-tour="feedback-button"]'), `${exp} includes the feedback launcher`)
  }
  // The anchor is the one SharedFeedbackPanel already hardcodes - no duplicate anchor invented.
  const sharedFeedback = read('../src/components/shared/SharedFeedbackPanel.jsx')
  assert.match(sharedFeedback, /data-tour="feedback-button"/)
})

test('the Messages shortcut step follows the same authorization as the Messages surface', () => {
  const profile = { full_name: 'Alex Rivera' }
  const launcher = '[data-tour="portal-messages-launcher"]'
  // Student and Unit Leader: always in the step set (engine skips if hidden).
  for (const exp of ['student', 'unit_leader']) {
    const targets = getTourSteps(exp, { userProfile: profile }).map(s => s.target)
    assert.ok(targets.includes(launcher), `${exp} includes the messages shortcut`)
  }
  // Academic Partner: present ONLY under the fail-closed server capability.
  const withCap = getTourSteps('academic_partner', { userProfile: profile, apMessagesEnabled: true }).map(s => s.target)
  const withoutCap = getTourSteps('academic_partner', { userProfile: profile, apMessagesEnabled: false }).map(s => s.target)
  assert.ok(withCap.includes(launcher))
  assert.ok(!withoutCap.includes(launcher))
  // The anchor exists on the actual launcher button in PortalUtilityLayer.
  const utility = read('../src/portal/PortalUtilityLayer.jsx')
  assert.match(utility, /data-tour="portal-messages-launcher"/)
  assert.match(utility, /portal-messages-launcher"\s*\n\s*className={\`ptl-team-message-launcher/)
})

test('launcher steps sit before the profile-menu step in every portal set', () => {
  const profile = { full_name: 'Alex Rivera' }
  for (const [exp, ctx] of [
    ['student', { userProfile: profile }],
    ['unit_leader', { userProfile: profile }],
    ['academic_partner', { userProfile: profile, apMessagesEnabled: true }],
  ]) {
    const targets = getTourSteps(exp, ctx).map(s => s.target)
    const fb = targets.indexOf('[data-tour="feedback-button"]')
    const menu = targets.indexOf('[data-tour="portal-profile-menu"]')
    assert.ok(fb > -1 && menu > -1 && fb < menu, `${exp} orders feedback before the profile menu`)
  }
})
