# Demo Mode

A presentation mode for ASPIRE Intelligence. With it on, every screen shows fabricated
records, so the app can be demonstrated at a conference without a real student's name
reaching a projector.

**Demo mode is not a privacy control.** It is applied in the browser and decides what
this app draws. It does not hide real rows from anyone holding the anon key, and it must
never be cited as a safeguard for the data itself. Authorization is unchanged.

---

## Turning it on, the first time

Three steps, in this order. Doing step 2 before step 1 breaks production.

### 1. Apply the foundation migration

`supabase/migrations/20260921000000_demo_mode_foundation.sql`

Additive and explicitly transactional. It adds `is_demo boolean NOT NULL DEFAULT false`
to nineteen tables, installs fourteen inheritance triggers, and creates five partial
indexes. Every existing row becomes a real row, and the app behaves exactly as before.

It asserts before it alters: several of those nineteen tables were created through the Supabase
dashboard and have no `CREATE TABLE` in this repo, so the file verifies every table and
every parent key exists and rolls back whole rather than applying in part.

Run its **V1 through V4** verification queries. V2 must show `demo_rows = 0` everywhere, and
V3 must list fourteen triggers.

### 2. Switch the boundary on

In `src/lib/demoBoundaryFlag.js`, change:

```js
export const DEMO_BOUNDARY_LIVE = false
```

to `true`, and update the matching assertion in `test/demoScope.test.mjs` in the same
commit. Then deploy.

This flag exists because the boundary filters in **both** directions: real mode asks
PostgREST for `is_demo = false`, and a filter on a column that does not exist is a 400 on
every screen that reads a scoped table. While the flag is false, the whole feature is
inert and `isDemoMode()` answers false no matter what is in browser storage, so a flag
left behind by a later build cannot put the Demo badge on screen over real data.

### 3. Seed the cast

`db/demo/demo_seed.sql`

Twenty-one students across nine stages, three schools (by name, not by catalog row), five
units, six preceptors, a
placement board, three weeks of shift history and two people on campus right now.

**This SQL has never been executed.** There is no PostgreSQL in this repo's toolchain, so
it was written against the migrations and the app's own queries and validated statically
(see `test/demoSeed.test.mjs`). Run it in a transaction and read the errors carefully the
first time. Its preflight refuses to run at all if step 1 was skipped.

Run its **V1 through V6** verification queries. V3 and V4 are the important ones: every
fabricated address must be at `@demo.aspire.invalid`, and no demo row may point at a real
one.

---

## Using it

**Settings > Demo Mode**, Owner only. One switch. Per user, per device, so a shared
workstation never hands the next person a mode they did not choose.

While it is on, the **scope picker's status light turns purple**. That light normally
reports the cohort's status (green Active, amber Planning, red Closed); in demo mode the
demo cohort overrides it, and the cohort row in the picker carries a presentation mark
instead of its season icon. It is deliberately quiet: a screenshot cropped to a card,
board, chart or drawer never contains it, and a capture of the whole window contains it
exactly once.

The light lives on the staff header and on the Residency Portal, which renders the same
control. The Student, Unit Leader, Academic Partner and Nursing Education & Leadership
portals have no scope picker and therefore no marker, so a screenshot of one of those
does not say on its face that it is fabricated. The names do: every demo address is
`@demo.aspire.invalid`.

**Before a talk, re-run the seed.** Dates are anchored to `CURRENT_DATE`, so a cohort
seeded in March looks finished by May. The seed clears and rebuilds its own rows, so
re-running is safe and idempotent.

**Portals:** open any of them as the Owner through the portal switcher. Every preview
resolves its own population server-side and each one is inside the boundary:

| Portal | What demo mode shows |
|---|---|
| Student | The picker lists only fabricated students; a stale id from the other population is refused |
| Unit Leader | The five demo units, and only the students assigned to them |
| Academic Partner | The three invented schools, derived from the demo students themselves |
| Nursing Education & Leadership | Demo cohorts, rotations, contacts and community-benefit figures |
| Residency | Its own fabricated cycle, ten alumni across the whole funnel, three hired |

