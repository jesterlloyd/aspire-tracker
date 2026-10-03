# Build prompt: Profile menu, portal previews and Profile page

**For:** a fresh Claude Code or Codex session. Paste this whole file as the first message.
**Attach with this prompt:** `topbar-profile-mockup.html`. Commit it as `docs/mockups/topbar-profile.html`. It is the visual source of truth.
**Related:** `appearance-style-build-prompt.md` (unchanged by this prompt), `at-a-glance-home-build-prompt.md` and `action-center-build-prompt.md`.

---

## Context

The profile menu mixes identity, photo controls, a public site link, five portals, Settings and Sign out in one list. Settings > General has an Email Signature page that asks for your name, credentials, title, department, email and phone, which are profile details. "Accounts & Access" in Administration reads like a personal account page, but it manages other users.

Four decisions are settled:

1. **Portals stay out of Settings.** A portal opens a preview of what a student, unit leader, partner or resident sees. That is a view, not configuration. Admins open previews several times a week, so they stay within two clicks, in the profile menu.
2. **Settings stays in the profile menu.** It does not get its own top-bar icon. Admins open Settings far less often than Connect, Catalog or the Action Center.
3. **Email Signature merges into a new Profile page.** The signature is built from the profile fields, so each field is entered once. The signature is the last section of Profile.
4. **"Accounts & Access" is renamed "Users & Access".** The personal page is called "Profile" everywhere, so the two names no longer collide.

**Appearance does not change.** Settings > General > Appearance keeps Style (Classic or Modern) and Color mode (Light, Dark or System), and the top-bar light/dark toggle stays where it is.

Only owners and admins see this top bar. Unit leaders, partners and students use their own portals with their own headers. Do not change those headers.

Before you write code, read the repo. Find:

- the top bar component
- the profile menu component, the photo upload and remove handlers, and the portal links
- how each portal currently opens a preview
- the Settings shell, the General list and the routing for drill-in pages
- the Email Signature page, its fields, its storage and every place Connect reads the signature
- every place the UI says "Accounts & Access"

Follow the repo's existing patterns and component library. Do not add dependencies.

## 1. Top bar

No layout change: Scope, Search, Connect, Catalog, Action Center, light/dark toggle, Profile.

- Search is hidden on At a Glance only, where the launcher replaces it (per the At a Glance prompt).
- Each icon button shows a tooltip on hover and keyboard focus: "Connect", "Catalog", "Action Center", "Light or dark".
- **Responsive:** below 1100px, hide "ASPIRE Intelligence" next to the brand mark. Below 860px, hide Scope and Search (both stay reachable from the screen itself). Below 560px, show only the avatar on the profile button. Never hide Connect, Catalog, the Action Center, the light/dark toggle or the profile button.

## 2. Profile menu

A popover anchored to the profile button: 320px wide, a 14px radius, an opaque `--surface` background and the standard shadow. Below 560px it spans the screen width with an 8px margin.

**Sections, top to bottom, separated by 1px `--line` rules:**

1. **Identity, and the link to Profile:** one full-width button with a 44px avatar, the full name in bold, the work email, a role pill ("Owner") and a chevron on the right. It opens `/settings/general/profile`. Hover and focus give it the `--navy-soft` background, and the chevron turns navy. Its accessible name is "Profile, [full name], [role]". There is no separate Profile item. **Remove "Change Photo" and "Remove photo" from the menu.** They move to the Profile page (section 4).
2. **Settings,** with a `⌘,` hint (Ctrl+, on Windows). It opens `/settings/general`.
3. **Preview as:** a mono uppercase label, then the five portals with their current icons: Student Portal, Unit Leader Portal, Academic Partner Portal, Nursing Education & Leadership Portal and Residency Portal. Filter the list by the user's permissions. Hide the section if the user can preview none.
4. **Leave:**
   - Public site, with an external-link icon. It opens in a new tab, and its accessible name includes "(opens in a new tab)".
   - Sign out, in muted text.

**Behavior**
- The profile button has `aria-haspopup="true"`, `aria-expanded` and `aria-controls`.
- Opening the menu by keyboard moves focus to the identity row. Up and Down arrows move between items, and Home and End jump to the first and last item.
- Escape, a click outside or choosing an item closes the menu. Escape returns focus to the profile button.
- `⌘,` or Ctrl+, opens Settings from anywhere in the app, with the menu open or closed.

## 3. Portal previews

- Choosing a portal opens a read-only preview **inside the admin app, in the same tab**.
- A full-width amber banner sits above the top bar for the whole preview: an eye icon, "Previewing the [Portal] as", a person picker, "Read-only. Nothing you click sends or saves." and an **Exit preview** button.
  - **Person picker:** sample people the admin is allowed to see, for example "Maya Okafor · Cal State LA", plus "A sample [role] with no data" where it applies. Changing the person reloads the preview for that person.
  - The default person is the first one in the current scope.
  - Exit preview returns to the screen the admin left and restores focus to the profile button.
- **Read-only, enforced on the server.** In preview, the server rejects every write: sends, submissions, signatures, uploads, check-in replies and status changes. Buttons for those actions still render, but are disabled, with the tooltip "Preview only". Do not rely on the UI alone.
- Do not log preview page views as the previewed person's activity, and do not mark anything read on their behalf.
- Write an audit entry when a preview starts and ends: admin, portal, previewed person and time.
- If the repo already opens previews in a new tab or a different way, keep the URLs working and redirect them to this flow.
- **Demo Mode stays under Settings > Diagnostics.** It is a separate feature. Do not merge the two.

