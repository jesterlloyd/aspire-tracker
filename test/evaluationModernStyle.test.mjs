import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

const evaluation = read('src/components/EvaluationTab.jsx')
const modern = read('src/components/evaluation/evaluationModern.css')
const packet = read('src/components/evaluation/ResponsesPacket.jsx')
const packetCss = read('src/components/evaluation/responsesPacket.css')
const brand = read('src/styles/aspireBrand.css')
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
  assert.match(modern, /\.rp-tab-main,[\s\S]*?background: color-mix\(in srgb, var\(--color-bg-surface\) 92%, var\(--color-text-secondary\) 8%\);[\s\S]*?box-shadow: inset 0 -10px 16px/)
  assert.match(modern, /\.rp-tab\[data-selected="true"\] \.rp-tab-main \{[\s\S]*?background: var\(--color-bg-surface\);[\s\S]*?box-shadow: 0 1px 0 var\(--color-bg-surface\);/)
  assert.match(modern, /\.rp-tab-main b \{[\s\S]*?color: var\(--color-text-secondary\);[\s\S]*?\.rp-tab\[data-selected="true"\] \.rp-tab-main b \{[\s\S]*?color: var\(--color-text-primary\);/)
  assert.doesNotMatch(modern, /Program Evidence/i)
})

test('Classic Evaluation uses the instrument tabs as the booklet index', () => {
  assert.match(packet, /role="group" aria-label="Evaluation instruments"/)
  assert.match(packet, /className="rp-tab-label-short"/)
  assert.match(packet, /className="rp-completion"/)
  assert.match(packet, /className="rp-classic-comparison"/)
  assert.match(packet, /data-basis-key=\{b\.key\}/)
  assert.match(packetCss, /:root\[data-style="classic"\] \.evaluation-workspace \.rp-folder \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 62px;/)
  assert.match(packetCss, /\.rp-folder \{[\s\S]*?padding: 14px 0 14px 24px;[\s\S]*?border-radius: var\(--aspire-radius-card\);/)
  assert.match(brand, /--aspire-fastener-size: 12px;[\s\S]*?--aspire-fastener-gilt: radial-gradient/)
  assert.match(packetCss, /\.rp-folder::before,[\s\S]*?\.rp-folder::after \{[\s\S]*?width: var\(--aspire-fastener-size\);[\s\S]*?border: var\(--aspire-fastener-border\);[\s\S]*?background: var\(--aspire-fastener-gilt\);[\s\S]*?box-shadow: var\(--aspire-fastener-shadow\);/)
  assert.match(packetCss, /:root\[data-style="classic"\] \.evaluation-workspace \.rp-sheet \{[\s\S]*?border-radius: 0;[\s\S]*?box-shadow: -3px 0 7px rgba\(5, 10, 43, 0\.16\);/)
  assert.doesNotMatch(packetCss, /4px 5px 0 color-mix/)
  assert.match(packetCss, /:root\[data-style="classic"\] \.evaluation-workspace \.rp-tabs \{[\s\S]*?flex-direction: column;/)
  assert.match(packetCss, /\.rp-tab-main b \{[\s\S]*?writing-mode: vertical-rl;/)
  assert.match(packetCss, /\.rp-sheet \{[\s\S]*?background-image: none;/)
  assert.match(packetCss, /\.rp-completion \{[\s\S]*?display: block;/)
  assert.match(packetCss, /\.rp-legacy-distribution \{ display: none; \}/)
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