Two things look empty on purpose. **7 North** has no roster: it is the unfilled unit, and
the gap is the point. And there is **no accepting cycle** in demo mode, so the Unit Leader
participation form has nothing to submit to: the demo cohort must never be the live public
intake router, which a partial unique index enforces.

**After a conference**, run `db/demo/demo_teardown.sql`. Demo rows cost nothing to leave
(invisible outside demo mode, skipped by every cron), but leaving them is how a database
accumulates fabricated people nobody remembers creating.

---

## What it covers

| Area | Covered |
|---|---|
| Every client read and write in `src/` | Yes, all 121 call sites, via one wrapper on the one Supabase client |
| Nineteen tables: students, cohorts, units, contacts, preceptors, preceptor cohort participation, matches, shift logs and plans, preceptor and unit assignments, evaluation assignments, interview slots/sessions/rubrics, rotations, unit capacity/requests/responses | Yes |
| Placement Board, rosters, Rotation Activity, On Campus Now, evaluations | Yes |
| Writes during a live demo | Yes. `is_demo` is in the WHERE clause of every UPDATE and DELETE, so a write in demo mode cannot reach a real row even when handed a real row's id |
| Outbound email | Yes. All 31 send sites go through `lib/server/email/mailer.js`, which holds anything addressed to `@demo.aspire.invalid` and never calls Resend |
| Crons and scheduled digests | They may read demo rows, but cannot email them |
| Student Portal preview | Yes |
| Unit Leader, Academic Partner and Nursing Education & Leadership previews | Yes, via one boundary on the service client each of their endpoints already shares |
| Residency Portal preview | Yes, including its own cycle. Six of the twenty-one `ngrp_*` tables carry `is_demo`; the other fifteen are reached only through an id one of those six filters |

## What it does not cover

Stated plainly so you know before the room is full, not after.

1. **Two relations were dropped from the boundary after meeting the live schema.**
   `schools` does not exist here (the canonical catalog, gate item 13, was never
   applied), and `student_active_disposition` is a VIEW over `student_dispositions`, so
   it cannot carry a column. Neither is a loss: a student's school is `students.school`,
   a TEXT column inside the boundary, and every read of the disposition view is already
   scoped by `cohort_id` or `student_id`, both of which the boundary filters. Details on
   schools: The canonical schools catalog (gate
   item 13) was never applied, which `api/lib/schoolScope.js` already tolerates by
   deriving the boundary from the school names on student records. A demo student's
   school is `students.school`, a TEXT column inside the boundary, so nothing is weaker
   for it. If that catalog is ever applied, add `schools` back to the registry and to a
   follow-up migration together.
2. **`user_profiles` is not filtered, and never will be.** Your own profile row resolves
   permissions, the Owner/Admin flags, the greeting and the avatar, so hiding it would
   stop the app working rather than show demo data. Settings > Accounts is safe to show
   anyway: it is the one panel that SUBSTITUTES instead of filtering, listing six
   fabricated colleagues from `src/lib/demoStaff.js` while demo mode is on. That works
   only because the directory and the session read different RPCs
   (`get_all_user_profiles` vs `get_my_profile`), and a test fails if those ever
   converge.
3. **Fifteen of the twenty-one `ngrp_*` tables carry no `is_demo`, deliberately.** Six
   do: `ngrp_cycles`, `ngrp_cycle_source_cohorts`, `ngrp_candidates`,
   `ngrp_residency_outcomes`, `ngrp_transition_assignments` and
   `ngrp_transition_revisions`. Every read of the other fifteen is already scoped by an
   id one of those six filters (a cycle id, a candidate id, an assignment id), which was
   established by reading every `.from('ngrp_*')` in `api/` and `lib/server/` rather than
   assumed; the list is in the header of
   `supabase/migrations/20260922000000_demo_mode_residency.sql`. `ngrp_cycles` is the one
   genuinely unscoped list read in the whole family, which is what makes a demo see only
   its own cycle.

   Two consequences worth knowing. A row a LIVE demo creates in one of the other fifteen
   (a Transition Form delivery, a support entry, a reflection) is a real row about a
   fabricated person; the teardown removes those by naming their demo parent. And the
   demo cycle is deliberately **not** `is_active`: that flag is the workspace default and
   a partial unique index allows exactly one, so a demo holding it would take it from
   real Talent Acquisition work. In demo mode it is the only cycle the boundary returns,
   so the picker lands on it anyway.
