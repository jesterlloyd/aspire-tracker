// test/s37ShellEscaping.test.mjs
//
// S-37: the shared email shell escapes its preheader and the organization fields itself, so a
// student's or respondent's name can never become live markup in the hidden preview div or the
// footer, whichever caller built the sentence. The contract is "the preheader is plain text and
// the shell escapes it", so no caller may escape it first (that would double-escape and show a
// reader "&amp;lt;"). These tests render the real shell and the three builders the register
// named, and sweep every shell caller. Nothing here sends email.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { aspireEmailShell, applyOrganizationBranding } from '../lib/server/email/aspireShell.js'
import { interviewBookedEmail } from '../lib/server/email/interviewBooked.js'
import { invitationEmail as formInvitation, forwardEmail } from '../lib/server/forms/mail.js'
import { invitationEmail as signInvitation } from '../lib/server/signatures/mail.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

// A last name that closes the hidden div and shows a link, as the register's exploit describes.
const NAME = `Doe</div><a href="https://evil.example">Reset your password</a><div>`
const ESCAPED_NAME = 'Doe&lt;/div&gt;&lt;a href=&quot;https://evil.example&quot;&gt;Reset your password&lt;/a&gt;&lt;div&gt;'
const DOUBLE = ['&amp;lt;', '&amp;gt;', '&amp;quot;', '&amp;#39;', '&amp;amp;']

function preheaderDiv(html) {
  const start = html.indexOf('<div style="display:none')
  assert.ok(start >= 0, 'the shell emits a hidden preheader div')
  return html.slice(start, html.indexOf('</div>', start))
}

function assertTextOnly(html, label) {
  const div = preheaderDiv(html)
  assert.ok(!div.includes('<a href'), `${label}: a live link survived in the preheader`)
  assert.ok(html.includes(ESCAPED_NAME), `${label}: the name is present, escaped`)
  for (const m of DOUBLE) assert.ok(!html.includes(m), `${label}: double escape ${m}`)
}

test('S-37: the shell escapes the preheader exactly once and keeps ordinary text readable', () => {
  const html = aspireEmailShell({ body: '<p>x</p>', preheader: `${NAME} self-scheduled.` })
  assertTextOnly(html, 'shell')
  const plain = aspireEmailShell({ body: '', preheader: "O'Brien & Sons" })
  assert.ok(preheaderDiv(plain).includes('O&#39;Brien &amp; Sons'))
  // The body is trusted HTML and is not touched.
  assert.ok(html.includes('<p>x</p>'))
})

test('S-37: the organization fields are escaped in the header, footer and alt text', () => {
  const organization = {
    display_name: 'Acme <script>alert(1)</script> Health',
    logo_alt_text: 'logo" onerror="alert(1)',
    header_logo_url: 'https://example.org/a.png?x=1&y=2',
    address_line_1: '1 <b>Main</b> St',
    city: 'LA',
    general_email: 'help@example.org<img src=x>',
  }
  const html = aspireEmailShell({ body: '', preheader: '', organization })
  assert.ok(!html.includes('<script>'), 'display_name markup is inert')
  assert.ok(html.includes('Acme &lt;script&gt;alert(1)&lt;/script&gt; Health &bull; ASPIRE Intelligence'))
  assert.ok(html.includes('alt="logo&quot; onerror=&quot;alert(1)"'), 'alt stays inside its quotes')
  assert.ok(html.includes('src="https://example.org/a.png?x=1&amp;y=2"'), 'the URL is attribute-escaped, once')
  assert.ok(html.includes('1 &lt;b&gt;Main&lt;/b&gt; St, LA'))
  assert.ok(html.includes('email us at help@example.org&lt;img src=x&gt;.'))
  for (const m of DOUBLE) assert.ok(!html.includes(m), `double escape ${m}`)
  // The branding substitution escapes the same fields.
  const branded = applyOrganizationBranding('Cedars-Sinai Medical Center &bull; 8700 Beverly Blvd, Los Angeles, CA 90048', organization)
  assert.ok(!branded.includes('<script>'))
  assert.ok(branded.includes('Acme &lt;script&gt;alert(1)&lt;/script&gt; Health &bull; 1 &lt;b&gt;Main&lt;/b&gt; St, LA'))
})

test('S-37: a student name containing markup renders as text in the interview-booked email', () => {
  const { html } = interviewBookedEmail({ studentName: NAME, studentSchool: 'S', studentProgram: 'BSN', studentEmail: 's@example.edu', interviewDate: 'Monday, October 6', interviewTime: '9:00 AM', duration: 30, interviewerName: 'I' })
  assertTextOnly(html, 'interviewBooked')
})

test('S-37: a respondent name containing markup renders as text in the form invitation and the forward to an outside office', () => {
  const assignment = { name: NAME, email: 's@example.edu', sender_name: `Sender ${NAME}`, subject: '', message: '', due_at: null }
  assertTextOnly(formInvitation({ assignment, title: 'ScrubEx Request', url: 'https://aspireintelligence.app/form#t=x' }).html, 'form invitation')
  assertTextOnly(forwardEmail({ assignment, title: 'ScrubEx Request', school: 'CSUN' }).html, 'form forward')
})

test('S-37: a request title or sender containing markup renders as text in the signature invitation', () => {
  const request = { title: NAME, sender_name: 'ASPIRE', subject: '', message: '', expires_at: null }
  const signer = { name: 'Signer', email: 's@example.edu', recipient_type: 'signer' }
  assertTextOnly(signInvitation({ request, signer, url: 'https://aspireintelligence.app/sign/x' }).html, 'signature invitation')
})

// Every file that calls the shell: a line that names `preheader` must not escape, or the reader
// sees a double escape. The sweep covers lib/, api/ and src/.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx|mjs)$/.test(name)) out.push(p)
  }
  return out
}

test('S-37: no shell caller escapes its preheader itself (the shell does it)', () => {
  const files = ['lib', 'api', 'src'].flatMap(d => walk(join(root, d)))
    .filter(f => readFileSync(f, 'utf8').includes('aspireEmailShell'))
    .filter(f => !f.endsWith('lib/server/email/aspireShell.js'))
  assert.ok(files.length >= 30, `the sweep found ${files.length} callers`)
  const offenders = []
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((l, i) => {
      if (/^\s*\/\//.test(l)) return
      if (/preheader/.test(l) && /esc(ape)?Html\(/.test(l)) offenders.push(`${f.slice(root.length + 1)}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [])
  const shell = read('lib/server/email/aspireShell.js')
  assert.match(shell, /const safePreheader = escapeHtml\(preheader\)/)
  assert.match(shell, /overflow:hidden;">\$\{safePreheader\}<\/div>/)
})

test('S-37: the register records the finding as Closed', () => {
  const reg = read('docs/security/FINDINGS_REGISTER.md')
  const entry = reg.slice(reg.indexOf('## S-37.'), reg.indexOf('## S-38.'))
  assert.match(entry, /\*\*Status\*\*: Closed/)
  assert.doesNotMatch(entry, /\u2014/)
})
