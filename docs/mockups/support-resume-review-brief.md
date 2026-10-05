# Build prompt: Residency > Support, Documents, and Keith résumé review

**For:** Claude Code or Codex, in the ASPIRE Intelligence repo. Paste this whole file as the first message.
**Attach:** `resume-review-mockup.html`. Commit it as `docs/mockups/support-resume-review.html`. It is the visual and behavioral source of truth.
**Related:** `docs/design/table-canon-spec.md`, `receipts-redesign-build-prompt.md` (upload and Keith pattern), `action-center-build-prompt.md` (shared needs queue), `student-chart-build-prompt.md` (profile).

**About the mockup:**
- The yellow note and the dark "Mockup steps" bar are for review only. Do not build them.
- All names, scores, and dates are synthetic, as of Oct 4, 2026. Wire every figure to real data.
- Values in brackets, such as `[personal email on file]`, stand in for real data.

---

## TASK

Make support logging simple and make résumé review a one-pass flow:

1. **Support entries stand on their own.** Logging support never requires a transition form.
2. **Documents live on the profile.** Staff upload, replace, and review application documents on the alumnus's Documents tab. The old file always moves to version history.
3. **Keith scores résumés on upload,** using the `aspire-resume-reviewer` skill, the same way Keith processes receipts in Program Budget.
4. **Staff send the review through ASPIRE Connect > Outreach.** The send event logs Résumé Review support with the send date. No manual entry.
5. **The Residency Portal mirrors the Documents checklist** so alumni can see what is missing and upload it themselves.

## 0. Before writing code

Find and report:

1. The Residency > Support route, its components, and the table that stores support entries. Does an entry require a transition form record, by foreign key or by query filter?
2. How the Support roster is built today. Does it exclude alumni without a transition form?
3. Where Student Profile > Documents stores files, and whether it already keeps versions.
4. The Program Budget receipt pipeline: upload, Keith processing, status, and the modal. List what can be reused.
5. How Keith runs a skill today, and whether `aspire-resume-reviewer` is registered. Note Keith's current data boundary (aggregate-only).
6. ASPIRE Connect > Outreach: the compose screen, whether messages support tags or metadata, the send event, scheduled sends, and failure states.
7. The Residency Portal: its routes, auth, and how it reads the alumnus's own records.
8. The shared needs queue (`getNeedsQueue` or equivalent) from the Action Center build.

Stop and ask if a finding changes a section below, especially if support entries cannot exist without a transition form, if Outreach cannot carry metadata, or if the portal cannot read profile documents.

## 1. Data model

Adapt names to the repo. Send every migration through the SQL gate.

**support_entry**
- `alumnus_id`, `activity` (resume_review, town_hall, interview_bootcamp, placement_advising), `date`, `source` (manual, bulk, outreach), `source_ref` (Outreach message id or bulk batch id), `note`, `created_by`, `created_at`.
- Unique on (`alumnus_id`, `activity`, `date`). A repeat is skipped and counted, never an error.
- No dependency on the transition form.

**document** and **document_version**
- `document`: `alumnus_id`, `type`, `current_version_id`.
- `document_version`: `file`, `pages`, `uploaded_by`, `uploaded_via` (staff, portal), `uploaded_at`, `keith_check` (JSON), `confirmed_by`, `confirmed_at`.
- Replacing creates a new version and repoints `current_version_id`. Never delete a version from this flow.

**resume_review**
- `document_version_id`, `score` (0 to 100), `categories` (six scores, 0 to 10), `readiness` (Highly Competitive, Competitive, Needs Improvement), `summary`, `top_fixes` (3), `missing_info` (list), `full_report`, `draft_subject`, `draft_body`, `status` (scoring, scored, failed, sent), `outreach_message_id`, `sent_at`.

**document type config**
- Keep required and optional types in one config list the team can edit, not in component code. Start with section 3's list.

## 2. Residency > Support

