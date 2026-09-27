// SCROLL-TOP-1: a new page in the staff app starts at the top (Owner, 2026-09-25: following
// "Open shift log" from At a Glance left Rotation > Activity scrolled, with blank page below).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { shouldScrollTop } from '../src/hooks/useScrollTopOnRoute.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('a new path starts at the top; Back, Forward, the first load and a query change do not', () => {
  assert.equal(shouldScrollTop('/aggregate', '/rotation/activity', 'PUSH'), true)
  assert.equal(shouldScrollTop('/rotation', '/rotation/matrix', 'REPLACE'), true)
  assert.equal(shouldScrollTop('/aggregate', '/rotation/activity', 'POP'), false)
  assert.equal(shouldScrollTop(null, '/aggregate', 'POP'), false, 'first render')
  assert.equal(shouldScrollTop('/students', '/students', 'PUSH'), false, 'the path did not change (a ?student= selection)')
})

test('the staff app runs it, keyed on the path alone', () => {
  const app = read('src/staff/StaffApp.jsx')
  assert.match(app, /import \{ useScrollTopOnRoute \} from '\.\.\/hooks\/useScrollTopOnRoute'/)
  assert.match(app, /\n  useScrollTopOnRoute\(\)\n/)
  const hook = read('src/hooks/useScrollTopOnRoute.js')
  assert.match(hook, /const \{ pathname \} = useLocation\(\)/)
  assert.doesNotMatch(hook, /location\.search|useSearchParams/)
})
