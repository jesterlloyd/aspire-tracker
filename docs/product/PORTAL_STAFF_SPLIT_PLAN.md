# Portal / staff app split

PORTAL-SPLIT (plan, 2026-09-15). Owner decision: full roadmap, phased, judged in
bytes. Nothing in this plan has been built; each phase is its own approval.

**The problem.** ASPIRE Intelligence ships as one JavaScript file. A student
opening the Student Portal on a phone downloads the entire staff app first:
ASPIRE Connect, Settings, the rich-text editor, the interview calendar, the
Residency workspace. None of it is reachable from a portal.

**Success is measured, not estimated.** `scripts/chunkReport.mjs` prints, for any
build, the first load (raw and gzipped), every chunk, and the entry chunk broken
down by npm package and `src/` folder from its sourcemap. Run it before and after
every phase:

```
npx vite build --sourcemap --outDir /tmp/aspire-build
node scripts/chunkReport.mjs /tmp/aspire-build --top=20
```

---

## Measured baseline (2026-09-15, d7c47f57)

| | raw | gzipped |
|---|---|---|
| First load (`index.html`: entry + preloads, 7 files) | 3,710 KB | **961 KB** |
| of which `index-*.js` (the one entry chunk) | 3,318 KB | 881 KB |
| `PortalApp-*.js`, fetched when a portal opens | 236 KB | 63 KB |
| **A portal user, total** | ~3,950 KB | **~1,024 KB** |

What is inside the entry chunk (share of 7,736 KB of mapped source):

