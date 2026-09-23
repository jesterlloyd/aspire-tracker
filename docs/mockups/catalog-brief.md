# Build prompt: ASPIRE Catalog revamp (Modern + Classic, Send, Forms, Signatures)

**Attach with this prompt:** `aspire-catalog-mockup.html`. The mockup is the visual and behavioral reference. It uses sample people and schools.

- Use the **Classic | Modern** switch in its top bar to compare the two styles.
- In the mockup, Modern sets `data-style="flat"`. In the app, use the existing `data-style="modern"` from the Appearance build.

## Context

The ASPIRE Catalog (`/catalog`) is the staff file manager. Staff use it to find a resource and **send** it, **collect** a form, or **get a document signed**. This build does five things:

- Revamps the Modern screen.
- Adds a Classic skin: an iOS 6 iBooks-style bookcase.
- Routes every send through ASPIRE Connect.
- Adds a form builder.
- Adds signature documents.

Before you change anything, read these in the repo:

- The current Catalog route, its components and data model
- Manage categories
- ASPIRE Connect: Messages and Outreach sending
- Student and school records
- The Appearance style setting (`appearance.style`)
- The Review & Release left list component

Reuse existing components, tokens and patterns. Do not add dependencies unless a step says so.

## Build order

Work in phases. Commit each phase separately, and report at the end of each one.

1. **Phase 1:** Catalog revamp (Modern), the Classic skin, Send through Connect, and cleanup of categories and data.
2. **Phase 2:** Forms, meaning the builder, the completion tracker, and filing completed forms to records.
3. **Phase 3:** Signature documents. Build it behind the feature flag `catalog.signatures`, **off by default**. Legal and IT still need to approve in-app e-signature or name an approved vendor. See section 6.

---

## 1. Page structure (both styles)

### Header

- **Title and subtitle:** "ASPIRE Catalog" and "Find a resource, then send it, collect it or get it signed."
- **Summary line:** "**15** items · **5** out for completion · **6** people overdue", with the overdue count in amber. Compute every number live.
- **Remove the four stat tiles:** Resources, Categories, Recently Updated and Featured.
- **+ New menu.** It has three options:
  - **Upload a file:** "PDF, Word, Excel or image"
  - **Build a form:** "Collect answers. Prefill from the student record." This option ships in Phase 2.
  - **Prepare a document for signature:** "Upload a PDF, place fields, set signers." This option ships in Phase 3, behind the flag.
- **Keep the existing back button.**

### Left list

Reuse the Review & Release left list component: a white card, mono uppercase group labels, and a filled navy selected item. It has three groups:

- **Library:** All items, Files, Forms, Signature documents, each with a count.
- **Tracking:**
  - Out for completion: items where not everyone has finished.
  - Overdue people: an amber count badge. Clicking it filters to items that have overdue people.
- **Categories:** each category with a count, and a **Manage** link that opens the existing Manage categories modal.

### Toolbar

- A search field that matches title, description and category.
- A sort control: Recently updated (default), Most used, A to Z.
- A "Show removed" checkbox.

### Item list (Modern)

- **Sections.** When no filter is on, show a **Pinned** section first, then **Everything else**.
- **Row contents:**
  - **Type icon.** Files get a file-type badge (PDF, DOCX, XLSX). Forms get a navy form icon. Signature documents get a plum signature icon.
  - **Title**, with a pin mark when pinned. Long titles wrap to 2 lines.
  - **Description** on one line.
  - **Meta line:** a category pill and the audience. "Staff only" shows in bold red.
  - **Status.**
    - Files show "Sent N times" and "Updated Mon D".
    - Forms and signature documents show "**19** of 24 signed", an overdue count in amber, a progress bar (green done, amber overdue, faded navy opened), and "Due Mon D".
  - **Actions:** a **Send** button, and a ⋯ menu.
    - For files, the menu has Open, Download, Copy link, Edit details, Upload new version, Pin or Unpin, and Remove.
    - For forms and signature documents, it has Edit, Preview, Duplicate, Export responses, Edit details, Pin or Unpin, and Remove.