## 4. Settings

**Sidebar**
- Rename "Accounts & Access" to **"Users & Access"**. Update the sidebar, the page heading, breadcrumbs, tours, help text and any link that uses the old name. Keep the old route working as a redirect.
- Do not add a Portals category. Everything else in the sidebar stays as it is.

**General list, in this order**
1. Profile: "Photo, name, title and your Connect signature"
2. Appearance: "Style and color mode" (unchanged)
3. Tours & Help: "Replay the welcome tour and find help"
4. About: "Version, build and deployment details"

Remove the Email Signature row.

**Profile page** at `/settings/general/profile`, with the breadcrumb "‹ Back to General / Profile". The sidebar keeps General highlighted. Redirect `/settings/general/signature` to `/settings/general/profile#signature`.

The page is one card with three sections:

1. **Photo:** a 64px avatar with "Change photo" and "Remove photo". Move the existing handlers here unchanged.
2. **Your details**, in a two-column grid that becomes one column below 860px:
   - Display name (required)
   - Credentials
   - Title
   - Department
   - Email: read-only, with the help text "From Cedars-Sinai sign-in"
   - Phone
   - Below the grid: "Role: Owner · Managed in Users & Access", with a link to that page.
3. **Connect signature** (anchor `#signature`):
   - The line "Used on emails you write in ASPIRE Connect. Automated program emails (reminders, notifications) do not use it."
   - The checkbox "Include my signature on emails I write in Connect".
   - Sign-off (default "Kind regards,") and the handwritten signature with Change and Remove, if the current signature page has them.
   - A live preview built from the fields above: sign-off, handwritten signature, then name and credentials in bold red, title, department, then email and phone. When the checkbox is off, the preview reads "No signature will be added."

- One **Save** button for the whole page, with "Unsaved changes" or "All changes saved" next to it. Warn before leaving the page with unsaved changes.
- **Data:** these fields are the single source for the user's name, credentials, title, department and phone. Migrate the values from the Email Signature page, and point Connect at the merged fields. If the old signature stored its own copy of a field, keep the signature's value where the profile value is empty, and report any conflicts instead of overwriting.
- Display name is shown on messages, signatures and outreach. If the repo does not let users edit it today, ask before enabling it.
- Keep "Back to [screen]" at the top of Settings.

**Layout alignment (every Settings page)**
- Build the Settings shell as one grid with two columns and three rows, so both columns line up on every page:
  1. **Row 1:** "‹ Back to [screen]" on the left. On drill-in pages, "‹ Back to [parent]" plus "/ [Page]" on the right.
  2. **Row 2:** the "Settings" heading on the left and the page title plus its description on the right. The two headings share a top edge.
  3. **Row 3:** the sidebar card on the left and the page's first white card on the right. **The two white cards share a top edge.**
- The page description belongs in row 2, not in row 3, so a longer description pushes both cards down together.
- Below 860px the grid becomes one column in this order: back link, breadcrumb, Settings heading, sidebar, page title, cards.

## 5. Accessibility and quality

- All text meets WCAG AA contrast in Classic and Modern, light and dark, including the amber preview banner.
- Focus rings are 3px navy, offset 2px, on every control in the top bar, menu and banner.
- Tooltips appear on keyboard focus as well as hover. They never replace accessible names.
- Every field on the Profile page has a visible label tied to its input.
- Respect `prefers-reduced-motion`.
- No horizontal scroll at 390px wide, with the menu open or closed, and with the preview banner showing.

## 6. Acceptance checklist

- [ ] The top bar is unchanged except that Search is hidden on At a Glance, and every icon button has a tooltip.
- [ ] The profile menu shows the identity row, Settings, Preview as, Public site and Sign out, in that order. The identity row opens Profile, and the menu has no photo controls.
- [ ] The identity row and Settings open the correct routes, and `⌘,` / Ctrl+, opens Settings from anywhere.
- [ ] The menu works fully by keyboard and closes with Escape, returning focus to the profile button.
- [ ] Each portal opens an in-app preview with the amber banner, the person picker and Exit preview.
- [ ] The server rejects every write during a preview, and preview views do not count as the previewed person's activity.
- [ ] Preview start and end are written to the audit log.
- [ ] "Users & Access" replaces "Accounts & Access" everywhere, and the old route redirects.
- [ ] The General list matches section 4, and the Email Signature row is gone.
- [ ] On every Settings page, the sidebar card and the first content card share a top edge, and the two headings share a top edge.
- [ ] Profile saves every field, the preview updates live, and Connect uses the merged fields for new emails.
- [ ] `/settings/general/signature` redirects to the signature section.
- [ ] Settings > General > Appearance still offers Style and Color mode, unchanged.
- [ ] Screenshots are captured at 1440px and 390px in Classic and Modern, light and dark, with the menu open, a preview running and the Profile page.

## 7. Deliver

- A short summary of the files changed.
- How previews worked before, and what changed to make them read-only on the server.
- The list of write endpoints you blocked in preview mode.
- How signature data was migrated, and any field conflicts you found.
- Open questions. Do not guess on data-model changes beyond the signature merge in section 4.
