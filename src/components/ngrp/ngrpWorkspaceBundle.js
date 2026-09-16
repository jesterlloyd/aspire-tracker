// PORTAL-SPLIT Phase 2 (2026-09-15): the Residency workspace as ONE module.
//
// The staff app and the Residency Portal render the same four components. While
// both imported them statically, the bundler saw a graph reachable from two
// eager chunks and merged it into the chunk it happened to name after another
// shared module: 273 KB of src/components/ngrp rode inside CustomOnboardingTour,
// which every portal visitor downloaded, student portals included.
//
// Both sides now import THIS module dynamically, through
// src/lib/ngrpWorkspaceLoader.js. One specifier means one chunk: the staff app
// fetches it when /ngrp opens, the Residency Portal when it renders, and nobody
// else pays for it at all.
export { default as NgrpNav } from './NgrpNav'
export { default as NgrpWorkspace } from './NgrpWorkspace'
export { default as CohortSettingsModal } from './CohortSettingsModal'
export { default as CreateCohortDialog } from './CreateCohortDialog'
