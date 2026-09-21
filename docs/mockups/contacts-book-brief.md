TASK: Add an optional "Address book" layout for ASPIRE Connect > Contacts. It is added alongside the current flat Contacts screen, never in place of it. Each user chooses which one they see in Settings. The current flat screen stays exactly as it is today.

REFERENCE FILE: docs/mockups/contacts-book-mockup.html in this repo. Open it first and read its CSS and markup. It is standalone and uses synthetic data. The spec below is the source of truth; the file shows the intended result and carries every exact value.

## 0. BEFORE WRITING CODE

- List the files behind the current Contacts screen: the list, category filters, profile panel, Recent Communications panel, Linked Students panel, and the data hooks or API calls feeding them. Tell me which you will add and which you will touch.
- Tell me where per-user preferences are stored today, if anywhere (a user settings table, a profile JSON column, local storage). Use that mechanism. If none exists, propose the smallest one and stop for my approval before creating a table.
- Confirm the Settings screen exists and where an Appearance section would go.

## 1. GUARDRAILS

- **Do not modify, restyle, or refactor the current flat Contacts screen.** Not its layout, not its CSS, not its components. It is the default and it must keep working exactly as it does now. If sharing code requires changing it, stop and tell me instead.
- Both layouts read from the same data hooks and the same API. Do not duplicate queries. If the flat screen's data logic lives inside its component, extract it into a shared hook first, with zero visual change, and confirm the flat screen still renders identically.
- No change to contacts data, permissions, email sending, or the communications log.
- This is a staff-only screen. No student-facing surface is affected.

## 2. THE SETTING

- Settings > Appearance > **Contacts layout**, a two-option segmented control: **Classic** (default) and **Address book**.
- Stored per user, not per browser, so it follows the user across devices. Key name suggestion: `appearance.contactsLayout`, values `classic` | `book`.
- Default is `classic` for every existing and new user. Nobody sees the book until they opt in.
- A small link on the Contacts screen itself, top right near Refresh, reading "Try the address book" in Classic and "Switch to classic" in the book, toggles the same setting. The two controls must stay in sync.
- Switching layouts keeps the currently selected contact, the active category filter, and the search text. The `?contactId=` deep link must open the right contact in either layout.
- Build the preference so other screens can add their own `appearance.*` keys later. Do not build those other keys now.

## 3. THE ADDRESS BOOK LAYOUT

### Structure
- Two pages inside an oxblood leather cover. Left page is the list, about 38% wide. Right page is the full contact record, about 62%.
- **The three-column layout becomes two.** Recent Communications and Linked Students move out of the right rail and into the record on the right page, below the profile. This applies to the book layout only. Classic keeps its three columns.
- Below 980px the pages stack: list first, then record.

### Cover
- Background #5E1E26 with an inline SVG feTurbulence grain (baseFrequency 1.1, numOctaves 2, alpha .5) blended soft-light, over a soft top highlight and `linear-gradient(180deg, #7E2B33, #5E1E26 55%, #43141B)`.
- Radius 8px, padding 15px 16px.
- A gold hairline pressed into the cover: an inset 7px border in `rgba(201,162,39,.32)`.
- Shadow: `inset 0 1px 0 rgba(255,255,255,.14), inset 0 -2px 0 rgba(0,0,0,.45), 0 2px 5px rgba(30,10,14,.35), 0 22px 50px rgba(30,10,14,.3)`.

### Pages
- Paper #FBF7F0, second tone #F3EDE3, ink #2A1D20, muted #7A6560, rules `rgba(90,40,45,.16)`.
- Gilt on both outer page edges: a 3px strip, `linear-gradient(180deg, #C9A227, #8F7318 50%, #C9A227)`.
- A gutter shadow down the fold between the pages, 26px wide, darkest at the center.

### A–Z thumb index
- A 33px column stepped down the outer left edge of the left page, one tab per letter.
- Letters with no contacts in the current category are disabled and dimmed.
- Clicking a letter filters the list to last names starting with it; clicking it again clears the filter. The active letter uses the cover color with cream text.

### Left page: the list
- Header: "Contacts" and an + Add button in the cover color.
- Search across name, school and role.
- Category chips with counts: All Contacts, Academic Partners, Unit Leaders, Preceptors, BNI Team, Nursing Executives, Others. The active chip uses the cover color.
- A count line: "12 of 12 shown · 231 in the full book".
- Entries sorted by last name, with a letter header each time the first letter changes. Each entry is 52px tall with a faint rule beneath it: initials avatar, name, then "Role · Organization" on one line.
- The selected entry gets a tinted background and a 3px left bar in the cover color, and scrolls into view when it is selected.

### Right page: the record, in this order
1. **Name plate.** Photo or initials, name, role badge in the cover color with the program beside it, organization, then actions: Email (primary), Call (disabled rather than hidden when there is no phone), Edit, LinkedIn (only when a profile exists). A 2px ink rule closes the plate.
2. **Contact.** Email, phone when present, affiliation.
3. **Notes.**
4. **Notification preferences.** Show only the preferences the system actually stores. The mockup shows an SMS pill as an example; drop it if SMS preferences do not exist.
5. **Recent communications.** Subject, status pill (Delivered green, Opened navy), date. Keep the current "View all communications for this contact →" link.
6. **Linked students.** Heading count reads "5 assigned · 3 on active rotation". Each row: initials, name, status pill (Active Rotation green, Placed amber, Completed grey).

Section headers are small uppercase mono labels over a hairline rule, with any count right-aligned.

## 4. DARK MODE AND ACCESSIBILITY

- Dark tokens are in the mockup: cover `#3E1A20 → #210C11`, paper #1E1A1C, ink #F0E8E4, muted #B49E98. Gilt stays but dims to #A8862B.
- Thumb index letters are buttons with `aria-label="Jump to M"` and `aria-pressed`. Disabled letters use the `disabled` attribute.
- Entries are buttons with `aria-current` on the selected one. Announce contact changes and letter jumps through an aria-live region.
- The Settings control is a real radio group or segmented control with a visible label.
- Respect prefers-reduced-motion.

## 5. DONE WHEN

- With the setting on Classic, the Contacts screen is pixel-identical to today.
- With the setting on Address book, the screen renders as the oxblood book, with communications and linked students inside the record.
- The setting persists per user across devices and can be changed from Settings or from the link on the screen.
- Switching layouts keeps the selected contact, category and search, and deep links work in both.
- Both layouts use the same data hooks.
- Tell me which files you added, which you changed, where the preference is stored, and whether you had to extract any shared logic from the flat screen.
