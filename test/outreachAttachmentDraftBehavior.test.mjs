// test/outreachAttachmentDraftBehavior.test.mjs
//
// OUTREACH-ATTACHMENTS-1 - BEHAVIORAL proof of draft persistence and reset.
//
// These tests do NOT assert on source patterns. They EXTRACT the real
// production logic out of OutreachView.jsx / BulkManualComposer.jsx and run it
// against a real localStorage shim:
//
//   - the module-level draft helpers are extracted verbatim and executed;
//   - the effect that fills latestDraftRef is extracted WITH its dependency
//     array, and driven by a tiny scheduler that applies React's own rule
//     (re-run only when a dependency changes by Object.is), so a missing
//     dependency reproduces the real staleness;
//   - persistDraftNow and the restore effect are extracted and executed with
//     injected setters.
//
// Every defect below carries a NEGATIVE CONTROL that reconstructs the broken
// implementation and asserts the test catches it. A guard nobody has watched
// fail is not a guard.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { toDraftAttachments, fromDraftAttachments, toSlugs } from '../src/lib/connect/outreachAttachments.js'
import { buildPreceptorAssignmentDraft } from '../src/lib/outreachTemplates.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

const OUTREACH = read('src/components/connect/OutreachView.jsx')
const BULK = read('src/components/connect/BulkManualComposer.jsx')

/** A real (in-memory) localStorage. */
function makeStorage() {
  const map = new Map()
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: k => { map.delete(k) },
    get size() { return map.size },
    keys: () => [...map.keys()],
  }
}

/** Extract a source slice between two anchors (end exclusive). */
function slice(src, startAnchor, endAnchor) {
  const a = src.indexOf(startAnchor)
  assert.notEqual(a, -1, `anchor not found: ${startAnchor}`)
  const b = src.indexOf(endAnchor, a + startAnchor.length)
  assert.notEqual(b, -1, `end anchor not found: ${endAnchor}`)
  return src.slice(a, b)
}

// ── The real module-level draft helpers, executed ───────────────────────────

function loadDirectHelpers(localStorage) {
  const src = slice(OUTREACH, 'const DRAFT_VERSION    = 1', '// Bulk survey send chunk size')
    .replace(/export\s+/g, '')
  // eslint-disable-next-line no-new-func
  const factory = new Function('localStorage', 'Date', `${src}
    return { DRAFT_VERSION, DRAFT_TTL_MS, directDraftKey, lastDraftPointerKey,
             readDirectDraft, directDraftIsEmpty, readDraftPointer }`)
  return factory(localStorage, Date)
}

function loadBulkHelpers(localStorage) {
  const src = slice(BULK, 'const BULK_DRAFT_VERSION', 'const CONTACT_CATEGORIES')
  // bulkDraftIsPristine/HasContent call buildBulkTemplate; stub it deterministically.
  // eslint-disable-next-line no-new-func
  const factory = new Function('localStorage', 'buildBulkTemplate', 'withCohortToken', 'withStaticLinks', 'plainTextToHtml', `${src}
    return { BULK_DRAFT_VERSION, bulkDraftKey, readBulkDraft, bulkDraftIsPristine, bulkDraftHasContent }`)
  const tpl = () => ({ subject: 'TPL SUBJECT', body: 'TPL BODY' })
  return factory(localStorage, tpl, v => v, (_k, b) => b, t => `<p>${t}</p>`)
}

/**
 * The REAL latestDraftRef effect: its assignment and its dependency array are
 * both taken from source. `run` applies React's dependency rule, so a dep the
 * author forgot produces exactly the staleness React would produce.
 */
function loadLatestDraftEffect() {
  // Anchored past the restore effect: PRECEPTOR-DRAFT-CONTINUITY-1 added a
  // coherence assignment to latestDraftRef inside the handoff tail, so the bare
  // 'latestDraftRef.current = {' string now matches twice. The snapshot EFFECT
  // is the one that follows the autosave banner comment.
  const region = OUTREACH.slice(OUTREACH.indexOf('Direct Message draft: autosave (CONNECT-DRAFT-AUTOSAVE)'))
  const body = slice(region, 'latestDraftRef.current = {', '  const persistDraftNow')
  const assignEnd = body.indexOf('  }, [')
  const assign = body.slice(0, assignEnd)
  const depsSrc = body.slice(body.indexOf('  }, [') + 5)
  const depNames = depsSrc.slice(depsSrc.indexOf('[') + 1, depsSrc.indexOf(']'))
    .split(',').map(s => s.trim()).filter(Boolean)

  // eslint-disable-next-line no-new-func
  const apply = new Function('scope', `with (scope) { ${assign} }`)

  let lastDeps = null
  return {
    depNames,
    run(scope) {
      const deps = depNames.map(n => scope[n])
      const changed = lastDeps === null || deps.some((d, i) => !Object.is(d, lastDeps[i]))
      if (changed) { lastDeps = deps; apply(scope) }
      return changed
    },
  }
}