| share | owner | reachable from a portal? |
|---|---|---|
| 9.5% | `src/components/connect` | no |
| 6.9% | `npm:react-dom` | yes |
| 6.2% | `src/components/settings` | no |
| 5.0% | `npm:@fullcalendar/core` | no |
| 4.7% | `npm:react-router` | yes |
| 3.6% | `src/components/ngrp` | Residency Portal only |
| ~9% | `prosemirror-*` + `@tiptap/*` (Connect's editor) | no |
| 2.6% | `src/components/evaluation` | no |
| 2.1% | `src/components/StudentSidePanel.jsx` | no |

Stylesheets: `src/main.jsx` imports `./index.css` (31 KB gz built) for **every**
visitor, including portal users, who then also download `portal.css` (17 KB gz).
The portal needs only `aspireBrand.css` (1.8 KB) + `aspireTable.css` (1.7 KB) +
`portal.css`; the rest of `index.css` is staff chrome.

## Measured floor (throwaway spike, discarded)

A portal-only entry (router, providers, auth, `PortalApp`, login) was built to
measure what Phase 1 reaches, rather than estimating it:

| | gzipped |
|---|---|
| Entry (react-dom 32%, supabase-js 27%, react-router 22%, react-query) | 95 KB |
| `jsx-runtime` | 3 KB |
| `PortalApp` chunk (absorbs what the shared entry holds today) | 191 KB |
| **A portal user, total JavaScript** | **~290 KB** |

**~1,024 KB to ~290 KB: a 72% cut from Phase 1 alone.** The Owner's target
(under 250 KB) needs Phase 3 as well, because that 191 KB portal chunk still
carries all five portals at once:

| share | owner | belongs to |
|---|---|---|
| 16.7% | `src/components/ngrp` | Residency Portal |
| 6.5% | `src/lib/ngrp` | Residency Portal |
| 6.2% | `src/portal/na` | Nursing Education & Leadership |
| 4.8% | `src/components/connect` | Messages (three portals) |
| 3.8% + 3.2% | `UnitLeaderPortal.jsx`, `src/portal/unit` | Unit Leader |
| 3.7% | `StudentIntakeFormPage.jsx` | Student (via `MyProfile`, legitimate) |
| 2.8% | `src/portal/ap` | Academic Partner |

---

## Phase 1: the staff app becomes its own chunk

**Boundary.** `App.jsx` keeps the router, the public routes, the token-form
routes, `/login`, `/portal`, and the auth pages. `MainApp` (App.jsx:159-1690),
`AuthedShell`, and every import only they use move to `src/staff/StaffApp.jsx`,
loaded with `lazyReload(() => import('./staff/StaffApp'), 'StaffApp')`.

**The stylesheet does NOT move in Phase 1.** The plan first said it would; the
split proved otherwise. `ResetPasswordPage`, `ActivateAccountPage`,
`EvaluationPage`, `UnitFormPage`, `SchoolFormPage`, `StudentIntakeFormPage`,
`InterviewSchedulePage`, `NgrpTransitionFormPage` and `ShiftLogLifecycle` import
no stylesheet of their own: hundreds of class names (`uf-card`, `sf-card`,
`ngrpf-card`, `eval-branded-band`, `error-msg`) are styled by the global
`index.css` that `main.jsx` loads. Moving it would strip every token form.
Extracting those rules into a sheet the token pages import is its own step,
sized in Phase 2b below.

**BUILT AND MEASURED 2026-09-15.** Actual, from `scripts/chunkReport.mjs`:

| | before | after |
|---|---|---|
| First load (every visitor) | 961 KB gz | **216 KB gz** |
| of which the entry chunk | 881 KB gz | 162 KB gz |
| `StaffApp` chunk (staff only, on demand) | n/a | 600 KB gz |
| `PortalApp` chunk (portal only) | 63 KB gz | 63 KB gz |
| **A portal / public / sign-in visitor** | ~1,024 KB gz | **~279 KB gz** |

A 745 KB cut to the first load, 73% less. The entry chunk now holds react-dom,
react-router and the token forms; Connect, tiptap, Settings, FullCalendar and the
Residency workspace are all gone from it, which is the gate this phase had to
pass. `CustomOnboardingTour` fell out as its own 107 KB chunk, loaded by whichever
shell starts a tour.

**Files:** `src/App.jsx` (split), new `src/staff/StaffApp.jsx`, `src/main.jsx`
(stylesheet import), `src/lib/staffAppLoader.js` (one importer, mirroring
`portalAppLoader.js`).

**Tests that must move with it:** 58 test files read `src/App.jsx`; six pin the
route table, `AuthedShell` or `MainApp` (`messagesPhase4b2iiConnectActivation`,
`messagesPhase5biiPortalActivation`, `ngrpPlanningTransition`,
`publicEndpointHardening`, `residencyReflection`, `studentShiftLogTab`).
`chunkReload.test.mjs` pins `main.jsx` and forbids plain `lazy(`.

**The known trap.** `src/App.jsx:68` records that a lazy NGRP chunk once hoisted
the shared dependency graph INTO the entry (585 KB to 3 MB). The gate for this
phase is the report above: if `src/components/connect` or `@tiptap/*` still
appears in the entry chunk after the split, the boundary is wrong and the phase
does not ship.

**Rollback:** revert the commit. No data, no schema, no API change.

## Phase 2: split the heavy staff areas

Each heavy area loads when its own route opens, instead of riding along with
every staff sign-in.

**BUILT AND MEASURED 2026-09-15.** Actual, from `scripts/chunkReport.mjs`:

| a staff member signing in | before (Phase 1) | after |
|---|---|---|
| Shared first load (entry + preloads) | 215.9 KB gz | 217.1 KB gz |
| `StaffApp` chunk | 599.9 KB gz | **118.9 KB gz** |
| `CustomOnboardingTour`, a static import of both shells | 107.3 KB gz | not loaded |
| **Total to reach At a Glance** | **923.1 KB gz** | **336.0 KB gz** |

Under the 400 KB target, and 64% less than Phase 1 left it. What each area now
costs, only when it is opened:

| chunk | gzipped | fetched when |
|---|---|---|
| `Connect` (tiptap + prosemirror + linkifyjs) | 225.6 KB | `/connect/*` opens |
| `InterviewRubricTab` (FullCalendar) | 111.1 KB | Interviews is first visited |
| `SettingsShell` | 71.4 KB | `/settings/*` opens |
| `ngrpWorkspaceBundle` | 47.6 KB | `/ngrp/*` opens |
| `EvaluationTab` | 40.7 KB | Evaluation is first visited |
| `ActionCenter` | 14.0 KB | the bell opens the panel |
| `CatalogPage` | 10.1 KB | `/catalog` opens |
| `MessagesWorkspace` | 9.7 KB | the Messages dock first opens |

**A portal visitor gained 102 KB without Phase 3.** The Residency workspace was
reachable from both eager shells, so the bundler merged 273 KB of
`src/components/ngrp` into the chunk it named after another shared module:
`CustomOnboardingTour`, a static import of `PortalApp`, which every portal
visitor downloaded (407 KB raw / 107.3 KB gz). A student on a phone paid for a
residency workspace they can never open. Both sides now reach it through
`src/lib/ngrpWorkspaceLoader.js`, so it is one shared chunk fetched on demand;
the tour chunk is 7.6 KB raw. Portal visitor: 403.7 KB gz to 301.2 KB gz.

**Two tabs changed when they mount.** The five ASPIRE tabs used to mount
together at boot. Interviews and Evaluation now mount on first visit and stay
mounted, so switching between visited tabs is as instant as before; only the
first open waits, behind the same `.state-box` spinner the app already uses for
loading rows. Overview, Student Profiles and Rotation are untouched.

**Files:** `src/staff/StaffApp.jsx`, `src/portal/residency/ResidencyPortal.jsx`,
`src/components/MainMessagesLauncher.jsx`, new
`src/components/ngrp/ngrpWorkspaceBundle.js` and `src/lib/ngrpWorkspaceLoader.js`.

**The inverted test.** `ngrpWorkspace.test.mjs` used to REQUIRE a static import
of `NgrpWorkspace`, because a bare `lazy(() => import('../components/ngrp/…'))`
in the old `App.jsx` once hoisted the shared graph into the entry (585 KB to
~3 MB). That guard now pins the loader instead: one bundle module behind one
dynamic specifier. The entry chunk is unchanged at 162 KB gz either way, which
is the evidence that the old failure did not recur.

**Gate:** `scripts/chunkReport.mjs`. `src/components/connect`, `@tiptap/*`,
`prosemirror-*`, `@fullcalendar/*`, `src/components/settings`,
`src/components/evaluation`, `src/components/ngrp` and `src/components/catalog`
must all be ABSENT from both the entry chunk and the `StaffApp` chunk. Measured
after: the staff chunk holds 1,012 KB of mapped source against 5,090 KB before,
and the only `connect` left in it is 6.8 KB, which is
`SchedulingLinkReturnConfirm`, mounted on every staff screen by design.

## Phase 3: one chunk per portal

`PortalApp` becomes a router that lazily loads `StudentPortal`,
`UnitLeaderPortal`, `AcademicPartnerPortal`, `NursingAcademicsPortal` and
`ResidencyPortal`, each with its own tree (`src/portal/na`, `src/portal/unit`,
`src/portal/ap`, `src/components/ngrp`). Messages is shared by three portals, so
it becomes its own chunk rather than being duplicated.

**Target (the Owner's):** a portal user under 250 KB gz total; a student, who
needs none of NGRP, `na`, `unit` or `ap`, closer to 150 KB.

---

## Sequencing and safety

1. Each phase is one commit on its own branch, with before/after report output in
   the commit message.
2. `lazyReload` (CHUNK-RELOAD-1) already covers every new chunk: a stale chunk
   after a deploy reloads the page once, and `AppErrorBoundary` catches the rest.
   No new failure mode is introduced by splitting.
3. `vercel.json` rewrites and the public-site prerender are untouched: `app.html`
   stays the shell for every non-file route, and `/assets/` 404s honestly.
4. Verify each phase live with `scripts/chunkReport.mjs` against a production
   build, then in the browser: portal loads, staff loads, a deploy mid-session
   still recovers.
