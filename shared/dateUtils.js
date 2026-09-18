// shared/dateUtils.js
//
// Shared date utilities importable by BOTH src/ (Vite frontend) and api/
// (Vercel serverless functions). Lives at the repo root so neither deployment
// context needs to reach into the other's directory.
//
// Rule: use these helpers for YYYY-MM-DD date strings. Continue using
// new Date().toISOString() for full ISO timestamps (sent_at, created_at, etc.).

/**
 * Returns the current date (or a given date) as a YYYY-MM-DD string using
 * the runtime's LOCAL timezone -- not UTC.
 *
 * Motivation: toISOString().split('T')[0] returns the UTC date, which can
 * differ from the Pacific date near midnight and produce off-by-one bugs in
 * event_date, issue_date, and any other calendar-date column.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} e.g. "2026-05-22"
 */
export function toLocalDateStr(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The current date (or a given date) as YYYY-MM-DD in PACIFIC time, regardless of where
 * the code runs.
 *
 * WHY THIS EXISTS ALONGSIDE toLocalDateStr, WHICH LOOKS LIKE IT WOULD DO
 *
 * toLocalDateStr reads the RUNTIME's timezone. In a browser that is the user's, which
 * is Pacific, so it is correct there. On Vercel the runtime is UTC, so toLocalDateStr
 * returns exactly what the UTC-derived date returns and swapping one for the other in
 * api/ changes nothing at all: a cosmetic edit that looks like a fix.
 *
 * So server-side calendar-date columns need an explicit zone. This is the pattern
 * api/keith.js and api/ngrp-support.js already use inline; it lives here now so the
 * next caller does not have to rediscover it.
 *
 * en-CA formats as YYYY-MM-DD, which is why that locale and not en-US.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} e.g. "2026-09-18"
 */
export function toPacificDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}
