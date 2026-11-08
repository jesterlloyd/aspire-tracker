// ASPIRE-INSIGHTS-1, Phase 2: the page's own rules, pure and tested without a browser.
//
// Every figure comes from /api/insights (insightsModel.js). This module only turns the URL into
// the API's filters, words the chips, formats a rate, and builds a chart's table and CSV. The
// URL parameter names ARE the API's, so a link to a filtered page is a link to its figures.

import { MEASURE_LABELS } from './insightsModel.js'

/** The filters the page offers, in the order the bar draws them. Defaults are omitted from the URL. */
export const FILTER_KEYS = Object.freeze(['cohort', 'school', 'pathway', 'serviceLine', 'unit', 'shift', 'residencyStatus', 'stage', 'measure', 'compare'])
export const FILTER_DEFAULTS = Object.freeze({
  cohort: '', school: '', pathway: 'all', serviceLine: '', unit: '', shift: '',
  residencyStatus: 'all', stage: 'all', measure: 'hired', compare: 'off',
})
/** The filters folded under More filters (INSIGHTS-LAYOUT-1); Cohort, School and Unit stay out. */
export const MORE_FILTER_KEYS = Object.freeze(['pathway', 'serviceLine', 'shift', 'residencyStatus', 'measure', 'compare'])
export const STAGE_LABELS = Object.freeze({ placed: 'Placed', completed: 'Completed', in_rotation: 'In rotation now' })

export const RESIDENCY_STATUS_LABELS = Object.freeze({
  all: 'All students',
  applied: 'Applied to NGRP',
  not_applied: 'Did not apply',
  offered: 'Offered NGRP',
  hired: 'Hired into NGRP',
  applied_not_hired: 'Applied, not hired',
})
export const COMPARE_LABELS = Object.freeze({ off: 'Off', previous: 'Previous cohort', program: 'Program average' })
export const PATHWAY_LABELS = Object.freeze({ all: 'All', internal: 'Internal', external: 'External' })

/** The page's filters from a query string (or URLSearchParams). Unknown keys are dropped. */
export function filtersFromSearch(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search || '')
  const out = { ...FILTER_DEFAULTS }
  for (const k of FILTER_KEYS) {
    const v = p.get(k)
    if (v != null && v !== '') out[k] = v
  }
  // Previous cohort needs one cohort; without one it is not offered.
  if (out.compare === 'previous' && !out.cohort) out.compare = 'off'
  return out
}

