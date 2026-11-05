# ASPIRE Connect: Studio (STUDIO-1)

Mockup: `studio.html` (five frames, Classic | Modern switch at the top). Owner decisions,
2026-11-05:

- **A new Connect tab, named Studio**, beside Contacts, Outreach, Messages and Automations. It
  has its own canvas, layouts and saved designs, and it **sends through Outreach's engine**.
- **Block-based design, like Flodesk, not freeform like Canva.** Designed blocks that can be
  restyled and reordered inside a brand theme, so every send renders in Outlook and on phones.
- **Keith proposes the audience and the Owner approves it.** Keith turns a sentence into a rule
  built from a fixed filter catalog the server runs. The rule, the count, the names and every
  exclusion with its reason are on screen before sending. Keith never sends.
- **Sign-ups come in two kinds**: a one-tap RSVP block (headcount, optional cap, waitlist,
  roster) for events, and the existing Catalog form button for anything that needs answers.
- **Everyone Outreach reaches is in scope**: students, alumni and applicants, preceptors, unit
  leaders, Academic Partner schools, Connect contacts. Owner and Admin only, as Outreach is.
- **Mockup first, then four phases**, each its own push. Images come from uploads and Catalog
  files only. No AI-generated photos.

## The worked example

"I want to send the New Graduate RN Residency application link to applicants who have not yet
passed the boards."

1. Keith finds the residency cohort that is open or opening, and its Key Dates.
2. He asks who "not yet passed" means, offering the Transition Form's own answers
   (`form_rn_status`: `pending` = NCLEX Ahead, `none` = Not Yet, `active` = Licensed), with a
   count for each choice, and asks whether to include alumni who have not submitted the form
   (license unknown).
3. He asks what action to take and whether to cite the licensure deadline. He never asks what
   the record already says.
4. The brief is complete, so he designs: the Announcement layout, ASPIRE Navy theme, a hero, the
   message, the application button, three steps, the Connect signature, and a footer that says
   why the person received it.
5. The special application link is never invented. Left blank, it is a **required placeholder**
   (`REQUIRED_PLACEHOLDERS`, as `[Cohort Request Password]` is) and Send stays disabled.
6. Audience: "Alumni on the Winter 2027 residency roster whose license answer is NCLEX Ahead or
   Not Yet, who submitted the form, at their residency email." 61 on the roster, 27 match, 4 left
   out with reasons, 23 receive it.

## What exists today (from the code)

- **Outreach** sends one-to-one (`api/connect-send-direct-email.js`) and to many
  (`api/connect-send-bulk-message.js`, batches of 75), through `createMailer()` (the demo guard),
  logging `notification_log`. Recipients are expanded in the browser and verified by the server.
- **The composer** is Tiptap (`src/components/connect/RichTextEditor.jsx`) with Button, Event,
  Note and Divider blocks in `src/components/connect/blocks/`. Emails are wrapped by
  `lib/server/email/aspireShell.js` and `emailPrimitives.js`.
- **Catalog form buttons** (OUTREACH-FORM-BUTTON-1) already give each recipient their own link
  through `lib/server/forms/outreachButtons.js`, and void the link when the email fails.
- **Opens and clicks** are already recorded: `api/webhooks/resend.js` maps `email.opened` and
  `email.clicked` onto `notification_log` (`opened_at`, `clicked_at`).
- **Email rules** already exist per audience: the residency recipient (preferred, else personal),
  Not Proceeding students never in a group token, the demo population boundary
  (`sendLogPopulationFilters`), unit leadership from Connect (`unitLeadersFromConnect.js`).
- **Keith Skills** run through `runKeithSkill` (on/off switch, roles, schema, usage, audit,
  provenance) and `KeithMark` shows his hand. Routes: `default` (Haiku) and `quality` (Sonnet).
- **There is no general unsubscribe** for program email. Only unit leader alerts carry one.
  A newsletter needs one (see Open Questions).
- **There are no scheduled sends** in Outreach.

## Design model

- A design is **blocks as JSON** (`{ type, props, style }[]` plus a theme id), never HTML. The
  editor, the preview and the sender read the same JSON.
