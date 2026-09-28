// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: client-half regression guards for
// per-user message reactions on both the staff Connect Messages thread and the
// Student/Unit Leader/Academic Partner Portal thread. Static-source and pure-
// function assertions, matching the repository's node:test stack (no
// testing-library, no jsdom). No real API call, RPC, conversation, or student
// content.
//
// Companion server-half guards: test/messagesReactionsServer.test.mjs
// Companion contract: api/messages-staff-thread.js, api/portal/messages-thread.js
//                      (both gain top-level reactions_available), plus
//                      setMessageReaction / portalSetMessageReaction in the two
//                      API clients.
//
// Run: node --test test/messagesReactionsUi.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  MESSAGE_REACTIONS, LEGACY_MESSAGE_REACTIONS, reactionByKey, applyOptimisticReaction,
  applyOptimisticReactors, reactionSentences, reactionBadgeContent,
} from '../src/lib/messages/reactionConstants.js'
import { canReactTo } from '../src/lib/messages/messagesTriage.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const reactionConstantsSrc = read('src/lib/messages/reactionConstants.js')
// MESSAGES-SIMPLIFY-1: the trigger hook lives beside the component (fast
// refresh wants component files to export components only); read as one.
const messageReactions = read('src/components/shared/MessageReactions.jsx') + '\n' + read('src/components/shared/useReactionTrigger.js')
const messageBubble = read('src/components/shared/MessageBubble.jsx')
const staffWorkspace = read('src/components/connect/messages/MessagesWorkspace.jsx')
const portalThread = read('src/portal/messages/PortalMessagesThread.jsx')
const globalCss = read('src/index.css')
const portalCss = read('src/portal/portal.css')

// Every file this task created or edited, for the hygiene checks at the
// bottom (em dash, no touch/gesture code).
const allChanged = {
  reactionConstantsSrc, messageReactions, messageBubble, staffWorkspace, portalThread, globalCss, portalCss,
}

test('reactionConstants: the refined six-key set preserves the legacy fallback', async (t) => {
  await t.test('MESSAGE_REACTIONS has the six approved keys and labels', () => {
    assert.equal(MESSAGE_REACTIONS.length, 6)
    assert.deepEqual(MESSAGE_REACTIONS.map((r) => r.key), ['acknowledge', 'on_it', 'done', 'thanks', 'warm', 'celebrate'])
    assert.deepEqual(MESSAGE_REACTIONS.map((r) => r.label), ['Got it', 'On it', 'Done', 'Thanks', 'Warm', 'Milestone'])
    assert.deepEqual(LEGACY_MESSAGE_REACTIONS.map((r) => r.key), ['acknowledge', 'thanks', 'celebrate'])
    for (const r of MESSAGE_REACTIONS) {
      assert.ok(r.glyph && r.glyph.length > 0, `${r.key} must carry a glyph`)
    }
  })

  await t.test('reactionByKey resolves a known key and returns undefined for an unknown one', () => {
    assert.equal(reactionByKey('thanks')?.label, 'Thanks')
    assert.equal(reactionByKey('bogus'), undefined)
    assert.equal(reactionByKey(), undefined)
  })

  await t.test('the source literally names all six closed-set keys', () => {
    for (const key of ['acknowledge', 'on_it', 'done', 'thanks', 'warm', 'celebrate']) {
      assert.match(reactionConstantsSrc, new RegExp(`key: '${key}'`))
    }
  })
})

test('applyOptimisticReaction: local merge matches the one-reaction-per-caller rule', async (t) => {
  await t.test('selecting a new key when the caller had none adds it with mine true, count 1', () => {
    const next = applyOptimisticReaction([], 'thanks')
    assert.deepEqual(next, [{ key: 'thanks', count: 1, mine: true }])
  })

  await t.test('sending null removes the caller\'s current reaction and decrements its count', () => {
    const next = applyOptimisticReaction([{ key: 'thanks', count: 3, mine: true }], null)
    assert.deepEqual(next, [{ key: 'thanks', count: 2, mine: false }])
  })

  await t.test('sending null drops the entry entirely once its count reaches zero', () => {
    const next = applyOptimisticReaction([{ key: 'thanks', count: 1, mine: true }], null)
    assert.deepEqual(next, [])
  })

  await t.test('replacing removes the old key and adds or increments the new one', () => {
    const next = applyOptimisticReaction(
      [{ key: 'thanks', count: 1, mine: true }, { key: 'celebrate', count: 2, mine: false }],
      'celebrate',
    )
    assert.deepEqual(next.find((r) => r.key === 'thanks'), undefined)
    assert.deepEqual(next.find((r) => r.key === 'celebrate'), { key: 'celebrate', count: 3, mine: true })
  })

  await t.test('never mutates the array or objects passed in', () => {
    const input = [{ key: 'thanks', count: 1, mine: true }]
    const inputCopy = JSON.parse(JSON.stringify(input))
    applyOptimisticReaction(input, null)
    assert.deepEqual(input, inputCopy)
  })
})