- **Selection.** Clicking a row selects it (navy-soft fill, 3px bar on the left) and shows its details in the right panel.

### Detail panel (right)

- **For every item:** the type label, title, description and primary action.
  - Files: **Send**, **Open** and **Download**.
  - Forms: **Send form** and **Edit form**.
  - Signature documents: **Send for signature** and **Edit fields**.
- **For a file:**
  - a preview thumbnail
  - Category, Audience, Version and date, and Size
  - **Send history** from the send log: date, recipient and channel
  - the line "Sent N times. Every send is logged here and on each recipient's record."
- **For a form or signature document:**
  - "**19 of 24** signed · due Sep 26" and a progress bar with an accessible text label
  - filter chips: All, Overdue, Not opened, Opened, Done or Signed
  - a list of people with their status and a **Remind** link for anyone not done
  - **Remind N overdue**
  - the note "Each signed copy files to the student's record as a PDF with its audit trail. This tracker stays in the Catalog."
- **The panel closes with ✕,** and the list then takes the full width.

## 2. Send through ASPIRE Connect (Phase 1)

**Send** opens a modal: "Send {item}", with the line "Goes out through ASPIRE Connect and is logged."

- **To:** a token field for students, cohorts, units and schools.
  - Show suggestions from the item's audience, such as "Fall 2026 · Internship cohort (24)", "Not yet completed (5)", "4 South students (2)" and "All 5 partner schools".
  - Default recipients: "Not yet completed" when a form or signature document is partly done, all partner schools for school items, and the current cohort otherwise.
- **Send through:** Connect message (default) or Outreach email. Use the existing Connect sending services.
- **Sends as:** a read-only line that depends on the type:
  - File: "Attachment."
  - Form: "Fillable form link. Each person gets a personal link. Answers they already gave ASPIRE are filled in."
  - Signature document: "Signature request. Signers go in order, and you are notified when all sign."
- **For forms and signature documents:** Due date, and Reminders (Every 3 days until done, default; Once, 2 days before due; Off).
- **Message:** filled in per type, with `{first name}` merge. The user can edit it.
- **Footer:** "Logged on this item and on each recipient's record." A toast confirms the send.

**Send log:** record each send with the item, the item version, the recipients (expanded to people), the channel, the Connect message ID, who sent it, and when. The detail panel and each recipient's record read from it.

## 3. Data and category cleanup (Phase 1)

- **Personal files.** The Catalog holds shared resources only. Build a one-time admin review that lists files whose names match a student (for example `Schedule_Witkin_Reena`). A staff member confirms each move to that student's record documents. **Do not move files automatically.** After a move, show a dismissible notice once: "1 personal file moved. Schedule_Witkin_Reena now lives on that student's record."
- **Featured becomes Pinned.** Migrate the `featured` flag to `pinned`. Remove the Featured Collections, Recent Updates and Pinned Resources side panels.
- **Categories.** "Forms" is now an item type, so retire it as a category.
  - Add **Student Onboarding** and **School Documents**.
  - List the items currently in "Forms" so staff can reassign them. Suggest Student Onboarding for student paperwork.
  - Keep category slugs fixed, as the modal already promises.
- **Audience field** on every item: Everyone, Students, Preceptors, Schools, Staff only.

## 4. Classic skin: iOS 6 iBooks bookcase (Phase 1)

Classic applies only when `appearance.style` is `classic`. It is a material layer on the same components: same data, same actions, same keyboard behavior. Draw everything with CSS. Put wood grain, paper grain and edge shapes in data-URI SVG, and use no image files.

### Bookcase (default Classic view)

- **Frame.** The middle column becomes a wooden bookcase:
  - maple back panel with vertical grain and shaded side edges
  - horizontal shelves: highlight on the top edge, darker front face, shadow underneath
  - a fixed row height, so empty shelves show below the items, as in iBooks
- **Wooden toolbar** across the top:
  - left: a grid and list toggle
  - center: the section name and count, engraved
  - right: a **+ New** button
  - all buttons are wood gradient buttons
