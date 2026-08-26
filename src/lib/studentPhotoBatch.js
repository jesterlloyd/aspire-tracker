// src/lib/studentPhotoBatch.js
//
// STUDENT-PHOTO-PERF-1: the app wiring for the staff photo request coalescer.
// The pure core (window collection, chunking, settlement) lives in
// studentFileBatchCore.js; this module binds it to the real batch client so
// useStudentFileUrl's mount-time fetches collapse into batch POSTs against
// /api/student-file-access. See the core module for the full rationale.

import { fetchStudentFileUrls } from './studentFileClient'
import { createStudentFileBatcher } from './studentFileBatchCore'

const defaultBatcher = createStudentFileBatcher({ fetchBatch: fetchStudentFileUrls })

export function queueStudentFileUrl({ studentId, kind }) {
  return defaultBatcher.queue({ studentId, kind })
}
