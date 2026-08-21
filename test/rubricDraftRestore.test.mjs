import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const rubricSource = fs.readFileSync('src/components/RubricSession.jsx', 'utf8')
const toastSource = fs.readFileSync('src/hooks/useToast.js', 'utf8')

test('rubric draft restore cannot enqueue the same notice repeatedly', () => {
  assert.match(rubricSource, /const restoredDraftKeyRef = useRef\(null\)/)
  assert.match(rubricSource, /if \(restoredDraftKeyRef\.current === key\) return/)

  const guardIndex = rubricSource.indexOf('restoredDraftKeyRef.current = key')
  const toastIndex = rubricSource.indexOf("toast?.success('Draft restored'")
  assert.ok(guardIndex >= 0 && guardIndex < toastIndex,
    'the restore must be marked before state updates or the toast can rerender the effect')
})

test('initial server state cannot overwrite or manufacture a browser draft before restore', () => {
  assert.match(rubricSource, /const draftHydratedKeyRef = useRef\(null\)/)
  assert.match(rubricSource, /if \(draftHydratedKeyRef\.current !== key\) return/)
  assert.match(rubricSource, /finally \{[\s\S]*?draftHydratedKeyRef\.current = key[\s\S]*?\}/)
})

test('the shared toast API remains stable when toast state changes', () => {
  assert.match(toastSource, /useMemo/)
  assert.match(toastSource, /const toast = useMemo\(\(\) => \(\{/)
  assert.match(toastSource, /\}\), \[addToast\]\)/)
})

test('auto-filled interviewer identity is not treated as draft content', () => {
  const fieldsMatch = rubricSource.match(/const userTypedFields = \[([\s\S]*?)\n  \]/)
  assert.ok(fieldsMatch, 'expected rubric draft content field list')
  assert.doesNotMatch(fieldsMatch[1], /['"]interviewer_name['"]/)
  assert.match(fieldsMatch[1], /['"]summary_comments['"]/)
})

test('completed and empty browser drafts are cleaned up instead of restored', () => {
  assert.match(rubricSource, /if \(f\.status === 'Completed'\) \{\s*localStorage\.removeItem\(key\)/)
  assert.match(rubricSource, /if \(draft\.formState\?\.status === 'Completed'\) \{\s*localStorage\.removeItem\(key\)/)
  assert.match(rubricSource, /if \(!hasRubricContent\(draft\)\) \{\s*localStorage\.removeItem\(key\)/)
})