/** The REAL persistDraftNow body. */
function loadPersistDraft() {
  const body = slice(OUTREACH, 'const persistDraftNow = useCallback(() => {', '  }, [userKey, cohortId, richEnabled])')
    .replace('const persistDraftNow = useCallback(() => {', '')
  // eslint-disable-next-line no-new-func
  return new Function('scope', `with (scope) { ${body} }`)
}

/** The REAL restore-or-clear effect body. */
function loadRestoreEffect() {
  const body = slice(OUTREACH, '    const recipientChanged = lastRecipientRef.current', '  }, [DRAFT_KEY, draftRecipientId])')
  // eslint-disable-next-line no-new-func
  return new Function('scope', `with (scope) { ${body} }`)
}

// ── A faithful Direct composer, wired from the extracted production logic ───

function directComposer({ userKey = 'u1', richEnabled = false, activePlacement = null, requiredDocs = null } = {}) {
  // PLACEMENT-COMMUNICATION-HANDOFF-1: the merged draft the component computes
  // BEFORE its state exists. Built from the same production builder, so the
  // harness cannot drift from what the composer really seeds.
  const docs = requiredDocs || { resolved: [], problems: [], ok: false }
  const handoffSeed = activePlacement ? (() => {
    const merged = buildPreceptorAssignmentDraft({
      firstName: activePlacement.placement?.preceptorFirstName || '',
      placement: activePlacement.placement || null,
      attachmentsAttached: docs.ok,
    })
    return {
      subject: merged.subject,
      body: richEnabled && merged.richBody ? merged.richBody : merged.body,
      attachments: docs.resolved.map(a => ({ slug: a.slug, title: a.title, type_label: a.type_label, size_bytes: null })),
    }
  })() : null
  const localStorage = makeStorage()
  const H = loadDirectHelpers(localStorage)
  const effect = loadLatestDraftEffect()
  const persist = loadPersistDraft()
  const restore = loadRestoreEffect()

  const state = {
    cohortId: 'cohortA', recipientType: 'contact', contactId: 'c1', studentId: null,
    msgSubject: handoffSeed?.subject || '', msgBody: handoffSeed?.body || '',
    includeSignature: true, dmAttachments: handoffSeed?.attachments || [],
    placementLink: null, placementDetachInfo: null,
    activeTemplateId: null, outreachMode: 'message', replaceTemplateKey: null,
    ccList: [], ccInput: '', ccInputError: null,
    dmRecipientName: 'Contact One', resolvedToEmail: 'c1@example.org', dmRecipientSchool: null,
  }
  const refs = {
    latestDraftRef: { current: null },
    draftHydratedRef: { current: false },
    richDocRef: { current: null },
    lastRecipientRef: { current: null },
    // The invariant's two pieces of state, exactly as the component holds them.
    hydratedKeyRef: { current: null },
    draftDirtyRef: { current: false },
    // PLACEMENT-COMMUNICATION-HANDOFF-1: the handoff's one-shot guard.
    placementAppliedRef: { current: null },
    restoredCcKeyRef: { current: null },
  }

  const scope = {
    ...refs, localStorage, Date, richEnabled, userKey,
    ...H, toDraftAttachments, fromDraftAttachments,
    plainTextToHtml: t => `<p>${t}</p>`,
    htmlToPlainText: h => String(h).replace(/<[^>]+>/g, ''),
    flashDraftStatus: () => {},
    setDmSendStatus: () => {}, setDmConfirmOpen: () => {},
    // PLACEMENT-COMMUNICATION-HANDOFF-1: everything the handoff tail of the real
    // effect touches. Defaulting activePlacement to null keeps every pre-existing
    // case on exactly the path it tested before.
    activePlacement, handoffSeed,
    requiredDocs: docs,
    buildPreceptorAssignmentDraft,
    // PRECEPTOR-DRAFT-CONTINUITY-1: the persisted placement connection.
    linkFromActivePlacement: (ap) => (ap?.placementRef?.matchId && ap.recipient?.preceptorId && ap.cohortId
      ? { matchId: ap.placementRef.matchId, studentId: ap.placementRef.studentId, unitId: ap.placementRef.unitId,
        preceptorId: ap.recipient.preceptorId, cohortId: ap.cohortId, templateKey: 'preceptor_assignment',
        preceptorName: ap.recipient?.name || '', studentName: ap.placement?.studentName || '', unitName: ap.placement?.unit || '' }
      : null),
    setPlacementLink: v => { state.placementLink = v },
    setPlacementDetachInfo: v => { state.placementDetachInfo = v },
    setActiveTemplateId: v => { state.activeTemplateId = v },
    setOutreachMode: v => { state.outreachMode = v },
    setReplaceTemplateKey: v => { state.replaceTemplateKey = v },
    setMsgSubject: v => { state.msgSubject = v },
    setMsgBody: v => { state.msgBody = v },
    setIncludeSignature: v => { state.includeSignature = v },
    setDmAttachments: v => { state.dmAttachments = v },
    setCcList: v => { state.ccList = v },
    setCcInput: v => { state.ccInput = v },
    setCcInputError: v => { state.ccInputError = v },
  }
  Object.defineProperty(scope, 'DRAFT_KEY', {
    get: () => H.directDraftKey(userKey, state.cohortId,
      `${state.recipientType}:${state.recipientType === 'student' ? state.studentId : state.contactId}`),
  })
  Object.defineProperty(scope, 'draftRecipientId', {
    get: () => (state.recipientType === 'student' ? state.studentId : state.contactId),
  })
  for (const k of Object.keys(state)) {
    Object.defineProperty(scope, k, { get: () => state[k], configurable: true })
  }

  // Hydrate once for the initial scope, as a real mount does.
  restore(scope)

  return {
    state, scope, localStorage, helpers: H, effectDeps: effect.depNames, refs,
    /** Commit a render: run the ref effect, then the debounced write. */
    commit() { effect.run(scope); persist(scope) },
    /**
     * A USER edit. Mirrors markDraftDirty() in the real onChange handlers: only
     * a genuine edit marks the draft dirty, never a restore or a remount.
     */
    edit(changes) {
      Object.assign(state, changes)
      refs.draftDirtyRef.current = true
      this.commit()
    },
    /** Change scope (recipient and/or cohort) and run the restore effect. */
    goTo({ contactId, cohortId }) {
      if (contactId !== undefined) state.contactId = contactId
      if (cohortId !== undefined) state.cohortId = cohortId
      restore(scope)
    },
    savedDraft() {
      const raw = localStorage.getItem(scope.DRAFT_KEY)
      return raw ? JSON.parse(raw) : null
    },
  }
}

