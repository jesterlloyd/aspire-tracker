# Build prompt: ASPIRE Signatures (e-signature inside the Catalog)

**Attach with this prompt:** `aspire-catalog-mockup.html`. Open it and go to the Catalog's left list, then **Signature requests**, or use **+ New > Prepare a document for signature**. The mockup is the visual and behavioral reference. Every person, school and timestamp in it is sample data.

**This prompt replaces Phase 3 (Signature documents) of `aspire-catalog-build-prompt.md`.** Phases 1 and 2 of that prompt stay as written.

## Context

ASPIRE Intelligence runs its own signing engine. There is no vendor. The platform will also be sold to other organizations, so every design choice must work for more than one tenant.

Staff send three kinds of documents for signature:

- acknowledgments and attestations
- requests and consent forms
- contracts and agreements

Health information is out of scope. Signers are students, school faculty or deans, preceptors and staff.

Before you write code, read these in the repo:

- the Catalog code from the previous build
- ASPIRE Connect sending services (Messages and Outreach)
- student, school and person records
- auth and session handling
- file storage
- the `appearance.style` setting (Classic or Modern)

Reuse existing components, tokens and the Review & Release left-list pattern.

Ship everything behind the feature flag **`catalog.signatures`, off by default**. The flag stays off in production until the legal and IT sign-off in section 10 is done.

## 1. Legal requirements (build these exactly)

These requirements come from the California Uniform Electronic Transactions Act (UETA), Civil Code 1633.1 to 1633.17, and the federal ESIGN Act, 15 U.S.C. 7001.

1. **Consent before signing.** Every signer sees a consent screen before the document opens. This must be its own step, never buried in other text. It states:
   - The signer may ask for a paper copy, and whether there are fees.
   - The signer may withdraw consent before signing, by declining, and what happens if they do.
   - The consent covers this document only.
   - How to update their email.
   - How to get a paper copy after signing.
   - What the signer needs: a current browser and a PDF reader.

   The signer must also open a sample PDF and check "I opened the sample PDF and can read it." This shows they can open the format, which ESIGN requires. Then they check "I agree to use electronic records and signatures."

   Store the disclosure version shown, both checkbox actions and the timestamps. Keep disclosure text versioned and editable per organization.
2. **Intent.** A signature is applied only by a deliberate act: the signer adopts a typed or drawn signature next to the words "By selecting Adopt and sign, I agree that this signature and initials are my electronic signature, with the same effect as my handwritten signature on this document," then presses Adopt and sign, then Finish. Opening or scrolling never counts as signing.
3. **Attribution.**
   - External signers use a unique, single-use emailed link plus a 6-digit one-time code (by email, or by text if a mobile number is given). The code expires in 10 minutes and is limited to 5 attempts.
   - Staff signers who sign in the app re-enter their password.
   - Record the method, where the code was sent (masked), the verification time, failed attempts, and the IP address, browser and device for every event.
4. **Never block the signer from keeping a copy.** Signers can download the document before signing and their copy after signing. A copy the signer can't print or save is not enforceable against them (Civil Code 1633.8).
5. **Seal the record.** When the last signer finishes:
   - Flatten all fields.
   - Append a certificate of completion page.
   - Apply a PDF digital signature using the platform's certificate, so any later edit shows as invalid in PDF readers.
   - Store SHA-256 hashes of the original upload and of the sealed PDF.
   - Email the sealed copy to every party, including the sender. This is the "Returned" step.
6. **Append-only audit log.** Events are added, never edited or deleted. Chain each event to the previous one with a hash. Show all times in UTC in storage and in the organization's time zone on screen and on the certificate.
7. **Excluded document types.** Every template has a required **Document type**. These types are blocked unless an admin confirms:
   - wills, codicils and trusts
   - family law documents
   - court orders and filings
   - notices about utility shutoff, eviction, foreclosure or loan default
   - notices cancelling health or life insurance
   - product recall notices
   - hazardous-materials documents
   - documents that require notarization
8. **Retention.** Each template has a retention period and a legal-hold flag. Sealed PDFs, certificates and audit logs go to write-once storage.

## 2. Where it lives in the Catalog

**Entry points:**

- **Left list > Tracking > Signature requests.** Shows the request count.
- **+ New > Prepare a document for signature.** Opens the editor at step 1.
- **A signature document's detail panel:**
  - **Send for signature**: the Catalog Send window
  - **Edit fields**: opens the editor at step 3
  - **Preview as signer**
  - The tracker's student names open that person's request.

