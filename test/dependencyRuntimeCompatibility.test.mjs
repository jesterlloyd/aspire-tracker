import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readJson = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))

test('the patched HTML sanitizer uses the Vercel-compatible parser runtime', () => {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')

  assert.equal(pkg.dependencies['sanitize-html'], '2.17.7')
  assert.equal(pkg.overrides?.['sanitize-html']?.htmlparser2, '10.1.0')

  const packages = lock.packages || {}
  assert.equal(packages['node_modules/sanitize-html']?.version, '2.17.7')
  assert.equal(packages['node_modules/htmlparser2']?.version, '10.1.0')
  assert.equal(
    packages['node_modules/sanitize-html/node_modules/htmlparser2'],
    undefined,
    'htmlparser2 12 is ESM-only and crashes sanitize-html CommonJS in Vercel',
  )
})