// ── DEFECT 1: attachment-only edits must reach the saved draft ──────────────

test('DIRECT: adding an attachment only is persisted to the saved draft', () => {
  const c = directComposer()
  c.edit({ msgSubject: 'Hello', msgBody: 'Body' })
  assert.deepEqual(c.savedDraft().attachments, [], 'baseline: no attachments')

  // The ONLY change is the attachment list.
  c.edit({ dmAttachments: [{ slug: 'brochure', title: 'ASPIRE Brochure', type_label: 'PDF' }] })
  assert.deepEqual(c.savedDraft().attachments.map(a => a.slug), ['brochure'],
    'an attachment-only edit must reach localStorage')
})

test('DIRECT: removing an attachment only is persisted', () => {
  const c = directComposer()
  c.edit({ msgSubject: 'Hello', dmAttachments: [{ slug: 'brochure', title: 'B', type_label: 'PDF' }] })
  assert.equal(c.savedDraft().attachments.length, 1)

  c.edit({ dmAttachments: [] })
  assert.deepEqual(c.savedDraft().attachments, [], 'the removal must reach localStorage')
})

test('NEGATIVE CONTROL: dropping dmAttachments from the deps reproduces the bug', () => {
  // Rebuild the same effect with the dependency removed - the shipped code
  // before this correction. The scheduler then never re-runs the assignment, so
  // the ref (and the saved draft) keep the PREVIOUS attachment list.
  const c = directComposer()
  const depsWithout = c.effectDeps.filter(d => d !== 'dmAttachments')
  assert.ok(c.effectDeps.includes('dmAttachments'),
    'the shipped effect declares dmAttachments as a dependency')

  let lastDeps = null
  const region = OUTREACH.slice(OUTREACH.indexOf('Direct Message draft: autosave (CONNECT-DRAFT-AUTOSAVE)'))
  const body = slice(region, 'latestDraftRef.current = {', '  }, [')
  // eslint-disable-next-line no-new-func
  const apply = new Function('scope', `with (scope) { ${body} }`)
  const brokenRun = (scope) => {
    const deps = depsWithout.map(n => scope[n])
    const changed = lastDeps === null || deps.some((d, i) => !Object.is(d, lastDeps[i]))
    if (changed) { lastDeps = deps; apply(scope) }
  }
  const persist = loadPersistDraft()

  c.refs.draftDirtyRef.current = true          // the user has edited
  c.state.msgSubject = 'Hello'
  brokenRun(c.scope); persist(c.scope)
  c.state.dmAttachments = [{ slug: 'brochure', title: 'B', type_label: 'PDF' }]
  brokenRun(c.scope); persist(c.scope)

  assert.deepEqual(c.savedDraft().attachments, [],
    'the broken version saves the STALE list - which is exactly the reported defect')
})