The Signatures screen has three tabs: **Signature requests**, **Prepare and send**, **Signer preview**. It has a breadcrumb "‹ Catalog / Signatures".

**Send window additions for signature documents:**

- "Sends as: Signature request" with the line "Each signer gets a secure link and a one-time code. Consent, timestamps and the audit trail are captured, and the sealed copy comes back to you."
- **How it goes out:**
  - **Each person signs their own copy** (default when more than one person is picked): one request per person, grouped as a bulk send.
  - **One copy, everyone signs in order.**
- Due date and reminders, as in the Catalog prompt.

## 3. Signature requests (tracker)

**Status filters:** All, Waiting (Sent or Opened), Partly signed, Completed, Declined, Expired, Drafts. Each shows a count.

**Rows:**

- title, recipient, a one-line status and a dot per signer
- the status chip and the date sent
- "Waiting on you" plus a teal **Your turn** tag when the current signer is the signed-in user
- "Returned to you {date}" when the document is completed

**Statuses:**

- **Per request:** Draft, Sent, Opened, Partly signed, Completed, Declined, Voided, Expired.
- **Per signer:** Sent, Delivered, Code verified, Consent accepted, Opened, Signed, Declined, and Completed copy sent.

Timestamp every change.

**Your-turn banner:** "1 document is waiting for your signature," with a **Sign now** button.

**Bulk sends:** one parent row, for example "CSMC Experience Confidentiality Policy Acknowledgment · Fall 2026 cohort · 24 people, each signs their own copy · 19 signed · 2 overdue."

- The row shows a progress bar: green signed, amber overdue, faded navy opened.
- Clicking the row expands child rows, one per person.
- The parent's detail panel has:
  - **Remind N not signed**
  - **Signed copies (ZIP)**
  - **Export status (CSV)**
  - a progress bar with a text summary
  - a list of people with their statuses
- A child opens its own detail panel, with a "‹ Back to all 24" link.

**Detail panel for one request:**

- the status, title, recipient, sent time and expiration
- actions that depend on status:
  - **Waiting:** Remind, Void, View progress
  - **Your turn:** Sign now, Void
  - **Completed:** Sealed PDF, Certificate
  - **Declined or expired:** Correct and resend
  - **Draft:** Continue editing, Delete draft
- a "Sealed and returned" note with the SHA-256 of the final PDF, once the request completes
- each signer in order, with a timeline of every step and its time
- the audit trail table: time, event, by, and IP and device

**Void:** requires a reason. Signers get an email, and the reason goes in the audit log.

**Certificate of completion:** a modal and the last PDF page.

- envelope ID, sender and sent time, completion time, and the final document hash
- per signer:
  - name, email and role
  - identity-check method
  - consent version and time
  - signed time, IP address and device
  - a rendering of their signature

## 4. Prepare and send (editor)

Four steps, with "Next" and "Back": **Document**, **Recipients**, **Place fields**, **Review and send**.

**Step 1, Document:**

- Start from a template, a PDF upload, or a Word upload. Convert Word to PDF on upload, so pages never shift.
- Several files join into one document.
- Set the Document type (drives the exclusions in section 1.7) and the document name.

**Step 2, Recipients:**

- Each recipient has a name, email, optional mobile number (for a code by text) and a role:
  - **Signer**
  - **Needs to view:** must open the document before it moves on
  - **Receives a copy**
- A signing-order toggle, "in order" by default.
- **Add from Contacts.**
- Each signer gets a color: plum for signer 1, teal for signer 2, then navy, amber and green.

**Step 3, Place fields:**

- **Left panel.** Pick who you're placing fields for. Each signer shows a count.
- **Field palette:** Signature, Initials, Date signed, Full name, Email, Phone, Title, School or company, Address, Text, Checkbox, Dropdown, Radio group.
- **Pages.** Page thumbnails above the page, each with a field count. Fields belong to one page.
- **Placing.** Click a field type, then click the page. Fields are stored in page-relative percentages, so they survive zoom and screen size.
- **Moving and resizing.** Drag to move. Drag the corner handle to resize. The handle shows only on the selected field.
- **Snapping.** While dragging, snap any edge or center of the field to the edges and centers of other fields on the page, and to the page's vertical center.
  - The threshold is about 0.9% of the page.
  - Show a pink dashed guide line while snapped. The page-center guide is solid.
  - Holding **Alt** places the field freely.
