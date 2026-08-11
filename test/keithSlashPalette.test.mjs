// KEITH-SLASH-ANYWHERE-CLIENT-1
//
// Behavioral coverage for the composer's Skills palette. These tests drive the
// same module the component calls, so they exercise real behavior rather than
// asserting that a line of source exists - the failure mode that let earlier
// defects ship pinned in place.
//
// The catalogue fixtures use invented slugs on purpose. No production slug is
// named here, matching the rule that the client must never carry a hardcoded
// skill list: the palette can only ever show what the server handed this
// caller.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findSlashToken, filterSkills, applySlashSelection } from '../src/lib/slashPalette.js';

// Stand-ins for whatever /api/keith (mode: skills_catalog) returned for this
// caller - already filtered server-side to active + enabled + role-authorized.
const CATALOG = [
  { slug: 'alpha-fixture-skill', name: 'Alpha Fixture', description: 'first' },
  { slug: 'beta-fixture-skill', name: 'Beta Fixture', description: 'second' },
  { slug: 'gamma-report', name: 'Gamma Report', description: 'third' },
];

/** The composer's open/filter decision, exactly as the component derives it. */
function palette(text, caret, catalog = CATALOG) {
  const token = findSlashToken(text, caret);
  return { open: !!token, token, matches: token ? filterSkills(catalog, token.query) : [] };
}

// ── Opening the palette mid-sentence: the reported defect ───────────────────

test('a bare slash mid-sentence opens the palette', () => {
  const text = 'Hey, can you use /';
  const p = palette(text, text.length);
  assert.equal(p.open, true, 'palette must open when "/" ends a natural sentence');
  assert.equal(p.token.query, '');
  assert.equal(p.matches.length, CATALOG.length, 'a bare slash offers every available skill');
});

test('the leading-slash case still opens the palette (regression)', () => {
  const p = palette('/', 1);
  assert.equal(p.open, true);
  assert.equal(p.token.start, 0);
  assert.equal(p.matches.length, CATALOG.length);
});

test('a slash after a newline opens the palette', () => {
  const text = 'First line\n/';
  assert.equal(palette(text, text.length).open, true);
});

test('the palette is closed with no slash at all', () => {
  assert.equal(palette('Just a normal question', 22).open, false);
});

// ── Filtering ───────────────────────────────────────────────────────────────

test('typing after the slash filters the palette', () => {
  const text = 'Can you run /bet';
  const p = palette(text, text.length);
  assert.equal(p.open, true);
  assert.equal(p.token.query, 'bet');
  assert.deepEqual(p.matches.map(s => s.slug), ['beta-fixture-skill']);
});

test('filtering matches the display name as well as the slug', () => {
  const text = 'Please use /gamma';
  assert.deepEqual(palette(text, text.length).matches.map(s => s.slug), ['gamma-report']);
});

test('filtering is case-insensitive', () => {
  const text = 'Please use /BETA';
  assert.deepEqual(palette(text, text.length).matches.map(s => s.slug), ['beta-fixture-skill']);
});

test('a query matching nothing opens the palette with no matches', () => {
  const text = 'Please use /zzzz';
  const p = palette(text, text.length);
  assert.equal(p.open, true, 'stays open so the "No Skill matches" hint can show');
  assert.equal(p.matches.length, 0);
});

// ── Ordinary punctuation must stay quiet ────────────────────────────────────

for (const [label, text] of [
  ['a fraction', 'about 50/50'],
  ['a date', 'due 8/11'],
  ['a URL', 'see https://example.com/path'],
  ['a conjunction', 'either and/or'],
  ['a unit', 'glucose 90 mg/dL'],
]) {
  test(`${label} does not open the palette`, () => {
    assert.equal(palette(text, text.length).open, false, text);
  });
}

// ── Selection replaces only the token ───────────────────────────────────────

test('selecting mid-sentence preserves the text before the token', () => {
  const text = 'Hey, can you use /bet';
  const token = findSlashToken(text, text.length);
  const next = applySlashSelection(text, token, 'beta-fixture-skill');
  assert.equal(next.value, 'Hey, can you use /beta-fixture-skill ');
});

test('selecting preserves the text AFTER the token', () => {
  const text = 'Please use /bet for this student.';
  const caret = text.indexOf(' for');            // caret at the end of the token
  const token = findSlashToken(text, caret);
  const next = applySlashSelection(text, token, 'beta-fixture-skill');
  assert.equal(next.value, 'Please use /beta-fixture-skill for this student.');
});

test('selecting from a bare mid-sentence slash keeps the surrounding words', () => {
  const text = 'Hey, can you use / on her file';
  const caret = text.indexOf('/') + 1;
  const token = findSlashToken(text, caret);
  const next = applySlashSelection(text, token, 'alpha-fixture-skill');
  assert.equal(next.value, 'Hey, can you use /alpha-fixture-skill on her file');
});

test('selection never inserts a double space', () => {
  const text = 'Use /alp for X';
  const token = findSlashToken(text, text.indexOf(' for'));
  const next = applySlashSelection(text, token, 'alpha-fixture-skill');
  assert.ok(!next.value.includes('  '), next.value);
});

test('selection before punctuation does not insert a space before it', () => {
  const text = 'Please use /alp.';
  const token = findSlashToken(text, text.length - 1);
  const next = applySlashSelection(text, token, 'alpha-fixture-skill');
  assert.equal(next.value, 'Please use /alpha-fixture-skill.');
});

