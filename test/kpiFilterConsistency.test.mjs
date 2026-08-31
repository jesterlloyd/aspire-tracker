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
const applicants = read('src/components/ngrp/ApplicantsTab.jsx')
const benefit = read('src/portal/na/CommunityBenefitView.jsx')
const contacts = read('src/portal/na/AcademicsContactsView.jsx')
const catalog = read('src/components/catalog/CatalogPage.jsx')
const knowledge = read('src/components/settings/KnowledgeCenterPanel.jsx')

test('Evaluation ignores instrument and timepoint selections absent from the current cohort', () => {
  assert.match(evaluation, /const activeInstrumentFilter = instruments\.includes\(filterInstrument\) \? filterInstrument : 'All'/)
  assert.match(evaluation, /const activeTimepointFilter = timepoints\.includes\(filterTimepoint\) \? filterTimepoint : 'All'/)
  assert.match(evaluation, /value=\{activeInstrumentFilter\}/)
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

test('Catalog KPI cards and active-resource counts cannot include removed rows', () => {
  assert.match(catalog, /if \(!showInactive && r\.is_active === false\) return false/)
  assert.match(catalog, /const resetToActiveCatalog = \(\) => setShowInactive\(false\)/)
  assert.match(catalog, /active=\{!showInactive && kpi === 'recent'\}/)
  assert.match(catalog, /active=\{!showInactive && kpi === 'featured'\}/)
  assert.match(catalog, /onChange=\{e => changeRemovedVisibility\(e\.target\.checked\)\}/)
})

test('Knowledge Center ignores a tag filter after that tag disappears', () => {
  assert.match(knowledge, /const activeTagFilter = tagFilter === 'all' \|\| allTags\.includes\(tagFilter\) \? tagFilter : 'all'/)
  assert.match(knowledge, /\(e\.tags \|\| \[\]\)\.includes\(activeTagFilter\)/)
  assert.match(knowledge, /value=\{activeTagFilter\}/)
})
