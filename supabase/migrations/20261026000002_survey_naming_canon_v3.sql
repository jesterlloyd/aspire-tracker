-- SURVEY-NAMING-CANON-V3
--
-- Updates the existing Active "ASPIRE Survey Naming Canon" through the same
-- governed revision-and-apply path used by Settings > Keith > Knowledge Center.
-- The revision preserves immutable version history and the entry's existing
-- effective dates and vault metadata that this naming change does not own.
--
-- Owner source: SURVEY-NAMES-1, approved 2026-09-20.
-- This migration intentionally does not rename evaluation_instruments rows.
-- App-facing names come from src/lib/evaluation/surveyNames.js; changing stored
-- display_name values remains a separate Owner-gated decision.

BEGIN;

DO $migration$
DECLARE
  v_entry    public.knowledge_entries%ROWTYPE;
  v_actor_id uuid;
  v_body     text := $canon$
# ASPIRE Survey Naming Canon

This entry is the source of truth for how ASPIRE survey and evaluation instruments are named and described across the app, Evaluation > Review & Release, respondent pages, email invitations and reminders, the Knowledge Center, and program evaluation reporting.

## Core naming principles

1. **Use one name per instrument.** App-facing names come from the owner-approved survey naming source. Do not create a local variation for one page, email, report, or workflow.
2. **Name the respondent and subject clearly.** A reader should be able to tell who answers and who or what the response concerns.
3. **Use the correct instrument term.** Use *assessment* when a preceptor assesses a student's readiness. Use *feedback* when a student comments on a preceptor, unit, or program experience.
4. **Keep validated instrument content intact.** Casey-Fink item wording, scoring, and structure must not be modified.
5. **Qualify only Casey-Fink by timepoint.** Casey-Fink is the one instrument administered twice. The other instrument names do not carry a timepoint qualifier.

## Canonical instrument names

| Instrument key | Canonical name | Respondent | Subject | Active timing |
| --- | --- | --- | --- | --- |
| `casey_fink_readiness_2024` | Casey-Fink Readiness for Practice | Student | The student's self-reported readiness for practice | Pre-Rotation and Post-Rotation |
| `preceptor_progress` | Preceptor's Assessment of Student Readiness | Preceptor | The student's development and readiness | Midpoint and End of Rotation |
| `student_preceptor_eval` | Student's Feedback on Unit and Preceptor | Student | The unit learning environment and the student's primary preceptor | Post-Rotation |
| `post_rotation_evaluation` | Student's Feedback on ASPIRE | Student | The ASPIRE program and rotation experience | Post-Rotation |

Instrument keys are functional identifiers. Do not rename them.

## Casey-Fink Readiness for Practice

**Canonical instrument name:** Casey-Fink Readiness for Practice

**Pre-Rotation label:** Casey-Fink Readiness for Practice (Pre-Rotation)

**Post-Rotation label:** Casey-Fink Readiness for Practice (Post-Rotation)

**Sentence-title forms:** Casey-Fink Readiness for Practice, Pre-Rotation; Casey-Fink Readiness for Practice, Post-Rotation

The app stores the pre-rotation administration under the `baseline` timepoint but displays **Pre-Rotation**. The two administrations use the same validated instrument and support the program's paired pre/post readiness comparison.

The Pre-Rotation workflow establishes the comparison baseline. The Post-Rotation workflow follows Student's Feedback on Unit and Preceptor. Completing the Post-Rotation administration unlocks the student's ASPIRE Certificate of Completion.

Casey-Fink remains the highest-priority ASPIRE program evaluation instrument. Prioritize both administrations for release, reminders, completion monitoring, and paired reporting.

## Preceptor's Assessment of Student Readiness

**Canonical name:** Preceptor's Assessment of Student Readiness

**Respondent:** Preceptor

**Subject:** Student

This developmental assessment covers clinical progress, communication, professionalism, safety awareness, transition readiness, and related coaching needs. It is not a hiring decision or punitive evaluation. Any endorsement is for consideration only.

The same instrument supports these active release periods:

- **Midpoint:** Released when the student reaches 50% of required hours.
- **End of Rotation:** Released when the student reaches 100% of required hours. Completion unlocks the preceptor's Certificate of Appreciation.
- **Other / Interim Check-In:** Available when the team deliberately requests an additional interim assessment.

The instrument name stays the same across periods. Show the period as supporting context, not as part of the canonical instrument name.

## Student's Feedback on Unit and Preceptor

**Canonical name:** Student's Feedback on Unit and Preceptor

**Respondent:** Student

**Subject:** The unit learning environment and the student's primary preceptor

This feedback captures preceptor support, communication, psychological safety, learning conditions, and the student's unit experience. It is not a performance review of the preceptor.

The workflow becomes eligible when the student reaches 100% of required hours. Completion is the prerequisite for the Post-Rotation Casey-Fink release and for the later Unit Leader feedback release.