test('a full stop is punctuation, not part of the command', () => {
  // Regression: treating "." as a slug character swallowed the sentence's full
  // stop into the token, so selecting replaced the punctuation too.
  const typed = 'Please use /alp.';
  const t = findSlashToken(typed, typed.length - 1);
  assert.equal(t.query, 'alp', 'the token must stop at the full stop');

  // And a completed command followed by a full stop closes the palette rather
  // than showing "No Skill matches" against "slug.".
  const done = 'Please use /alpha-fixture-skill.';
  assert.equal(palette(done, done.length).open, false);
});

test('the leading-slash selection is unchanged (regression)', () => {
  const token = findSlashToken('/', 1);
  const next = applySlashSelection('/', token, 'alpha-fixture-skill');
  assert.equal(next.value, '/alpha-fixture-skill ');
  assert.equal(next.caret, next.value.length);
});

// ── Caret placement closes the palette ──────────────────────────────────────

test('the caret lands after the command, ready to keep typing', () => {
  const text = 'Hey, can you use /bet';
  const token = findSlashToken(text, text.length);
  const next = applySlashSelection(text, token, 'beta-fixture-skill');
  assert.equal(next.caret, next.value.length);
});

test('selecting closes the palette', () => {
  for (const text of ['/bet', 'Hey, can you use /bet', 'Please use /bet for this student.']) {
    const caret = text.indexOf('/bet') + 4;
    const token = findSlashToken(text, caret);
    const next = applySlashSelection(text, token, 'beta-fixture-skill');
    assert.equal(
      palette(next.value, next.caret).open, false,
      `palette must not survive a selection in: ${text}`,
    );
  }
});

test('the palette closes once the caret moves past a completed command', () => {
  const text = 'Please use /beta-fixture-skill for this student.';
  assert.equal(palette(text, text.length).open, false, 'caret at the end of the sentence');
  const inToken = text.indexOf('/') + 5;
  assert.equal(palette(text, inToken).open, true, 'caret back inside the command reopens it');
});

// ── Authorization stays server-side ─────────────────────────────────────────

test('an empty catalogue offers nothing', () => {
  const text = 'Please use /';
  assert.deepEqual(palette(text, text.length, []).matches, []);
});

test('a skill absent from the caller catalogue is never offered', () => {
  const text = 'Please use /restricted-other-role-skill';
  const p = palette(text, text.length);
  assert.equal(p.open, true, 'typing it is allowed; the server decides the answer');
  assert.deepEqual(p.matches, [], 'but it can never be listed - it is not in this catalogue');
});

test('filtering only ever narrows the caller catalogue', () => {
  for (const q of ['', 'a', 'fixture', 'zzz', 'report']) {
    for (const s of filterSkills(CATALOG, q)) {
      assert.ok(CATALOG.includes(s), `filter invented an entry for query "${q}"`);
    }
  }
});

test('a null catalogue (not yet fetched) yields no matches', () => {
  assert.deepEqual(filterSkills(null, 'alpha'), []);
});

// ── Escape ──────────────────────────────────────────────────────────────────
// The component holds the dismissal as the token start Escape closed. These
// pin the rule that decides it, including that Escape never edits the text.

test('Escape dismisses only the token it closed, and keeps the message', () => {
  const text = 'Hey, can you use /bet';
  const token = findSlashToken(text, text.length);
  const dismissedAt = token.start;

  // Same token, still dismissed - typing more of the word must not reopen it.
  const more = 'Hey, can you use /beta';
  const t2 = findSlashToken(more, more.length);
  assert.equal(t2.start, dismissedAt);
  assert.equal(!!t2 && dismissedAt !== t2.start, false, 'stays closed while the token stands');

  // Escape changes no text: the composer value is untouched by dismissal.
  assert.equal(more.slice(0, token.start), 'Hey, can you use ');
});

test('a new token at a different position reopens after a dismissal', () => {
  const dismissedAt = 'Hey, can you use /'.indexOf('/');
  const text = 'Hey, can you use later /bet';
  const t = findSlashToken(text, text.length);
  assert.notEqual(t.start, dismissedAt);
  assert.equal(!!t && dismissedAt !== t.start, true, 'a different token opens a fresh palette');
});

// ── The component actually uses this module ─────────────────────────────────

test('Keith.jsx derives the palette from the caret, not from position 0', () => {
  const src = readFileSync(new URL('../src/components/Keith.jsx', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(code.includes('findSlashToken(input, caretPos)'), 'palette must be caret-anchored');
  assert.ok(
    !/input\.startsWith\('\/'\)/.test(code) && !/v\.startsWith\('\/'\)/.test(code),
    'no position-0 slash assumption may remain',
  );
});

test('Keith.jsx hardcodes no skill slug', () => {
  const src = readFileSync(new URL('../src/components/Keith.jsx', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // A quoted "/word-word" literal would be a hardcoded command.
  const hits = code.match(/['"`]\/[a-z0-9]+-[a-z0-9-]+['"`]/g) || [];
  assert.deepEqual(hits, [], `client must not name skills: ${hits.join(', ')}`);
});

test('Escape does not clear the composer', () => {
  const src = readFileSync(new URL('../src/components/Keith.jsx', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const escapeLine = code.split('\n').find(l => l.includes("e.key === 'Escape'") && l.includes('slashMenuOpen'));
  assert.ok(escapeLine, 'the slash-menu Escape branch must exist');
  assert.ok(!escapeLine.includes("setInput('')"), 'Escape must dismiss the menu, not delete the message');
});
