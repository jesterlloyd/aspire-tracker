# Unit Leader Portal Utility Layer Handoff

## Mount Architecture

The visible portal utility layer is implemented through shared, role-neutral components:

- `src/portal/PortalUtilityLayer.jsx`
- `src/portal/PortalUtilityButton.jsx`
- `src/portal/PortalFeedbackDialog.jsx`
- `src/portal/usePortalDialogFocus.js`

`PortalShell` accepts a `utilityLayer` prop and renders it once below the portal header. `PortalApp` supplies that prop only in the Unit Leader branch with `portalRole="unit_leader"` and `portalType="unit_leader"`.

No utility layer is mounted inside `UnitLeaderPortal.jsx`, `StudentPortal.jsx`, or `AcademicPartnerPortal.jsx`.

## Unit Leader-Only Activation

This pass activates the utilities only for active Unit Leader portal rendering. Student Portal and Academic Partner Portal feedback controls remain inactive.

Academic Partner Messages was not built. Academic Partner authorization, predicates, APIs, floating controls, desktop notice, and table repairs were not changed.

## Feedback Dialog Behavior

The lower-left `Feedback / Bug` launcher opens an accessible modal dialog. At the existing 760px breakpoint, it inherits the portal bottom-sheet modal behavior.

The dialog provides two explicit choices:

- `Send Feedback`
- `Report a Bug`

Feedback requires a message. Bug reports require a summary, expected behavior, actual behavior, and reproduction steps. Bug reports also include viewport width and height. Attachments, screenshots, pasted images, and file uploads are not included.

The dialog traps focus, restores focus to the exact launcher, supports Escape when not submitting, preserves form text after failures, blocks rapid duplicate submits with a synchronous guard, and announces success or failure in a live region.

## Payload Privacy

The browser sends only the approved fields:

- `request_id`
- `type`
- `message`
- `pathname`
- `section`
- `build_sha`
- `environment`
- bug-only `expected_behavior`
- bug-only `actual_behavior`
- bug-only `reproduction_steps`
- bug-only `viewport_width`
- bug-only `viewport_height`

The feedback payload does not include profile id, user id, role, unit, school, student id, preceptor id, actor profile id, email, message thread id, message content, evaluation content, user agent, IP address, raw errors, access tokens, screenshots, or attachments.

The backend remains authoritative for identity, role, and scope.

## Request-ID Lifecycle

The dialog uses the shared request-ID helper in `src/lib/portalFeedbackApiClient.js`.

One stable request ID is held for the active submission intent. It is retained after failed attempts and cleared only after success or cancellation. A synchronous `submittingRef` guard prevents rapid double-send before React rerenders.

`409` request-ID conflicts and `429` rate limits produce safe user-facing messages. A saved submission with pending email delivery is treated as successful receipt.

## Messages Reuse

The lower-right `Messages` launcher uses the existing unread count passed from `PortalApp`. It does not mount a second unread polling hook and does not create another Messages workspace.

The control navigates to `/portal/messages`. When already on a Messages route, it marks itself current and focuses the existing Messages heading instead of resetting or discarding the selected thread.

## Notice Trigger And Persistence

The desktop-optimization notice is Unit Leader-only and uses:

```js
window.matchMedia('(max-width: 1023px)')
```

It is hidden at 1024px and above, suppressed on `/portal/messages`, and never uses user-agent or device-name detection.

Dismissal is stored per browser, account, and role:

```text
aspire.portal.desktopNotice.v1:<profile-id>:unit_leader
```

The stored value is:

```json
{ "dismissedAt": "<ISO timestamp>" }
```

Dismissal expires after 30 days. If localStorage is unavailable, the component falls back to session-only dismissal.

## Overlay Suppression

Floating utilities hide while modal, drawer, bottom sheet, or assignment manager surfaces are open. They also hide on narrow viewports when a text input, textarea, or select has focus, so the software keyboard does not collide with the controls.

Hidden controls are not rendered and therefore are not focusable.

## Responsive Placement

The utility layer uses z-index `25`, above normal content and below the existing bottom navigation, sheets, modals, assignment manager, drawers, and menus.

Desktop/tablet placement:

- lower-left `Feedback / Bug`
- lower-right `Messages`
- safe-area-aware `20px` offsets

Phone placement:

- both controls move above the fixed bottom navigation
- 44px minimum target is preserved
- labels can wrap safely
- safe-area inset is included

## Accessibility

The launchers are visible text buttons, not ambiguous icon-only controls. The dialog has `role="dialog"`, `aria-modal="true"`, a labelled title and description, focus trapping, Escape handling, focus restoration, inline validation, and live-region status.

The notice is non-modal and does not block phone access.

## Test Results

Verification for this branch should include:

- `node --test test/unitLeaderPortalUtilityLayer.test.mjs`
- `node --test test/portalFeedbackBackendFoundation.test.mjs`
- Unit Leader portal tests
- Messages tests
- changed-file ESLint
- `node --test 'test/*.test.mjs'`
- production client/SSR build
- `git diff --check`

Live database verification is not part of this pass. No SQL or migration was added.

## Live QC Plan

Manual QA matrix:

- widths: 320px, 375px, 430px, 760px, 768px, 834px, 1023px, 1024px, 1280px
- portrait and landscape
- 200% browser zoom
- reduced viewport height
- software keyboard open
- every Unit Leader modal, drawer, sheet, and assignment-manager flow
- Messages list route
- Messages thread route

Confirm:

- notice appears below 1024px, not at 1024px or above
- notice is absent on Messages routes
- `Continue anyway` persists for the current account and role
- launchers do not cover final rows, pagination, or action buttons
- launchers hide behind overlays and during narrow text input
- feedback retry preserves text
- rapid submit cannot duplicate
- success says ASPIRE received the submission

## Future Extension Points

Student Portal can later pass `enabled` and Student-specific reporter context into the same utility layer after product approval.

Academic Partner Portal can later use the same feedback utility once that portal is ready. The Messages launcher must remain disabled for Academic Partner until Academic Partner Messages is actually built.