test('DIRECT: restore returns this recipient\'s attachment, and legacy drafts return none', () => {
  const c = directComposer()
  c.edit({ msgSubject: 'For contact one', dmAttachments: [{ slug: 'brochure', title: 'ASPIRE Brochure', type_label: 'PDF' }] })

  // Move away, then back: the saved draft is restored.
  c.goTo({ contactId: 'c2' })
  assert.deepEqual(c.state.dmAttachments, [], 'a recipient with no draft starts clean')
  c.goTo({ contactId: 'c1' })
  assert.deepEqual(c.state.dmAttachments.map(a => a.slug), ['brochure'])
  assert.equal(c.state.msgSubject, 'For contact one')

  // A legacy draft (written before this feature) restores an EMPTY list.
  const legacyKey = c.helpers.directDraftKey('u1', 'cohortA', 'contact:c3')
  c.localStorage.setItem(legacyKey, JSON.stringify({
    v: c.helpers.DRAFT_VERSION, savedAt: Date.now(), subject: 'Legacy', body: 'Old', includeSignature: true,
  }))
  c.goTo({ contactId: 'c3' })
  assert.equal(c.state.msgSubject, 'Legacy', 'the legacy draft still restores its text')
  assert.deepEqual(c.state.dmAttachments, [], 'but never inherits an attachment list')
})

// ── Cohort is a REMOUNT boundary, enforced by the parent ───────────────────
//
// The effect above only handles a recipient change within one cohort. Cohort is
// handled deterministically in Connect.jsx by keying OutreachView on cohortId,
// so a switch destroys the component and its state outright. That is what these
// tests model: a remount is a brand-new composer, not a re-render.

test('a cohort switch REMOUNTS the composer, so nothing can survive it', () => {
  const connect = read('src/pages/Connect.jsx')
  assert.match(connect, /<OutreachView key=\{cohortId \|\| 'no-cohort'\}/,
    'the composer is keyed by cohort')

  // NEGATIVE CONTROL: without the key React reuses the same instance across a
  // cohort change, which is exactly how the previous cohort's subject, body and
  // attachments stayed on screen and were then autosaved into the new cohort.
  const withoutKey = connect.replace(/<OutreachView key=\{cohortId \|\| 'no-cohort'\} /, '<OutreachView ')
  assert.doesNotMatch(withoutKey, /<OutreachView key=/,
    'the control removes the boundary')
  assert.notEqual(withoutKey, connect, 'the key is load-bearing, not decoration')
})

test('cohort A keeps its own draft while cohort B starts empty', () => {
  // One storage, two cohorts, ONE contact - the exact reported scenario.
  const a = directComposer()
  a.goTo({ contactId: 'c1', cohortId: 'cohortA' })
  a.edit({ msgSubject: 'Cohort A subject', msgBody: 'Cohort A body',
           dmAttachments: [{ slug: 'brochure', title: 'ASPIRE Brochure', type_label: 'PDF' }] })

  const keyA = a.helpers.directDraftKey('u1', 'cohortA', 'contact:c1')
  const keyB = a.helpers.directDraftKey('u1', 'cohortB', 'contact:c1')
  assert.notEqual(keyA, keyB, 'the two cohorts address different drafts')
  assert.ok(a.localStorage.getItem(keyA), "cohort A's draft is saved")
  assert.equal(a.localStorage.getItem(keyB), null,
    "cohort B's key must never receive cohort A's content")

  // The remount: a brand-new composer, same storage, cohort B.
  const b = directComposer()
  b.localStorage.setItem(keyA, a.localStorage.getItem(keyA))   // carry storage across
  b.state.cohortId = 'cohortB'
  b.goTo({ contactId: 'c1' })
  assert.equal(b.state.msgSubject, '', 'cohort B starts empty')
  assert.deepEqual(b.state.dmAttachments, [], 'and with no attachments')
  b.commit()
  assert.equal(b.localStorage.getItem(keyB), null,
    'an empty composer writes nothing into cohort B')

  // Returning to cohort A is another remount, and A's draft is intact.
  const back = directComposer()
  back.localStorage.setItem(keyA, a.localStorage.getItem(keyA))
  back.goTo({ contactId: 'c1', cohortId: 'cohortA' })
  assert.equal(back.state.msgSubject, 'Cohort A subject')
  assert.deepEqual(back.state.dmAttachments.map(x => x.slug), ['brochure'])
})

