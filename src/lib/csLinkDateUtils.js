// src/lib/csLinkDateUtils.js
//
// CSLINK-DATE-PICKER-DATA-RECOVERY: helpers for the CS-Link Access date fields, which are TEXT
// columns that may still hold LEGACY free-text values (e.g. "5/1/26", "May 1") entered before the
// inputs became <input type="date">. A date input can only display exact YYYY-MM-DD, so legacy
// values render blank - these helpers let the UI surface them and prevent accidental overwrite.
//
// We never parse or guess legacy values here - that's owner-run recovery, not UI behavior.

// Exactly YYYY-MM-DD (what an <input type="date"> can display and the server accepts).
export function isIsoDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Non-blank text that is NOT ISO - i.e. a legacy value the date picker cannot show.
export function isLegacyNonIsoDateValue(value) {
  return String(value ?? '').trim() !== '' && !isIsoDateString(value);
}

// Safe value for binding to <input type="date">: the ISO string, or '' for blank/legacy
// (so the control is cleanly empty and React stays a controlled input - the raw legacy value
// is surfaced separately, never silently dropped).
export function dateInputValue(value) {
  return isIsoDateString(value) ? value : '';
}

// Should an UNTOUCHED date field be preserved (omitted from a save) rather than written?
// True when the user did not change it AND the stored value is a legacy non-ISO string - writing
// it back would coerce a real (but unparseable-here) date to null. Touched fields, or ISO/blank
// values, are safe to save normally.
export function shouldPreserveLegacyDateValue(initialValue, touched) {
  return !touched && isLegacyNonIsoDateValue(initialValue);
}