Keep the page structure: phase tabs (Before Residency, At the Start, During Residency), the KPI row, and By Alumnus.

**Roster**
- Include every alumnus in scope. Show transition form status as a pill (Submitted green, Pending amber). It never blocks logging.

**KPIs**
- Count distinct alumni per activity. Alumni Supported is distinct alumni with any entry, "of [N] alumni".
- Résumé Review sub-line: "Logged from Outreach sends".

**Log group activity**
- Replace the current Activity, Date, Alumnus form with a **Log group activity** button that opens a bulk log panel.
- Activities: Town Hall, Interview Bootcamp, Placement Advising. Résumé Review is not in this list. It logs from Outreach only (section 5).
- Panel: pick one activity, one date (Today, Yesterday, and Last event shortcuts), an optional shared note, then multi-select alumni.
- Roster filters: All alumni, "No [activity] yet", Form pending. Add Select all shown.
- One save writes one entry per alumnus with `source: bulk` and a shared batch id. Report duplicates skipped.
- Show an Undo toast for 10 seconds. Undo removes the whole batch.

**By Alumnus**
- `DataSheet` plain sheet, per the table canon. Columns: Alumnus (Name · cohort), Form, Résumé, Score, Town Hall, Bootcamp, Advising.
- Résumé shows the latest Outreach-logged date with a small message icon, and links to the alumnus's Documents. With no entry, show **Upload**, which opens their Documents tab.
- Score is its own right-aligned column. Missing values are an en dash.
- No decision buttons in rows. Links only open other screens.

## 3. Student Profile > Documents

### Résumé card (top)
- Left: the current file chip (name, upload date, Keith score, readiness), a status pill (Scored, Sent, or none), and a drop zone with **Choose file**.
- Right: version history with date, score, readiness, and "email sent" where it applies. Each version opens its review.
- Note: "Replacing never deletes. The current file moves here with its score."

### Application documents checklist (below)
- Header: "[N] of [M] required on file", a progress bar, the names of missing items, and **Upload documents**.
- `DataSheet` plain sheet with two groups:

| Group | Type | Qualifier | Keith check |
|---|---|---|---|
| Required for the NGRP application | Résumé | with rotation hours | Full score (section 4). Flags missing clinical rotation hours: facility, unit, and hours. |
| | Personal statement | Max 2 pages | Page count. Flags more than 2 pages. |
| | Transcript | Official or unofficial | Reads the graduation or completion date. Flags a transcript with no date. |
| | Letter of recommendation 1 | Recommender role | Signature and recommender name present. |
| | Letter of recommendation 2 | Recommender role | Same. |
| Also on file | BLS card | AHA | Reads the expiration date. |
| | ACLS card | If held | Reads the expiration date. |
| | Proof of licensure | California RN | Reads the expiration date. Shows "Not yet · After NCLEX" until uploaded. |

- The "Also on file" group label is pending owner confirmation. It may become "ASPIRE onboarding" or be removed. Keep it config-driven.
- Columns: Document (Name · qualifier), Status, Updated, Detail, actions.
- Status pills: On file (green), Missing (amber, required only), None (grey, optional), Not yet (grey).
- Detail holds the Keith check result, such as "2 pages · within limit", "Completion Dec 2026", or "Expires May 2028".
- Actions: **View** and **Replace** when a file exists. **Request** and **Upload** when it does not.

### Upload dialog
- Opened from a row (type fixed) or from **Upload documents** (type picker, required types first).
- New file: one file chip. Replace: "Current → history" and "New current" side by side.
- Keith checks run on upload:
  - **Date checks** (transcript, BLS, ACLS, licensure): show the date Keith read in an editable field, the line "Keith read this from the file. Check it against the file before you save," and a checkbox "I checked this date against the file." **Upload** or **Replace** stays disabled until it is checked. Store `confirmed_by` and `confirmed_at`.
  - **Page and signature checks:** show the result. A flag is a warning, not a block.