/** The query string for a filter set, defaults left out, in a stable order. */
export function searchFromFilters(f) {
  const p = new URLSearchParams()
  for (const k of FILTER_KEYS) {
    const v = f?.[k]
    if (v != null && v !== '' && v !== FILTER_DEFAULTS[k]) p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

/**
 * Change one filter. A service line that no longer holds the chosen unit drops the unit;
 * clearing the cohort drops Previous cohort.
 */
export function withFilter(f, key, value, units = []) {
  const next = { ...f, [key]: value ?? FILTER_DEFAULTS[key] }
  if (key === 'serviceLine' && next.unit && value) {
    const u = units.find(x => x.key === next.unit)
    if (u && u.serviceLine !== value) next.unit = ''
  }
  if (key === 'cohort' && !value && next.compare === 'previous') next.compare = 'off'
  return next
}

/** A cross-filter click: choosing the chosen value again clears it. */
export function toggleFilter(f, key, value, units = []) {
  return withFilter(f, key, f[key] === value ? FILTER_DEFAULTS[key] : value, units)
}

/** The removable chips for the active narrowing filters (measure and compare are views, not filters). */
export function chipsFor(f, { cohorts = [], units = [] } = {}) {
  const chips = []
  const name = {
    cohort: v => cohorts.find(c => c.id === v)?.name || 'Cohort',
    school: v => v,
    pathway: v => PATHWAY_LABELS[v] || v,
    serviceLine: v => v,
    unit: v => units.find(u => u.key === v)?.name || v,
    shift: v => `${v} shift`,
    residencyStatus: v => RESIDENCY_STATUS_LABELS[v] || v,
    stage: v => STAGE_LABELS[v] || v,
  }
  for (const k of Object.keys(name)) {
    if (f[k] && f[k] !== FILTER_DEFAULTS[k]) chips.push({ key: k, label: name[k](f[k]) })
  }
  return chips
}

/** Clear every narrowing filter, keeping the measure and the compare (unless it needed a cohort). */
export function clearFilters(f) {
  return { ...FILTER_DEFAULTS, measure: f.measure, compare: f.compare === 'previous' ? 'off' : f.compare }
}

/** How many folded filters are set, for the More filters button. */
export function moreFiltersSet(f) {
  return MORE_FILTER_KEYS.filter(k => f?.[k] != null && f[k] !== '' && f[k] !== FILTER_DEFAULTS[k]).length
}

/**
 * INSIGHTS-KPI-FILTER-1: the tiles are the first filter, one at a time, like every KPI band.
 * 'all' (Applicants) clears both tile filters; a stage tile sets the stage; 'measure' (the
 * Hired / Applied / Offered tile) sets the residency status to the current measure. Choosing the
 * chosen tile again clears it.
 */
export function tileActive(f, tile) {
  const stage = f?.stage || 'all'
  const status = f?.residencyStatus || 'all'
  if (tile === 'all') return stage === 'all' && status === 'all'
  if (tile === 'measure') return stage === 'all' && status === (f?.measure || 'hired')
  return status === 'all' && stage === tile
}
export function pickTile(f, tile) {
  if (tile === 'all' || tileActive(f, tile)) return { ...f, stage: 'all', residencyStatus: 'all' }
  if (tile === 'measure') return { ...f, stage: 'all', residencyStatus: f.measure || 'hired' }
  return { ...f, stage: tile, residencyStatus: 'all' }
}

export const measureLabel = m => MEASURE_LABELS[m] || MEASURE_LABELS.hired

/** "62.5%", "Too few", or an en dash. */
export function fmtRate(r) {
  if (!r) return '–'
  if (r.suppressed) return r.n ? 'Too few' : '–'
  return `${Math.round(r.rate)}%`
}

/** "+0.40" for a Casey-Fink change. */
export function fmtChange(m) {
  if (!m || m.suppressed || m.mean == null) return m?.n ? 'Too few' : '–'
  return `${m.mean >= 0 ? '+' : ''}${m.mean.toFixed(2)}`
}

/** "▲ 4 pts vs Summer 2026" / "No change vs program", or '' when either side is withheld. */
export function deltaWords(points, label) {
  if (points == null || !label) return ''
  const d = Math.round(points)
  if (d === 0) return `No change vs ${label}`
  return `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts vs ${label}`
}

/** One cell for a CSV: a withheld rate reads "Too few to rate (n = 3)", never a number. */
export function rateText(r) {
  if (!r) return ''
  if (r.suppressed) return `Too few to rate (n = ${r.n})`
  return `${r.rate}%`
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  // A cell a spreadsheet would run as a formula is written as text.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV text for a table: columns [{label}] and rows of plain values. UTF-8 BOM for Excel. */
export function toCsv(columns, rows) {
  const lines = [columns.map(c => csvCell(c.label)), ...rows.map(r => r.map(csvCell))]
  return `\uFEFF${lines.map(l => l.join(',')).join('\r\n')}`
}

/** "aspire-insights-pipeline-2026-11-05.csv", dated by the Pacific calendar day. */
export function csvFileName(id, now = new Date()) {
  const d = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  return `aspire-insights-${id}-${d}.csv`
}

/** "As of Nov 5, 2026, 9:40 PM", in Pacific time. */
export function asOfWords(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
  return `As of ${day}, ${time}`
}

/** "Fall ’25" from "Fall 2025", for a crowded axis. */
export function shortCohort(name) {
  const m = /^(\w+)\s+20(\d\d)$/.exec(String(name || ''))
  return m ? `${m[1].slice(0, 3)} ’${m[2]}` : String(name || '')
}