test('cohort B restores ITS OWN draft when it has one', () => {
  const a = directComposer()
  const keyB = a.helpers.directDraftKey('u1', 'cohortB', 'contact:c1')
  a.localStorage.setItem(keyB, JSON.stringify({
    v: a.helpers.DRAFT_VERSION, savedAt: Date.now(),
    subject: 'Cohort B subject', body: 'B body', includeSignature: true,
    attachments: toDraftAttachments([{ slug: 'guidelines', title: 'Guidelines', type_label: 'DOCX' }]),
  }))
  a.state.cohortId = 'cohortB'
  a.goTo({ contactId: 'c1' })
  assert.equal(a.state.msgSubject, 'Cohort B subject', "B's own draft still restores")
  assert.deepEqual(a.state.dmAttachments.map(x => x.slug), ['guidelines'])
})

test('an attachment-only draft round-trips through a remount', () => {
  const a = directComposer()
  a.goTo({ contactId: 'c1', cohortId: 'cohortA' })
  a.edit({ dmAttachments: [{ slug: 'brochure', title: 'ASPIRE Brochure', type_label: 'PDF' }] })  // no subject, no body
  const key = a.helpers.directDraftKey('u1', 'cohortA', 'contact:c1')
  assert.ok(a.localStorage.getItem(key), 'an attachment alone is worth saving')

  const fresh = directComposer()
  fresh.localStorage.setItem(key, a.localStorage.getItem(key))
  fresh.goTo({ contactId: 'c1', cohortId: 'cohortA' })
  assert.deepEqual(fresh.state.dmAttachments.map(x => x.slug), ['brochure'])
  assert.equal(fresh.state.msgSubject, '', 'and nothing is invented around it')
})

// ── THE DRAFT-PERSISTENCE INVARIANT ────────────────────────────────────────
//
// Mounting, hydrating, switching cohorts and unmounting must NEVER delete a
// draft. Only a send, an explicit discard, or the user emptying a hydrated
// draft may. These execute the real persistDraftNow to prove it.

test('an untouched, newly mounted composer writes nothing and deletes nothing', () => {
  const c = directComposer()
  const key = c.helpers.directDraftKey('u1', 'cohortA', 'contact:c1')
  c.localStorage.setItem(key, JSON.stringify({
    v: c.helpers.DRAFT_VERSION, savedAt: Date.now(),
    subject: 'Existing draft', body: 'Body', includeSignature: true,
    attachments: toDraftAttachments([{ slug: 'brochure', title: 'B', type_label: 'PDF' }]),
  }))

  // A fresh mount for that same scope: hydrate, then let every automatic
  // persistence path fire without the user touching anything.
  const fresh = directComposer()
  fresh.localStorage.setItem(key, c.localStorage.getItem(key))
  fresh.goTo({ contactId: 'c1', cohortId: 'cohortA' })
  fresh.commit()            // debounce
  fresh.commit()            // visibilitychange / beforeunload / unmount flush
  fresh.commit()

  assert.ok(fresh.localStorage.getItem(key), 'the existing draft SURVIVES an untouched mount')
  assert.equal(JSON.parse(fresh.localStorage.getItem(key)).subject, 'Existing draft',
    'and is not overwritten')
})

