import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

test('one shared pill owns back and refresh presentation', () => {
  const component = read('src/components/ui/NavigationPill.jsx')
  const css = read('src/components/ui/navigationPill.css')
  assert.match(component, /export function BackPill/)
  assert.match(component, /export function RefreshPill/)
  assert.match(component, /icon=\{RotateCw\}/)
  assert.match(component, /disabled=\{disabled \|\| loading\}/)
  assert.match(component, /aria-busy=\{loading \|\| undefined\}/)
  assert.match(css, /\.nav-pill:focus-visible[\s\S]*box-shadow: 0 0 0 3px #93c5fd/)
  assert.match(css, /\.nav-pill:hover:not\(:disabled\)[\s\S]*background: rgba\(29, 37, 103, 0\.04\)/)
  assert.match(css, /\.nav-pill:active:not\(:disabled\)[\s\S]*background: var\(--color-accent-primary/)
  assert.match(css, /\.nav-pill-icon-spin/)
})

test('workspace back remains context-aware and delegates only its presentation', () => {
  const source = read('src/components/ui/WorkspaceBackLink.jsx')
  assert.match(source, /navigate\(path\)/)
  assert.match(source, /label=\{`Back to \$\{label\}`\}/)
  assert.match(source, /<BackButton/)
})

test('refresh behavior is unchanged while using the canonical pill', () => {
  const source = read('src/components/UnifiedNav.jsx')
  assert.match(source, /const handleClick = onClick \?\? \(\(\) => window\.location\.reload\(\)\)/)
  assert.match(source, /<RefreshPill onClick=\{handleClick\} disabled=\{isDisabled\} loading=\{loading\} \/>/)
})

test('every Back to surface uses BackButton', () => {
  const surfaces = [
    'src/components/InterviewRubricTab.jsx',
    'src/components/RubricSession.jsx',
    'src/components/connect/messages/MessagesWorkspace.jsx',
    'src/components/settings/KnowledgeVersionHistory.jsx',
    'src/components/settings/SettingsShell.jsx',
    'src/components/shift-log-lifecycle/ShiftLogLifecycle.jsx',
    'src/pages/Login.jsx',
    'src/pages/ResetPasswordPage.jsx',
    'src/pages/SurveyTestModePage.jsx',
    'src/portal/StudentShiftLog.jsx',
    'src/portal/messages/PortalMessagesThread.jsx',
  ]
  for (const path of surfaces) assert.match(read(path), /<BackButton\b/, path)
})

test('Interview Rubric unlock action uses the same canonical pill shape', () => {
  const source = read('src/components/RubricSession.jsx')
  assert.match(source, /<NavigationPill onClick=\{\(\) => setConfirmUnlock\(true\)\}>Unlock to Edit<\/NavigationPill>/)
})