- **Covers.** Each item is a portrait cover (about 124 × 168 px) standing on a shelf:
  - a spine shadow on the left edge
  - a color band at the top: red PDF, green XLSX, navy DOCX and forms, plum signature documents
  - a small mono label: the category for files, or "Form" or "Signature"
  - the title, clamped to 4 lines
  - decoration: text lines for files, checkbox lines for forms
  - a footer: format and version plus "Sent N times" for files, or "19/24 signed" and a mini progress bar
- **Cover markers:**
  - **Pinned:** a blue diagonal corner sash reading "PINNED", like the iBooks "New" ribbon. Pinned items go first on the top shelf.
  - **Signature documents:** a plum **SIGN HERE** arrow flag sticking out the right edge.
  - **Overdue:** a rubber-stamp label on the cover, such as "3 OVERDUE", in amber ink.
- **Cover behavior:**
  - A cover lifts 3px on hover.
  - The selected cover lifts 6px with a light halo and a navy outline.
  - Hover or focus shows a small navy **Send** pill.
  - Arrow keys move between covers. Covers are buttons, and selection uses `aria-selected`.
- **List toggle.** It keeps the same bookcase frame and toolbar. The list sits on one paper sheet laid on the wood, with the same rows as Modern.
- **Pinned items** show a paper clip instead of a star in Classic.

### Detail panel

- **A sheet torn from a pad:** paper with fine grain, a torn left edge made with an SVG mask, and a soft drop shadow. Put the shadow on a wrapper, because the mask clips `box-shadow`.
- **Send history** is a **library checkout card**:
  - a cream card with a double red rule under the header
  - blue ruled lines and a red rule between columns
  - columns "Date sent", "Issued to" and "Via"
  - dates stamped in navy ink, slightly rotated
  - recipients in a handwritten face: Caveat from Google Fonts, with a cursive fallback
- **Tracker statuses** are rubber stamps: SIGNED and DONE in green ink, OPENED in navy, OVERDUE in amber with a thicker border, and NOT OPENED as a dashed outline. Stamps are uppercase mono, slightly rotated, with an ink-texture mask. **The word carries the status**, so no one needs to tell the colors apart.

### Signature prep (Phase 3)

- Each placed field is a SIGN HERE-style arrow flag in its signer's color: plum for signer 1, teal for signer 2.
- Signature fields read "Sign here".
- The document page gets paper grain.

### Dark mode

- Wood becomes walnut. Paper, the library card and the stamps get dark variants. The dark tokens are in the mockup.
- Text meets WCAG AA contrast in all four combinations: Classic light, Classic dark, Modern light, Modern dark.

### Modern

- The list and plain panel shown in section 1.
- No bookcase, torn edge, library card, stamps or flags.
- The grid and list toggle appears only in Classic.

## 5. Forms (Phase 2)

**Builder:** `/catalog/forms/:id/edit`. A breadcrumb "‹ Catalog / Forms", the form title, a status tag (Draft or Published), **Preview as student** and **Publish changes**.

- **Left, "Add a question":** Short answer, Paragraph, Multiple choice, Checkboxes, Dropdown, Number, Date, File upload, Signature, Section heading.
- **Center:** the form as respondents see it: title, description and question cards.
  - Each card shows a drag handle, the label, a required marker, help text, a preview of the control, and the question type.
  - Drag to reorder.
  - A prefilled question shows "Filled automatically" and its source.
- **Right, two tabs:**
  - **Question:** label, help text, **Prefill from** (None, Student record fields, Placement fields), Required, and Delete.
  - **Form settings:** who fills it (Students, Preceptors, Schools), "File a PDF to the record" (on by default), notify me on each submission, close after the due date, reminders, and export answers (CSV).

**Versioning:** publishing creates a new version. New links use the latest version. Submissions keep the version they were answered on.

**Respondent page:**

- Personal link, mobile first, with answers from ASPIRE filled in.
- **Before submit:** the respondent can review and edit answers.
- **On submit:**
  - Mark the assignment done.
  - Generate a PDF of the submission.
  - File the PDF to the person's record: student or school.
  - Update the tracker.

