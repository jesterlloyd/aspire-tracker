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

Inside the staff chunk, each of these loads when its route opens:

| candidate | entry share today | route |
|---|---|---|
| ASPIRE Connect + `@tiptap` + `prosemirror` | ~18.5% | `/connect/*` |
| Settings | 6.2% | `/settings/*` |
| Interview calendar (`@fullcalendar`) | 5%+ | `/interviews` |
| Evaluation | 2.6% | `/evaluation` |
| Residency workspace (`components/ngrp`, `lib/ngrp`) | 5.0% | `/ngrp/*` |

**Target:** staff first load under 400 KB gz. **Gate:** the same report, plus the
staff app's own first paint no slower than Phase 1.

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