- Footer hint: "Nothing is deleted. Old versions stay in history."
- After save, show a toast: "[Type] uploaded to [First name]'s documents."

### Request
- **Request** opens a pre-filled ASPIRE Connect > Outreach message asking for that document, tagged `document_request`. Requests never log support.

## 4. Keith résumé scoring

**Trigger**
- Staff replace or upload a résumé with "Score it with Keith after upload" checked (default on).
- The replace prompt reads "Replace [First name]'s current résumé?" and shows the old and new files. Buttons: Cancel, Replace and score.
- If the file hash matches the current version, skip scoring and say so.

**Processing**
- Reuse the receipt pipeline. Show four steps: Uploaded and filed, Reading [N] pages, Scoring six categories, Drafting the email.
- The user can close the dialog. The score appears on the Documents tab when ready.
- On failure: status Failed, a Retry button, and the file stays saved.

**Keith skill contract**
- Run `aspire-resume-reviewer` on the extracted text and return JSON matching `resume_review`. Map the skill's sections:
  - Overall score → `score`. Category scores → `categories`. Readiness classification → `readiness`.
  - The three highest-priority improvements → `top_fixes`.
  - Any absent graduation date, BLS status, ASPIRE participation, clinical rotation hours (facility, unit, hours), unit placements, or GPA → `missing_info`.
  - All ten sections → `full_report`.
- Add the draft email: warm, in the owner's voice, signed with the owner's name and credentials from their profile. It covers strengths, the three fixes, a request for every `missing_info` item, and an invitation to send the next version. Score sentence included by default.
- Keith never invents experience, hours, units, dates, or certifications. A missing item is requested, never filled in.

**Review modal** (two columns, matching the receipts modal)
- Header: "[First Last] · [cohort]", file name, and scoring time. Close returns focus to the trigger.
- Tracker: **Uploaded → Scored → Send via Outreach → Logged as support.** Done steps green with dates. Current step navy with `aria-current="step"`.
- Left (`--paper-2`): the résumé preview with the top fixes highlighted, a SCORED stamp (decorative), Download and View original, and a score history card with the change since the last review.
- Right, in order:
  1. Missing-info alert (amber), when `missing_info` is not empty.
  2. Score: ring with score of 100, readiness pill, change since last review, two-line summary, six category bars (scores of 6 or lower in amber), top three fixes, and links to the full report and rewritten bullets. **Copy score** copies one labeled line.
  3. Draft response: the email body, with Warmer, Shorter, and Regenerate. Checkboxes: Include score, Attach rewritten bullets. Both update the draft.
- Footer: hint "Opens a pre-filled Outreach message tagged to [First name]. Sending it logs Résumé Review with the date." Buttons: **Copy draft** (secondary) and **Open in Outreach** (primary).
- **Copy draft** shows a toast: "Draft copied. Copying does not log support. Use Open in Outreach to log on send."

## 5. Outreach handoff and auto-log

- **Open in Outreach** opens ASPIRE Connect > Outreach > New message, pre-filled:
  - To: the alumnus, using their personal email on file.
  - From: the owner.
  - Subject and body: the current draft. The user can edit everything.
  - Attachments: the current résumé version and, if checked, the rewritten bullets.
  - Tag: `support:resume_review` with `alumnus_id` and `resume_review_id`. Show it as a chip: "Support · Résumé Review · [First Last]".
  - A green note: "When you send, [First name] is logged as supported for Résumé Review on the send date. If you schedule it, the log uses the date it goes out."
- On a successful send event for a tagged message:
  - Write `support_entry` with `activity: resume_review`, `date` = the actual send date in the owner's time zone, `source: outreach`, and `source_ref` = message id.
  - Set `resume_review.status = sent`, `sent_at`, and `outreach_message_id`.
  - Show a toast: "Sent to [First name]. Résumé Review logged for [date]."
