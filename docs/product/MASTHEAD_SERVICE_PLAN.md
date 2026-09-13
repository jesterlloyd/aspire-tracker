> **Renamed 2026-09-13: the service is Skyline.** Repository `jesterlloyd/skyline`, address https://skyline-card.vercel.app (the old masthead-seven address still answers), element `<skyline-card>`, script `/v1/skyline.js`, events `skyline-ready` and `skyline-calendar`, ASPIRE wrapper `src/components/SkylineCard.jsx` and `src/lib/skylineService.js`. The document below keeps its original wording.

# Masthead Service Plan

Status: investigation and plan, not built. Written 2026-09-12 from a read of the
current code. The decisions the Owner has made are listed at the end;
one item is still open.

## The decision this plan serves

The masthead becomes its own program, hosted once, loaded by every product that
wants it: ASPIRE Intelligence (Cedars-Sinai), the Corinthian School of Health
Sciences staff and student login and LMS, the Golden Oar Business Suite, and
whatever comes next. When a city pack, an effect or a fix lands in the masthead,
every host shows it on its next page load. No host rebuilds.

Hosts choose one of two modes:

- `full`: the whole card. The host supplies the greeting name and its own
  events; the service renders everything.
- `scene`: the scenic layer only (artwork, motion, weather, clock). The host
  draws its own text over it.

## What the masthead is today

Everything below lives in `aspire-tracker` and is entangled with the app in the
ways marked.

### Code

| Piece | File | Size | Entangled with |
|---|---|---|---|
| Card shell (greeting, layout, modes) | `src/components/masthead/GreetingMasthead.jsx` | 4 KB | `data-tour="masthead"` welcome-tour anchor |
| Staff card | `src/components/TodayMasthead.jsx` | 97 lines | Supabase session, `/api/aspire-events`, US holidays, react-router `navigate` |
| Scenery (frames, sweep, Sphere) | `src/components/MastheadScenery.jsx` | 258 lines | Vite build-time define `__MASTHEAD_SCENE_FILES__` |
| Weather, scene clock, city picker | `src/components/WeatherScene.jsx` | 450 lines | React Query; Open-Meteo fetched from the browser |
| Motion layer (every effect) | `src/components/masthead/MastheadMotion.jsx` | 40 KB | none |
| City registry (every measured point) | `src/lib/mastheadCityScenes.js` | 2,758 lines | none |
| Clock, events row, picker dialog | `src/components/masthead/*.jsx` | small | `useCityPreference` reads `AuthContext` for the user id |
| Scene clock, sweep, Sphere, prefs, keys | `src/lib/masthead*.js`, `weatherLocation.js`, `sessionKeys.js` | ~1,200 lines | `sessionKeys.js` is app-wide |

### Styles

About 4,700 lines of `src/index.css` from the `MASTHEAD-SCENE-1` marker down
(579 `.mast*` / `.wx-*` selectors and `mast-*` keyframes). They read roughly 25
tokens from `src/styles/aspireBrand.css` and the app's older palette
(`--nightfall`, `--pearl`, `--raven`, `--sand`, `--nova`, `--marina`,
`--chart-*`, `--cf-*`, `--color-*`, `--text-secondary`, `--border*`). Dark theme
is keyed on `[data-theme="dark"]`. Fonts are self-hosted Plus Jakarta Sans and
Playfair Display under `public/fonts/`.

### Assets

| What | Where | Size |
|---|---|---|
| 19 city packs, 10 to 12 WebP frames each, 2000x400 | `public/masthead/<City>/` | ~31 MB |
| Picker cards | `public/masthead/picker/` | 2.4 MB |
| Lightning | `public/masthead/fx/` | 128 KB |
| Sun, moon, cloud, rain, fog, leaf layers | `public/weather/aspire-licensed/` | 492 KB |

A page loads only the current scene's frame (~220 KB) plus the weather layers
it needs, so the 34 MB is a hosting figure, not a per-visit one.

### Inputs the masthead takes from its host today

