// Commit 2: the Student Edit Profile drawer converges on the approved student-profile identity
// language (sky-blue header, circular photo, centred name) via a shared, role-neutral primitive
// (ProfileIdentityHero). The student-only data boundaries are preserved: only preferred name and
// phone are editable, authoritative fields stay read-only with Request a correction, and no
// staff-only field or control is exposed just because the visual shell is shared.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const hero = read('src/components/portal/ProfileIdentityHero.jsx')
const drawer = read('src/portal/EditProfileDrawer.jsx')
const drawerCode = stripJs(drawer)
const css = read('src/portal/portal.css')

test('the shared identity hero is a reusable, presentational primitive with its own classes', () => {
  assert.ok(existsSync(join(here, '..', 'src/components/portal/ProfileIdentityHero.jsx')))
  // Role-neutral props; no data fetching, no role-specific fields.
  assert.match(hero, /export default function ProfileIdentityHero\(\{ name, photoUrl = null, subtitle = null/)
  assert.match(hero, /className="ptl-idhero"/)
  assert.match(hero, /className="ptl-idhero-photo"/)
  assert.doesNotMatch(hero, /fetch\(|supabase|api\/|getStudentFileUrl/)   // presentational only
  // Owns its own class namespace (does not reuse another component's .ptl-detail-* classes).
  assert.doesNotMatch(hero, /ptl-detail-/)
  // Photo with an initials fallback.
  assert.match(hero, /photoUrl && !broken/)
  assert.match(hero, /: <span className="ptl-idhero-initials">\{initials\(name\)\}<\/span>/)
})

test('the identity hero CSS reproduces the approved sky-blue + circular-photo language', () => {
  assert.match(css, /\.ptl-idhero \{[\s\S]*?linear-gradient\(160deg, #dceff8 0%, #f0f6fb 50%, #ffffff 100%\)/)
  assert.match(css, /\.ptl-idhero-photo \{[\s\S]*?border-radius: 50%/)
  assert.match(css, /\.ptl-idhero-photo img \{ width: 100%; height: 100%; object-fit: cover; \}/)
})

test('the Edit Profile drawer leads with the identity hero and the student\'s own photo', () => {
  assert.match(drawer, /import ProfileIdentityHero from '\.\.\/components\/portal\/ProfileIdentityHero'/)
  assert.match(drawer, /<ProfileIdentityHero[\s\S]*?photoUrl=\{headshotUrl\}[\s\S]*?subtitle=\{student\?\.school \|\| null\}/)
  // The photo comes in as a prop (the caller resolves the student's OWN server-mediated headshot).
  assert.match(drawer, /headshotUrl = null/)
  // Close control floats over the hero; the focus-trap initial target is preserved on it.
  assert.match(drawer, /className="ptl-icon-btn ptl-edit-close" aria-label="Close"/)
  assert.match(drawer, /data-drawer-initial/)
  assert.match(css, /\.ptl-edit-close \{ position: absolute;/)
})

test('student-only data boundaries are preserved (no staff-only fields or controls)', () => {
  // Still edits ONLY the two non-authoritative fields through the same secure endpoint.
  assert.match(drawer, /\/api\/portal\/update-profile/)
  assert.match(drawer, /preferred_first_name: preferred\.trim\(\), phone: phone\.trim\(\)/)
  // Authoritative details remain read-only with Request a correction.
  assert.match(drawer, /Managed by ASPIRE/)
  assert.match(drawer, /Request a correction/)
  // None of the Unit Leader / staff-only student fields leak in just because the shell is shared.
  for (const forbidden of [
    'support_needed', 'learning_highlight', 'review_reason', 'evaluations',
    'resume', 'preceptor', 'ptl-detail-manage', 'getStudentFileUrl',
  ]) {
    assert.ok(!drawerCode.includes(forbidden), `edit drawer must not expose ${forbidden}`)
  }
})

test('no new image assets were introduced for the identity hero', () => {
  // The hero is CSS + an <img> bound to the passed-in photo URL; it defines no artwork.
  assert.doesNotMatch(hero, /\.png|\.svg|\.jpg|illustrations\/|new Image/i)
})
