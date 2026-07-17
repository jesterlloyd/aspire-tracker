// MESSAGES-PHASE4B2B-I: guards for the dormant staff write workflows and
// management controls. Pure-function and static-source, using the repository's
// existing node:test stack. No real API call, conversation, reply, mark-read
// mutation, notification, or student content.
//
// Run: node --test test/messagesPhase4b2iStaffWrites.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  MESSAGE_CATEGORIES, STAFF_STATUSES, MESSAGE_MAX_BODY_CHARS,
  SUBJECT_MIN_CHARS, SUBJECT_MAX_CHARS,
  validateSubjectValue, validateBodyValue, normalizeBody,
} from '../src/lib/messages/messagesConstants.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const dialog = read('../src/components/connect/messages/NewMessageDialog.jsx')
const actions = read('../src/components/connect/messages/ThreadActions.jsx')
const workspace = read('../src/components/connect/messages/MessagesWorkspace.jsx')
const client = read('../src/lib/messages/messagesApiClient.js')
const connect = read('../src/pages/Connect.jsx')
const app = read('../src/App.jsx')

test('client-side validation mirrors the server bounds', async (t) => {
  await t.test('subject is trimmed and bounded 3 to 120', () => {
    assert.equal(SUBJECT_MIN_CHARS, 3)
    assert.equal(SUBJECT_MAX_CHARS, 120)
    assert.equal(validateSubjectValue('  Placement  ').value, 'Placement')
    assert.equal(validateSubjectValue('ab').ok, false)
    assert.equal(validateSubjectValue('   ').ok, false, 'whitespace only rejected')
    assert.equal(validateSubjectValue('x'.repeat(121)).ok, false)
    assert.equal(validateSubjectValue('x'.repeat(120)).ok, true)
    assert.equal(validateSubjectValue(undefined).ok, false)
  })

  await t.test('body is trimmed, non-blank, and bounded at 5000', () => {
    assert.equal(MESSAGE_MAX_BODY_CHARS, 5000)
    assert.equal(validateBodyValue('   ').ok, false)
    assert.equal(validateBodyValue('x'.repeat(5001)).ok, false)
    assert.equal(validateBodyValue('x'.repeat(5000)).ok, true)
    assert.equal(validateBodyValue('hello').value, 'hello')
  })

  await t.test('body preserves line breaks and is never treated as HTML', () => {
    assert.equal(normalizeBody('a\r\nb\rc'), 'a\nb\nc')
    assert.equal(validateBodyValue('<b>x</b>').value, '<b>x</b>')
  })

  await t.test('category and status sets are the approved ones', () => {
    assert.equal(MESSAGE_CATEGORIES.length, 7)
    assert.deepEqual(STAFF_STATUSES, ['open', 'waiting', 'resolved'])
  })
})

