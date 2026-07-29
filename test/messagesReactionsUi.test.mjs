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

import { MESSAGE_REACTIONS, reactionByKey, applyOptimisticReaction } from '../src/lib/messages/reactionConstants.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const reactionConstantsSrc = read('src/lib/messages/reactionConstants.js')
const messageReactions = read('src/components/shared/MessageReactions.jsx')
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

test('reactionConstants: exactly the three server-allowed keys and labels', async (t) => {
  await t.test('MESSAGE_REACTIONS has exactly three entries with the exact approved labels', () => {
    assert.equal(MESSAGE_REACTIONS.length, 3)
    assert.deepEqual(MESSAGE_REACTIONS.map((r) => r.key), ['acknowledge', 'thanks', 'celebrate'])
    assert.deepEqual(MESSAGE_REACTIONS.map((r) => r.label), ['Got it', 'Thank you', 'Celebrate'])
    for (const r of MESSAGE_REACTIONS) {
      assert.ok(r.glyph && r.glyph.length > 0, `${r.key} must carry a glyph`)
    }
  })

  await t.test('reactionByKey resolves a known key and returns undefined for an unknown one', () => {
    assert.equal(reactionByKey('thanks')?.label, 'Thank you')
    assert.equal(reactionByKey('bogus'), undefined)
    assert.equal(reactionByKey(), undefined)
  })

  await t.test('the source literally names the three keys as a closed allowlist, matching the migration CHECK', () => {
    assert.match(reactionConstantsSrc, /key: 'acknowledge'/)
    assert.match(reactionConstantsSrc, /key: 'thanks'/)
    assert.match(reactionConstantsSrc, /key: 'celebrate'/)
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

test('MessageReactions: accessible chip and add-reaction affordances', async (t) => {
  await t.test('chips are real buttons using aria-pressed, never color alone', () => {
    assert.match(messageReactions, /aria-pressed=\{mine\}/)
    assert.match(messageReactions, /className=\{`msg-reaction-chip\$\{mine \? ' msg-reaction-chip-mine' : ''\}`\}/)
  })

  await t.test('chip accessible name matches the approved pattern, singular and plural', () => {
    assert.match(messageReactions, /\$\{def\.label\}, \$\{r\.count\} reaction\$\{r\.count === 1 \? '' : 's'\}\$\{mine \? ', including yours' : ''\}/)
  })

  await t.test('the trigger has the exact accessible name "Add reaction" and opens a real menu', () => {
    assert.match(messageReactions, /aria-label="Add reaction"/)
    assert.match(messageReactions, /aria-haspopup="menu"/)
    assert.match(messageReactions, /role="menu"/)
  })

  await t.test('menu options carry glyph plus a real text label, never emoji-only', () => {
    assert.match(messageReactions, /msg-reaction-option-glyph/)
    assert.match(messageReactions, /msg-reaction-option-label/)
    assert.match(messageReactions, /\{def\.label\}/)
  })

  await t.test('the current reaction is marked in the menu via aria-checked, and selecting it removes it', () => {
    assert.match(messageReactions, /role="menuitemradio"/)
    assert.match(messageReactions, /aria-checked=\{checked\}/)
    assert.match(messageReactions, /const next = key === mineKey \? null : key/)
  })

  await t.test('every rendered reaction key is defensively checked against the allowlist', () => {
    assert.match(messageReactions, /reactionByKey\(r\.key\)/)
    assert.match(messageReactions, /r && reactionByKey\(r\.key\) && r\.count > 0/)
  })

  await t.test('the popover follows the RowActionsMenu interaction shape: portal, Escape, outside click, focus return, arrow keys', () => {
    assert.match(messageReactions, /createPortal\(/)
    assert.match(messageReactions, /document\.body/)
    assert.match(messageReactions, /event\.key === 'Escape'/)
    assert.match(messageReactions, /document\.addEventListener\('mousedown', onPointerDown, true\)/)
    assert.match(messageReactions, /btnRef\.current\?\.focus\(\)/)
    assert.match(messageReactions, /ArrowDown.*ArrowUp|ArrowUp.*ArrowDown/s)
  })

  await t.test('no long-press, no double-tap, no hover-only affordance', () => {
    const code = strip(messageReactions)
    assert.doesNotMatch(code, /onDoubleClick/)
    assert.doesNotMatch(code, /long[\s\S]{0,20}press/i)
    assert.doesNotMatch(code, /onTouchStart|onTouchEnd|onTouchMove|touchstart|touchend|touchmove/i)
    assert.doesNotMatch(code, /:hover\s*\{[^}]*display:\s*(none|block)/i)
  })

  await t.test('disabled propagates to both the chips and the trigger while a request is in flight', () => {
    assert.match(messageReactions, /disabled=\{disabled\}/)
  })
})

test('MessageBubble: reactions render only behind the opt-in prop', async (t) => {
  await t.test('reactionsEnabled defaults to false, so an untouched caller renders nothing new', () => {
    assert.match(messageBubble, /reactionsEnabled = false,/)
  })

  await t.test('MessageReactions is imported and gated on reactionsEnabled', () => {
    assert.match(messageBubble, /import MessageReactions from '\.\/MessageReactions'/)
    assert.match(messageBubble, /\{reactionsEnabled && \(/)
    const gate = messageBubble.slice(messageBubble.indexOf('{reactionsEnabled && ('), messageBubble.indexOf('{reactionsEnabled && (') + 200)
    assert.match(gate, /<MessageReactions/)
  })

  await t.test('reactions render after the body div, inside the bubble div, and the pinned body line is untouched', () => {
    assert.match(messageBubble, /<div className=\{`msg-bubble-body \$\{bodyClassName\}`\}>\{message\?\.body\}<\/div>/)
    const bodyIdx = messageBubble.indexOf('msg-bubble-body')
    const reactionsIdx = messageBubble.indexOf('{reactionsEnabled && (')
    assert.ok(reactionsIdx > bodyIdx, 'reactions must be rendered after the body div')
  })

  await t.test('onSetReaction and reactionsDisabled are threaded through, both optional', () => {
    assert.match(messageBubble, /onSetReaction,/)
    assert.match(messageBubble, /reactionsDisabled = false,/)
    assert.match(messageBubble, /onSetReaction=\{onSetReaction\} disabled=\{reactionsDisabled\}/)
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
    const fn = staffWorkspace.slice(staffWorkspace.indexOf('const setReaction = useCallback'), staffWorkspace.indexOf('const setReaction = useCallback') + 2200)
    assert.match(fn, /reactionBusyRef\.current\.has\(messageId\)\) return/)
    assert.match(fn, /reactionBusyRef\.current\.add\(messageId\)/)
    assert.match(fn, /reactionBusyRef\.current\.delete\(messageId\)/)
  })

  await t.test('optimistic update writes to the exact thread query key, then reconciles or reverts', () => {
    const fn = staffWorkspace.slice(staffWorkspace.indexOf('const setReaction = useCallback'), staffWorkspace.indexOf('const setReaction = useCallback') + 2200)
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

test('CSS: msg-reaction- classes exist in both stylesheets that style the bubbles', async (t) => {
  await t.test('src/index.css defines the base chip, add-reaction, and popover rules', () => {
    assert.match(globalCss, /\.msg-reaction-row \{/)
    assert.match(globalCss, /\.msg-reaction-chip \{/)
    assert.match(globalCss, /\.msg-reaction-chip-mine \{/)
    assert.match(globalCss, /\.msg-reaction-add \{/)
    assert.match(globalCss, /\.msg-reaction-menu \{/)
    assert.match(globalCss, /\.msg-reaction-option \{/)
  })

  await t.test('the caller-owned chip is the only filled/accent variant, and uses the shared accent token', () => {
    const block = globalCss.slice(globalCss.indexOf('.msg-reaction-chip-mine {'), globalCss.indexOf('.msg-reaction-chip-mine {') + 200)
    assert.match(block, /var\(--color-accent-primary, #1D2567\)/)
  })

  await t.test('a focus-visible ring is defined for every new interactive element', () => {
    assert.match(globalCss, /\.msg-reaction-chip:focus-visible \{/)
    assert.match(globalCss, /\.msg-reaction-add:focus-visible \{/)
    assert.match(globalCss, /\.msg-reaction-option:focus-visible \{/)
  })

  await t.test('a 44px minimum touch target is defined for narrow layouts', () => {
    assert.match(globalCss, /@media \(max-width: 760px\) \{[\s\S]*\.msg-reaction-chip, \.msg-reaction-add \{ min-height: 44px; min-width: 44px; \}/)
  })

  await t.test('src/portal/portal.css also carries msg-reaction- rules for the portal mobile layout', () => {
    assert.match(portalCss, /\.msg-reaction-chip, \.msg-reaction-add \{ min-height: 44px; min-width: 44px; \}/)
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