## Student's Feedback on ASPIRE

**Canonical name:** Student's Feedback on ASPIRE

**Respondent:** Student

**Subject:** The ASPIRE program and rotation experience

This is a separate survey, not a section embedded in Student's Feedback on Unit and Preceptor. It captures program-level feedback about the ASPIRE experience, communication, resources, transition support, and program structure.

Release it after the student completes the Post-Rotation Casey-Fink and the required program activities are recorded. It does not unlock a certificate and nothing downstream depends on its completion.

## Active Review & Release sequence

The five survey workflows appear in this order:

1. Casey-Fink Readiness for Practice (Pre-Rotation)
2. Preceptor's Assessment of Student Readiness
3. Student's Feedback on Unit and Preceptor
4. Casey-Fink Readiness for Practice (Post-Rotation)
5. Student's Feedback on ASPIRE

The student post-rotation sequence is gated in this order:

1. Student's Feedback on Unit and Preceptor
2. Casey-Fink Readiness for Practice (Post-Rotation)
3. Student's Feedback on ASPIRE

The Pre-Rotation Casey-Fink workflow and the preceptor assessment workflow use their own eligibility triggers. Do not describe them as steps in the three-survey student post-rotation sequence.

## Timing vocabulary

- **Pre-Rotation:** At or near the start of the rotation, before the rotation's main effect. The database timepoint is `baseline`.
- **Midpoint:** When the student reaches 50% of required hours.
- **End of Rotation:** When the student reaches 100% of required hours and the preceptor provides the end assessment.
- **Post-Rotation:** After the clinical rotation, when the student reflects on the experience or completes the paired Casey-Fink administration.
- **Other / Interim Check-In:** A deliberately requested preceptor assessment outside the standard Midpoint and End of Rotation periods.

End of Rotation and Post-Rotation are not interchangeable. Use End of Rotation for the preceptor's final assessment. Use Post-Rotation for student feedback and the second Casey-Fink administration.

## Preceptor recipient routing

Preceptor's Assessment of Student Readiness defaults to the student's active primary preceptor. When a student has another active canonical preceptor assignment, the Owner may select an active secondary or coverage preceptor as the respondent for that release.

This is a selection among verified assignments, not a free-text recipient override. ASPIRE still creates one assessment per student per timepoint. The selected respondent is recorded when the assessment is released so later assignment changes do not rewrite history.

Student's Feedback on Unit and Preceptor remains one survey about the student's primary preceptor and unit. ASPIRE does not create separate structured student-feedback assignments for every secondary or coverage preceptor.

## Survey fatigue guidance

Use the five governed workflows instead of adding overlapping surveys. Keep additional interim preceptor assessments selective. Do not add another program-experience survey alongside Student's Feedback on ASPIRE.

## Email naming guidance

Email subjects remain concise action sentences. The email body or survey page names the instrument canonically.

- Casey-Fink Pre-Rotation: **Before Your Rotation: Complete Your ASPIRE Readiness Survey**
- Casey-Fink Post-Rotation: **Complete Your ASPIRE Readiness Survey**
- Preceptor Midpoint: **ASPIRE: Midpoint Readiness Check-In for [Student Name]**
- Preceptor End of Rotation: **ASPIRE: Student Readiness Feedback Requested for [Student Name]**
- Student's Feedback on Unit and Preceptor: **ASPIRE: Share Feedback on Your Preceptor and Unit**
- Student's Feedback on ASPIRE: **Share Your ASPIRE Rotation Feedback**

Use [[ASPIRE Email Routing & Communication Guidance Canon]] to choose the correct invitation channel.

## Retired alias map

Use retired names only to recognize older records, searches, or documents. Answer with the canonical name.

- Casey-Fink Readiness for Practice Survey - Baseline -> Casey-Fink Readiness for Practice (Pre-Rotation)
- Casey-Fink Readiness for Practice Survey - Post-Rotation -> Casey-Fink Readiness for Practice (Post-Rotation)
- Preceptor Assessment of Student Readiness -> Preceptor's Assessment of Student Readiness
- Preceptor Student Readiness Assessment -> Preceptor's Assessment of Student Readiness
- Preceptor Readiness Assessment -> Preceptor's Assessment of Student Readiness
- Preceptor Progress Feedback -> Preceptor's Assessment of Student Readiness
- ASPIRE Preceptor Student Progress & Readiness Feedback -> Preceptor's Assessment of Student Readiness
- Student Feedback: Preceptor & Unit -> Student's Feedback on Unit and Preceptor
- Student Feedback on Preceptor & Unit -> Student's Feedback on Unit and Preceptor
- Preceptor & Unit Feedback -> Student's Feedback on Unit and Preceptor
- Student Evaluation of Preceptor/Unit -> Student's Feedback on Unit and Preceptor
- ASPIRE Program Experience Feedback -> Student's Feedback on ASPIRE
- ASPIRE Program Experience -> Student's Feedback on ASPIRE
- ASPIRE Post-Rotation Evaluation -> Student's Feedback on ASPIRE

