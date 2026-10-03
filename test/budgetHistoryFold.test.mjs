// HISTORY-FOLD-1 (Owner, 2026-10-03): Budget History shows the newest five changes; an arrow shows the rest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/components/budget/BudgetSummary.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/components/budget/budget.css', import.meta.url), 'utf8')

test('Budget History folds to the newest five and expands from an arrow', () => {
  assert.match(src, /const HISTORY_PEEK = 5/)
  assert.match(src, /histOpen \? year\.history : year\.history\.slice\(0, HISTORY_PEEK\)/)
  assert.match(src, /year\.history\.length > HISTORY_PEEK && \(/, 'no toggle when everything already shows')
  assert.match(src, /className="bud-hist-more" aria-expanded=\{histOpen\}/)
  assert.match(src, /Show all \$\{year\.history\.length\} changes/)
  assert.match(src, /'Show fewer'/)
  assert.match(css, /\.bud-hist-more:focus-visible/)
})
