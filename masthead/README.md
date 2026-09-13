# Masthead

The scenic greeting masthead: city artwork for every time of day and weather,
a measured motion layer (lights, traffic, boats, birds, rain, stars...), live
weather with a city picker, and a clock in the chosen city's time. It is on its
way to being its own program that any product loads live; the plan is in
`docs/product/MASTHEAD_SERVICE_PLAN.md`.

## Phase 1: a package inside aspire-tracker

This folder is the package. Nothing on screen changed when it was carved out
(rendered before and after, pixel-identical apart from the live weather
numbers). The app reaches it through one Vite alias, `@masthead`, so moving
it out is a one-line change.

```
masthead/
  src/            components, hooks and the city registry (see src/index.js)
  src/lib/        the scene clock, sweep, Sphere cycle, city preference, weather
  styles/         masthead.css, imported by the components that need it
  scripts/        prepare-masthead-scenes.mjs, prepare-picker-images.mjs
  test/           the guards that pin every measured number
```

What a host provides:

- `fullName` for the greeting, `items` for the events row (`{ key, dot, text,
  milestone }`), a `calendar` `{ label, onClick }`.
- `userKey`: an opaque, stable key for the viewer. The chosen city is stored
  against it (`masthead:city:<userKey>` in localStorage). A host that renders
  the pieces individually wraps them in `<MastheadIdentity userKey={...}>`.

What still lives in the host (ASPIRE) and is not the package's concern: how
events are fetched and shaped (`src/lib/mastheadEvents.js`,
`src/components/useStaffMastheadEvents.js`), the welcome-tour anchor, and the
colour tokens the CSS reads (`--pearl`, `--nightfall`, `--chart-*`...), which
Phase 2 gives the package its own copy of.

## Assets

Still served from the app's `public/` in this phase: city packs under
`public/masthead/<City>/`, picker cards under `public/masthead/picker/`,
lightning under `public/masthead/fx/`, weather layers under
`public/weather/aspire-licensed/`. Vite lists the scene files at build time
through `src/lib/sceneManifest.mjs` and injects them as
`__MASTHEAD_SCENE_FILES__`.

## Adding a city

Drop `<City>_<Scene>.png` frames (2000x400) into `public/masthead/<City>/` and
a 16:9 `<City>.png` into `public/masthead/picker/`, then:

```bash
npm run masthead:prepare
npm run picker:prepare
```

Add the city to `CITY_ALIASES`, `CITY_COORDS` and (if it needs one) `CITY_SKY_X`
in `src/lib/mastheadCityScenes.js`, its display name and picker file in
`src/lib/mastheadCityPreference.js`, and its measured motion to `CITY_MOTION`.
Every coordinate is measured off the artwork, never placed by eye; the guards
in `test/` say what a measurement has to satisfy.

## Tests

```bash
npm test
```

runs the app's tests and this package's together.
