# Shared Docked Messages UI Handoff

## Scope

This pass keeps the lower-right docked `Messages` launcher and panel active for Student and Unit Leader portal users, and converges the docked panel, full portal Messages workspaces, and staff Connect Messages thread on one shared bubble treatment.

It does not enable Academic Partner Messages, the Student desktop optimization notice, SQL, migrations, deployment, or the Unit Leader assignment UI.

## User Experience

The launcher opens a docked panel instead of navigating immediately to the full Messages workspace.

Panel header:

- title: `Messages`
- subtitle: `ASPIRE Team`
- subtle `↺ New` action with accessible name `Start a new conversation`
- subtle `×` close action with accessible name `Close Messages`

The large outlined `+ New` control was retired. Header actions now follow the Keith-style low-chrome treatment without using Keith identity or AI behavior.

The safety/guidance notice appears above the conversation and composer, not between the textbox and the send control. The composer is pinned low inside the panel and uses a compact row:

- flexible textarea
- circular blue paper-plane send button
- accessible send name: `Send message`

`Open full Messages` still navigates to the full `/portal/messages` workspace.

## First Message Creation

The panel creates a general ASPIRE Team conversation only when the first message is successfully submitted.

It calls:

```js
startGeneralTeamConversation({ requestId, body })
```

The request body sent by the client contains only:

- `request_id`
- `body`

The browser does not send student, unit, role, profile, subject, category, or destination data. The backend derives identity, scope, subject, category, notification routing, and classification.

Each compose attempt keeps one stable request id. Rapid double-submit is blocked before React rerenders. Failed retries preserve draft text and request id. Success clears the draft/request id, activates the returned conversation, and refreshes shared list/unread caches.

Opening the panel, clicking `New`, closing, or leaving compose does not create a conversation.

## Thread Selection

When the panel opens, it selects only the most recent authorized `thread_kind: 'team_general'` row.

It does not use `!direct_student_name` as a proxy and does not auto-select `team_student_context` or `direct_student` rows.

Existing `team_general` replies continue through the existing portal thread, reply, read, list, and unread APIs.

## Shared Visual Treatment

The canonical message bubble lives in:

- `src/components/shared/MessageBubble.jsx`
- `src/lib/messages/messageBubbleDirection.js`

It is reused by:

- docked Student and Unit Leader Messages panel
- Student full Messages workspace
- Unit Leader full Messages workspace
- staff Connect > Messages thread

Viewer-relative direction:

- portal perspective: portal-user messages are outgoing blue/right; ASPIRE/staff messages are incoming gray/left
- staff perspective: staff messages are outgoing blue/right; portal participant messages are incoming gray/left

The visual treatment is iMessage-inspired:

- ASPIRE Team/staff messages: left-aligned gray bubbles
- active viewer messages: right-aligned blue bubbles
- author/time metadata stays subdued inside the bubble
- body text remains plain text with preserved line breaks

The Unit Leader full Messages workspace now uses the broader Student-style available width rather than the earlier narrow centered maximum.

The full Unit Leader Messages workspace no longer renders the extra full-width
`Message the ASPIRE Team` banner above the workspace. Normal navigation now
begins directly with the main Messages workspace card, while retaining the `New
message` action, thread list, conversation pane, composer, privacy and escalation
guidance, and the lower-right docked Messages utility. The retained
`/portal/unit/concern` handoff still opens the ASPIRE-Team compose flow when that
legacy route explicitly requests it.

## Verification

Recommended checks:

- `node --test test/sharedDockedMessagesUi.test.mjs`
- `node --test test/unitLeaderPortalUtilityLayer.test.mjs`
- `node --test test/messagesPhase5biiPortalActivation.test.mjs`
- `node --test test/messagesPhase5biPortalWorkspace.test.mjs`
- `node --test test/generalTeamThreadsBackend.test.mjs`
- changed-file ESLint
- `node --test test/*.test.mjs`
- production build with placeholder Vite env when local env is absent
- `git diff --check`