- Greeting: the person's full name (staff from `userProfile`, portals by prop).
- Events row: `items` in the shape `src/lib/mastheadEvents.js` produces, plus a
  `calendar` `{ label, onClick }`. Staff builds them from `/api/aspire-events`
  and US holidays; portals pass their own.
- Identity: a user id, so the chosen city is stored per person
  (`aspire:mastheadCity:<userId>` in localStorage).
- Location: browser geolocation with a cached, rounded fallback and Los Angeles
  as the default; a chosen city overrides it.

### External calls

One: Open-Meteo, from the browser, no key, one request per location per hour.
Sunrise and sunset ride the same request and drive the scene clock.

## Target architecture

### Delivery: a custom element served from one URL

The service publishes a single script. A host adds:

```html
<script type="module" src="https://<masthead-host>/v1/skyline.js"></script>
<skyline-card mode="full" name="Jester" user-key="cshs:u_8f2…" theme="auto"></skyline-card>
```

The element renders into a Shadow DOM, so the masthead's 4,700 lines of CSS
never touch the host's page and the host's CSS never touches the card. It works
in any stack: ASPIRE (Vite/React), `cshs` and `golden-oar-web` (both Next.js
16 / React 19, which handles custom elements natively), or a plain HTML login
page. It is one file to cache, and updating the file updates every host.

Why not an iframe: an iframe isolates just as well and needs nothing from the
host, but in `scene` mode the host cannot draw over it, sizing needs
cross-window messages, geolocation needs a `Permissions-Policy` grant, and the
welcome tour cannot anchor to anything inside it. Keep the iframe as a
documented fallback (`https://<masthead-host>/v1/embed?mode=scene&…`) for a host
whose Content Security Policy forbids third-party scripts.

### Contract (v1)

Attributes:

| Attribute | Meaning |
|---|---|
| `mode` | `full` or `scene` |
| `name` | greeting name (`full` only) |
| `user-key` | opaque, host-namespaced key; the city choice is stored against it |
| `theme` | `light`, `dark`, `auto` |
| `city` | optional forced city key; otherwise the person's saved choice, then location |

Properties (set from script, since they are objects): `items` (events, same
shape as today), `calendar` (`{ label }`; the click comes back as an event).

Events dispatched: `skyline-ready`, `masthead-city` (city changed),
`masthead-scene` (scene changed, with the scene name), `skyline-calendar`
(the host handles navigation).

Slots (`scene` mode): the host may place its own elements over the card. The
element exposes the same three-column grid (`left`, `centre`, `right`) and the
bottom row as named slots so a host can drop its own greeting into the exact
place ASPIRE's sits.

### Versioning

`/v1/skyline.js` is a channel, not a build. Content (cities, effects, fixes)
flows through it automatically. A breaking change to the contract goes to
`/v2/`; hosts move when they choose. The manifest of installed cities lives at
`/v1/manifest.json` and replaces the Vite build-time define.

### Assets

Served by the service on its own origin under hashed, immutable paths. City
packs are fetched on demand exactly as now. Fonts are served by the service; the
loader injects one `@font-face` stylesheet into the host document, because
`@font-face` inside a shadow root does not load in every browser.

### Weather

Keep the browser calling Open-Meteo directly for now: no server, no key, no
cost, and the service is then static files only. Add a proxy later only if a
host needs it (a CSP that blocks third-party fetches, or rate limiting).
See "Still open" about Open-Meteo's terms for commercial use.

### The person's city choice

Stored in the service origin's localStorage under `masthead:city:<user-key>`.
Because the storage belongs to the masthead's origin, a person who uses two of
your products in one browser keeps one choice per `user-key`; if a host wants
the same person recognised across products, it passes the same key. A server-
side sync (one row per key) is a later phase, not v1.

### Theme and layout

The element reads `theme`; `auto` follows `prefers-color-scheme`. The card keeps
its 5:1 aspect and its narrow-width layout; the host controls only the width.

### Access control

Decided: none (see "Decisions made"). The three shapes, for the record:

- None. Anyone who finds the script can embed the masthead. Cost: nothing.
  Risk: bandwidth on your account if a stranger hot-links it; no data exposure,
  since the masthead holds no user data beyond a city choice.
- Origin allow-list in the loader. Cheap to add, cosmetic in practice: it stops
  casual embedding, not a determined one.
- Signed embed tokens per host. Real control, and a key to manage per product.

### Hosting

Decided: its own Vercel project, Vercel's address for now (see "Decisions made"). The shapes considered:

- A new repository and Vercel project (`masthead`),
  static output only. Deploys are independent of ASPIRE. Free tier covers 34 MB
  of static assets comfortably.
- A folder inside `aspire-tracker` served at `/masthead/v1/`. Cheapest to start,
  but every masthead change becomes an ASPIRE deploy, and Corinthian's and
  Golden Oar's pages would load code from Cedars-Sinai's app URL.
- Domain: a subdomain of `aspireintelligence.app`, or a neutral domain owned by
  you, since two of the three hosts are not Cedars products. The choice shows
  up in every host's page source.

## Repository shape (recommended)

A new repository holding:

- `src/` — the element, the React components it wraps, the registry, the libs.
- `styles/` — the masthead CSS with its own copy of the ~25 tokens it reads.
- `assets/` — city packs, picker cards, fx, weather layers, fonts.
- `scripts/` — `prepare-masthead-scenes.mjs`, `prepare-picker-images.mjs`.
- `test/` — `mastheadMotion`, `mastheadCityScenes`, `mastheadLockscreen`,
  `mastheadNightMode`, `mastheadWeatherLocation`, and the others that pin the
  card today, moved as they are.
- `reference/` — source PNGs, the way `reference/masthead-scenes-source/` works
  now (untracked or LFS; the archive is already 232 MB).
- The measurement recipes (grid crops, overlays, the lock harness) that every
  city pack has needed, so adding a city stays the same job.

ASPIRE then loads the element like any other host and deletes its private copy.

## Migration, in phases

### Phase 1: carve out, no behaviour change

Move the files above into a package with its own build (Vite library mode
producing the custom element). ASPIRE keeps importing the React components
directly from the package, so nothing on screen changes. The tests move with
the code. `injectedSceneFiles()` becomes a generated manifest. The `AuthContext`
read in `useCityPreference` becomes a `userKey` prop. `TodayMasthead` is guard-
pinned by `chartToday` and `mastheadGreeting` tests; those tests move or are
re-pointed at the wrapper. Verify with the existing suite plus a pixel
comparison of the staff card and each portal card before and after.

### Phase 2: the service, and ASPIRE as its first host

**Done, 2026-09-13.** The service is the `masthead` repository beside this
one (github.com/jesterlloyd/masthead, private), deployed by Vercel on every
push to `https://masthead-seven.vercel.app`. `/v1/skyline.js` (134 KB
gzipped) defines `<skyline-card>`; `/v1/manifest.json` lists the frames.
Ten renders of the served element against the in-app card, with the weather
stubbed and every animation frozen, were pixel-identical before the switch.

ASPIRE is the first host: `src/components/SkylineCard.jsx` loads the script
once (`src/lib/skylineService.js`, `VITE_SKYLINE_URL` to override), renders
the element, keeps the app's theme and the host's `items`/`calendar` in step
with it, and carries the welcome tour's anchor in light DOM. The staff card
and the four portals render it; the app's own copy of the package, the
34 MB of artwork and the prepare scripts are gone from this repository, and
`npm test` is back to one folder. What stayed: `src/lib/greeting.js` (the
greeting line, also used by the rotation calendars), `src/lib/mastheadEvents.js`
and `src/components/useStaffMastheadEvents.js` (how ASPIRE shapes its events),
and the `.mast-live-*` rules, which style On Campus Now, not the card.

Two things found on the way and fixed in the element: a shadow tree gets none
of the host's resets, tokens, typography or fonts (the package carries all
four); and a host that assigns `items` before the script arrives shadows the
setter unless the element adopts the value on upgrade.