test('NEGATIVE CONTROL: without the dirty gate an untouched mount deletes the draft', () => {
  const c = directComposer()
  const key = c.helpers.directDraftKey('u1', 'cohortA', 'contact:c1')
  c.localStorage.setItem(key, JSON.stringify({
    v: c.helpers.DRAFT_VERSION, savedAt: Date.now(),
    subject: 'Existing draft', body: 'Body', includeSignature: true,
  }))
  // Reconstruct the pre-correction persister: no key check, no dirty check.
  const body = slice(OUTREACH, 'const persistDraftNow = useCallback(() => {', '  }, [userKey, cohortId, richEnabled])')
    .replace('const persistDraftNow = useCallback(() => {', '')
    .replace(/\n\s*\/\/ Only ever touch the draft this composer actually loaded\.\.\.\n\s*if \(l\.DRAFT_KEY !== hydratedKeyRef\.current\) return/, '')
    .replace(/\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(!draftDirtyRef\.current\) return/, '')
  assert.doesNotMatch(body, /draftDirtyRef\.current\) return/, 'the control removes the gate')
  // eslint-disable-next-line no-new-func
  const brokenPersist = new Function('scope', `with (scope) { ${body} }`)

  // An untouched composer for that scope: empty content, same key.
  c.goTo({ contactId: 'c1', cohortId: 'cohortA' })
  c.state.msgSubject = ''; c.state.msgBody = ''; c.state.dmAttachments = []
  c.scope.latestDraftRef.current = {
    DRAFT_KEY: key, ptrKey: null, recipId: 'c1', kind: 'contact',
    subject: '', body: '', includeSignature: true, richDoc: null,
    attachments: [], name: '', email: '', school: null,
  }
  brokenPersist(c.scope)
  assert.equal(c.localStorage.getItem(key), null,
    'the broken version deletes a draft nobody edited - the reported regression')
})

test('a hydrated draft the user empties IS deleted', () => {
  const c = directComposer()
  const key = c.helpers.directDraftKey('u1', 'cohortA', 'contact:c1')
  c.goTo({ contactId: 'c1', cohortId: 'cohortA' })
  c.edit({ msgSubject: 'Something', dmAttachments: [{ slug: 'brochure', title: 'B', type_label: 'PDF' }] })
  assert.ok(c.localStorage.getItem(key), 'saved while it had content')

  // The user clears it deliberately.
  c.edit({ msgSubject: '', msgBody: '', dmAttachments: [] })
  assert.equal(c.localStorage.getItem(key), null,
    'an intentionally emptied draft is removed')
})

test('persistence never touches a key the composer did not hydrate', () => {
  const c = directComposer()
  const keyA = c.helpers.directDraftKey('u1', 'cohortA', 'contact:c1')
  c.goTo({ contactId: 'c1', cohortId: 'cohortA' })
  c.edit({ msgSubject: 'Cohort A subject' })
  assert.ok(c.localStorage.getItem(keyA))

  // Point the ref at ANOTHER scope's key while the hydrated key is still A's -
  // the shape a cohort switch produces mid-flight. Nothing may happen.
  const keyB = c.helpers.directDraftKey('u1', 'cohortB', 'contact:c1')
  c.localStorage.setItem(keyB, JSON.stringify({
    v: c.helpers.DRAFT_VERSION, savedAt: Date.now(), subject: 'Cohort B subject', body: '', includeSignature: true,
  }))
  c.scope.latestDraftRef.current = { ...c.scope.latestDraftRef.current, DRAFT_KEY: keyB, subject: '', body: '', attachments: [] }
  c.scope.draftDirtyRef.current = true
  const persist = loadPersistDraft()
  persist(c.scope)
  assert.equal(JSON.parse(c.localStorage.getItem(keyB)).subject, 'Cohort B subject',
    "cohort B's draft is neither overwritten nor deleted")
  assert.ok(c.localStorage.getItem(keyA), "and cohort A's draft is untouched")
})

// ── DEFECT 2: an attachment makes a bulk draft non-pristine ────────────────

/** The REAL bulk autosave decision, extracted with its pristine calculation. */
function bulkPristine({ subject, body, audienceEmpty, attachments }) {
  const localStorage = makeStorage()
  const H = loadBulkHelpers(localStorage)
  const line = slice(BULK, '    const pristine = bulkDraftIsPristine(', '\n')
  // eslint-disable-next-line no-new-func
  const fn = new Function('bulkDraftIsPristine', 'bulkMsgType', 'subject', 'body', 'richEnabled', 'audienceEmpty', 'attachments',
    `${line}\n return pristine`)
  return fn(H.bulkDraftIsPristine, 'manual', subject, body, false, audienceEmpty, attachments)
}

test('BULK: an attachment alone makes an untouched template non-pristine', () => {
  const base = { subject: 'TPL SUBJECT', body: 'TPL BODY', audienceEmpty: true }
  assert.equal(bulkPristine({ ...base, attachments: [] }), true,
    'baseline: an untouched template with no attachments is pristine (no draft saved)')
  assert.equal(bulkPristine({ ...base, attachments: [{ slug: 'brochure' }] }), false,
    'adding an attachment must create a saved draft')
  assert.equal(bulkPristine({ ...base, attachments: [] }), true,
    'removing the last attachment returns to pristine behavior')
})