// MESSAGES-SIMPLIFY-1 (20261014000000): reactions are iMessage style. The
// always-visible add button and the chips under the bubble are gone; a long
// press, a right-click or Enter opens a bar, and a corner badge shows what was
// picked. These replace the chip-and-menu assertions.
test('MessageReactions: long press, right-click and keyboard open the bar', async (t) => {
  await t.test('a 450 ms press opens it; moving more than 8 px or releasing early cancels it', () => {
    assert.match(messageReactions, /export const LONG_PRESS_MS = 450/)
    assert.match(messageReactions, /export const LONG_PRESS_SLOP_PX = 8/)
    assert.match(messageReactions, /onPointerDown:/)
    assert.match(messageReactions, /Math\.hypot\(e\.clientX - start\.x, e\.clientY - start\.y\) > LONG_PRESS_SLOP_PX\) cancelPress\(\)/)
    assert.match(messageReactions, /onPointerUp: cancelPress/)
    assert.match(messageReactions, /onPointerCancel: cancelPress/)
    // Pointer events, not touch events.
    assert.doesNotMatch(strip(messageReactions), /onTouchStart|onTouchEnd|onTouchMove|touchstart|touchend|touchmove/i)
  })

  await t.test('right-click opens the bar and suppresses the browser menu only on the bubble', () => {
    assert.match(messageReactions, /onContextMenu: \(e\) => \{\s*\n\s*e\.preventDefault\(\)/)
    assert.doesNotMatch(strip(messageReactions), /document\.addEventListener\('contextmenu'/)
  })

  await t.test('the bubble is focusable; Enter or Space opens the bar', () => {
    assert.match(messageReactions, /tabIndex: 0/)
    assert.match(messageReactions, /e\.key === 'Enter' \|\| e\.key === ' '/)
  })

  await t.test('the bar is a toolbar: arrows move, Escape closes and returns focus to the bubble', () => {
    assert.match(messageReactions, /role="toolbar"/)
    assert.match(messageReactions, /aria-label="Reactions"/)
    assert.match(messageReactions, /e\.key === 'ArrowRight'/)
    assert.match(messageReactions, /e\.key === 'ArrowLeft'/)
    assert.match(messageReactions, /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); onClose\(true\)/)
    assert.match(messageReactions, /if \(returnFocus\) bubbleRef\.current\?\.focus\(\)/)
  })

  await t.test('an outside click closes it; it opens above, flips below, and stays in the viewport', () => {
    assert.match(messageReactions, /document\.addEventListener\('pointerdown', onPointerDown, true\)/)
    assert.match(messageReactions, /let top = r\.top - GAP - h/)
    assert.match(messageReactions, /if \(top < EDGE\) \{\s*\n\s*top = r\.bottom \+ GAP/)
    assert.match(messageReactions, /Math\.max\(EDGE, Math\.min\(left, vw - w - EDGE\)\)/)
  })

  await t.test('the current reaction is aria-pressed, and picking it again removes it', () => {
    assert.match(messageReactions, /aria-pressed=\{on\}/)
    assert.match(messageReactions, /const next = key === mineKey \? null : key/)
    assert.match(messageReactions, /'Removed reaction'/)
    assert.match(messageReactions, /`Reacted \$\{reactionByKey\(key\)\?\.label/)
  })

  await t.test('no always-visible add button and no chips remain', () => {
    assert.doesNotMatch(messageReactions, /msg-reaction-add|msg-reaction-chip|SmilePlus|Add reaction/)
  })
})

test('the corner badge', async (t) => {
  await t.test('shows up to three distinct emoji, most used first, and the total when above one', () => {
    const one = reactionBadgeContent({ reactions: [{ key: 'acknowledge', count: 1, mine: true }] })
    assert.deepEqual(one, { glyphs: ['👍'], total: 1 })
    const many = reactionBadgeContent({ reactions: [
      { key: 'thanks', count: 1 }, { key: 'acknowledge', count: 3 }, { key: 'warm', count: 1 }, { key: 'celebrate', count: 2 },
    ] })
    assert.deepEqual(many.glyphs, ['👍', '🎉', '🙏'])
    assert.equal(many.total, 7)
    assert.match(messageReactions, /\{total > 1 && <span aria-hidden="true" className="msg-reaction-badge__count">\{total\}<\/span>\}/)
  })

  await t.test('says who reacted: You, a first name, or Reacted when the portal hides names', () => {
    const staffView = { reactors: [
      { key: 'acknowledge', profile_id: 'me', name: 'Jester Lloyd Bautista', is_staff: true },
      { key: 'thanks', profile_id: 'k', name: 'Krystal Rodriguez', is_staff: true },
    ] }
    assert.deepEqual(reactionSentences(staffView, 'me'), ['You reacted Got it', 'Krystal reacted Thanks'])
    const portalView = { reactions: [{ key: 'acknowledge', count: 2, mine: true }] }
    assert.deepEqual(reactionSentences(portalView), ['You reacted Got it', 'Reacted Got it'])
  })

  await t.test('the badge shows emoji only and carries the names in its label and hover title', () => {
    assert.match(messageReactions, /role="img"\s*\n\s*aria-label=\{label\}\s*\n\s*title=\{label\}/)
  })

  await t.test('the optimistic reactor list follows the same one-per-person rule', () => {
    const viewer = { id: 'me', full_name: 'Jester Lloyd Bautista' }
    const before = [{ key: 'thanks', profile_id: 'me', name: 'Jester Lloyd Bautista', is_staff: true }]
    assert.deepEqual(applyOptimisticReactors(before, viewer, 'acknowledge').map((r) => r.key), ['acknowledge'])
    assert.deepEqual(applyOptimisticReactors(before, viewer, null), [])
  })
})

test('who may react', async (t) => {
  await t.test('staff react to participant messages, participants to staff messages, nobody to their own', () => {
    assert.equal(canReactTo({ author_role: 'student' }, 'staff'), true)
    assert.equal(canReactTo({ author_role: 'staff' }, 'staff'), false)
    assert.equal(canReactTo({ author_type: 'staff' }, 'portal'), true)
    assert.equal(canReactTo({ author_type: 'me' }, 'portal'), false)
    assert.equal(canReactTo({ author_role: 'system' }, 'staff'), false)
  })
})

test('MessageBubble: reactions render only behind the opt-in prop', async (t) => {
  await t.test('reactionsEnabled defaults to false, so an untouched caller renders nothing new', () => {
    assert.match(messageBubble, /reactionsEnabled = false,/)
  })

  await t.test('the badge, bar and trigger come from MessageReactions and are gated', () => {
    assert.match(messageBubble, /import \{ ReactionBadge, ReactionBar \} from '\.\/MessageReactions'/)
    assert.match(messageBubble, /import \{ useReactionTrigger \} from '\.\/useReactionTrigger'/)
    assert.match(messageBubble, /const canReact = reactionsEnabled && !neutral && canReactTo\(message, perspective\)/)
    assert.match(messageBubble, /useReactionTrigger\(\{ enabled: canReact \}\)/)
    assert.match(messageBubble, /\{reactionsEnabled && \(\s*\n\s*<ReactionBadge/)
  })

  await t.test('the badge sits on the top outer corner: right for incoming, left for outgoing', () => {
    assert.match(messageBubble, /side=\{outgoing \? 'left' : 'right'\}/)
    assert.match(globalCss, /\.msg-reaction-badge--right \{ right: -12px;/)
    assert.match(globalCss, /\.msg-reaction-badge--left \{ left: -12px; \}/)
    assert.match(globalCss, /\.msg-reaction-badge \{\s*\n\s*position: absolute;\s*\n\s*top: -12px;/)
  })

  await t.test("a reactable bubble's accessible name has the sender, the text and the hint", () => {
    assert.match(messageBubble, /`Message from \$\{displayName\}, sent \$\{fullTime\}: \$\{message\?\.body \|\| ''\}\. Press Enter to react\.`/)
  })

  await t.test('the pinned body line is untouched, and the badge renders after it', () => {
    assert.match(messageBubble, /<div className=\{`msg-bubble-body \$\{bodyClassName\}`\}>\{message\?\.body\}<\/div>/)
    assert.ok(messageBubble.indexOf('<ReactionBadge') > messageBubble.indexOf('msg-bubble-body'))
  })

  await t.test('onSetReaction, reactionsDisabled and the version reach the bar', () => {
    assert.match(messageBubble, /onSetReaction,/)
    assert.match(messageBubble, /reactionsDisabled = false,/)
    assert.match(messageBubble, /onSetReaction=\{onSetReaction\}[\s\S]{0,120}disabled=\{reactionsDisabled\}[\s\S]{0,100}reactionSetVersion=\{reactionSetVersion\}/)
  })

  await t.test('changes are announced in a polite live region', () => {
    assert.match(messageBubble, /<span className="msg-reaction-live" role="status" aria-live="polite">\{announcement\}<\/span>/)
  })
})

test('staff workspace: wires setMessageReaction and reactions_available', async (t) => {
  await t.test('reactionsAvailable fails closed, matching the archiveAvailable convention', () => {
    assert.match(staffWorkspace, /const reactionsAvailable = pages\.some\(\(p\) => p\?\.reactions_available === true\)/)
  })

  await t.test('the correct client function is called with the correct shape', () => {
    assert.match(staffWorkspace, /api\.setMessageReaction\(\{ messageId, reaction: nextKey \}\)/)
    assert.doesNotMatch(staffWorkspace, /portalSetMessageReaction/)
  })

  await t.test('a duplicate request for the same message is prevented while one is in flight', () => {
    const fn = staffWorkspace.slice(staffWorkspace.indexOf('const setReaction = useCallback'), staffWorkspace.indexOf('const setReaction = useCallback') + 3400)
    assert.match(fn, /reactionBusyRef\.current\.has\(messageId\)\) return/)
    assert.match(fn, /reactionBusyRef\.current\.add\(messageId\)/)
    assert.match(fn, /reactionBusyRef\.current\.delete\(messageId\)/)
  })

  await t.test('optimistic update writes to the exact thread query key, then reconciles or reverts', () => {
    const fn = staffWorkspace.slice(staffWorkspace.indexOf('const setReaction = useCallback'), staffWorkspace.indexOf('const setReaction = useCallback') + 3400)
    assert.match(fn, /const threadQueryKey = \['messages_staff_thread', conversationId\]/)
    assert.match(fn, /applyOptimisticReaction\(/)
    assert.match(fn, /queryClient\.setQueryData\(threadQueryKey, previous\)/)
    assert.match(fn, /announce\(mapMessagesError\(err\?\.status\)\)/)
  })

  await t.test('MessageBubble in the thread receives the reaction wiring', () => {
    assert.match(staffWorkspace, /reactionsEnabled=\{reactionsEnabled\}/)
    assert.match(staffWorkspace, /reactionsEnabled=\{reactionsAvailable\}/)
    assert.match(staffWorkspace, /onSetReaction=\{setReaction\}/)
    assert.match(staffWorkspace, /reactionsDisabled=\{busyReactionIds\.has\(m\.id\)\}/)
  })
})

test('portal thread: wires portalSetMessageReaction and reactions_available', async (t) => {
  await t.test('reactionsAvailable fails closed, matching the archiveAvailable convention', () => {
    assert.match(portalThread, /const reactionsAvailable = pages\.some\(\(p\) => p\?\.reactions_available === true\)/)
  })

  await t.test('the correct client function is imported and called with the correct shape', () => {
    assert.match(portalThread, /import \{ getPortalThreadPage, portalSetMessageReaction \} from '\.\.\/\.\.\/lib\/messages\/portalMessagesApiClient'/)
    assert.match(portalThread, /api\.portalSetMessageReaction\(\{ messageId, reaction: nextKey \}\)/)
    assert.doesNotMatch(portalThread, /api\.setMessageReaction\(/)
  })

  await t.test('a duplicate request for the same message is prevented while one is in flight', () => {
    const fn = portalThread.slice(portalThread.indexOf('const setReaction = useCallback'), portalThread.indexOf('const setReaction = useCallback') + 2200)
    assert.match(fn, /reactionBusyRef\.current\.has\(messageId\)\) return/)
    assert.match(fn, /reactionBusyRef\.current\.add\(messageId\)/)
    assert.match(fn, /reactionBusyRef\.current\.delete\(messageId\)/)
  })

  await t.test('optimistic update writes to the exact thread query key, then reconciles or reverts', () => {
    const fn = portalThread.slice(portalThread.indexOf('const setReaction = useCallback'), portalThread.indexOf('const setReaction = useCallback') + 2200)
    assert.match(fn, /const threadQueryKey = portalThreadQueryKey\(conversationId\)/)
    assert.match(fn, /applyOptimisticReaction\(/)
    assert.match(fn, /queryClient\.setQueryData\(threadQueryKey, previous\)/)
    assert.match(fn, /setReactionError\(mapPortalMessagesError\(err\?\.status\)\)/)
  })

  await t.test('MessageBubble in the thread receives the reaction wiring', () => {
    assert.match(portalThread, /reactionsEnabled=\{reactionsAvailable\}/)
    assert.match(portalThread, /onSetReaction=\{setReaction\}/)
    assert.match(portalThread, /reactionsDisabled=\{busyReactionIds\.has\(m\.id\)\}/)
  })

  await t.test('a reaction failure surfaces through the same inline error class the composer already uses', () => {
    assert.match(portalThread, /className="ptl-form-error" role="alert"/)
  })
})

test('CSS: the badge and bar live once in src/index.css', async (t) => {
  await t.test('src/index.css defines the badge, the bar and its options', () => {
    assert.match(globalCss, /\.msg-reaction-badge \{/)
    assert.match(globalCss, /\.msg-reaction-bar \{/)
    assert.match(globalCss, /\.msg-reaction-option \{/)
    assert.match(globalCss, /\.msg-reaction-option\[aria-pressed='true'\] \{ background: var\(--messages-reaction-picked/)
  })

  await t.test('every option is a 44px target with a visible focus ring, and the bubble has one too', () => {
    const block = globalCss.slice(globalCss.indexOf('.msg-reaction-option {'), globalCss.indexOf('.msg-reaction-option {') + 300)
    assert.match(block, /width: 44px;/)
    assert.match(block, /height: 44px;/)
    assert.match(globalCss, /\.msg-reaction-option:focus-visible \{/)
    assert.match(globalCss, /\.msg-bubble-reactable:focus-visible \{/)
  })

  await t.test('the pop animation runs only without a reduced-motion preference', () => {
    assert.match(globalCss, /@media \(prefers-reduced-motion: no-preference\) \{\s*\n\s*\.msg-reaction-bar \{ animation:/)
  })

  await t.test('the iOS callout and selection are suppressed during the press only', () => {
    assert.match(globalCss, /\.msg-bubble-pressing,\s*\n\.msg-bubble-pressing \* \{[^}]*-webkit-touch-callout: none;[^}]*user-select: none;/)
  })

  await t.test('the retired chip rules are gone from both stylesheets', () => {
    assert.doesNotMatch(globalCss, /\.msg-reaction-chip|\.msg-reaction-add/)
    assert.doesNotMatch(portalCss, /\.msg-reaction-chip|\.msg-reaction-add/)
  })

  await t.test('no new rule disturbs the pinned legacy .ptl-msg-item slice', () => {
    const legacy = portalCss.slice(portalCss.indexOf('.ptl-msg-item {'), portalCss.indexOf('.ptl-msg-author {'))
    assert.doesNotMatch(legacy, /msg-reaction-/)
  })
})

test('hygiene', async (t) => {
  await t.test('no em dash was introduced in any file created or edited for this task', () => {
    for (const [name, src] of Object.entries(allChanged)) {
      assert.doesNotMatch(src, /—/, `${name} must not use an em dash`)
    }
  })

  await t.test('no touch or gesture handler was added anywhere', () => {
    for (const [name, src] of Object.entries(allChanged)) {
      assert.doesNotMatch(src, /onTouchStart|onTouchMove|onTouchEnd|touchstart|touchmove|touchend|Swipe|swipe/i, `${name} must not add gesture code`)
    }
  })

  await t.test('ASPIRE, never the deprecated long form', () => {
    for (const [name, src] of Object.entries(allChanged)) {
      assert.doesNotMatch(src, /ASPIRE Program/, `${name} must not use the deprecated long form`)
    }
  })
})
