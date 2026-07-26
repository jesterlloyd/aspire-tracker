# Nightfall taskbar parity + evening weather masthead: diagnosis and convergence notes

Branch: `taskbar-weather-diagnosis-refinement` (baseline `6d1b322`).

This pass was diagnosis-first. The evidence below came from the **built production
bundle** (`dist/assets/*.css`), not from source assumptions, because the earlier
convergence work had already touched the source and the QC report said the mismatch
persisted in production.

## 1. Taskbar parity diagnosis

### What was already correct
The portal dark bar's *fill* was already identical to the main app. In the built
bundle, both compile to the same declarations:

- `.app-header { background: var(--nightfall-gradient) }`
- `.ptl-header-nightfall { ... background: var(--nightfall-gradient) ... }`
- dark theme: both `background: var(--color-header-bg, #0A0E14)`
- border: none on both; height: 64px on both (main app via `.header-inner`
  `height: 64px`; portal via `min-height: 64px` + 9px/9px padding around a 46px logo).

So the earlier assumption, that the portal header was still painting a different or
darker gradient, was **wrong**. That part was genuinely fixed. The gradient token is
defined once (`index.css` `--nightfall-gradient`) and is not overridden anywhere.

### The actual root cause
The one remaining chrome difference is **where the Nightfall shadow is attached**,
which is a container/structure difference, not a fill difference:

- **Main app:** the shadow lives on the `.top-section` *wrapper*, which contains the
  dark `.app-header` **and** the light `.chart-nav` tab bar. So on a normal tabbed
  page the shadow sits one tier below the dark bar (beneath the light tab bar), and
  the dark gradient bar itself is flush and shadowless where it meets the tab bar.
- **Portal:** the shadow was on `.ptl-header-nightfall` itself, so the dark bar cast a
  navy drop shadow directly onto the content below, and (on desktop) the tab nav
  `.ptl-nav` beneath it is a transparent, non-sticky row rather than a solid attached
  tab bar. The portal dark bar therefore read as a heavier, floating bar even though
  its fill was identical.

Classification: **container/structure difference (shadow attachment) plus a
surrounding-context difference (transparent portal nav vs the main app's solid
attached tab bar)**. Not a gradient/solid/theme difference.

Selectors/files responsible: `src/index.css` (`.top-section`, `.app-header`),
`src/portal/portal.css` (`.ptl-header-nightfall`, `.ptl-nav`),
`src/styles/chartTokens.css` (`.chart-nav`).

## 2. Taskbar fix
Made `.ptl-header-nightfall` reuse `.app-header`'s exact final behavior: gradient as
the whole background and **nothing else**, dropping its own `box-shadow`. The dark bar
now renders identically to the main app's (gradient only, crisp bottom edge, no
floating shadow). Background, dark-theme solid, border, and height were already
identical. Both Student and Unit Leader portals benefit through the shared class.
The main app is unchanged.

Not done (deliberately, to stay minimal and avoid rewriting the portal chrome
architecture): giving the portal a `.top-section`-style sticky wrapper that unifies
the header with a solid light tab bar. The remaining difference is that the main app
has a subtle chrome shadow beneath its tab bar, which the portal (different chrome
structure) does not replicate. The dark bars themselves now match.

## 3. Weather masthead refinement (shared: main app + both portals)

- **Size:** the scene was still small after the previous 110 to 146px bump, so it is
  enlarged to **178px** (`.wx-mast-art` / `.wx-mast .wx-svg`) and lifted 10px into the
  card headroom (inside the 18px top padding, so it never clips the border). Reused
  artwork only, same shared Open-Meteo query and the same SVG / licensed-asset
  renderers, no new assets. Narrow screens step to 132px.
- **Evening readability:** the evening wash used a warm peach radial
  (`rgba(255,180,130)`) that read too reddish and washed out the white stars/moon of
  the night weather scene. Replaced with a cooler, slightly deeper dusk indigo glow
  (`rgba(84,96,168,0.40)` + `rgba(52,64,128,0.34)`) placed upper-right behind the
  weather art, keeping the upper-left greeting light. The dark-theme evening wash was
  cooled to match.

### Honest limit on star visibility
The stars in the weather scene are white dots. On the light masthead card, only a
strongly dark backing would make them high-contrast, and that would over-darken the
shared light-mode card and clash with the dark greeting text. The evening wash was
made cooler and a bit deeper (a moderate, tasteful shift, per "slightly darker"), so
star/moon contrast improves but does not become dramatic. A fully dark sky panel
scoped to night-only weather scenes would need a component change (a `night` class on
the weather art), which was kept out of scope here.
