// src/lib/demoBoundaryFlag.js
//
// DEMO-MODE-1: one boolean, in its own module so that demoMode.js and demoScope.js can
// both read it without importing each other.
//
// WHY THE FEATURE HAS AN OFF SWITCH AT ALL
//
// The boundary filters in BOTH directions. Real mode does not merely decline to show
// demo rows; it asks PostgREST for is_demo = false, and a filter on a column that does
// not exist is a 400. Until
// supabase/migrations/20260921000000_demo_mode_foundation.sql is applied, turning the
// boundary on would take down every screen that reads a scoped table, for everyone, the
// moment it deployed.
//
// So while this is false:
//   - installDemoScope does nothing, and the app is byte-identical to before.
//   - isDemoMode() answers false no matter what is in storage, so a flag left behind by
//     an earlier build cannot put the badge on screen over real student data. That is
//     the failure this module exists to make impossible, not merely unlikely.
//   - Settings > Demo Mode renders as unavailable and says which migration it wants.
//
// LIVE SINCE 2026-09-17. The migration was applied to production and confirmed: all
// nineteen is_demo columns exist, the fourteen inheritance triggers are installed, and
// the five partial indexes are present.
//
// THE ORDER THIS WENT IN, and it is not interchangeable:
//   1. Apply 20260921000000_demo_mode_foundation.sql.          DONE
//   2. Flip this to true and deploy.                            THIS COMMIT
//   3. Apply db/demo/demo_seed.sql, which creates the records.  AFTER the deploy.
//
// Step 3 must follow step 2, not precede it. The seed creates rows; until this flag is
// true and deployed, NOTHING filters them, so twenty-one fabricated students would
// appear in the live app beside the real ones and the Friday digest would try to email
// a domain that cannot resolve. Step 1 without step 2 was harmless, which is why it went
// first; step 3 without step 2 is not.
//
// Setting this back to false is a safe way to disable the whole feature: the boundary
// stops installing, isDemoMode() answers false regardless of stored state, and the app
// behaves as it did before demo mode existed. Any demo ROWS remain in the database and
// become visible in normal use, so turn the seed out with db/demo/demo_teardown.sql
// first if that is the intent.
export const DEMO_BOUNDARY_LIVE = true