- **Keyboard:**
  - **Delete** or **Backspace** removes the selected field. The toast reads "Field deleted. Press Ctrl+Z or ⌘Z to undo."
  - **Ctrl+Z** or **⌘Z** restores the last deleted field.
  - **Arrow keys** nudge the selected field by 0.5%. **Shift+Arrow** nudges by 2%.
  - **Esc** cancels placing.
  - These shortcuts work only when focus is not in a text input.
- **Radio group.** One click places **3 round options**, stacked, aligned on one vertical line and evenly spaced. All three share one group, "Choice N."
  - Each option has its own label, shown beside it.
  - The panel has **+ Add option** and **Line up**, which centers every option on one line and spaces them evenly.
  - The signer must pick exactly one.
- **Right panel, field settings:**
  - **Filled by:** any signer, or **You, before sending.** Fields filled before sending are completed at step 4 and locked for signers.
  - **Required.** Hidden for checkbox groups and radio groups.
  - **Label.**
  - **Fill from ASPIRE record** (on by default for name, email, title, school, phone and address). The signer can still edit it.
  - **Rules:**
    - **Phone:** US phone number, any phone number, or none.
    - **Email:** valid email address.
    - **Text:** number, ZIP code, or up to 100 characters.
    - **Checkbox:** a group name and a group rule (at least 1, exactly 1, or all). The panel shows how many checkboxes share the group.
  - **Duplicate** and **Delete.**
- **Warning.** Show a warning under the page when any signer has no signature field.

**Step 4, Review and send:**

- **Fill before sending:** any fields marked "You, before sending."
- **The email:** subject, a message with a `{first name}` placeholder, reminders, expiration, and identity check (email link + code, link + code by text, or ASPIRE portal sign-in).
- **Summary:** each signer with their field count, the copy recipients, and "Signed copy returns to: You and every party."
- **Save as a template in the Catalog.** When this is off, the request is one-time and still shows in Signature requests.
- **Preview as signer.**
- **Checks, which block sending while any fail:**
  - every signer has a signature field
  - every signer has a valid email
  - the document type allows e-signature
  - the consent screen and one-time code are on
  - every rule is listed, for example "Roster attachments: signer checks at least 1"

## 5. The signer's experience (mobile first)

Signers always see the plain Modern flow, whatever style the sender uses.

1. **Email.** It comes from "{Sender} via ASPIRE Intelligence" with a **Review document** button. It warns: "This link is only for {email}. Do not forward it."
2. **Code.** "Confirm it's you." Six boxes for the one-time code, which auto-advance, plus **Send a new code**.
3. **Consent.** As in section 1.1, with **Continue** and **Decline to sign**.
4. **Fill and sign.**
   - The header shows "N required fields left."
   - **Zoom in** and **Whole page** controls.
   - A **More** menu with:
     - **Someone else should sign this:** name, email and reason. The sender approves the change before the new signer gets it.
     - **Download to read first.**
     - **Request a paper copy.**
     - **Decline to sign:** requires a reason. The sender is notified.
   - Pages stack vertically. The current field is highlighted, and the view scrolls to center it.
   - Fields belonging to other signers are faded. Fields filled before sending show their value.
   - The bottom button reads "Fill: {field}" and moves through unmet requirements in page order. It counts each checkbox group as one requirement, and warns "{Group}: check at least one."
   - The first signature or initials field opens **Adopt your signature**: full name, a Type or Draw choice, and the legal text in section 1.2. Later signature and initials fields fill with one tap.
   - Date signed fills automatically. Prefilled fields fill on tap and stay editable. Rule checks run live.
   - **Finish** appears when nothing required is left.
5. **Done.** "You signed" with the time. It says who signs next, notes that the sealed copy will arrive by email, and offers **Download your copy**.

## 6. Signing in the app (your turn)

**Sign now** opens a large modal:

- All pages, with earlier signers' values filled in and your fields pulsing.
- A side panel with:
  - "Your turn, signer N of N"
  - a status of your fields left
  - **Confirm it's you: ASPIRE password**
  - "I agree that my typed name is my electronic signature on this document."
  - **Sign and complete**, enabled only when every field is filled, the password is entered and the box is checked
  - **Cancel**

