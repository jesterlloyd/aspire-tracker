// lib/server/shiftOrdinals.js
//
// SHIFT-SEQUENCE-1: the ordinal rule moved to src/lib/shiftOrdinals.js so the
// CLIENT surfaces (staff clinical-hours tables, Student Portal) can share the
// exact definition the Unit Leader calendar already uses. This module stays as
// the server import site so existing callers are unchanged.
//
// Same core/server split the repo already uses for contactSearch -> contactSearchCore
// and appUrl -> server/appUrl.
export { compareShiftChronological, buildStudentShiftOrdinals } from '../../src/lib/shiftOrdinals.js'
