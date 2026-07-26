# Portal Chrome, Width, and Spacing Convergence

Status: **Complete on branch `portal-width-spacing-nightfall-refinement` (from `main` tip
`b9db1df`, which is the approved `6f66c95` plus a comment-only fix). Not merged, pushed, or
deployed. No SQL run, no migration added.** A convergence pass, not a redesign: no new colors,
gradients, spacing systems, wrappers, or portal-only variants were invented. The main app is the
canonical reference and is visually unchanged.

## Commits

1. `Unify portal Nightfall chrome` (`02b047a`)
2. `Align Unit Leader Home width and spacing` (`c3b9b46`)
3. `Document portal chrome convergence` (this commit)

## Canonical main-app Nightfall source

The main-app top taskbar lives in `src/App.jsx` (`.top-section` > `.app-header` > `.header-inner`,
with `UnifiedNav` inside the same sticky `.top-section`), styled in `src/index.css`:

- **Gradient:** `.app-header { background: linear-gradient(180deg, #1c2452 0%, #141928 100%) }`
- **Shadow:** `.top-section { box-shadow: 0 2px 8px rgba(29,37,103,0.25) }` (dark theme:
  `0 2px 8px rgba(0,0,0,0.40)`)
- **Border:** none (shadow only)
- **Height / inset:** `.header-inner { height: 64px; padding: 0 32px; max-width: 1600px }`
- **Content shell:** `.main-content-shell / .app-main { width: min(100% - 140px, 1580px);
  margin: 0 auto; padding: 20px 0 0 }`

## Shared tokens now used

Two tokens were added to `:root` in `src/index.css`, defined once with the main app's existing
values so its output is unchanged, plus a dark-theme shadow override:

```
--nightfall-gradient: linear-gradient(180deg, #1c2452 0%, #141928 100%);
--nightfall-shadow:   0 2px 8px rgba(29,37,103,0.25);   /* [data-theme="dark"]: 0 2px 8px rgba(0,0,0,0.40) */
```

- **Main app:** `.app-header { background: var(--nightfall-gradient) }`,
  `.top-section { box-shadow: var(--nightfall-shadow) }`. The previously-separate
  `[data-theme="dark"] .top-section` shadow rule was folded into the dark token (identical
  computed output).
- **Both portals:** `.ptl-header-nightfall { background-image: var(--nightfall-gradient);
  box-shadow: var(--nightfall-shadow) }`. This replaced a portal-only shadow
  (`0 1px 0 rgba(255,255,255,0.08), 0 2px 10px rgba(14,20,40,0.18)`) with the canonical one, so
  the portal taskbar and the main app can no longer drift.

## Portal adoption

Both active portals already opt into the shared Nightfall taskbar via `PortalShell`
(`headerVariant="nightfall"`, `logoSrc="/cs-logo-large.png"`, `withTabBar`):

- **Student Portal** (`PortalApp.jsx`, `title="Student Portal"`).
- **Unit Leader Portal** (`PortalApp.jsx`, `title="Unit Leader Portal"`, `showHeaderName`).

They now share the exact same gradient, shadow, border (none), height (`min-height: 64px`), logo
treatment (46px, `object-fit: contain`), divider, `ASPIRE` title (20px), profile control, and
avatar treatment via the single `.ptl-header-nightfall` block plus the shared tokens. Only the
visual chrome converges; each portal keeps its own controls, title/subtitle, and navigation
destinations.

### Academic Partner future adoption
The Academic Partner Portal (`title="Academic Partner Portal"`) was **not** started. It still
uses the default light placeholder header. When that portal is built, it should pass
`headerVariant="nightfall"` + `logoSrc="/cs-logo-large.png"` to `PortalShell` to inherit the same
shared chrome and tokens automatically. No new colors or variants should be introduced.

## Unit Leader Home page-shell width rule

The greeting masthead and On Campus Now card reuse the main-app `.mast` / `.mast-live` classes,
which carry a `14px 20px 0` margin sized for the staff aggregate page. Inside the Unit Leader
Home grid (`.ptl-unit-page`, a single-column `display: grid; gap: 16px`), that side margin inset
them relative to the calendar and roster. The fix scopes a reset to the Home grid only:

```
.ptl-unit-page .mast,
.ptl-unit-page .mast-live { margin: 0; }
```

