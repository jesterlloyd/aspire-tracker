import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

const evaluation = read('src/components/EvaluationTab.jsx')
const modern = read('src/components/evaluation/evaluationModern.css')
const queue = read('src/components/evaluation/ReviewReleaseQueue.jsx')

test('Evaluation uses the canonical segmented picker for its two views', () => {
  assert.match(evaluation, /import SegmentedPicker from '\.\/shared\/SegmentedPicker'/)
  assert.match(evaluation, /ariaLabel="Evaluation views"/)
  assert.match(evaluation, /\{ value: 'cohort', label: 'Responses' \}/)
  assert.match(evaluation, /\{ value: 'automation', label: 'Review & Release' \}/)
  assert.doesNotMatch(evaluation, /const btnStyle|style=\{btnStyle/)
})

test('Modern Evaluation removes the Classic materials without changing Classic selectors', () => {
  assert.match(evaluation, /className="evaluation-workspace"/)
  assert.match(evaluation, /import '\.\/evaluation\/evaluationModern\.css'/)
  assert.match(modern, /:root\[data-style="modern"\] \.evaluation-workspace \.rp-folder/)
  assert.match(modern, /background-image: none;/)
  assert.match(modern, /\.rq-clip \{ display: none; \}/)
  assert.match(modern, /\.ds-holes \{ display: none; \}/)
  assert.match(modern, /\.rq-board \{[\s\S]*?background: var\(--color-bg-surface\);[\s\S]*?background-image: none;/)
  assert.match(modern, /\.rp-sheet \{[\s\S]*?background-image: none;/)
  assert.doesNotMatch(modern, /Program Evidence/i)
})

test('Modern Review and Release uses neutral action language', () => {
  assert.match(queue, /className="rq-sent-label-classic">Sent from this clipboard/)
  assert.match(queue, /className="rq-sent-label-modern">Recently sent/)
  assert.match(modern, /\.rq-sent-label-classic \{ display: none; \}/)
  assert.match(modern, /\.rq-sent-label-modern \{ display: inline; \}/)
})

test('the analysis table control names the action it will take', () => {
  const packet = read('src/components/evaluation/ResponsesPacket.jsx')
  assert.match(packet, /aria-expanded=\{tableView\}/)
  assert.match(packet, /aria-controls=\{tableId\}/)
  assert.match(packet, /\{tableView \? 'Hide table' : 'View table'\}/)
})
