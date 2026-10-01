// test/receiptsRedesignUi.test.mjs
//
// RECEIPTS-REDESIGN-1 (Owner, 2026-10-01): the screens, pinned by their source. Reference:
// docs/mockups/receipts-redesign.html. One drawing in both styles; receipts white on tan holders; the
// modal replaces the side panel; the Subscriptions tab has the month grid. The rules themselves are
// tested in receiptsRedesignModel.test.mjs, the server in receiptsRedesign.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const filed = read('src/components/budget/BudgetFiled.jsx')
const modal = read('src/components/budget/ReceiptModal.jsx')
const grid = read('src/components/budget/SubscriptionMonths.jsx')
const css = read('src/components/budget/budget.css')
const code = (s) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')

test('the mockup is in the repo, and the screens compute nothing: every figure is filedModel’s', () => {
  assert.ok(existsSync(new URL('../docs/mockups/receipts-redesign.html', import.meta.url)))
  for (const src of [filed, modal, grid]) {
    assert.match(src, /from '\.\.\/\.\.\/lib\/budget\/filedModel'/)
    assert.doesNotMatch(code(src), /daysLeft\s*[<>]|deadline_days|\b60\b\s*\*|addDays\(/, 'no second 60-day rule in a screen')
  }
})

test('Filed: the strip, the toolbar order, tan holders, white receipts, chips and marks', () => {
  for (const k of ['Filed in {fyShort(year.fy)}', 'Submitted to Concur', 'Past the 60-day limit', 'Due in the next 14 days']) assert.ok(filed.includes(k), k)
  assert.match(read('src/lib/budget/receiptModel.js'), /\{ key: 'month', label: 'Month' \}, \{ key: 'vendor', label: 'Vendor' \}, \{ key: 'status', label: 'Stage' \}, \{ key: 'category', label: 'Category' \}/)
  assert.match(filed, /className="bud-month bud-holder"/)
  assert.match(filed, /className="bud-fcard bud-holder"/)
  assert.match(css, /\.bud-holder \{ --hold-bg: var\(--aspire-paper-tan\); --hold-line: var\(--aspire-rule-tan\);/, 'the calendar’s own tan tokens, never a second value')
  assert.match(css, /\[data-theme="dark"\] \.bud-holder \{ --hold-bg: var\(--color-bg-surface\);/, 'dark uses the app’s own surface')
  assert.match(css, /\.bud-holder \.bud-rcpt \{ background: #FFFFFF;/, 'receipts stay white')
  // Removed from the card: the category chip, the duplicate Attached chip, the repeated caption.
  assert.doesNotMatch(code(filed), /Attached<|Meal · documented|bud-ftile-tags|categories`/)
  assert.match(filed, /aria-label=\{cardLabel\(r\)\}/, 'a card is a button with its full name')
  assert.match(filed, /Submit \{f\.key\.replace\(\/ \\d\{4\}\$\/, ''\)\} to Concur/)
  assert.match(filed, /groupBy === 'month' && sum\.open > 0 &&/, 'only while the month has unsubmitted Personal (Concur) receipts')
  assert.match(modal, /<span className="bud-latetab" aria-hidden="true">/)
  assert.match(modal, /className=\{`bud-stamp bud-stamp-\$\{m\.tone\}\$\{fresh \? ' bud-stamp-new' : ''\}`\} aria-hidden="true"/, 'stamps are decoration')
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.bud-stamp-new \{ animation: bud-stamp/, 'the stamp animates only when motion is welcome')
  // The manila folder drawing is retired in both styles.
  assert.doesNotMatch(css, /\.bud-fcard-peek|\.bud-folder-tab|data-style="modern"\] \.bud-fcard/)
  assert.doesNotMatch(filed, /DetailDrawer/)
})

test('the modal: a named dialog that traps focus, the tracker, the order of work, and a footer that follows the stage', () => {
  assert.match(modal, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/)
  assert.match(modal, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); onClose\(\); return \}/)
  assert.match(modal, /if \(!typing && e\.key === 'ArrowRight'\) \{ go\(1\); return \}/)
  assert.match(modal, /if \(e\.shiftKey && document\.activeElement === f\[0\]\) \{ e\.preventDefault\(\); f\[f\.length - 1\]\.focus\(\) \}/, 'Tab is trapped')
  assert.match(filed, /document\.querySelector\(`\[data-receipt="\$\{id\}"\]`\)\) \|\| opener\.current/, 'focus returns to the receipt that opened it')
  assert.match(modal, /\{\.\.\.\(s\.state === 'current' \? \{ 'aria-current': 'step' \} : \{\}\)\}/)
  const order = ['bud-rm-alert', 'bud-rm-check', 'bud-rm-concur', 'bud-rm-details'].map(c => modal.indexOf(`className={\`${c}`) >= 0 ? modal.indexOf(`className={\`${c}`) : modal.indexOf(`className="${c}`))
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'deadline, policy check, Concur entry, Details')
  assert.ok(order.every(i => i > 0))
  assert.match(modal, /aria-expanded=\{details\}/)
  assert.match(modal, /const \[details, setDetails\] = useState\(false\)/, 'Details starts collapsed')
  assert.match(modal, /aria-label=\{done \? `\$\{f\.label\} copied` : `Copy \$\{f\.label\}`\}/)
  assert.match(modal, /const copiedFields = new Map\(\)/, 'copy ticks live in memory, never stored')
  assert.match(modal, /I confirm this is necessary for ASPIRE operations\./)
  assert.match(modal, /budgetStaff\('receipt_stage', \{ id: r\.id, to \}\)/)
  assert.match(modal, /budgetStaff\('receipt_policy_confirm', \{ id: r\.id, confirmed: on \}\)/)
  assert.match(modal, /budgetStaff\('receipt_late_note', \{ id: r\.id \}\)/)
  assert.match(modal, /disabled=\{foot\.disabled \|\| !!busy\} onClick=\{primary\}/)
  assert.match(modal, /undo\?\.id === r\.id && <button[^>]*onClick=\{doUndo\}>Undo<\/button>/)
  // The footer no longer carries Download, Show in Sheet or View original.
  const foot = modal.slice(modal.indexOf('<footer className="bud-rm-foot">'))
  assert.doesNotMatch(foot, /Download|Show in Sheet|View original/)
  // A P-card receipt never shows the Concur pieces.
  assert.match(modal, /\{stage && stage !== 'paid' && \(\s*<section className="bud-rm-concur"/)
  assert.match(modal, /Submitting \{batch\.label\} · \{batch\.ids\.indexOf\(r\.id\) \+ 1\} of \{batch\.ids\.length\}/)
  assert.match(filed, /notify\(`\$\{label\} submitted to Concur\.`\)/)
})

test('touch targets in the modal and the grid are at least 44px', () => {
  assert.match(css, /\.bud-rm \.bud-btn \{ min-height: 44px;/)
  assert.match(css, /\.bud-rm-icon \{[^}]*width: 44px; height: 44px;/)
  assert.match(css, /\.bud-rm-copy \{[^}]*width: 44px; height: 44px;/)
  assert.match(css, /\.bud-subm-cell \{[^}]*min-height: 44px;/)
})

test('the Subscriptions tab holds the month grid, a cell says its status in words and opens its receipt', () => {
  const subs = read('src/components/budget/BudgetSubscriptions.jsx')
  assert.match(subs, /\{canEdit && <SubscriptionMonths year=\{year\} onOpenReceipt=\{onOpenReceipt\} \/>\}/, 'the Owner’s view: receipts are the Owner’s')
  assert.match(grid, /\$\{usd\(c\.amount\)\}\$\{c\.kind === 'ok' \? '' : ` · \$\{c\.word\}`\}/, 'never colour alone')
  assert.match(grid, /aria-label=\{`\$\{c\.label\}\. Open the receipt\.`\} onClick=\{\(\) => onOpenReceipt\(c\.receiptId\)\}/)
  assert.match(grid, /<span className="bud-subm-cell k-expected">Expected<\/span>/)
  assert.match(grid, /className="aspire-th"/, 'the shared table header')
  assert.doesNotMatch(grid, /<th[^>]*style=/)
  const view = read('src/components/budget/ProgramBudgetView.jsx')
  assert.match(view, /onOpenReceipt=\{\(id\) => \{ setReceiptFocus\(id\); setTab\('receipts'\) \}\}/)
  assert.match(filed, /onGo\('subscriptions'\)\}>Subscriptions by month →/, 'linked from the Receipts toolbar')
  assert.match(modal, /onClick=\{onSubscriptions\}>See all subscriptions →/)
})