Now the masthead, On Campus Now, calendar, and roster share the same left/right content edges
(the `.ptl-main` width: `94vw`, max `1500px` at desktop, full width with 24px side padding
below), and the grid gap owns the vertical rhythm. The staff aggregate usage of `.mast` /
`.mast-live` is untouched (the reset is scoped under `.ptl-unit-page`).

## Navigation spacing rule

The gap between the Nightfall taskbar and the nav tabs is the top padding of the shared
`.ptl-main`. It was reduced to sit compactly under the taskbar, like the main app where the tabs
are part of the sticky header region:

- Base/mobile: `padding-top` 28px -> 16px.
- Desktop (`min-width: 1024px`): `padding-top` 24px -> 14px.

This is a shared-shell change, so both the Student and Unit Leader portals get the same tighter,
main-app-consistent spacing (per the shared-foundation rule; it is chrome, not portal content).
The nav tabs keep their 44px touch target, focus outlines, and sticky/scroll behavior.

## Redundant unit-label removal

The Unit Leader Home previously showed the unit twice: the UnitSwitcher's `Unit · <unit>` line
above the masthead (`.ptl-unit-context` in `UnitLeaderChrome.jsx`) and a `Unit Leader · <units>`
line below it. The lower line (and its now-unused `unitContext` computation and `unitKeys`
parameter in `HomeScreen`) was removed. The upper `Unit · <unit>` context remains. No empty
spacer is left: the removed line's `12px` top margin went with it, and the grid gap governs the
spacing between the masthead and On Campus Now.

## Responsive considerations

- The taskbar keeps its mobile logo size (`34px`, `max-width: 112px`) and safe-area padding.
- The `.ptl-main` width stays `94vw`/`max 1500px` at desktop and full width with 24px side
  padding below 1024px; the masthead/On Campus Now reset does not change those breakpoints, it
  only removes the extra side inset so they match the calendar at every width.
- No horizontal overflow is introduced (the reset removes width, never adds it).

## Performance and regression

- **No new API request**, no new weather request, no layout-measurement JavaScript, no render
  loop. Changes are CSS variables/values and the removal of one static JSX line.
- **No bundle growth of note** (a few CSS declarations; one removed React element).
- **No change to authorization or data contracts.**

## Live QC checklist

### Nightfall chrome
- Main app taskbar visually unchanged (gradient, shadow, height, logo, profile controls).
- Unit Leader and Student portal taskbars match the main app's gradient, shadow, border, and
  height.
- Logo and profile controls remain aligned; no portal controls disappear.

### Unit Leader width
- Greeting masthead aligns exactly with the calendar's left/right edges.
- On Campus Now aligns exactly with the calendar's edges.
- No excessive side gutters; no horizontal overflow; responsive widths correct.

### Unit labels and spacing
- `Unit · <unit>` remains above the masthead.
- The lower `Unit Leader · <units>` line is gone, with no blank spacer.
- Nav tabs sit closer to the Nightfall bar; masthead, On Campus Now, and calendar form one
  compact vertical flow.

### Regression
- Greeting content, weather graphics, On Campus Now cards, student modal, logged shifts, and
  calendar ordinal chips unchanged.
- Unit Leader Evaluations, Messages, and Feedback unchanged.
- Student Portal routes and content unchanged (it gains only the shared taskbar shadow and the
  tighter shared top spacing).
- Academic Partner Portal not started.

## Verification (run on this branch)

- Focused suites (chrome convergence, Home width/spacing) pass.
- Full suite `node --test 'test/*.test.mjs'`: all pass.
- Changed-file ESLint: no new errors or warnings.
- Production build clean (prerender needs the dev env:
  `set -a && . ./.env.development.local && set +a && npm run build`).
- `git diff --check` clean; no em dashes.

## Rollback

All changes are CSS values/tokens plus one removed JSX line; each is independently reversible:
- Restore the portal `.ptl-header-nightfall` literal gradient/shadow to un-converge the taskbar.
- Restore the `.ptl-main` padding-top values to widen the taskbar-to-tabs gap.
- Remove the `.ptl-unit-page .mast` reset to restore the masthead/On Campus Now side inset.
- Re-add the `Unit Leader · <units>` line in `HomeScreen`.
