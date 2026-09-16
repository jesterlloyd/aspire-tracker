// PORTAL-SPLIT Phase 2: the ONE dynamic import of the Residency workspace.
//
// Mirrors portalAppLoader / staffAppLoader. Every caller goes through here, so
// the staff app and the Residency Portal resolve to the same chunk instead of
// two copies, and the workspace stays out of both eager chunks.
export const loadNgrpWorkspace = () => import('../components/ngrp/ngrpWorkspaceBundle')

// lazyReload wants a module with a default export; the bundle has four named
// ones. ngrpPart('NgrpWorkspace') adapts one without a second import()
// specifier, which is what keeps them in a single chunk.
export const ngrpPart = (name) => () => loadNgrpWorkspace().then(m => ({ default: m[name] }))
