import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

test('Classic Outreach is one presentation skin over the existing workflows', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')
  assert.match(outreach, /const classicDesk = appearanceStyle !== 'modern'/)
  assert.match(outreach, /outreach-workspace-classic/)
  assert.match(outreach, /Correspondence Desk/)
  assert.match(outreach, /recipientMode === 'single'/)
  assert.match(outreach, /recipientMode === 'bulk'/)
  assert.match(outreach, /recipientMode === 'history'/)
  assert.match(outreach, /<BulkManualComposer/)
  assert.match(outreach, /<SentHistory/)
})

test('the correspondence skin keeps physical materials warm in Dark mode', () => {
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')
  assert.match(css, /--ocd-paper: #fffdf7/)
  assert.match(css, /--ocd-leather: #26314f/)
  assert.doesNotMatch(css, /data-theme=['"]dark['"]/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
})

test('the composer spacing is compact and its writing canvas is visibly white', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')
  assert.match(outreach, /padding: '0 24px 20px'/)
  assert.match(outreach, /marginBottom: 12, display: 'flex'/)
  assert.match(css, /\.outreach-workspace-classic \.rte-content \{[^}]*background: #fff;/s)
})

test('direct email preview is revealed by the draft action and owns the confirming send', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')
  assert.match(outreach, /\{!dmConfirmOpen && \(\s*<ConnectPanel tone="draft" title="Draft" className="outreach-draft-panel">/s)
  assert.match(outreach, /\{dmConfirmOpen && \(\s*<div className="outreach-email-preview-pane">\s*<ConnectPanel[\s\S]*tone="preview"[\s\S]*title="Email Preview"[\s\S]*className="outreach-preview-panel"/s)
  assert.doesNotMatch(outreach, /dmPreviewRef|scrollIntoView/)
  const previewStart = outreach.indexOf('<div className="outreach-email-preview-pane">')
  const preview = outreach.slice(previewStart, outreach.indexOf('</ConnectPanel>', previewStart))
  assert.match(preview, /onClick=\{handleDmSend\}/)
  assert.match(preview, /'Send Email'/)
  assert.match(preview, /Back to Draft/)
  assert.doesNotMatch(preview, /marginTop: 14/)
})

test('the supplied metaphor is restrained and uses the live editor', () => {
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')
  const editor = read('src/components/connect/RichTextEditor.jsx')
  assert.match(css, /outreach-rich-editor-carriage/)
  assert.match(editor, /<EditorContent editor=\{editor\} \/>/)
  assert.doesNotMatch(css, /typewriter-key|typing-sound|moving-carriage|distressed/)
})

test('Classic recipient files use a stable clipboard clip outside source-switched content', () => {
  const panel = read('src/components/connect/ConnectPanel.jsx')
  const outreach = read('src/components/connect/OutreachView.jsx')
  const bulk = read('src/components/connect/BulkManualComposer.jsx')
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')

  assert.match(panel, /clipboard && <span className="outreach-clipboard-clip" aria-hidden="true">/)
  assert.match(outreach, /title="Recipient Card"[\s\S]*className="outreach-recipient-file outreach-recipient-file-single"[\s\S]*clipboard[\s\S]*bodyClassName="outreach-recipient-file-body"/)
  assert.match(bulk, /className="outreach-recipient-file outreach-recipient-file-bulk"[\s\S]*clipboard[\s\S]*bodyClassName="outreach-recipient-file-body"/)
  assert.match(css, /\.outreach-workspace-classic \.outreach-recipient-file \{[\s\S]*overflow: visible !important;/)
  assert.match(css, /\.outreach-workspace-classic \.outreach-correspondence-files > \.outreach-recipient-file \{[\s\S]*overflow: visible !important;/)
  assert.match(css, /content: 'ADDRESS FILE'/)
  assert.doesNotMatch(css, /\.outreach-bulk-manual > \.connect-panel:first-child::before/)
})

test('composer desks use the measured viewport while Sent History keeps its full board', () => {
  const connect = read('src/pages/Connect.jsx')
  const outreach = read('src/components/connect/OutreachView.jsx')
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')
  const viewport = read('src/components/student/useChartViewport.js')

  assert.match(connect, /<OutreachView[\s\S]*viewportHeight=\{bookHeight\}/)
  assert.match(connect, /viewportTop=\{workspaceTop\}/)
  assert.match(outreach, /'--outreach-desk-h': viewportHeight \? `\$\{viewportHeight\}px` : undefined/)
  assert.match(outreach, /'--outreach-desk-top': viewportTop != null \? `\$\{viewportTop\}px` : undefined/)
  assert.match(viewport, /return \{ barRef, chartHeight, toolbarTop, chartTop \}/)
  assert.match(css, /--ocd-plaque-clearance: 24px;/)
  assert.match(css, /--ocd-desk-bottom-extension: 10px;/)
  assert.match(css, /\.outreach-desk-plaque \{[\s\S]*top: -15px;[\s\S]*padding: 5px 17px;[\s\S]*font-size: 10px;/)
  assert.match(css, /\.outreach-workspace-classic \.outreach-desk-shell \{[\s\S]*border: 6px solid var\(--ocd-wood\);[\s\S]*background: var\(--ocd-leather\);/)
  assert.match(css, /\.outreach-workspace-classic \.outreach-desk-shell\[data-outreach-mode='single'\],[\s\S]*data-outreach-mode='bulk'[\s\S]*position: sticky;[\s\S]*top: calc\(var\(--outreach-desk-top[\s\S]*height: calc\(var\(--outreach-desk-h/)
  assert.match(css, /@media \(max-width: 840px\)[\s\S]*data-outreach-mode='bulk'\] \{ position: relative; top: auto; height: auto;/)
  assert.doesNotMatch(css, /\.outreach-workspace-classic \.outreach-desk-shell\[data-outreach-mode='history'\][^{]*\{[^}]*height:/s)
})

test('direct email preview replaces the draft within the same paper column', () => {
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')

  assert.match(css, /\.outreach-workspace-classic \.outreach-email-preview-pane \{[\s\S]*display: flex;[\s\S]*flex: 1 1 0;[\s\S]*min-height: 0;/)
  assert.match(css, /\.outreach-workspace-classic \.outreach-email-preview-pane > \.connect-panel \{[\s\S]*flex: 1 1 0;[\s\S]*overflow-y: auto;/)
})

test('direct message addressing stays compact and uses To, CC, Subject, Message order in both themes', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')
  const draft = outreach.slice(outreach.indexOf('<ConnectPanel tone="draft" title="Draft"'), outreach.indexOf('Keep draft controls together'))

  const ordered = [
    'className="outreach-address-to"',
    'className="outreach-address-cc"',
    'className="outreach-address-subject"',
    'className="outreach-message-body"',
  ].map(marker => draft.indexOf(marker))
  assert.ok(ordered.every(index => index >= 0))
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered)
  assert.doesNotMatch(draft, /classicDesk &&[\s\S]{0,100}outreach-address-to/)
  assert.match(css, /\.outreach-workspace-classic \.outreach-address-to,[\s\S]*margin-bottom: 8px !important;/)
  assert.match(css, /\.outreach-workspace-classic \.outreach-message-body \{[\s\S]*flex: 1 1 330px;[\s\S]*min-height: 330px;/)
  assert.match(css, /\.outreach-workspace-modern \.outreach-address-value \{[\s\S]*min-height: 34px;/)
})

test('bulk email preview replaces the draft and owns the next review action', () => {
  const bulk = read('src/components/connect/BulkManualComposer.jsx')

  assert.match(bulk, /\{!previewOpen && \(\s*<ConnectPanel[\s\S]*tone="draft"[\s\S]*title="Draft"[\s\S]*className="outreach-draft-panel"/s)
  assert.match(bulk, /\{previewOpen && \(\s*<div className="outreach-email-preview-pane outreach-bulk-preview-pane">\s*<ConnectPanel[\s\S]*tone="preview"[\s\S]*title="Email Preview"[\s\S]*className="outreach-preview-panel"/s)
  assert.match(bulk, /className="outreach-preview-secondary"[\s\S]*Back to Draft/)
  assert.match(bulk, /className="outreach-primary-action"[\s\S]*setReviewOpen\(true\)[\s\S]*Continue to final review/)
  assert.doesNotMatch(bulk, /title="Email Preview" padding=\{24\} style=\{\{ marginTop: 14 \}\}/)
})

test('Modern single and bulk papers align and keep draft actions in one control row', () => {
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')

  assert.match(css, /\.outreach-workspace-modern \.outreach-single-layout,[\s\S]*\.outreach-workspace-modern \.outreach-bulk-manual,[\s\S]*\.outreach-workspace-modern \.outreach-bulk-survey-layout \{[\s\S]*align-items: stretch !important;[\s\S]*flex-wrap: nowrap !important;/)
  assert.match(css, /\.outreach-workspace-modern \.outreach-bulk-manual > \.connect-panel,[\s\S]*max-height: none !important;/)
  assert.match(css, /\.outreach-workspace-modern \.outreach-draft-action-main \{[\s\S]*display: flex;[\s\S]*align-items: center;[\s\S]*flex-wrap: wrap;/)
  assert.match(css, /\.outreach-workspace-modern \.outreach-draft-action-meta \{[\s\S]*margin-left: auto;/)
  assert.match(css, /\.outreach-workspace-modern \.outreach-discard-draft \{[\s\S]*border-radius: var\(--aspire-radius-pill, 999px\);/)
})

test('Modern composers fill the measured viewport and scroll inside fixed panes', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')
  const bulk = read('src/components/connect/BulkManualComposer.jsx')
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')

  assert.match(css, /@media \(min-width: 841px\)[\s\S]*\.outreach-workspace-modern \.outreach-desk-shell\[data-outreach-mode='single'\],[\s\S]*data-outreach-mode='bulk'[\s\S]*position: sticky;[\s\S]*top: var\(--outreach-desk-top, 156px\);[\s\S]*height: var\(--outreach-desk-h, calc\(100dvh - 180px\)\);/)
  assert.match(css, /\.outreach-workspace-modern \.outreach-single-layout,[\s\S]*\.outreach-bulk-survey-layout \{[\s\S]*height: 100%;[\s\S]*min-height: 0;/)
  assert.match(css, /\.outreach-workspace-modern \.outreach-bulk-manual \.outreach-recipient-file-body,[\s\S]*\.outreach-workspace-modern \.outreach-bulk-survey-results \{[\s\S]*overflow-y: auto;/)
  assert.match(bulk, /bodyClassName="outreach-recipient-file-body"[\s\S]*bodyStyle=\{\{ minHeight: 0, overflowY: 'auto' \}\}/)
  assert.match(bulk, /className="outreach-draft-panel"[\s\S]*bodyClassName=\{classicDesk \? '' : 'outreach-draft-scroll'\}/)
  assert.match(outreach, /className="outreach-bulk-survey-results"/)
  assert.doesNotMatch(bulk, /maxHeight: 'calc\(100dvh - 280px\)'/)
})

test('Modern direct preview expands its email viewport instead of leaving blank paper', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')

  assert.match(outreach, /bodyClassName=\{classicDesk \? '' : 'outreach-preview-scroll outreach-preview-expand'\}/)
  assert.match(outreach, /className="outreach-preview-frame"/)
  assert.match(outreach, /className="outreach-preview-iframe outreach-preview-iframe-expand"/)
  assert.match(css, /\.outreach-workspace-modern \.outreach-preview-expand \.outreach-preview-frame \{[\s\S]*flex: 1 1 520px;[\s\S]*min-height: 520px;/)
  assert.match(css, /\.outreach-workspace-modern \.outreach-preview-iframe-expand \{[\s\S]*height: 100%;/)
})

test('bulk papers share one bottom edge and the obsolete scaffolding subtitle is gone', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')

  assert.doesNotMatch(outreach, /Bulk Operation, Phase 3A scaffolding/)
  assert.match(css, /\.outreach-workspace-classic \.outreach-bulk-manual > \.connect-panel,[\s\S]*\.outreach-bulk-survey-layout > \.connect-panel \{[\s\S]*height: 100%;[\s\S]*max-height: none !important;/)
  const bulkSelector = outreach.slice(outreach.indexOf('const renderBulkTypeSelector'), outreach.indexOf('// Escape closes', outreach.indexOf('const renderBulkTypeSelector')))
  assert.match(bulkSelector, /alwaysShowOther/)
  assert.doesNotMatch(bulkSelector, /bulkOtherOpen|onToggleOther/)
})

test('single and bulk drafts use one compact action row beneath the editor', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')
  const bulk = read('src/components/connect/BulkManualComposer.jsx')
  const css = read('src/components/connect/outreachCorrespondenceDesk.css')

  assert.match(outreach, /className="outreach-draft-action-bar"[\s\S]*Attach(?:mentPicker)?[\s\S]*Include my email signature[\s\S]*Send Email[\s\S]*className="outreach-draft-action-meta"[\s\S]*Draft saved[\s\S]*Discard draft/)
  assert.match(bulk, /className="outreach-draft-action-bar outreach-bulk-action-row"[\s\S]*<AttachmentPicker[\s\S]*Include my email signature[\s\S]*className="outreach-primary-action"[\s\S]*Review & send/)
  assert.doesNotMatch(bulk, /const panelCard =/)
  assert.match(css, /\.outreach-workspace-classic \.outreach-bulk-action-row \{[\s\S]*position: static;[\s\S]*background: transparent !important;[\s\S]*box-shadow: none !important;/)
  assert.match(css, /button\.outreach-primary-action \{[\s\S]*border-radius: var\(--ocd-r-8\) !important;/)
  assert.match(css, /button\.outreach-discard-draft \{[\s\S]*border-radius: var\(--aspire-radius-pill\) !important;/)
})

test('the To line never reuses a previous recipient preview', () => {
  const outreach = read('src/components/connect/OutreachView.jsx')

  assert.match(outreach, /dmPreview\.recipientKey === draftRecipientId \? dmPreview\.recipient\?\.email : ''/)
  assert.match(outreach, /fetchedStudent\?\.id === studentId \? fetchedStudent\.school_email : ''/)
  assert.match(outreach, /fetchedContact\?\.id === contactId \? fetchedContact\.email : ''/)
  assert.match(outreach, /const previewRecipientKey = `\$\{recipientType\}:\$\{rid\}`/)
  assert.match(outreach, /if \(!rid \|\| !msgBody\.trim\(\)\) \{\s*setDmPreview\(\{ recipientKey: null, html: '', recipient: null,/)
})

test('Settings documents Outreach as a shipped correspondence desk surface', () => {
  const appearance = read('src/lib/appearance.js')
  const settings = read('src/components/settings/AppearancePanel.jsx')
  assert.match(appearance, /key: 'outreach', label: 'Outreach', material: 'Correspondence desk', modern: true/)
  assert.match(settings, /address book, the correspondence desk/)
})
