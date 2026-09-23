// Cross-workspace regression guards for interactive KPI cards. Dynamic scope
// values must fail back to a visible All option, and KPI populations must match
// the rows their cards reveal.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(here, '..', path), 'utf8')

const evaluation = read('src/components/EvaluationTab.jsx')
const applicants = read('src/components/ngrp/ProfilesTab.jsx')
const benefit = read('src/portal/na/CommunityBenefitView.jsx')
const contacts = read('src/portal/na/AcademicsContactsView.jsx')
const catalog = read('src/components/catalog/CatalogPage.jsx')
const knowledge = read('src/components/settings/KnowledgeCenterPanel.jsx')

test('Evaluation ignores instrument and timepoint selections absent from the current cohort', () => {
  // RESPONSES-PACKET-1: the instrument is a file tab keyed by slug. A slug this build does
  // not know falls back to the first tab, never to nothing.
  assert.match(evaluation, /const chosenInstrument = PACKET_SLUGS\.includes\(filterInstrument\) \? filterInstrument : DEFAULT_PACKET_SLUG/)
  assert.match(evaluation, /const activeInstrumentFilter = userPickedInstrument \? chosenInstrument : \(firstWithRows \|\| chosenInstrument\)/)
  assert.match(evaluation, /const activeTimepointFilter = timepoints\.includes\(filterTimepoint\) \? filterTimepoint : 'All'/)
  assert.match(evaluation, /selected=\{activeInstrumentFilter\}/)
  assert.match(evaluation, /value=\{activeTimepointFilter\}/)
})

test('NGRP applicant KPI filters ignore cohort and school values from another cycle', () => {
  assert.match(applicants, /const activeCohortFilter = sourceCohorts\.some\(c => c\.id === cohortFilter\) \? cohortFilter : ''/)
  assert.match(applicants, /const activeSchoolFilter = schoolOptions\.includes\(schoolFilter\) \? schoolFilter : ''/)
  assert.match(applicants, /r\.student\.cohort_id !== activeCohortFilter/)
  assert.match(applicants, /r\.student\.school !== activeSchoolFilter/)
})

test('Nursing Academics program KPIs ignore school and cohort values absent from the fiscal year', () => {
  assert.match(benefit, /const activeSchoolFilter = schools\.includes\(schoolFilter\) \? schoolFilter : ''/)
  assert.match(benefit, /const activeCohortFilter = cohorts\.includes\(cohortFilter\) \? cohortFilter : ''/)
  assert.match(benefit, /r\.school === activeSchoolFilter/)
  assert.match(benefit, /r\.cohort === activeCohortFilter/)
})

test('Nursing Academics contact KPIs fall back when a scope removes the selected category', () => {
  assert.match(contacts, /const activeCategory = category === 'All' \|\| categories\.includes\(category\) \? category : 'All'/)
  assert.match(contacts, /orderContacts\(scopedContacts, activeCategory, query, ordering\)/)
  assert.match(contacts, /const nextCategory = activeCategory === 'All'/)
})

// CATALOG-REVAMP-1 retired the four KPI tiles for a summary line and a left list. The rule
// they carried stays: every count reads ACTIVE rows, and a removed row is listed only
// while Show removed is on. The behaviour itself is pinned in test/catalogRevamp.test.mjs.
test('Catalog counts cannot include removed rows', () => {
  assert.match(catalog, /const activeRows = useMemo\(\(\) => rows\.filter\(r => r\.is_active !== false\)/)
  assert.match(catalog, /catalogSummary\(activeRows, statsById\)/)
  assert.match(catalog, /railCounts\(activeRows, statsById, assignableCats\)/)
  assert.match(catalog, /filterItems\(rows, \{ view, q: query, showRemoved/)
})

test('Knowledge Center ignores a tag filter after that tag disappears', () => {
  assert.match(knowledge, /const activeTagFilter = tagFilter === 'all' \|\| allTags\.includes\(tagFilter\) \? tagFilter : 'all'/)
  assert.match(knowledge, /\(e\.tags \|\| \[\]\)\.includes\(activeTagFilter\)/)
  assert.match(knowledge, /value=\{activeTagFilter\}/)
})