**Settings app (2026-09-13).** The Owner then asked for permission control,
a log, and a safer update. The service is gated: `/v1/skyline.js?host=KEY`
is served only to a registered, enabled host from one of its registered page
origins, checked on the server; every admitted load is logged per host. A
push builds to `/next/`; hosts receive only what the Owner publishes from the
settings app at `/admin/` (one owner password, separate from ASPIRE). Cities
have on/off switches there. ASPIRE is registered as `aspire-intelligence`.
Storage is one private Vercel Blob store on the existing plan. Installable
city packages are deferred; nothing depends on them.

**A city or effect is now added in the masthead repository** (its README
says how) and reaches ASPIRE, and every later host, on the next page load.


Deploy the element. Switch the staff card and the four portals to
`<skyline-card>`. The welcome tour anchors to the host's wrapper element
instead of the card's own `data-tour`. Verify parity again (the lock harness
recipe in memory does this in minutes). ASPIRE deletes the in-repo copy.

### Phase 3: Corinthian

`cshs` login page and LMS home, `scene` or `full` as they prefer. Next.js 16:
the element mounts in a client component; nothing else changes.

### Phase 4: Golden Oar, and the rest

Same as Phase 3. Then, only if wanted: server-side city sync, usage counts per
host, an admin page listing cities and hosts.

## Effort

| Phase | Work | Estimate |
|---|---|---|
| 1 | package, build, manifest, prop for identity, tests moved, parity check | 2 to 3 sessions |
| 2 | element contract, Shadow DOM CSS, fonts, deploy, ASPIRE switch, tour anchor, parity | 2 to 3 sessions |
| 3 | one host | under 1 session |
| 4 | per host, under 1 session; sync and admin, 1 to 2 sessions |

## Risks and how each is handled

- Shadow DOM and fonts: `@font-face` must live in the host document. The loader
  injects it. Verified need, not a guess.
- Host CSP: a host that forbids third-party scripts uses the iframe fallback.
- Geolocation: inside a custom element it is the host page asking, which is
  what happens today. In the iframe fallback the host must grant
  `allow="geolocation"`.
- Performance: unchanged per visit (one frame plus layers). The service should
  send long cache headers on hashed assets.
- Open-Meteo terms: see "Still open".
- Two masthead copies during Phase 1 and 2: avoided by making ASPIRE consume the
  package from Phase 1.
- Tests that pin ASPIRE-specific JSX: re-pointed, not deleted.
- Storage keys: `aspire:mastheadCity:<userId>` becomes `masthead:city:<user-key>`;
  ASPIRE's loader migrates the old key once, the way `readCityPreference`
  already migrates the pre-namespacing key.

## Decisions made (2026-09-12)

1. Hosting: its own Vercel project on the existing account, named `masthead`,
   static files only, separate from ASPIRE's deploys. Address: Vercel's own
   (`masthead….vercel.app`) for now; a domain of the Owner's can be put in
   front later without touching any host.
2. Access control: none. The masthead holds no data beyond a city choice; the
   only exposure is bandwidth. Can be added later if ever wanted.
3. Name: **Masthead**. Repository `masthead`, script `/v1/skyline.js`, element
   `<skyline-card>` (a custom element must contain a hyphen), picker title
   stays "Masthead Scenery". Nothing carries the ASPIRE name into other products.
4. Source PNG archive: moves into the Masthead folder, outside git. The WebPs
   are what ships; the PNGs are kept because they are sharper for measuring.
5. Events by URL for script-less hosts: dropped. Every planned host runs
   JavaScript.

## Still open

- Open-Meteo's free tier is for non-commercial use. Revisit when Golden Oar
  is built (Owner, 2026-09-12: Corinthian and Golden Oar are not built yet, so
  nothing about them blocks this work). Does not affect Phases 1 and 2.

## How to resume this

This document is the source of truth. A pointer lives in Claude Code memory
(`masthead-service-plan.md`, indexed in `MEMORY.md`) so a future session finds
it. Phase 1 can start now.
