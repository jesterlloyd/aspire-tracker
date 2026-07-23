# Shared Feedback Experience Handoff

## Scope

This pass converges the main app, Student Portal, and Unit Leader Portal on one shared feedback presentation component:

- `src/components/shared/SharedFeedbackPanel.jsx`
- `src/components/FeedbackPanel.jsx`
- `src/portal/PortalFeedbackPanel.jsx`

Academic Partner feedback remains disabled.

## Canonical Copy

The shared panel uses:

- title: `Send Feedback`
- subtitle: `Report a bug, suggest a feature, or ask a question.`

Visible categories remain:

- `Bug Report`
- `Feature Idea`
- `Question`

## Transport Boundaries

The main app keeps its existing Outlook compose transport through `src/components/FeedbackPanel.jsx`.

Student and Unit Leader portals use `src/portal/PortalFeedbackPanel.jsx` and submit to:

```text
POST /api/portal/feedback-submit
```

Portal category mapping:

- `Bug Report` -> backend `type: "bug"`
- `Feature Idea` -> backend `type: "feedback"`
- `Question` -> backend `type: "feedback"`

The selected category is preserved in the submitted message text. Bug reports collect expected behavior, actual behavior, reproduction steps, and viewport dimensions required by the backend.

## Privacy Allowlist

The portal browser payload sends only:

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

The browser does not send profile id, user id, role, unit, school, student id, preceptor id, actor profile id, email, message thread id, message content, evaluation content, user agent, IP address, raw errors, access tokens, screenshots, or attachments.

The backend derives identity, role, and scope server-side for active Student and active Unit Leader portal callers.

## Request-ID Lifecycle

The portal adapter uses `src/lib/portalFeedbackApiClient.js`.

One stable request id is retained per portal/utility intent across failed attempts and cleared only after success. Rapid double-submit is blocked synchronously before React rerenders.

`409` request-id conflicts and `429` rate limits produce safe user-facing messages. A saved submission with pending email delivery is treated as successful receipt.

## Verification

Recommended checks:

- `node --test test/portalExperienceConvergencePhase1.test.mjs`
- `node --test test/portalFeedbackBackendFoundation.test.mjs`
- `node --test test/unitLeaderPortalUtilityLayer.test.mjs`
- `node --test test/sharedDockedMessagesUi.test.mjs`
- changed-file ESLint
- `node --test test/*.test.mjs`
- production build with placeholder Vite env when local env is absent
- `git diff --check`