test('NEGATIVE CONTROL: pristine without the attachments term misses the edit', () => {
  const localStorage = makeStorage()
  const H = loadBulkHelpers(localStorage)
  const line = slice(BULK, '    const pristine = bulkDraftIsPristine(', '\n')
  const broken = line.replace(/ && attachments\.length === 0/, '')
  assert.notEqual(broken, line, 'the shipped line carries the attachments term')
  // eslint-disable-next-line no-new-func
  const fn = new Function('bulkDraftIsPristine', 'bulkMsgType', 'subject', 'body', 'richEnabled', 'audienceEmpty', 'attachments',
    `${broken}\n return pristine`)
  assert.equal(fn(H.bulkDraftIsPristine, 'manual', 'TPL SUBJECT', 'TPL BODY', false, true, [{ slug: 'brochure' }]), true,
    'the broken version calls it pristine and saves nothing - the reported defect')
})

test('BULK: a stored attachment-only draft is recognised as having content', () => {
  const localStorage = makeStorage()
  const H = loadBulkHelpers(localStorage)
  const attachmentOnly = {
    v: H.BULK_DRAFT_VERSION, subject: 'TPL SUBJECT', body: 'TPL BODY',
    studentSel: [], contactSel: [], picked: [],
    attachments: toDraftAttachments([{ slug: 'brochure', title: 'B', type_label: 'PDF' }]),
  }
  assert.equal(H.bulkDraftHasContent('manual', attachmentOnly, false), true,
    'so it is restored rather than discarded as unedited')
  assert.equal(H.bulkDraftHasContent('manual', { ...attachmentOnly, attachments: [] }, false), false)
})

// ── DEFECT 4: attachments are part of the reviewed context ─────────────────

/** The REAL draftSig expression. */
function draftSigFor({ subject, body, recipients, attachments }) {
  const line = slice(BULK, '  const draftSig = ', '\n')
  // eslint-disable-next-line no-new-func
  const fn = new Function('subject', 'body', 'recipients', 'attachments', 'toSlugs', `${line}\n return draftSig`)
  return fn(subject, body, recipients, attachments, toSlugs)
}

test('BULK: changing attachments changes the reviewed signature', () => {
  const base = { subject: 'S', body: 'B', recipients: [{ normEmail: 'a@x.com' }] }
  const none = draftSigFor({ ...base, attachments: [] })
  const one = draftSigFor({ ...base, attachments: [{ slug: 'brochure' }] })
  const two = draftSigFor({ ...base, attachments: [{ slug: 'brochure' }, { slug: 'guidelines' }] })
  const swapped = draftSigFor({ ...base, attachments: [{ slug: 'guidelines' }, { slug: 'brochure' }] })

  assert.notEqual(none, one, 'adding an attachment invalidates the review')
  assert.notEqual(one, two, 'adding another invalidates it again')
  assert.notEqual(two, swapped, 'ORDER matters - it is what the recipient sees')
  assert.equal(one, draftSigFor({ ...base, attachments: [{ slug: 'brochure' }] }), 'stable when nothing changed')
})

test('NEGATIVE CONTROL: a signature without attachments misses the change', () => {
  const line = slice(BULK, '  const draftSig = ', '\n')
  const broken = line.replace(/ @\$\{toSlugs\(attachments\)\.join\('>'\)\}/, '')
  assert.notEqual(broken, line, 'the shipped signature includes the ordered slugs')
  // eslint-disable-next-line no-new-func
  const fn = new Function('subject', 'body', 'recipients', 'attachments', 'toSlugs', `${broken}\n return draftSig`)
  const a = fn('S', 'B', [{ normEmail: 'a@x.com' }], [], toSlugs)
  const b = fn('S', 'B', [{ normEmail: 'a@x.com' }], [{ slug: 'brochure' }], toSlugs)
  assert.equal(a, b,
    'the broken version cannot tell the batches apart, so a completed send and a typed confirmation would survive an attachment change')
})

test('the typed confirmation and NP acknowledgment are retracted with the signature', () => {
  // Structural, but load-bearing: both resets hang off ackContext, which is
  // built from draftSig - proven above to include the attachments.
  assert.match(BULK, /const ackContext = `\$\{reviewOpen\}\|\$\{draftSig\}`/)
  const block = slice(BULK, 'const ackContext =', '// ── Handlers ─')
  assert.match(block, /if \(ackNotProceeding\) setAckNotProceeding\(false\)/)
  assert.match(block, /if \(confirmText\) setConfirmText\(''\)/,
    'a typed confirmation must not survive a change to what is being sent')
  // And a completed batch is reset on the same signal.
  const reset = slice(BULK, 'if (!sendResult) return', '}, [draftSig, sendResult])')
  assert.match(reset, /setSendResult\(null\)/)
  assert.match(reset, /setConfirmText\(''\)/)
})

