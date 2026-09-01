// test/programNameCanon.test.mjs
//
// The residency program has ONE spelling: "New Graduate RN Residency Program".
//
// src/public-site/publicContent.js states the rule, and the public site, the interview
// script, the FAQ, the outreach templates and Keith's knowledge base all follow it. But
// three places had drifted to a hyphenated "New-Graduate", including the invitation
// email students actually receive, and the drift was only caught by reading a rendered
// preview. A program's own name appearing two ways across the product is the kind of
// error nobody reports and everybody notices.
//
// This sweeps SOURCE, not docs: planning documents are drafting space, and holding them
// to product copy rules would generate noise without protecting anyone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    // The " 2.js" duplicates are stray copies the Owner keeps untracked; they are not
    // the product and must not fail a product-copy rule.
    if (entry.name.includes(' 2.')) continue
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) sourceFiles(rel, out)
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(rel)
  }
  return out
}

const FILES = [...sourceFiles('src'), ...sourceFiles('lib'), ...sourceFiles('api')]

test('the program name is never hyphenated', () => {
  // Capitalized only: "new-graduate candidates" is an ordinary adjective describing a
  // person, not the program, and outreachTemplates uses it correctly.
  const offenders = FILES.filter(f => /New-Graduate|New-graduate/.test(read(f)))
  assert.deepEqual(offenders, [],
    'the formal name is "New Graduate RN Residency Program"; see src/public-site/publicContent.js')
})

test('the rule is written down where the name is defined', () => {
  assert.match(read('src/public-site/publicContent.js'),
    /The formal residency name is always "New Graduate RN Residency Program"/)
})

test('the sweep actually covers the source tree, so a broken matcher cannot pass', () => {
  assert.ok(FILES.length >= 300, `expected 300+ source files, found ${FILES.length}`)
  // And it genuinely sees the canonical name in the places that carry it.
  const carriers = FILES.filter(f => /New Graduate RN Residency Program/.test(read(f)))
  assert.ok(carriers.length >= 4, `expected 4+ files naming the program, found ${carriers.length}`)
})

test('the student-facing surfaces that had drifted now carry the canonical name', () => {
  // Each of these was hyphenated. Named individually so a regression says WHICH.
  assert.match(read('lib/server/email/ngrpTransitionEmail.js'), /New Graduate RN Residency Program \(NGRP\)/)
  assert.match(read('src/lib/portalNextSteps.js'), /New Graduate RN Residency Program/)
  assert.match(read('src/lib/keithKnowledge.js'), /New Graduate RN Residency Program/)
})