4. **Connect message history, notification log, messaging, program events and the
   Masthead's event feed** are outside the nineteen scoped tables and show real data.
5. **Six rpc functions** carry no table to filter and sit outside the boundary. They are
   listed in `DEMO_UNSCOPED_RPCS` in `src/lib/demoScope.js` and pinned by a test, so the
   gap cannot silently grow.
6. **Realtime** pushes rows rather than answering filtered requests.
   `realtimePayloadInScope()` exists for subscribers to use, but no subscriber calls it
   yet, so a colleague editing a real student mid-presentation could surface.
7. **Settings, email templates and the knowledge library** are workspace configuration
   and are shown as they really are in both modes.

Extending coverage means adding a table to `DEMO_SCOPED_TABLES` **and** to the migration
in the same change. `test/demoScope.test.mjs` fails if those two ever disagree, because a
client filtering on a column the database lacks is a 400 on every read of that table.

---

## Decisions worth revisiting

**Units are real, people are not.** Every student, preceptor, coordinator and school in
the seed is invented. The units are the real ones from `src/lib/unitCatalog.js`, because
the app resolves a unit's division, description and eligibility from that catalog by
name, so an invented unit renders a blank division and an empty description on exactly
the screens a demo exists to show. Unit names are institutional rather than personal and
already appear in public postings. Change them in the seed if you disagree, and accept
the blanks.

**Every demo address is `@demo.aspire.invalid`.** This is load-bearing, not decoration.
RFC 2606 reserves `.invalid` so it can never resolve, and the mailer refuses the domain
outright. Two independent defences, because one is not enough for something that sends
mail. A test fails if a single address in the seed would be accepted by a mail provider.

**The cast includes friction**, because that is the product: a student who raised support
needed mid-shift, two candidates unmatched on the board, a unit with both slots unfilled,
and a decline. An app that only ever shows a perfect Tuesday does not demonstrate
anything.

---

## The files

| File | What it is |
|---|---|
| `src/lib/demoBoundaryFlag.js` | The on switch. False until the migration is applied |
| `src/lib/demoMode.js` | The mode state: two storage keys, subscribers, the request parameter |
| `src/lib/demoScope.js` | The client boundary and the table registry |
| `src/lib/supabase.js` | Installs the boundary on the one client |
| `shared/demoIdentity.js` | How a fabricated person is recognised, importable by `src/` and `api/` |
| `lib/server/email/mailer.js` | The one door outbound mail leaves by |
| `lib/server/demoScope.js` | The server half, for endpoints the browser wrapper cannot reach |
| `src/components/DemoModeBadge.jsx` | The marker |
| `src/components/settings/DemoModePanel.jsx` | Settings > Demo Mode |
| `src/lib/demoFetch.js` | The header that tells a server endpoint which population to answer for |
| `shared/demoTables.js` | The one registry of scoped tables, read by both halves of the boundary |
| `supabase/migrations/20260921000000_demo_mode_foundation.sql` | The column, the triggers, the indexes |
| `supabase/migrations/20260922000000_demo_mode_residency.sql` | The same, for the six residency tables |
| `db/demo/demo_seed.sql` | The cast |
| `db/demo/demo_teardown.sql` | Removing it |
| `test/demoScope.test.mjs` | Boundary, lockstep with the migration, the gate |
| `test/demoMailer.test.mjs` | The mail guard and its structural ratchets |
| `test/demoSeed.test.mjs` | What can be proven about the seed without a database |
| `test/demoServerScope.test.mjs` | The Student Portal preview |
| `test/demoPortalScope.test.mjs` | The other four portals, the header, and the seed rows the Unit Leader roster needs |
