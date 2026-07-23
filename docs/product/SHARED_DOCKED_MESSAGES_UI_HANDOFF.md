# Shared Docked Messages UI Handoff

## Scope

This pass enables the lower-right docked `Messages` launcher and panel for Student and Unit Leader portal users.

It does not enable Academic Partner Messages, Student feedback, the Student desktop optimization notice, SQL, migrations, deployment, or the Unit Leader assignment UI.

## User Experience

The launcher opens a docked panel instead of navigating immediately to the full Messages workspace.

Panel header:

- title: `Messages`
- subtitle: `ASPIRE Team`
- action: `New` with accessible name `Start a new conversation`
- action: close with accessible name `Close Messages`

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

The shared portal thread renderer now uses an iMessage-inspired bubble treatment:

- ASPIRE Team/staff messages: left-aligned gray bubbles
- portal-user messages: right-aligned blue bubbles
- shared behavior for Student and Unit Leader

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