- **One renderer**, `lib/server/studio/renderEmail.js` (pure, tested), turns blocks into
  table-based, inline-styled HTML (600px, one column that stacks two-column blocks on a phone)
  and a plain-text copy. No new dependency: the shapes are few and the repo already hand-builds
  email HTML. The browser preview calls the same function, so preview and inbox cannot drift.
- **Blocks for the first release**: Hero, Text, Image, Image grid, Two columns, Steps, Quote,
  Button, Event card, RSVP, Catalog form, Catalog file, Divider, Spacer, Signature, Footer.
  Saved blocks (for example "NGRP key dates") are the Owner's reusable pieces.
- **Themes** are palette, two typefaces (Playfair Display and Plus Jakarta Sans with Georgia and
  Arial fallbacks; webfonts never load in Outlook) and spacing. Three to start: ASPIRE Navy,
  Residency Forest, Warm Paper. Any block can override its theme's colours.
- **Contrast is checked as colours are picked** (4.5:1 for text), and a photo background needs
  alt text and a solid fallback colour. The panel says so in words.
- **Merge fields** are the existing Outreach tokens (`[First Name]` and friends) drawn as chips.

## Keith's part

Two Skills, both on the `quality` route, Owner and Admin, seeded by an Owner-gated migration:

- **`studio-brief`** reads the request and returns the next question with its answer choices,
  or a completed brief. It is given cohort names, Key Dates, Catalog item titles and the filter
  catalog with **counts only**, never names or emails.
- **`studio-design`** turns a completed brief into blocks JSON and a subject and preheader, and
  rewrites a single block on request ("shorter", "warmer"). `sanitizeDesign` drops any block type,
  prop or URL it does not recognise. Links Keith did not receive become required placeholders.

## Audience rules

- A rule is `{ population, conditions[] }`, where every condition comes from a fixed catalog in
  `src/lib/studio/audienceCatalog.js` (pure, tested), for example `residency_cohort`,
  `form_rn_status`, `form_submitted`, `aspire_cohort`, `student_status`, `school`,
  `contact_category`, `unit`. Keith may only choose from the catalog; the server runs it
  (`lib/server/studio/resolveAudience.js`) in the request's population (real or demo).
- Each population keeps its existing recipient rule and exclusions. Exclusions are listed with
  their reason and cannot be overridden from Studio.
- The Owner can remove people or add people by hand. The resolved list is frozen at send time
  and stored with the send.

## Data (one Owner-gated migration per phase, server-only tables)

- Phase 1: `studio_designs` (draft blocks, theme, subject, preheader), `studio_saved_blocks`,
  `studio_sends` (design snapshot, rule, frozen list, `notification_log` batch ids).
- Phase 3: `studio_rsvps` (send, recipient, answer, answered_at, waitlist position), with a
  token per recipient in the `rsvp:` namespace (an HMAC, only its SHA-256 stored, like form links).
- Phase 4: `studio_sends.scheduled_for` and a cron that sends due rows.

## Phases (each its own push)

1. **Canvas.** The Studio tab, layouts, themes, blocks, saved designs, Desktop and Phone preview,
   Send me a test, and sending through the bulk engine to a hand-picked list (Outreach's own
   recipient picker). The renderer and its tests.
2. **Keith.** The interview, the brief, the design, block rewrites, and the audience rule with
   its review screen.
3. **RSVP.** The block, one-tap answers, confirmation page with `.ics`, capacity and waitlist,
   the responses roster, Export to Excel, and follow-ups that open Studio with the group chosen.
4. **Scheduling and results.** Schedule a send, and per-send opens, clicks and RSVP figures on
   the Studio home from the data the Resend webhook already records.

## Open questions

1. **Unsubscribe.** A newsletter needs a way out. Proposed: a per-person "program news" opt-out
   that Studio respects and transactional mail (forms, signatures, interview notices) ignores.
   Is that right, and should it be per audience or one switch?
2. **From address.** Studio sends as "Jester via ASPIRE" from noreply with reply-to the sender,
   as Outreach does. Should residency sends reply to ngrp@cshs.org instead?
3. **RSVP to Support.** Should a Town Hall RSVP offer to record attendance in Residency >
   Support after the event (on a confirm), or stay separate?
4. **Who else designs.** Owner and Admin only for now. Talent Acquisition's Outreach is Phase 2
   of TA-CONNECT-1; should Studio come to the Residency Portal later?