On completion:

- Update the timeline and audit log: opened in app, password re-confirmed, signed, sealed, copies emailed.
- If you were the last signer, seal the document and send the copies.

## 7. Classic style (staff screens only)

Under `appearance.style = classic`:

- **Request list:** paper rows inside the wooden bookcase frame, with wooden filter buttons.
- **Status chips:** rubber stamps.
  - Signed and Completed: green ink.
  - Partly signed: plum.
  - Sent and Opened: navy.
  - Declined and Overdue: red, rotated the other way.
  - Draft, Expired and Voided: dashed and faint.
- **Detail panel:** the torn-sheet paper look, with the shadow on a wrapper.
- **Editor:** fields become solid sign-here arrow flags in the signer's color, on a paper page laid on wood. Radio options stay round and have no arrow.
- **Page thumbnails** stay plain.

Reuse the Catalog's Classic tokens and textures. Modern has none of these materials.

## 8. Data model (adapt to the existing schema)

List every schema change in your report.

- `sig_templates`: org, name, document type, source PDF (hash), pages, fields as JSON, signer roles, retention, legal hold, version.
- `sig_fields` (or JSON in the template): id, page, x, y, w, h (page percent), type, signer role or `sender`, required, label, prefill source, rule, group, group rule, option label.
- `sig_requests`: id, org, template version, title, parent bulk ID (nullable), mode (`each` or `one`), status, sender, sent, expires, completed, void reason, original hash, sealed hash, sealed PDF.
- `sig_request_signers`: order, person or contact, email, phone, role, color, status, access-token hash, code attempts, consent version, consented at, signed at, adopted signature (type plus typed text or stroke data).
- `sig_field_values`: request, field, signer, value, time.
- `sig_events`: append-only. Request, signer, type, time (UTC), IP, user agent, details as JSON, previous hash, hash.
- `sig_bulk_sends`: parent record, counts computed from children.
- **Link each completed request to the person's or school's record,** so a filed PDF appears there with its certificate.

## 9. Security

- Store access tokens and codes as hashes only.
- Links expire with the request and stop working after completion, void or decline.
- Rate-limit code requests and attempts.
- Isolate every organization's data, for example with row-level security.
- Encrypt PDFs and field values at rest.
- Build the PDF sealing and signing service behind an interface, so a Cedars-Sinai-approved vendor could replace it without changing the UI.

## 10. Before launch (do not remove)

Keep this note in the editor while the flag is off in production: "Confirm with Legal and IT that in-app e-signature meets Cedars-Sinai policy, or connect the approved vendor behind this same screen."

Legal must review:

- the consent text
- the certificate wording
- whether email plus code is enough for affiliation agreements and MOUs, or whether portal sign-in is required

## 11. Accessibility

- Every control is keyboard reachable, with a visible navy focus ring.
- Fields are focusable buttons, and arrow keys move the selected field.
- Status is carried by text, never color alone. Stamps and chips read their status.
- A drawn signature always has a typed alternative.
- Signer screens meet WCAG AA at phone width.

## 12. Acceptance

- [ ] The flag hides every entry point when off.
- [ ] Place, move, snap (with guides; Alt bypasses), resize, nudge, delete with Delete or Backspace, and undo with Ctrl+Z or ⌘Z all work.
- [ ] Radio groups place 3 aligned options, and **Line up** straightens them.
- [ ] Multi-page documents keep each field on its page.
- [ ] Rules and group requirements block Finish until they are met, with clear messages.
- [ ] A bulk send creates one request per person under one parent. Parent counts match the children, and Remind, ZIP and CSV work.
- [ ] In-order signing routes correctly. **Your turn** and **Sign now** appear for staff signers.
- [ ] Consent, code, adopt, finish, seal, certificate, and copies to every party work end to end.
- [ ] Opening the sealed PDF after any change shows an invalid signature.
- [ ] Decline, void, expire, reassign (with sender approval) and paper-copy requests are logged and notify the sender.
- [ ] Excluded document types are blocked without admin confirmation.
- [ ] Classic and Modern look as specified. Signers always see Modern.

## 13. Deliver

- A summary of the files changed.
- Every schema change.
- The PDF sealing approach and libraries used.
- Anything in the app that differs from this spec.
- Open questions. Do not guess on legal or data-model decisions.
