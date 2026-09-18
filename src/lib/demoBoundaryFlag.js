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
// TO TURN THE FEATURE ON, in this order:
//   1. Owner applies 20260921000000_demo_mode_foundation.sql and confirms V1 through V4.
//   2. Flip this to true and deploy.
//   3. Owner applies the phase 4 seed, which is what actually creates demo records.
//
// Step 2 before step 1 breaks production. Step 1 without step 2 is harmless: the column
// sits unused, defaulted to false on every row.
export const DEMO_BOUNDARY_LIVE = false