## Applies to

This canon applies to:

- Evaluation > Review & Release
- Survey eligibility and release workflows
- Respondent survey pages
- Student and preceptor invitations and reminders
- Evaluation dashboards, response viewers, and packets
- Student and Unit Leader portals
- Knowledge Center documentation
- ASPIRE program evaluation and scholarly reporting
- Future survey governance decisions

## Source-of-truth order

1. This Active Knowledge Center entry governs naming and survey-language decisions for Keith.
2. The owner-approved app naming source governs exact app-facing instrument strings.
3. The Review & Release catalog governs current workflow order, triggers, gates, and respondent relationships.
4. Casey-Fink item content and scoring remain governed by the licensed instrument and applicable permission terms.

Stored `evaluation_instruments.display_name` values are not the app-facing naming authority. Do not use a stored legacy display name when the canonical instrument key is known.

## Naming maintenance

When an instrument is added, renamed, merged, or retired:

1. Update this canon.
2. Update the shared app naming source.
3. Update Review & Release labels and routing descriptions.
4. Update respondent pages, email bodies, reminders, response viewers, packets, and portals.
5. Update Knowledge Center cross-references and program evaluation language.
6. Add or update tests that prevent retired names from returning.

Do not introduce a new survey name in one surface without updating the canon and the shared naming source.

## Keith guidance

When answering questions about ASPIRE surveys, use this entry as the naming authority and distinguish the four instruments clearly:

- **Casey-Fink Readiness for Practice:** completed by students at Pre-Rotation and Post-Rotation as a readiness self-assessment.
- **Preceptor's Assessment of Student Readiness:** completed by a selected active preceptor about the student at Midpoint, End of Rotation, or another deliberately requested interim point.
- **Student's Feedback on Unit and Preceptor:** completed by the student about the primary preceptor and unit.
- **Student's Feedback on ASPIRE:** completed by the student about the ASPIRE program as a separate, non-gating post-rotation survey.

Keith should use a retired alias to recognize the user's meaning, then respond with the canonical name. Keith should not say that all secondary or coverage preceptor routing is deferred. The Owner can select an active canonical alternate for a preceptor assessment, while student feedback remains structured around the primary preceptor and unit.
$canon$;
BEGIN
  SELECT *
    INTO v_entry
    FROM public.knowledge_entries
   WHERE slug = 'aspire-survey-naming-canon'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SURVEY-NAMING-CANON-V3: Active Knowledge Center entry aspire-survey-naming-canon was not found';
  END IF;

  IF v_entry.state <> 'active' THEN
    RAISE EXCEPTION 'SURVEY-NAMING-CANON-V3: expected active entry, found %', v_entry.state;
  END IF;

  -- Safe rerun guard for a database restored from a later snapshot.
  IF v_entry.body = v_body THEN
    RAISE NOTICE 'SURVEY-NAMING-CANON-V3: canonical body is already active; no change';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.knowledge_revisions WHERE entry_id = v_entry.id
  ) THEN
    RAISE EXCEPTION 'SURVEY-NAMING-CANON-V3: a pending revision already exists; review it before applying this migration';
  END IF;

  -- Use the entry's current steward as the governed actor. updated_by is a
  -- required user_profiles FK, so the lifecycle RPC can validate it.
  v_actor_id := v_entry.updated_by;

  INSERT INTO public.knowledge_revisions (
    entry_id,
    title,
    category,
    body,
    source_attribution,
    precedence_rank,
    change_note,
    author_id,
    submitted_at,
    body_format,
    aliases,
    tags,
    review_date,
    confidence
  ) VALUES (
    v_entry.id,
    'ASPIRE Survey Naming Canon',
    'terminology_navigation',
    v_body,
    'ASPIRE Evaluation > Review & Release; SURVEY-NAMES-1 owner decision dated September 20, 2026; licensed Casey-Fink instrument content and scoring',
    v_entry.precedence_rank,
    'Aligned the canon with the owner-approved September 20 survey names, the separate Student''s Feedback on ASPIRE workflow, the active post-rotation release sequence, and current preceptor recipient routing.',
    v_actor_id,
    now(),
    'markdown',
    ARRAY[
      'survey naming',
      'Casey-Fink',
      'Pre-Rotation',
      'Post-Rotation',
      'Preceptor Assessment',
      'Student Feedback',
      'Unit and Preceptor',
      'ASPIRE feedback',
      'Review & Release',
      'Program Experience'
    ]::text[],
    ARRAY['evaluation-surveys']::text[],
    v_entry.review_date,
    'verified'
  );

  -- The existing lifecycle RPC writes the immutable next version, updates the
  -- Active entry, removes the pending revision, and records the activity event.
  PERFORM public.governance_apply_knowledge_revision(v_entry.id, v_actor_id);
END
$migration$;

COMMIT;

