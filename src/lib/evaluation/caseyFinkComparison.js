const CASEY_FINK_SLUG = 'casey_fink_readiness_2024'
const PRE_TIMEPOINTS = new Set(['baseline', 'early_rotation_baseline'])
const POST_TIMEPOINT = 'post_rotation'

export const CASEY_FINK_SECTION_GROUPS = [
  {
    key: 'clinical_problem_solving',
    label: 'Clinical Problem-Solving',
    shortLabel: 'CPS',
    scoreKey: 'score_s1_clinical_problem_solving',
    itemCodes: ['S1_Q01', 'S1_Q02', 'S1_Q03', 'S1_Q04', 'S1_Q05', 'S1_Q06'],
  },
  {
    key: 'learning_activities',
    label: 'Learning Activities',
    shortLabel: 'LA',
    scoreKey: 'score_s1_learning_activities',
    itemCodes: ['S1_Q07', 'S1_Q08', 'S1_Q09', 'S1_Q10', 'S1_Q11'],
  },
  {
    key: 'practice_readiness',
    label: 'Practice Readiness',
    shortLabel: 'PR',
    scoreKey: 'score_s1_practice_readiness',
    itemCodes: ['S1_Q12', 'S1_Q13', 'S1_Q14', 'S1_Q15'],
  },
]

function responseFor(assignment) {
  const response = assignment?.evaluation_responses
  if (!response) return null
  return Array.isArray(response) ? response[0] || null : response
}

function hasSectionIScores(assignment) {
  const response = responseFor(assignment)
  return CASEY_FINK_SECTION_GROUPS.every(section => {
    const value = Number(response?.[section.scoreKey])
    return Number.isFinite(value) && value >= 1 && value <= 4
  })
}

function submittedAt(assignment) {
  const value = responseFor(assignment)?.submitted_at || assignment?.completed_at || assignment?.sent_at
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

// Prefer the true zero-hour baseline when both baseline labels somehow exist;
// within the same label, retain the earliest completed response.
function preferredPre(current, candidate) {
  if (!current) return candidate
  const rank = tp => tp === 'baseline' ? 0 : 1
  const currentRank = rank(current.timepoint)
  const candidateRank = rank(candidate.timepoint)
  if (candidateRank !== currentRank) return candidateRank < currentRank ? candidate : current
  return submittedAt(candidate) < submittedAt(current) ? candidate : current
}

// The schema allows one response per student/cohort/timepoint. Latest is a
// deterministic fallback for imported or legacy duplicates.
function preferredPost(current, candidate) {
  if (!current) return candidate
  return submittedAt(candidate) > submittedAt(current) ? candidate : current
}

function mean(values) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function itemDistribution(pairs, itemCode, side) {
  const counts = [0, 0, 0, 0]
  for (const pair of pairs) {
    const raw = responseFor(pair[side])?.responses?.[itemCode]
    const value = Number(raw)
    if (Number.isInteger(value) && value >= 1 && value <= 4) counts[value - 1] += 1
  }
  return {
    counts,
    total: counts.reduce((sum, count) => sum + count, 0),
  }
}

export function buildCaseyFinkComparison(assignments = []) {
  const byStudent = new Map()

  for (const assignment of assignments) {
    if (assignment?.evaluation_instruments?.slug !== CASEY_FINK_SLUG) continue
    if (assignment?.status !== 'completed' || !hasSectionIScores(assignment)) continue

    const studentId = assignment?.students?.id || assignment?.student_id
    if (!studentId) continue

    const entry = byStudent.get(studentId) || { pre: null, post: null }
    if (PRE_TIMEPOINTS.has(assignment.timepoint)) {
      entry.pre = preferredPre(entry.pre, assignment)
    } else if (assignment.timepoint === POST_TIMEPOINT) {
      entry.post = preferredPost(entry.post, assignment)
    }
    byStudent.set(studentId, entry)
  }

  const pairs = []
  let baselineOnlyCount = 0
  let postOnlyCount = 0

  for (const [studentId, entry] of byStudent.entries()) {
    if (entry.pre && entry.post) pairs.push({ studentId, pre: entry.pre, post: entry.post })
    else if (entry.pre) baselineOnlyCount += 1
    else if (entry.post) postOnlyCount += 1
  }

  const metrics = CASEY_FINK_SECTION_GROUPS.map(section => {
    const preValues = pairs.map(pair => Number(responseFor(pair.pre)[section.scoreKey]))
    const postValues = pairs.map(pair => Number(responseFor(pair.post)[section.scoreKey]))
    const preMean = mean(preValues)
    const postMean = mean(postValues)
    const changeCounts = pairs.reduce((counts, pair) => {
      const preValue = Number(responseFor(pair.pre)[section.scoreKey])
      const postValue = Number(responseFor(pair.post)[section.scoreKey])
      if (postValue > preValue) counts.higherPost += 1
      else if (postValue < preValue) counts.lowerPost += 1
      else counts.same += 1
      return counts
    }, { higherPost: 0, same: 0, lowerPost: 0 })
    return {
      ...section,
      preMean,
      postMean,
      delta: preMean == null || postMean == null ? null : postMean - preMean,
      changeCounts,
    }
  })

  const itemDistributions = CASEY_FINK_SECTION_GROUPS.flatMap(section =>
    section.itemCodes.map(itemCode => ({
      sectionKey: section.key,
      sectionLabel: section.label,
      itemCode,
      pre: itemDistribution(pairs, itemCode, 'pre'),
      post: itemDistribution(pairs, itemCode, 'post'),
    })),
  )

  const pairedStudents = pairs
    .map(pair => {
      const student = pair.pre?.students || pair.post?.students || {}
      const firstName = student.preferred_first_name || student.first_name || ''
      const lastName = student.last_name || ''
      const studentName = [firstName, lastName].filter(Boolean).join(' ') || 'Student'

      return {
        studentId: pair.studentId,
        studentName,
        baselineTimepoint: pair.pre.timepoint,
        baselineSubmittedAt: responseFor(pair.pre)?.submitted_at || pair.pre?.completed_at || null,
        postSubmittedAt: responseFor(pair.post)?.submitted_at || pair.post?.completed_at || null,
        scores: CASEY_FINK_SECTION_GROUPS.reduce((scores, section) => {
          const pre = Number(responseFor(pair.pre)[section.scoreKey])
          const post = Number(responseFor(pair.post)[section.scoreKey])
          scores[section.key] = { pre, post, delta: post - pre }
          return scores
        }, {}),
      }
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName, undefined, { sensitivity: 'base' }))

  return {
    matchedCount: pairs.length,
    baselineOnlyCount,
    postOnlyCount,
    metrics,
    itemDistributions,
    pairedStudents,
  }
}