**Starter forms:** build the **ScrubEx Request Form** exactly as in the mockup. Build the **Student Parking Request** to replace the "Students Parking Data" spreadsheet, and export its answers as the list for Parking Services.

## 6. Signature documents (Phase 3, flag off)

**Template editor:** `/catalog/signatures/:id/edit`.

- **Signers in order:** a role and a default person, with color and order number, plus **+ Add signer**.
- **Field palette:** Signature, Initials, Date signed, Full name, Title, Text box, Checkbox. Place fields on PDF pages by clicking and dragging.
- **Sending rules:** signing order, reminders, expiration.
- **Validation:** every signer needs at least one signature field.
- **Replace PDF:** keep field positions when the page count matches.

**Signing flow:**

- Signers use secure links, in order.
- On completion, generate a flattened PDF with an audit trail: signer, time, IP address and device. File it to the relevant record, school or student.

**Starter documents:** CSMC Experience Confidentiality Policy Acknowledgment (the student signs), and Clinical Affiliation Attestation (the school signs, then the Cedars-Sinai ASPIRE lead countersigns).

**Before launch:** show this note in the editor: "Confirm with Legal and IT that in-app e-signature meets Cedars-Sinai policy, or connect the approved vendor behind this same screen." Build the signing service behind an interface, so an approved vendor (DocuSign or Adobe Sign) can replace it without changing the UI.

## 7. Data model (adapt to the existing schema)

Check what already exists, add only what is missing, and list every schema change.

- `catalog_items`:
  - `kind` (file, form or signature), `category_slug`, `audience`, `pinned`, `removed_at`
  - version fields
  - for files: file metadata
- `catalog_sends`: item, version, channel, Connect message ID, sender, time
- `catalog_send_recipients`: expanded people
- `form_definitions`: versioned JSON of questions, prefill mappings and settings
- `completion_requests`: item, person or school, status (not opened, opened, done, overdue), timestamps, due date, reminder schedule
  - **Overdue:** past due and not done.
  - Compute **overdue** from the data. Do not store it.
- `form_submissions`: answers, the definition version, and a link to the PDF filed to the record
- `signature_templates`: PDF, signer roles, placed fields
- `signature_requests`: signers, per-signer status, audit trail, and a link to the completed PDF filed to the record

## 8. Accessibility

- Every control is keyboard reachable, with a visible 3px navy focus ring.
- Selection:
  - list rows and covers use `aria-selected`
  - chips and toggles use `aria-pressed`
  - the current left-list item uses `aria-current`
- Progress bars have text labels, for example "19 signed, 2 overdue, 2 opened, 1 not opened".
- Modals trap focus and close on Escape.
- Respect `prefers-reduced-motion`: no cover lift animation.

## 9. Acceptance

**Phase 1**

- [ ] The stat tiles and empty side panels are gone. The summary line counts are correct.
- [ ] The left list, search, sort, Pinned section and rows match the mockup in Modern.
- [ ] Send works for all three types through Connect. Each send is logged and appears in the detail panel and on each recipient's record.
- [ ] The personal-file review moves files only after staff confirm. Featured has become Pinned. The Forms category is retired and its items reassigned.
- [ ] In Classic:
  - The bookcase, covers, sash, flags and stamps render. Empty shelves show.
  - The list toggle keeps the wooden frame.
  - The torn-sheet panel and the library card render.
  - The skin works in light and dark.
- [ ] Switching style changes only the look. Data, actions and keyboard behavior are identical.

**Phase 2**

- [ ] The builder creates, reorders, prefills, previews and publishes forms. Versioning holds.
- [ ] Respondents see answers already filled in. A submission files a PDF to the right record and updates the tracker.
- [ ] Reminders go out on schedule. Remind and Remind all overdue work.
- [ ] The ScrubEx and Student Parking Request forms are live, and the parking CSV exports.

**Phase 3**

- [ ] With the flag on, templates, ordered signing, the audit trail and filing to records work end to end.
- [ ] With the flag off, the signature entry points are hidden.

## 10. Deliver

At the end of each phase, report:

- files changed
- schema changes
- anything in the app that differs from this spec, and what you did about it
- open questions (do not guess on data-model or compliance questions)
