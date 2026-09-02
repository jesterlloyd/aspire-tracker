import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COORDINATOR_DIGEST_EVENT_TYPES,
  COORDINATOR_DIGEST_TEMPLATE_VERSION,
  addCoordinatorDigestEvent,
  createCoordinatorDigestTransitions,
} from '../api/lib/coordinatorDigestTransitions.js';
import { buildCoordinatorWeeklyDigestEmail } from '../src/lib/notifications/templates/coordinatorWeeklyDigest.js';

const student = (status = 'Not Proceeding', id = 'student-juliana') => ({
  id,
  first_name: 'Juliana',
  last_name: 'Pilla',
  school: 'West Coast University North Hollywood',
  program_type: null,
  status,
});

const event = (event_type, status, notes = null) => ({
  event_type,
  event_date: '2026-08-13',
  notes,
  students: student(status),
});

test('INCIDENT: current Not Proceeding status overrides interview, placement, and disposition history', () => {
  const transitions = createCoordinatorDigestTransitions();

  addCoordinatorDigestEvent(transitions, event('interview', 'Not Proceeding', 'Score: 13/15'));
  addCoordinatorDigestEvent(transitions, event('placement', 'Not Proceeding', 'Placed in 5 South'));
  addCoordinatorDigestEvent(transitions, event('disposition_ineligible', 'Not Proceeding'));

  assert.equal(transitions.not_proceeding.length, 1, 'terminal student appears exactly once');
  assert.equal(transitions.not_proceeding[0].line, 'Juliana Pilla');
  for (const key of ['form_received', 'interview_booked', 'interview', 'placement', 'rotation']) {
    assert.deepEqual(transitions[key], [], `${key} must not contain a terminal student`);
  }
});

test('legacy Declined is treated as the same privacy-safe terminal state', () => {
  const transitions = createCoordinatorDigestTransitions();
  addCoordinatorDigestEvent(transitions, event('placement', 'Declined', 'Placed in 5 South'));

  assert.deepEqual(transitions.not_proceeding.map(row => row.line), ['Juliana Pilla']);
  assert.equal(transitions.placement.length, 0);
});

test('active students keep their real milestones and a cleared disposition event stays silent', () => {
  const transitions = createCoordinatorDigestTransitions();
  addCoordinatorDigestEvent(transitions, event('interview', 'Interviewed', 'Score: 13/15'));
  addCoordinatorDigestEvent(transitions, event('placement', 'Placed', 'Placed in 5 South'));
  addCoordinatorDigestEvent(transitions, event('disposition_ineligible', 'Placed'));

  assert.deepEqual(transitions.interview.map(row => row.line), ['Juliana Pilla (13/15)']);
  assert.deepEqual(transitions.placement.map(row => row.line), ['Juliana Pilla, 5 South']);
  assert.equal(transitions.not_proceeding.length, 0);
});

test('a terminal disposition can be the only qualifying event in the weekly window', () => {
  assert.ok(COORDINATOR_DIGEST_EVENT_TYPES.includes('disposition_ineligible'));
  assert.ok(COORDINATOR_DIGEST_EVENT_TYPES.includes('disposition_not_selected'));
  assert.ok(COORDINATOR_DIGEST_EVENT_TYPES.includes('disposition_removed_from_program'));
});

test('rendered coordinator copy shows only Not Proceeding and never the private reason or stale milestones', () => {
  const transitions = createCoordinatorDigestTransitions();
  addCoordinatorDigestEvent(transitions, event('interview', 'Not Proceeding', 'Score: 13/15'));
  addCoordinatorDigestEvent(transitions, event('placement', 'Not Proceeding', 'Placed in 5 South'));
  addCoordinatorDigestEvent(transitions, event('disposition_ineligible', 'Not Proceeding'));

  const { html } = buildCoordinatorWeeklyDigestEmail({
    coordinatorFirstName: 'Tony',
    schoolDisplayName: 'West Coast University North Hollywood',
    windowStart: new Date('2026-08-07T07:00:00Z'),
    windowEnd: new Date('2026-08-14T07:00:00Z'),
    transitions,
  });

  assert.match(html, />Not Proceeding</);
  assert.equal((html.match(/Juliana Pilla/g) || []).length, 1);
  assert.doesNotMatch(html, /13\/15|5 South|Ineligible/i);
  assert.match(html, /This reflects 1 total update/);
});

test('scheduled and manual digest paths share the classifier, current status, event set, and version 2', () => {
  const cron = readFileSync(new URL('../api/cron/coordinator-weekly-digest.js', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../api/admin/resend-coordinator-digest.js', import.meta.url), 'utf8');

  for (const [name, source] of [['cron', cron], ['admin', admin]]) {
    // preferred_first_name joined the select when student names started honouring a preferred
    // first name; both paths gained it identically, which is what this parity test guards.
    assert.match(source, /students!inner\(id, first_name, preferred_first_name, last_name, school, program_type, status\)/, `${name} reads current status`);
    assert.match(source, /COORDINATOR_DIGEST_EVENT_TYPES/, `${name} uses the shared event set`);
    assert.match(source, /createCoordinatorDigestTransitions\(\)/, `${name} uses the shared bucket shape`);
    assert.match(source, /addCoordinatorDigestEvent\(bucket, event\)/, `${name} uses terminal precedence`);
    assert.doesNotMatch(source, /case 'interview'|case 'placement'/, `${name} has no divergent inline classifier`);
    assert.match(source, /templateVersion: COORDINATOR_DIGEST_TEMPLATE_VERSION/, `${name} archives the shared version`);
  }

  assert.equal(COORDINATOR_DIGEST_TEMPLATE_VERSION, 2);
});
