/* global process */
// api/school-form-submit.js
// Handles ASPIRE school coordinator form submissions.
// Replaces the previous direct-Supabase approach in SchoolFormPage.jsx.
//
// Responsibilities:
//   1. Upsert cohort_school_rotations row for (cohort, school) pair.
//   2. Insert each student, linking to the rotation row.
//   3. Log rotation_created event for the first new student added.
//   4. Fire form_received notifications (fire-and-forget).
//
// No auth required: this endpoint is called from a public-facing form that is
// password-gated at the client. The cohort accepting_submissions check
// prevents spoofed submissions against closed cohorts.

import { createClient } from '@supabase/supabase-js'
import { emailBaseUrl } from '../lib/server/appUrl.js'
import { performSchoolPlacementUpsert } from './lib/schoolPlacementUpsert.js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const {
    cohortId, cohortName,
    coordinator,
    rotationStartDate, rotationEndDate,
    availability,
    students = [],
  } = req.body || {}

  // Required field validation
  if (!cohortId) return res.status(400).json({ error: 'cohortId is required' })
  if (!coordinator?.school?.trim()) return res.status(400).json({ error: 'School name is required' })
  if (!coordinator?.name?.trim() || !coordinator?.email?.trim())
    return res.status(400).json({ error: 'Coordinator name and email are required' })
  if (!rotationStartDate || !rotationEndDate)
    return res.status(400).json({ error: 'Rotation start and end dates are required' })
  if (rotationEndDate <= rotationStartDate)
    return res.status(400).json({ error: 'Rotation end date must be after start date' })
  if (!students.length) return res.status(400).json({ error: 'At least one student is required' })

  const db = getDb()

  // Verify cohort is still accepting submissions
  const { data: cohort } = await db
    .from('cohorts').select('id, name, accepting_submissions')
    .eq('id', cohortId).single()
  if (!cohort?.accepting_submissions)
    return res.status(400).json({ error: 'This cohort is not currently accepting submissions.' })

  // Canonical write, shared with the authenticated Academic Partner endpoint so the two submission
  // paths can never drift (rotation upsert + duplicate-safe student insert/update + event log).
  const result = await performSchoolPlacementUpsert(db, {
    cohortId, cohortName, coordinator,
    rotationStartDate, rotationEndDate, availability, students,
    submittedVia: 'school_form',
  })
  if (result.error) return res.status(500).json({ error: result.error })
  const { added, updated, skipped, rotationId } = result

  // Fire-and-forget: form_received notifications for each new student. Internal
  // same-deployment call - canonical origin in Production, forwarded host on
  // Preview so it hits the right deployment's endpoint. See lib/server/appUrl.js.
  const baseUrl = emailBaseUrl(req)
  for (const s of added) {
    fetch(`${baseUrl}/api/form-received-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId:        s.id,
        cohortId,
        studentName:      s.name,
        studentFirstName: s.name.split(' ')[0],
        studentEmail:     s.email,
        school:           coordinator.school.trim(),
      }),
    }).catch(e => console.warn('[school-form-submit] notification failed:', e.message))
  }

  return res.status(200).json({
    success: true,
    added:   added.map(s => s.name),
    updated: updated.map(s => s.name),
    skipped,
    rotationId,
  })
}