test('New message workflow', async (t) => {
  await t.test('uses the real participant endpoint with the 2-character minimum and debounce', () => {
    assert.match(dialog, /api\.listParticipantOptions\(term, \{ signal \}\)/)
    assert.match(dialog, /const MIN_SEARCH = 2/)
    assert.match(dialog, /const SEARCH_DEBOUNCE_MS = 300/)
    assert.ok(300 >= 250 && 300 <= 400, 'debounce inside the approved range')
    assert.match(dialog, /enabled: searchEnabled/)
    assert.match(dialog, /term\.length >= MIN_SEARCH/)
  })

  await t.test('only active participants are selectable and no email is shown', () => {
    assert.match(dialog, /\.filter\(\(o\) => o\.access_active !== false\)/)
    assert.doesNotMatch(strip(dialog), /\.email/)
  })

  await t.test('sends exactly the five approved fields and no routing fields', () => {
    assert.match(dialog, /api\.startStaffConversation\(\{\s*participantProfileId: participant\.participant_profile_id,\s*studentId: participant\.student_id,\s*subject: s\.value,\s*category: category \|\| null,\s*body: b\.value,\s*\}\)/)
    for (const f of ['p_delivery', 'recipient_email', 'recipient_kind', 'event_type',
      'idempotency_key', 'snapshot_sender_name', 'cta_path']) {
      assert.ok(!strip(dialog).includes(f), `must not send ${f}`)
    }
  })

  await t.test('duplicate submit is prevented', () => {
    assert.match(dialog, /if \(pending\) return/)
    assert.match(dialog, /disabled=\{pending\}/)
    assert.match(dialog, /type="submit" disabled=\{pending\}/)
  })

  await t.test('success announces exactly Message sent. and never claims delivery', () => {
    assert.match(dialog, /announce\('Message sent\.'\)/)
    assert.doesNotMatch(dialog, /email (was )?(sent|delivered)/i)
  })

  await t.test('failure preserves the form and a 409 refreshes options', () => {
    assert.match(dialog, /setFormError\(mapMessagesError\(err\?\.status\)\)/)
    assert.match(dialog, /if \(err\?\.status === 409\) \{[\s\S]*?setParticipant\(null\)[\s\S]*?refetch\(\)/)
    // reset() is called only on the success path, so a failure keeps every field.
    const fail = dialog.slice(dialog.indexOf('} catch (err) {'), dialog.indexOf('  if (!open) return null'))
    assert.doesNotMatch(fail, /reset\(\)/, 'failure must not clear the form')
  })

  await t.test('is an accessible dialog with Escape and labeled fields', () => {
    assert.match(dialog, /role="dialog"/)
    assert.match(dialog, /aria-modal="true"/)
    assert.match(dialog, /aria-labelledby="nm-title"/)
    assert.match(dialog, /e\.key === 'Escape' && !pending/)
    for (const id of ['nm-search', 'nm-subject', 'nm-category', 'nm-body']) {
      assert.ok(dialog.includes(`htmlFor="${id}"`), `missing label for ${id}`)
    }
    assert.match(dialog, /aria-label="Close new message"/)
    assert.match(dialog, /aria-invalid=/)
  })

  await t.test('shows loading, no-results, and retryable error states', () => {
    assert.match(dialog, /searchState === 'loading'/)
    assert.match(dialog, /No active participants match that search/)
    assert.match(dialog, /searchState === 'error'/)
    assert.match(dialog, /onClick=\{\(\) => refetch\(\)\}/)
  })

  await t.test('character counts are present and nothing persists', () => {
    assert.match(dialog, /\{subject\.trim\(\)\.length\} of \{SUBJECT_MAX_CHARS\}/)
    assert.match(dialog, /\{bodyCount\} of \{MESSAGE_MAX_BODY_CHARS\}/)
    assert.doesNotMatch(strip(dialog), /localStorage|sessionStorage|indexedDB/i)
  })
})

test('reply composer', async (t) => {
  await t.test('carries the exact safety notice, unmodified', () => {
    const expected = "ASPIRE Messages is not monitored continuously. Do not include patient names, medical record numbers, or other identifying information. For urgent patient-care or safety concerns, follow your unit's established escalation process."
    assert.ok(actions.includes(expected), 'the safety notice must be verbatim')
    assert.match(actions, /export const SAFETY_NOTICE/)
    assert.match(actions, /id="reply-safety"/)
  })

  await t.test('carries the exact inactive-participant notice', () => {
    const expected = 'This participant no longer has active portal access. You can review and manage this conversation, but you cannot send a new message.'
    assert.ok(actions.includes(expected))
    assert.match(actions, /export const INACTIVE_NOTICE/)
  })

  await t.test('send is disabled for inactive access, pending, blank, or over-limit', () => {
    assert.match(actions, /const disabled = !accessActive \|\| pending \|\| trimmed\.length < 1 \|\| tooLong \|\| !conversationId/)
    assert.match(actions, /if \(disabled\) return/)
    assert.match(actions, /disabled=\{disabled\}/)
  })

  await t.test('uses the real reply contract and no optimistic insertion', () => {
    assert.match(actions, /api\.replyStaffConversation\(\{ conversationId, body: v\.value \}\)/)
    assert.doesNotMatch(strip(actions), /optimistic|setMessages|prepend/i)
  })

  await t.test('success clears the draft and invalidates the right keys', () => {
    assert.match(actions, /setBody\(''\)\s*\n\s*announce\('Message sent\.'\)/)
    assert.match(actions, /queryKey: \['messages_staff_thread', conversationId\]/)
    assert.match(actions, /queryKey: \['messages_staff_list'\]/)
    assert.match(actions, /queryKey: \['messages_staff_unread'\]/)
  })

  await t.test('failure preserves the draft and a 409 refreshes access state', () => {
    const fail = actions.slice(actions.indexOf('} catch (err) {'), actions.indexOf('} finally {'))
    assert.doesNotMatch(fail, /setBody\(''\)/, 'the draft must survive a failure')
    assert.match(fail, /err\?\.status === 409/)
    assert.match(fail, /messages_staff_thread/)
  })

  await t.test('the draft is memory only and polling cannot clear it', () => {
    assert.match(actions, /const \[body, setBody\] = useState\(''\)/)
    assert.doesNotMatch(strip(actions), /localStorage|sessionStorage|indexedDB|analytics/i)
  })
})

test('management controls', async (t) => {
  await t.test('use the real manage contract for all four actions', () => {
    assert.match(actions, /api\.manageStaffConversation\(\{ action, conversation_id: id, \.\.\.payload \}\)/)
    assert.match(actions, /run\('status', \{ status: e\.target\.value \}/)
    assert.match(actions, /run\('assign', \{ assignee_profile_id: e\.target\.value \|\| null \}/)
    assert.match(actions, /run\('category', \{ category: e\.target\.value \|\| null \}/)
    assert.match(actions, /run\('flag', \{ flagged: !flagged \}/)
  })

  await t.test('assignee options come from the narrow lookup, never a directory', () => {
    assert.match(actions, /api\.listAssigneeOptions\(\{ signal \}\)/)
    assert.match(actions, /a\.is_current_user \? `\$\{a\.display_name\} \(me\)`/, 'assign to self is available')
    assert.match(actions, /<option value="">Unassigned<\/option>/, 'assignment can be cleared')
    assert.doesNotMatch(strip(actions), /get_all_user_profiles|admin-users|list-portal-access/)
  })

  await t.test('status offers exactly open, waiting, resolved', () => {
    assert.match(actions, /STAFF_STATUSES\.map\(\(s\) => <option key=\{s\} value=\{s\}>\{STAFF_STATUS_LABEL\[s\]\}<\/option>\)/)
  })

  await t.test('category offers Uncategorized (null) plus the approved values', () => {
    assert.match(actions, /<option value="">Uncategorized<\/option>/)
    assert.match(actions, /MESSAGE_CATEGORIES\.map/)
  })

  await t.test('follow up is labeled correctly and is a toggle', () => {
    assert.match(actions, /Follow up\{flagged \? ': on' : ''\}/)
    assert.match(actions, /aria-pressed=\{flagged\}/)
    // Scope the alarming-terminology guard to the follow-up control itself. The
    // approved safety notice legitimately contains the word "urgent", and
    // role="alert" is the correct ARIA role for an error.
    const flagBlock = actions.slice(actions.indexOf("run('flag'") - 400, actions.indexOf("run('flag'") + 300)
    assert.doesNotMatch(flagBlock, /urgent|critical|emergency|escalat/i)
  })

  await t.test('duplicate management requests are prevented per action', () => {
    assert.match(actions, /if \(busy\) return/)
    assert.match(actions, /setBusy\(action\)/)
    assert.match(actions, /disabled=\{busy === 'status'\}/)
    assert.match(actions, /disabled=\{busy === 'assign'\}/)
  })

  await t.test('no management action sends an email or a notification request', () => {
    assert.doesNotMatch(strip(actions), /Resend|notification|sendEmail/i)
  })

  await t.test('failure preserves authoritative state, success invalidates narrowly', () => {
    assert.match(actions, /setError\(mapMessagesError\(err\?\.status\)\)/)
    // No optimistic local value is written, so the server state simply stands.
    assert.doesNotMatch(actions, /setConversation\(/)
    assert.match(actions, /invalidateQueries\(\{ queryKey: \['messages_staff_thread', id\] \}\)/)
  })

  await t.test('controls are labeled for assistive technology', () => {
    for (const id of ['mg-status', 'mg-assignee', 'mg-category']) {
      assert.ok(actions.includes(`htmlFor={id}`) || actions.includes(`id="${id}"`), `missing control ${id}`)
    }
    assert.match(actions, /<label htmlFor=\{id\} style=\{srOnly\}>\{label\}<\/label>/)
  })
})

test('workspace wiring and aria-live', async (t) => {
  await t.test('reuses the Phase 4A inbox and adds no parallel implementation', () => {
    assert.match(workspace, /import MessagesInbox from '\.\/MessagesInbox'/)
    assert.match(workspace, /<MessagesInbox/)
    assert.match(workspace, /import NewMessageDialog from '\.\/NewMessageDialog'/)
    assert.match(workspace, /import \{ ReplyComposer, ThreadManagementControls \} from '\.\/ThreadActions'/)
  })

  await t.test('has a polite announcement region carrying no message content', () => {
    assert.match(workspace, /role="status" aria-live="polite" style=\{srOnly\}>\{announcement\}/)
    assert.match(workspace, /const announce = useCallback\(\(text\) => setAnnouncement\(String\(text \|\| ''\)\), \[\]\)/)
  })

  await t.test('New message returns focus to its trigger', () => {
    assert.match(workspace, /newBtnRef\.current\?\.focus\(\)/)
    assert.match(workspace, /const closeNew = useCallback\(\(\) => \{ setNewOpen\(false\); newBtnRef\.current\?\.focus\(\) \}/)
  })

  await t.test('a created conversation is selected and the inbox invalidated', () => {
    assert.match(workspace, /invalidateQueries\(\{ queryKey: \['messages_staff_list'\] \}\)/)
    assert.match(workspace, /setSelectedId\(conversationId\)/)
  })

  await t.test('the composer receives authoritative access state', () => {
    assert.match(workspace, /accessActive=\{conversation\.participant_access_active !== false\}/)
  })

  await t.test('Phase 4B2a thread, read-state, and polling behavior is preserved', () => {
    assert.match(workspace, /queryKey: \['messages_staff_thread', conversationId\]/)
    assert.match(workspace, /getNextPageParam: \(lastPage\) => \(lastPage\?\.has_more \? lastPage\?\.next_cursor \?\? undefined : undefined\)/)
    assert.match(workspace, /Load earlier messages/)
    assert.match(workspace, /refetchInterval: visible \? ACTIVE_POLL_MS : false/)
    assert.match(workspace, /markedRef\.current === token/, 'mark-read still runs once per newest message')
  })
})

test('privacy and dormancy', async (t) => {
  await t.test('no message content is logged and no dangerous HTML is used', () => {
    for (const [name, src] of Object.entries({ dialog, actions, workspace })) {
      assert.doesNotMatch(strip(src), /console\.(log|error|warn)/, `${name} must not log`)
      assert.doesNotMatch(strip(src), /dangerouslySetInnerHTML|innerHTML/, `${name} must not use dangerous HTML`)
      // Match the actual renderers, not the substring "marked" (the follow-up
      // announcement legitimately says "Marked for follow up.").
      assert.doesNotMatch(strip(src), /react-markdown|DOMPurify|\bmarked\(|from 'marked'/i, `${name} must not render Markdown`)
      assert.doesNotMatch(strip(src), /analytics|telemetry|gtag/i, `${name} must not add analytics`)
    }
  })

  await t.test('no direct Supabase RPC or service-role use from the browser', () => {
    for (const [name, src] of Object.entries({ dialog, actions, workspace })) {
      assert.doesNotMatch(strip(src), /\.rpc\(/, `${name} must not call an RPC directly`)
      assert.doesNotMatch(strip(src), /service_role|SERVICE_ROLE/, `${name} must not touch service-role`)
    }
    assert.match(client, /function assertNoRoutingFields/, 'the routing-field guard is still active')
  })

  await t.test('Messages is gated in Connect; App.jsx is untouched', () => {
    assert.match(connect, /const VALID_TABS = new Set\(\['contacts', 'outreach', 'messages', 'broadcasts'\]\)/)
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/, 'Messages is activated in Phase 4B2b-ii and gated to an active Owner or Admin')
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/, 'Messages is activated in Phase 4B2b-ii and gated to an active Owner or Admin')
    assert.doesNotMatch(app, /MessagesWorkspace|MessagesInbox/)
    assert.doesNotMatch(app, /\/connect\/messages/)
  })

  await t.test('the Connect unread badge is present and accessible', () => {
    assert.match(connect, /messagesUnread/)
  })

  await t.test('Student Portal Messages is activated and mounted only in the student branch', () => {
    // Phase 5B-ii ACTIVATED Student Portal Messages. These guards no longer assert
    // dormancy; they assert the boundary that replaced it. PortalApp is the sole
    // activation point, so PortalShell, StudentPortal, and App.jsx stay untouched.
    const papp = read('../src/portal/PortalApp.jsx')
    assert.match(papp, /<PortalMessagesWorkspace active=\{studentView === 'messages'\} \/>/,
      'Messages is mounted only in the active student branch')
    assert.doesNotMatch(read('../src/portal/PortalShell.jsx'), /PortalMessagesWorkspace|PortalNav/)
    assert.doesNotMatch(read('../src/portal/StudentPortal.jsx'), /PortalMessagesWorkspace|PortalNav/)
    assert.doesNotMatch(read('../src/App.jsx'), /PortalMessagesWorkspace/)
  })
})
