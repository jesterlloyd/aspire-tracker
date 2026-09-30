// BUDGET-TRACKER-1 (Owner, 2026-09-30): a closed year keeps Subscriptions and Receipts; Undo and Redo in
// every sheet; the Budget Tracker opens on the fiscal year last opened, until a hard refresh or a new
// sign-in; Program Budget is labelled Budget Tracker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PM = await import('../src/lib/budget/planModel.js')
const LY = await import('../src/lib/budget/lastYear.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('a closed year keeps Subscriptions and Receipts (the Owner’s), and Add receipts', () => {
  assert.deepEqual(PM.tabsForState('closed'), ['summary', 'sheet', 'subscriptions', 'receipts', 'plan'])
  assert.ok(!PM.tabsForState('closed', { owner: false }).includes('receipts'), 'receipts stay the Owner’s')
  assert.match(read('src/components/budget/ProgramBudgetView.jsx'), /\{canEdit && \(year\.state === 'current' \|\| year\.state === 'closed'\) && tab !== 'receipts'/)
})

test('the last fiscal year is remembered in memory only, per app, and forgotten on sign-out', () => {
  LY.forgetRememberedYears()
  assert.equal(LY.rememberedYear('staff'), null)
  LY.rememberYear('staff', 2026)
  LY.rememberYear('portal', 2028)
  assert.deepEqual([LY.rememberedYear('staff'), LY.rememberedYear('portal')], [2026, 2028])
  LY.rememberYear('staff', 'x')
  assert.equal(LY.rememberedYear('staff'), 2026, 'only a year')
  LY.forgetRememberedYears()
  assert.equal(LY.rememberedYear('staff'), null)
  const src = read('src/lib/budget/lastYear.js')
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /localStorage|sessionStorage/, 'a hard refresh starts again')
  assert.match(read('src/lib/signOutCleanup.js'), /forgetRememberedYears\(\)/)
  const view = read('src/components/budget/ProgramBudgetView.jsx')
  assert.match(view, /useState\(\(\) => initialFy \?\? rememberedYear\(memoryKey\) \?\? currentFiscalYear\(\)\)/)
  assert.match(view, /const setFy = useCallback\(\(y\) => \{ rememberYear\(memoryKey, y\); setFyState\(y\) \}, \[memoryKey\]\)/)
})

test('every sheet has Undo and Redo: recorded where saved, put back through the same save, grouped', () => {
  const s = read('src/components/sheet/EditableSheet.jsx')
  assert.match(s, /aria-label="Undo"><Undo2 size=\{15\} \/><\/button>/)
  assert.match(s, /aria-label="Redo"><Redo2 size=\{15\} \/><\/button>/)
  assert.match(s, /if \(editable && \(e\.metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === 'z'\) \{ e\.preventDefault\(\); if \(e\.shiftKey\) redo\(\); else undo\(\); return \}/)
  assert.match(s, /record\(\{ kind: 'host', rowId: row\.id, key: col\.key, before, after: \{ value, fx: fx \|\| null \} \}\)/, 'a host cell, after its save lands')
  assert.match(s, /record\(\{ kind: 'staff', rowId: row\.id, key: col\.key, before: row\.cells\[col\.key\] \?\? '', after: value \}\)/)
  assert.match(s, /const mine = beginGroup\(\)\n\s+try \{ await pasteCells\(text\) \} finally \{ endGroup\(mine\) \}/, 'a paste is one step')
  assert.match(s, /else if \(e\.kind === 'host'\) \{ setSave\('saving'\); await saveHostValue\(row, col, v\.value, v\.fx\); saved\(\) \}/, 'an undo saves through the host, so its rules apply')
  assert.match(s, /if \(c\.staff\) \{ saveStaffQuietly\(row, c, String\(res\.value\)\); continue \}/, 'a recalculated formula is not a step of its own')
  assert.match(s, /const HISTORY_MAX = 50/)
})

test('Program Budget is labelled Budget Tracker where people read it', () => {
  assert.match(read('src/components/settings/settingsSections.js'), /label: 'Budget Tracker', path: '\/settings\/budget'/, 'the route stays')
  assert.match(read('src/components/settings/ProgramBudgetPanel.jsx'), /title="Budget Tracker"/)
  assert.match(read('src/lib/home/needsYouModel.js'), /open: \{ label: 'Open Budget Tracker', to \}/)
  assert.match(read('src/portal/na/NursingAcademicsPortal.jsx'), /<h2>Budget Tracker<\/h2>/)
  for (const f of ['src/components/budget/ProgramBudgetView.jsx', 'src/components/budget/BudgetReceipts.jsx', 'src/components/budget/ReceiptSlip.jsx', 'src/components/budget/BudgetFiled.jsx', 'src/lib/actionCenter/queueModel.js', 'api/budget-staff.js']) {
    const code = read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\s\/\/\s.*$/, '')).join('\n')
    assert.doesNotMatch(code, /Program Budget/, f)
  }
})
