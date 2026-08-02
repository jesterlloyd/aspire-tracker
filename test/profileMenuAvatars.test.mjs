// PROFILE-MENU-AVATARS-1: unified profile menus + self-service portal avatars.
//
// Menu system: the main-app UserMenu gains a Public site link (canonical domain,
// new tab, matching the portals); the shared portal ProfileMenu gains Change
// Photo, the student item reads My Profile, and the Student Portal's Public
// site converges on the same canonical URL and open behavior as UL/AP.
//
// Avatars: ONE canonical writer per role via POST /api/portal/my-avatar -
// students update the canonical students.headshot_url (private storage,
// server-derived path, replace only); Unit Leaders / Academic Partners update
// user_profiles.avatar_url with the matching Connect contact mirrored
// (avatar_url only). The caller can only ever change their own image.
//
// Run: node --test test/profileMenuAvatars.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const userMenu = read('src/components/UserMenu.jsx')
const shell = read('src/portal/PortalShell.jsx')
const app = read('src/portal/PortalApp.jsx')
const dialog = read('src/portal/ChangePhotoDialog.jsx')
const api = read('api/portal/my-avatar.js')
const css = read('src/portal/portal.css')

// ── Main app: Public site in the profile menu ────────────────────────────────

test('UserMenu links the canonical public site in a new tab, portal-style', () => {
  assert.match(userMenu, /import \{ CANONICAL_APP_URL \} from '\.\.\/lib\/appUrl'/)
  assert.match(userMenu, /href=\{CANONICAL_APP_URL\}/)
  assert.match(userMenu, /target="_blank" rel="noopener noreferrer"/)
  assert.match(userMenu, /Public site/)
  // Order: identity block -> Public site -> Settings -> Sign out.
  const publicIdx = userMenu.indexOf('Public site')
  const settingsIdx = userMenu.indexOf('navigate(\'/settings/general\')')
  const signOutIdx = userMenu.indexOf('Sign out')
  assert.ok(publicIdx > -1 && publicIdx < settingsIdx && settingsIdx < signOutIdx)
  // Existing self-photo controls are untouched.
  assert.match(userMenu, /Change Photo/)
  assert.match(userMenu, /Remove photo/)
  assert.match(userMenu, /rpc\('update_my_avatar'/)
})

// ── Portal menus: unified structure ──────────────────────────────────────────

test('the shared ProfileMenu offers Change Photo when wired, between profile and Public site', () => {
  assert.match(shell, /onChangePhoto && \(/)
  assert.match(shell, /> Change Photo<\/button>/)
  const profileIdx = shell.indexOf('> My Profile</button>')
  const photoIdx = shell.indexOf('> Change Photo</button>')
  const publicIdx = shell.indexOf('> Public site')
  const signOutIdx = shell.indexOf('> Sign out</button>')
  assert.ok(profileIdx > -1 && photoIdx > -1 && publicIdx > -1 && signOutIdx > -1)
  assert.ok(profileIdx < photoIdx && photoIdx < publicIdx && publicIdx < signOutIdx,
    'menu order must be profile item, Change Photo, Public site, ..., Sign out')
})

test('all three portals wire Change Photo, and the student Public site is canonical', () => {
  const mount = (title) => {
    const i = app.indexOf(`title="${title}"`)
    return app.slice(i, i + 500)
  }
  for (const title of ['Student Portal', 'Unit Leader Portal', 'Academic Partner Portal']) {
    assert.match(mount(title), /onChangePhoto=\{openChangePhoto\}/, `${title} must wire Change Photo`)
    assert.match(mount(title), /publicSiteUrl="https:\/\/aspireintelligence\.app"/, `${title} must use the canonical public site URL`)
  }
})

test('a Change Photo save refreshes the right identity without a reload', () => {
  // Student: bump the headshot cache key; UL/AP: refresh the auth profile
  // (avatar_url), which the portal header reads.
  assert.match(app, /const \[headshotVersion, setHeadshotVersion\] = useState\(0\)/)
  assert.match(app, /usePortalHeadshotUrl\(\{ enabled: isStudent, refreshKey: headshotVersion \}\)/)
  assert.match(app, /if \(isStudent\) setHeadshotVersion\(v => v \+ 1\)/)
  assert.match(app, /else refreshUserProfile\?\.\(\)/)
  assert.doesNotMatch(app, /window\.location\.reload/)
})

// ── Dialog: role-bound rules, fallback preserved ─────────────────────────────

test('ChangePhotoDialog enforces per-mode rules and never offers remove to students', () => {
  assert.match(dialog, /headshot: \{ types: \['image\/jpeg', 'image\/png'\], maxBytes: 5 \* 1024 \* 1024/)
  assert.match(dialog, /profile: {2}\{ types: \['image\/jpeg', 'image\/png', 'image\/webp'\], maxBytes: 2 \* 1024 \* 1024/)
  assert.match(dialog, /\{mode === 'profile' && hasPhoto && \(/)
  assert.match(dialog, /fetch\('\/api\/portal\/my-avatar'/)
  // Errors render inline; failures never crash the dialog.
  assert.match(dialog, /role="alert"/)
})

test('the portal header keeps its initials fallback and dialog styles are its own', () => {
  assert.match(shell, /: initials\(userName\)/)
  assert.match(css, /\.ptl-photo-dialog/)
  assert.match(css, /\.ptl-photo-backdrop/)
  assert.doesNotMatch(dialog, /className="ptl-btn-/, 'the dialog must not borrow shared ptl button classes')
})

// ── Endpoint: authorization and canonical writes ─────────────────────────────

test('my-avatar authorizes the caller server-side and accepts no target id', () => {
  assert.match(api, /verifyPortalCaller\(req\)/)
  assert.match(api, /hasActiveRoleGrant\(db, auth\.profile\.id, 'student'\)/)
  assert.match(api, /hasActiveRoleGrant\(db, auth\.profile\.id, 'unit_leader'\)/)
  assert.match(api, /hasActiveRoleGrant\(db, auth\.profile\.id, 'academic_partner'\)/)
  // The target derives ONLY from the verified identity - the body carries no
  // student_id / user_id / profile id of any kind.
  assert.doesNotMatch(api, /body\.student_id|body\.user_id|body\.profile_id|body\.target/)
  assert.match(api, /getActiveStudentLinks\(db, auth\.profile\.id\)/)
})

test('my-avatar validates like admin-avatar-upload: fixed type maps, size caps, magic bytes', () => {
  assert.match(api, /const PROFILE_TYPES = \{ 'image\/jpeg': 'jpg', 'image\/png': 'png', 'image\/webp': 'webp' \}/)
  assert.match(api, /const HEADSHOT_TYPES = \{ 'image\/jpeg': 'jpg', 'image\/png': 'png' \}/)
  assert.match(api, /PROFILE_MAX_BYTES = 2 \* 1024 \* 1024/)
  assert.match(api, /HEADSHOT_MAX_BYTES = 5 \* 1024 \* 1024/)
  assert.match(api, /function sniffType\(buf\)/)
  assert.match(api, /if \(sniffType\(buf\) !== contentType\)/)
})

test('student branch writes the ONE canonical headshot record, replace only, no raw path returned', () => {
  assert.match(api, /canonicalPath\(student\.cohort_id, student\.id, 'headshot', img\.ext\)/)
  assert.match(api, /from\(STUDENT_FILES_BUCKET\)\.upload\(cp\.path/)
  assert.match(api, /from\('students'\)\.update\(\{ headshot_url: cp\.path \}\)\.eq\('id', student\.id\)/)
  // Students never gain a second image record and cannot remove the headshot.
  assert.match(api, /error: 'remove_unsupported'/)
  const studentBranch = api.slice(api.indexOf('Student branch'), api.indexOf('Unit Leader / Academic Partner branch'))
  assert.doesNotMatch(studentBranch, /user_profiles.*avatar_url/, 'the student branch must not write user_profiles.avatar_url')
  assert.match(studentBranch, /json\(\{ success: true, kind: 'headshot' \}\)/, 'no storage path in the student response')
})

test('UL/AP branch writes user_profiles.avatar_url and mirrors ONLY avatar_url to the matched contact', () => {
  assert.match(api, /from\('user_profiles'\)\.update\(\{ avatar_url: publicUrl \}\)\.eq\('id', auth\.profile\.id\)/)
  assert.match(api, /normalizeEmailForLookup/)
  assert.match(api, /from\('contacts'\)\.update\(\{ avatar_url: value \}\)\.eq\('id', c\.id\)/)
  // Remove clears the mirror only when it still equals the removed profile URL,
  // so a manually curated contact photo survives.
  assert.match(api, /onlyIfCurrently/)
  assert.match(api, /from\('user_profiles'\)\.update\(\{ avatar_url: '' \}\)\.eq\('id', auth\.profile\.id\)/)
})

test('admin avatar changes now refresh the portal directory too', () => {
  const dir = read('src/components/settings/AccountsDirectory.jsx')
  const upload = dir.slice(dir.indexOf('const uploadPhoto'), dir.indexOf('const uploadPhoto') + 1400)
  assert.match(upload, /invalidateQueries\(\{ queryKey: \['people_access_users'\] \}\)/)
  assert.match(upload, /invalidateQueries\(\{ queryKey: \['portal_access_list'\] \}\)/)
})

test('existing avatar authorization boundaries are untouched', () => {
  const adminUpload = read('api/admin-avatar-upload.js')
  assert.match(adminUpload, /Gate 7: OWNER IMMUTABILITY/)
  assert.match(adminUpload, /Gate 8: SELF-TARGETING blocked/)
  assert.match(adminUpload, /Gate 10: admin callers may only act on interviewer\/viewer targets/)
  // The portal read endpoints stay the only student-headshot read paths.
  assert.match(read('src/lib/studentFileClient.js'), /\/api\/portal\/student-file-access/)
})