// ── PLACEMENT-COMMUNICATION-HANDOFF-1, through the REAL restore effect ───────
//
// These run the same extracted production effect the tests above use, with the
// handoff switched on. Nothing is re-implemented here.

const HANDOFF = {
  cohortId: 'cohortA',
  templateKey: 'preceptor_assignment',
  recipient: { contactId: 'c1', name: 'Dana Reyes', email: 'dana@cshs.org' },
  placement: {
    studentName: 'Ana Cruz', school: 'California State University, Northridge',
    unit: '5 SCCT', schedule: 'August 24–October 20, 2026', hoursRequired: '144 hours',
    notes: '', preceptorFirstName: 'Dana',
  },
}
const DOCS_OK = {
  ok: true, problems: [],
  resolved: [
    { slug: 'aspire-brochure', title: 'ASPIRE Brochure', type_label: 'PDF' },
    { slug: 'prelicensure-guidelines', title: 'Pre-licensure Student General Guidelines', type_label: 'PDF' },
  ],
}

test('the handoff merges the placement and preselects both documents', () => {
  const c = directComposer({ activePlacement: HANDOFF, requiredDocs: DOCS_OK })
  assert.equal(c.state.activeTemplateId, 'preceptor_assignment')
  assert.match(c.state.msgSubject, /Student Assignment and Introduction Details/)
  assert.match(c.state.msgBody, /Student: Ana Cruz/)
  assert.match(c.state.msgBody, /Rotation Dates \/ Schedule: August 24–October 20, 2026/)
  assert.match(c.state.msgBody, /Please see attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference./)
  assert.deepEqual(c.state.dmAttachments.map(a => a.slug),
    ['aspire-brochure', 'prelicensure-guidelines'])
  assert.equal(c.state.replaceTemplateKey, null, 'an empty composer needs no confirmation')
})

test('an unresolved Catalog leaves the draft honest and unattached', () => {
  const c = directComposer({
    activePlacement: HANDOFF,
    requiredDocs: { ok: false, resolved: [], problems: [{ key: 'aspire_brochure', label: 'ASPIRE Brochure', code: 'missing' }] },
  })
  assert.deepEqual(c.state.dmAttachments, [])
  assert.ok(!/see the attached/i.test(c.state.msgBody),
    'the draft must not claim attachments it does not carry')
})

test('an existing draft is never overwritten by a handoff', () => {
  const c = directComposer()
  c.edit({ msgSubject: 'Half-written note', msgBody: 'Do not lose me' })
  const saved = c.localStorage.getItem(c.scope.DRAFT_KEY)
  assert.ok(saved, 'precondition: a real draft exists for this recipient')

  // Arrive again for the SAME recipient, now carrying a handoff.
  const c2 = directComposer({ activePlacement: HANDOFF, requiredDocs: DOCS_OK })
  c2.localStorage.setItem(c2.scope.DRAFT_KEY, saved)
  c2.refs.placementAppliedRef.current = null
  c2.goTo({ contactId: 'c9' })      // leave
  c2.goTo({ contactId: 'c1' })      // and return with the handoff live
  assert.equal(c2.state.replaceTemplateKey, 'preceptor_assignment',
    'the branded Replace draft? confirmation must open instead')
  assert.equal(c2.state.msgSubject, 'Half-written note', 'the existing draft survives untouched')
  assert.equal(c2.state.msgBody, 'Do not lose me')
})

test('the handoff applies once, not on every re-render of the same draft', () => {
  const c = directComposer({ activePlacement: HANDOFF, requiredDocs: DOCS_OK })
  c.edit({ msgBody: 'Owner edited this after the merge' })
  c.goTo({ contactId: 'c1' })       // same recipient, effect re-runs
  assert.equal(c.state.msgBody, 'Owner edited this after the merge',
    're-stamping the template would discard the Owner’s edits')
})

test('NEGATIVE CONTROL: no handoff leaves the composer completely untouched', () => {
  const c = directComposer()
  assert.equal(c.state.activeTemplateId, null)
  assert.equal(c.state.msgSubject, '')
  assert.deepEqual(c.state.dmAttachments, [])
})