- A scheduled send logs when it goes out. A failed send logs nothing. Make the handler idempotent so a retried event writes one entry.
- Recalling or deleting the message later does not remove the entry. Staff can remove it from the entry's history.

## 6. Residency Portal mirror

The portal reads the same `document` and `document_version` records. There is one source of truth.

**Alumni see**
- The Application documents checklist: the same required list, statuses, "[N] of [M] required on file", and missing items.
- **Upload** and **Replace** for each type, with the same replace-to-history rule and date confirmation ("I checked this date against my document").
- Their own version history, with upload dates only.
- A banner for any open document request from Outreach: "Your ASPIRE team asked for [type]."

**Alumni do not see**
- Keith scores, category scores, readiness, the full report, drafts, or staff notes. They get feedback through the Outreach email.
- Any other alumnus's records.

**When an alumnus uploads**
- Keith runs the type's check (page count, date, signature). The alumnus confirms dates. Staff see "Confirmed by alumnus" with the time.
- A new résumé does not score automatically. It adds a needs-queue item for staff: "[First Last] uploaded a new résumé · Score now". **Score now** runs section 4.
- A newly completed required list adds a needs-queue item: "[First Last] completed application documents."
- Uploads made in the portal appear on the staff Documents tab at once, and the reverse.

## 7. Keith boundary

This build gives Keith a per-alumnus capability. Keith is aggregate-only everywhere else.

- Limit per-alumnus Keith output to résumé scoring and document checks on this screen.
- Show scores and reports only to roles with ASPIRE owner or co-lead access. Hide them from unit leaders, partner schools, and the portal.
- Log every Keith run (who, when, which version, which skill version) in the audit trail.
- Keith never sends messages and never changes a record without a user action.
- Scores are advisory and never affect residency eligibility. Keep the existing "optional, never affects eligibility" line on the Support tab.
- Add a note in your delivery summary that the Keith data boundary changed, so the owner can update the Keith foundation spec.

## 8. Accessibility

- Dialogs trap focus, label themselves with their title, close on Escape, and return focus to the trigger.
- Upload drop zones also work with a real **Choose file** button.
- Status pills carry text. Stamps and banding are decorative (`aria-hidden`).
- The scoring steps use `aria-live="polite"` and `aria-busy` while running.
- Category bars expose their value in text ("6/10").
- Copy buttons name what they copy and announce success.
- Text meets WCAG AA in light and dark. Touch targets are at least 44 px. Respect `prefers-reduced-motion`.

## 9. Done when

- [ ] Support entries save for alumni with a pending transition form. The roster shows every alumnus in scope with a Form pill.
- [ ] Log group activity bulk-logs one activity and date for many alumni, skips duplicates with a count, and can be undone.
- [ ] Résumé Review is not a manual option. It appears in By Alumnus only from Outreach sends, with a link to Documents.
- [ ] Documents shows the résumé card, version history, and the Application documents checklist from config.
- [ ] Replacing any document creates a new version. No version is deleted.
- [ ] Date checks block save until confirmed and store who confirmed.
- [ ] Keith scores a résumé on upload and fills the review modal: missing info, score, categories, top fixes, and draft.
- [ ] Open in Outreach pre-fills and tags the message. Sending writes one support entry with the send date. Scheduled sends log on send. Failed sends log nothing.
- [ ] Copy draft never logs support.
- [ ] The Residency Portal shows the same checklist and lets alumni upload and replace, without scores or drafts.
- [ ] A portal résumé upload creates a "Score now" needs-queue item instead of scoring automatically.
- [ ] Every Keith run is in the audit trail. Scores are hidden from non-owner roles.

## Deliver

- A summary of the files you changed.
- Every schema or migration change, sent through the SQL gate.
- Your findings for section 0.
- Every place where the app differs from this spec, and what you did about it.
- The Keith boundary note from section 7.
