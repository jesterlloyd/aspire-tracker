# Keith Skills and Markdown Knowledge Vault: Architecture Plan

Status: **PLAN ONLY, awaiting Jester's approval decisions (Section 11).**
Nothing in this document is implemented. No code, SQL, migrations, or
production changes accompany it. This file is untracked and uncommitted.

Prompt: `ASPIRE_Fable_Keith_Skills_and_Knowledge_Vault_Plan.md` (2026-08-04).

---

## 1. Current-State Architecture Audit (Phase 0)

Three parallel code audits were performed (Keith pipeline, Knowledge Center,
resume storage). Findings below are verified against source with file:line
references; nothing here is assumed.

### 1.1 Keith chat architecture

- **Provider and model.** Single provider, Anthropic, called over raw `fetch`
  (no SDK dependency). Model hardcoded: `claude-haiku-4-5-20251001` at
  `api/keith.js:601`, `max_tokens: 2048`, temperature never set (defaults to
  1.0), no streaming, no prompt caching. The header comment in
  `src/lib/keithKnowledge.js:6` claiming Sonnet is stale.
- **Request pipeline** (in order): CORS, `verifyCaller` (JWT via anon client,
  then service-role `user_profiles` lookup; any authenticated profile may
  chat), 25s server deadline, client-supplied message history (last 10, React
  state only, never persisted), deterministic regex intent classifier
  (`lib/server/keith/queryIntent.js`), a person/contact short-circuit that
  answers without the model, live-context assembly from the client's React
  Query snapshot plus server-side service-role fetches, tool filtering, system
  prompt build (`buildSystemPrompt`, `src/lib/keithKnowledge.js:987`),
  governed-knowledge injection at the `[[GOVERNED_KNOWLEDGE]]` marker, then a
  tool loop (max 5 rounds, 18s per call).
- **Tools.** Four read-only tools (`search_students`, `get_student_detail`,
  `get_unit_details`, `get_cohort_summary`), authorized twice (pre-filter and
  at execution) via `TOOL_AUTHORIZATION` (owner/admin/interviewer; co-lead has
  none, flagged in code as an unresolved Owner decision). Tools run on a
  service-role client with field redaction limited to
  `date_of_birth, ssn_last4, gender`.
- **Audit.** The only DB trace is a `program_events` row per tool call
  (allowed and denied). Conversations are never logged. Token counts are
  logged per round to stdout only; **no cost, latency, or usage persistence
  exists**. `program_events` RLS grants `anon` full CRUD (see 1.5, risk R6).
- **No rate limiting** on `api/keith.js`, the only uncapped expensive endpoint
  in a repo that rate-limits four cheaper ones.

### 1.2 Knowledge Center (current)

- **Schema** (`supabase/migrations/20260610000000_kt1...sql`):
  `knowledge_entries` (title, unique slug, category CHECK of 8, plain-text
  `body` up to 50k chars, `source_attribution`, `precedence_rank`, state CHECK
  draft/active/deprecated/archived, `effective_date`/`expires_at`,
  `current_version`), `knowledge_entry_versions` (immutable forward-only
  snapshots), `knowledge_revisions` (at most one pending full-snapshot
  revision per entry, UNIQUE(entry_id)).
- **Access model.** RLS enabled with zero policies (deny-all); every operation
  goes through `api/knowledge-admin.js` (14 actions, strict per-action key
  allow-lists, server-verified caller). Owner or Admin for everything;
  lifecycle actions (activate, apply revision, restore, state change) are
  Owner-only. Lifecycle RPCs are SECURITY INVOKER, service-role-execute-only,
  lock-then-verify, and write `activity_logs` atomically. The RPCs themselves
  perform no role check; authorization lives entirely in the endpoint.
- **Retrieval** (`lib/server/keith/knowledgeRetrieval.js`): per request,
  fetch **all** Active entries, lexical keyword scoring (title +6, category
  +3, body +1 capped), top 3 to 5 whole entries within an 8,000-char budget,
  rendered into the system prompt. No embeddings, no cache, no pagination.
  Two hardcoded alias families (CS-Link, email routing) and one +50
  slug-specific boost are patches for lexical misses.
- **Known gaps** (from the audit): `effective_date`/`expires_at` are stored
  but never enforced anywhere; `restore_entry_version` has an API but no UI;
  version history shows editor as a raw UUID; content is one plain-text
  textarea with structure-by-convention; no entry deletion path (archive is
  terminal).

### 1.3 Resume storage and access

- **Storage.** Private bucket `student-files` (Wave F-2 Pass 3 applied;
  verified by three later audit baselines), canonical path
  `<cohort_id>/<student_id>/resume.<ext>`, kinds resume/headshot only.
  Resume formats `pdf|doc|docx`, 10 MB cap (declared metadata only; no
  storage-level MIME/size enforcement, no magic-byte check).
- **Access.** Entirely server-mediated. Download: `api/student-file-access.js`
  verifies the JWT, gates by role (Owner/Admin both kinds; Viewer headshot
  only, **never resume**; Interviewer both kinds but only in cohorts with an
  unrevoked `interviewer_cohort_entitlements` row), resolves the stored path
  server-side, signs a 300s URL with service role. Denials return
  `signed_url: null` (no existence leak). Client capability layer mirrors
  this (`canViewStudentResumeInCohort`, `AuthContext.jsx:204-217`).
- **Parsing: none.** No text-extraction library exists anywhere in the repo
  (`pdf-lib` is generation-only, used for certificates). Resumes are opaque
  binary. No endpoint ever downloads resume bytes server-side today.
- **Keith today** never touches resume files; it does receive the
  `resume_url` path string via `get_student_detail` (harmless on a private
  bucket, but it leaks internal ids into the prompt).

### 1.4 Rubric extensibility

`src/components/RubricSession.jsx`: question banks are hardcoded module
arrays (`CJ_QUESTIONS`, `PP_QUESTIONS`, `GA_QUESTIONS`) aggregated as
`DOMAIN_QUESTIONS`, a clean single-point injection seam. An "Other" free-text
question path already persists off-bank questions to `interview_rubrics`, and
Keith's `get_student_detail` already reads rubric summary fields back. So a
future "Add to interview preparation" action needs no new persistence model;
phase 1 deliberately does not use it.

### 1.5 Dependency map and smallest safe extension points

```
Keith.jsx ──POST──> api/keith.js ──┬─ verifyCaller (JWT -> user_profiles)
                                   ├─ classifyIntent (regex)         [EXT-1]
                                   ├─ buildSystemPrompt              [EXT-2]
                                   │    └─ [[GOVERNED_KNOWLEDGE]] <── knowledgeRetrieval.js  [EXT-3]
                                   │                                        └── knowledge_entries (service-role only)
                                   ├─ KEITH_TOOLS + TOOL_AUTHORIZATION      [EXT-4]
                                   └─ Anthropic /v1/messages (Haiku 4.5, hardcoded)  [EXT-5]

student resume:  students.resume_url (path) ──> api/student-file-access.js ──> private bucket
                                                   (role + entitlement gates)        [EXT-6]

Settings rail:   settingsSections.js already reserves { key:'keith', implemented:false, isAdmin }  [EXT-7]
                 and { key:'audit', implemented:false, isOwner }
```

Smallest safe extension points:

- **EXT-1** intent classifier: add a skill-invocation intent without touching
  existing intents.
- **EXT-2/3** prompt build: a second marker (e.g. `[[ACTIVE_SKILL]]`)
  following the proven `[[GOVERNED_KNOWLEDGE]]` substitution pattern.
- **EXT-4** tool matrix: skills declare required tools; the existing
  default-deny matrix stays the single authority.
- **EXT-5** model call: lift the hardcoded model string into a per-request
  parameter chosen server-side (skill metadata), never client-supplied.
- **EXT-6** resume access: a server-side sibling of the existing signer that
  fetches bytes for parsing under the exact same role/entitlement gates.
- **EXT-7** Settings: flip the reserved `keith` section on as the Keith
  Skills workspace; no new IA needed.

Risks carried into the design (pre-existing, surfaced by this audit):

- **R1** No rate limiting on `api/keith.js`.
- **R2** No persisted usage/cost/latency instrumentation (stdout only).
- **R3** `liveData` prompt block includes school/personal email, phone, GPA
  for placed students regardless of caller role.
- **R4** Superseded DO-NOT-APPLY migration
  `20260712000014_phase0b_wave_f2_student_files_private.sql` still in the
  tree; applying it would recreate rejected storage policies.
- **R5** Stale docs: `WAVE_F2_STUDENT_FILES.md` on Pass 3;
  `keithKnowledge.js:6` model comment.
- **R6** `program_events` RLS grants anon/authenticated full CRUD: Keith's
  only audit trail is readable, forgeable, and deletable by its subjects.
- **R7** Intake file signer is unauthenticated with `Origin: *` and
  `upsert: true` until submission.

---

## 2. Recommended Target Architecture

One sentence: **extend the proven Knowledge Center governance pattern (tables
+ versions + revisions + Owner-gated lifecycle RPCs + a single strict admin
endpoint) to two new governed content types, Skills and Markdown knowledge
pages, and give Keith a server-side skill runtime that loads exactly one
skill's instructions on explicit invocation.**

Everything below is DB-backed on the existing Supabase/Vercel stack, keeps
the deny-all RLS + service-role-endpoint posture, keeps identity as canonical
profile/student IDs, and adds zero runtime dependencies to the client bundle.

### 2.1 Keith Skills runtime (server)

- A skill is a governed row, not a file on disk. `SKILL.md` (frontmatter +
  markdown body) is the **interchange format**: import parses and validates
  it into columns; export regenerates it byte-stably. Vercel's read-only
  serverless filesystem makes files-as-runtime-source a poor fit; the DB is
  already the app's source of truth for governed content.
- Invocation flow inside `api/keith.js`:
  1. Detect explicit invocation: skill picker sends `skill_id` +
     `skill_version` explicitly, or the intent classifier matches a
     registered trigger phrase against **enabled + active** skills fetched by
     metadata only (id, name, triggers, roles). Confidential-data skills
     require the explicit path or an exact trigger-phrase match; Keith never
     silently selects one.
  2. Authorize: caller role must be in the skill's `allowed_roles`; each
     `required_tools`/data grant is re-checked against the existing
     authorities (tool matrix, resume entitlement logic). Both must pass.
  3. Load that one skill's instruction body (progressive disclosure: never
     all skills, never unselected bodies) and splice it at an
     `[[ACTIVE_SKILL]]` marker, after the governed-knowledge block.
  4. Execute with the skill's model route (server-chosen, never
     client-supplied).
  5. Disclose in the reply footer: skill name, version, data sources
     consulted, missing-data notes.
  6. Audit: one `keith_skill_invocations` row (see 3.1); no content stored.

### 2.2 Keith Skills workspace (Settings)

Activate the reserved `keith` Settings section (Owner/Admin) as **Keith**,
with Skills as its first panel. Phase 1 UI mirrors the Knowledge Center
patterns users already know: FilterKPICards by lifecycle state, table, drawer
with view/edit, revision-style version flow, Owner-only lifecycle buttons.
Installed/Available/Draft/Active/Deprecated/Archived map onto lifecycle state
plus the enabled flag; no public marketplace.

### 2.3 Knowledge Vault

**Evolve the existing Knowledge Center in place** rather than building a
parallel system: add markdown as a content format, frontmatter-equivalent
metadata columns, wikilinks with a link index, and lifecycle enforcement.
The 26 active entries migrate non-destructively (Section 8). Rationale in
the source-of-truth comparison (Section 2.4).

New capabilities on top of the existing tables:

- `body_format` (`plain` | `markdown`), rendered with an extended
  `keithMarkdown.js` (already a safe, dependency-free React renderer; add
  wikilink + table support behind its existing escaping guarantees).
- Frontmatter fields as real columns (aliases, tags, review_date,
  confidence, supersedes), not YAML blobs, so retrieval and governance can
  query them. YAML exists only at import/export boundaries.
- `[[Wikilinks]]` resolved against titles, slugs, and aliases at save time
  into a `knowledge_links` index table; backlinks, orphan pages, and broken
  links become simple queries.
- Lifecycle enforcement: retrieval excludes entries past `expires_at` and
  flags entries past `review_date`; the review queue surfaces both.
- Retrieval scoring upgraded generically: alias and tag matches score like
  title matches, retiring the hardcoded CS-Link/email-routing alias hacks
  and the +50 slug boost as one-off patches (the email-routing canon keeps
  its priority via `precedence_rank` and aliases instead).
- Keith's answers cite the pages used (slug + title already reach the
  prompt; the footer makes them visible and linkable to Settings).

### 2.4 Source-of-truth decision (required comparison)

| Criterion | 1. DB-backed Markdown | 2. Git-backed vault | 3. Hybrid (files canonical + DB index) |
|---|---|---|---|
| Vercel/Supabase fit | Native; serving stack unchanged | Poor: serverless FS is read-only; runtime writes need GitHub API commits and either redeploys or a fetch layer | Adds a sync layer with two write paths to reconcile |
| Versioning/rollback | Already built (versions table, restore RPC) | Git-native but disconnected from app auth | Both, plus drift between them |
| Concurrent editing | Row locks + one-pending-revision, already proven | Merge conflicts surfaced to non-Git users | Conflict resolution spans two systems |
| Auditability | `activity_logs` in the same transaction | Commits attributable to a bot token, not the app profile | Split-brain audit |
| Permissions | Existing Owner/Admin server gates | GitHub perms don't map to app roles | DB gates writes but files leak reads |
| Backup/recovery | Supabase PITR, already in posture | Git history | Both, and restore ordering matters |
| Search | SQL + optional Postgres FTS later | Needs an index built elsewhere | DB index anyway |
| Owner/Admin ease | The UI they already use | Requires Git fluency | Two mental models |
| Obsidian compatibility | Via import/export of .md + YAML | Native | Native |

**Recommendation: option 1, DB-backed Markdown documents, with first-class
Markdown import/export as the portability guarantee.** Obsidian compatibility
is achieved at the boundary (bulk export produces a valid vault folder; bulk
import round-trips it), which satisfies the "Obsidian-compatible pattern, not
embedded Obsidian" goal without a second source of truth. Option 3 is the
fallback if a true external-editing workflow ever becomes a requirement; it
should not be built speculatively.

The same decision applies to skills: DB rows canonical, `SKILL.md` package
import/export at the boundary.

### 2.5 Model routing

Lift the hardcoded model string into server-side routing:

- Base Keith chat: `claude-haiku-4-5-20251001` (unchanged).
- Per-skill `model_route` (`default` | `quality`): `quality` maps to a
  Sonnet-tier model chosen server-side. Resume Interview Questions uses
  `quality`: three grounded questions per invocation is low-volume,
  quality-sensitive work where Haiku's cost edge is irrelevant.
- Set `temperature` explicitly per route (recommend 0.2 for skill execution
  and for base chat; approval decision D11).
- The model id never comes from the client.

---

## 3. Schema Proposal

All new tables: RLS enabled, zero policies (deny-all), service-role access
through one new strict endpoint per domain, following `knowledge-admin.js`.
DDL sketches only; exact SQL is written at implementation time and gated
through the Owner SQL checklist.

### 3.1 Skills

```
keith_skills
  id uuid PK, slug text UNIQUE (immutable), display_name text, description text,
  version integer (current), status text CHECK (draft|active|deprecated|archived),
  enabled boolean DEFAULT false,           -- runtime kill switch, independent of status
  allowed_roles text[] CHECK subset,       -- owner implied; e.g. {admin,interviewer}
  required_tools text[],                   -- validated against the server tool registry
  required_data text[],                    -- e.g. {student_profile_read, student_resume_read}
  trigger_phrases text[],                  -- lowercase exact-phrase matches
  data_classification text CHECK (internal|confidential),
  model_route text CHECK (default|quality),
  io_contract jsonb,                       -- declared inputs/outputs, shown in UI
  instruction_body text,                   -- the SKILL.md body (markdown)
  owner_label text DEFAULT 'ASPIRE', provenance text,
  created_by/updated_by uuid -> user_profiles RESTRICT,
  created_at/updated_at, reviewed_at, reviewed_by

keith_skill_versions        -- immutable forward-only snapshots, mirrors knowledge_entry_versions
  id, skill_id FK CASCADE, version_number, <full snapshot of governed fields>,
  change_note text NOT NULL DEFAULT '', editor_id, created_at,
  UNIQUE (skill_id, version_number)

keith_skill_tests           -- declared test cases, run before activation
  id, skill_id FK CASCADE, name, input jsonb, expectations jsonb,
  last_run_at, last_result text CHECK (pass|fail|error) NULL, last_output_note text

keith_skill_invocations     -- the audit trail (metadata only, no content)
  id, skill_id, skill_version integer,
  request_id text, invoked_by uuid -> user_profiles,
  invoked_role text, cohort_id uuid NULL, student_id uuid NULL,
  data_sources jsonb,       -- e.g. {resume: {path_kind:'resume', object_updated_at:...}}
  outcome text CHECK (completed|denied|missing_data|error),
  model_used text, input_tokens int, output_tokens int, duration_ms int,
  created_at
```

Lifecycle RPCs mirror the knowledge set (activate, deprecate, archive,
restore-as-new-version), Owner-only at the endpoint, service-role execute
only. Rollback = restore a prior version forward, the pattern already proven.
Versioning is integer forward-only like knowledge entries; the semver in
SKILL.md frontmatter is derived (`1.<version>.0`) rather than hand-managed,
so import/export stays standards-shaped without a second version authority
(approval decision D5).

### 3.2 Knowledge Vault (additive to existing tables)

```
knowledge_entries ADD
  body_format text CHECK (plain|markdown) DEFAULT 'plain',
  aliases text[] DEFAULT '{}', tags text[] DEFAULT '{}',
  review_date date NULL, confidence text CHECK (verified|provisional) NULL,
  superseded_by uuid NULL -> knowledge_entries

knowledge_links             -- rebuilt on every save of the source entry
  id, source_entry_id FK CASCADE, target_entry_id NULL FK,  -- NULL = broken link
  target_text text,          -- the literal [[...]] target as written
  created_at
```

`knowledge_entry_versions` and `knowledge_revisions` gain the same new
fields so snapshots stay complete. Existing RPCs extend rather than fork.
Also in this pass: enforce `expires_at` in retrieval, add the missing
restore UI, and join editor names in version history (three audit gaps).

### 3.3 Foundations (prerequisites, small)

```
keith_requests              -- closes the instrumentation gap (R2)
  id, request_id text, profile_id uuid, role text, intent text,
  skill_id uuid NULL, model text, rounds int,
  input_tokens int, output_tokens int, duration_ms int,
  outcome text, created_at
  -- no message content, ever

keith_rate_limit_counters   -- closes R1; same shape as the three existing
  profile_id, window_start, count      -- rate-limit counter tables
```

Recommended defaults: 30 requests per profile per 10 minutes, skills counted
double; 429 with a friendly retry message (approval decision D8).

---

## 4. Settings Information Architecture (wireframe level)

```
Settings
├─ Workspace: General, About
├─ Administration (Owner/Admin)
│  ├─ Accounts & Access
│  ├─ Knowledge Center            <- evolves into the Vault UI in place
│  │  ├─ [KPI cards: All | Draft | Active | Deprecated | Archived | Needs review]
│  │  ├─ Table + search (title/aliases/tags) + category & tag filters
│  │  └─ Entry drawer
│  │     ├─ Edit: markdown editor + live preview (extended keithMarkdown.js),
│  │     │        metadata form (category, aliases, tags, dates, confidence,
│  │     │        precedence, source), link checker panel
│  │     ├─ View: rendered markdown, backlinks list, citations usage
│  │     └─ Versions: history + diff (added) + restore (Owner, added)
│  └─ Keith                        <- reserved section, flipped on
│     └─ Skills
│        ├─ [KPI cards: All | Draft | Active | Deprecated | Archived] + Enabled toggle count
│        ├─ Table: name, version, status, enabled, roles, classification, invocations(30d), failures(30d)
│        ├─ + Create skill | Import SKILL.md package (validate -> preview -> save as draft)
│        └─ Skill drawer
│           ├─ Overview: description, permissions, required tools/data, triggers, model route
│           ├─ Instructions: rendered SKILL.md body
│           ├─ Tests: declared cases, run-all before activation, last results
│           ├─ Versions: compare, restore (Owner)
│           ├─ Activity: invocation history (from keith_skill_invocations)
│           └─ Lifecycle: activate/deprecate/archive (Owner), enable/disable (Owner/Admin)
└─ Diagnostics (Owner): Preceptor Parity
```

Keith chat additions: a small "Skills" affordance listing the enabled skills
the caller's role may use (explicit invocation without typing trigger
phrases), and the per-answer disclosure footer (skill, version, sources).

---

## 5. Resume Interview Questions: Skill Specification

**Slug** `resume-interview-questions`, display "Resume Interview Questions".
`allowed_roles: {admin, interviewer}` plus Owner implied. `data_classification:
confidential`. `required_data: {student_profile_read, student_resume_read}`.
`model_route: quality`. Explicit invocation only (picker or exact trigger
phrase); never auto-selected.

Flow (server, inside the skill runtime):

1. **Resolve the student canonically.** Reuse the existing tool path
   (`search_students` then id); ambiguous names return a disambiguation list
   with school/cohort, no generation. Identity from this point is
   `student_id`, never a name string.
2. **Authorize.** Caller role in allowed_roles, then the exact resume rule
   from `student-file-access`: Owner/Admin, or Interviewer with an unrevoked
   entitlement for the student's cohort. Viewer is refused by construction.
3. **Fetch and extract.** Server downloads the resume bytes with the service
   client (new, sibling to the signer, same gates), extracts text:
   PDF via a pure-JS extractor, DOCX via a pure-JS extractor (two new
   server-only dependencies, approval decision D3), legacy `.doc` returns the
   honest unreadable state. Extraction failures, empty text, and >10 MB all
   land on the explicit no-resume/unreadable path, never a fabricated answer.
4. **Minimize.** Before inference, redact email addresses, phone numbers,
   street addresses, and URLs from the extracted text (regex pass); cap the
   text at a fixed budget (recommend 12k chars, head-weighted). Profile
   context is limited to fields the caller can already see, and only those
   the contract needs (school, program type, cohort, interest statement).
5. **Generate** exactly three questions (Clinical Judgment, Professional
   Presence, Goal Alignment), each with a "Resume basis" quoting or citing a
   specific resume detail, in the prompt-specified markdown shape. The
   instruction body forbids inventing experiences, employers, credentials,
   or goals, and requires "the resume does not provide enough evidence for a
   personalized question in this domain; here is a solid general question"
   when grounding is missing.
6. **Disclose and audit.** Footer: skill + version, resume object version
   (storage `updated_at`), fields consulted, redactions applied. One
   `keith_skill_invocations` row with metadata only; extracted text is never
   stored and never logged.

**Output destination: Keith chat only in phase 1** (approval decision D9).
The rubric's `DOMAIN_QUESTIONS` seam and existing "Other" persistence make an
"Add to interview preparation" action a clean later phase; nothing is written
to the official rubric automatically, ever.

Prompt-injection posture: resume text is untrusted input. It is delimited as
data, the instruction hierarchy states that nothing inside it can change the
task, tools are disabled during the generation call (the student record is
resolved before extraction), and the output contract is fixed-shape.

---

## 6. Authorization and Privacy Threat Model

Assets: resume text (confidential), student PII, knowledge content
(internal), skill instructions (internal), API keys.

| # | Threat | Mitigation |
|---|---|---|
| T1 | Unauthorized resume access via skill | Server re-derives the `student-file-access` rule per invocation (role + entitlement); the skill declares `student_resume_read` and the runtime refuses undeclared data access. UI hides what the server would refuse. |
| T2 | Prompt injection via resume content | Data delimiting, fixed output contract, no tools during generation, no writes anywhere in the skill runtime. |
| T3 | Cross-student leakage | Canonical `student_id` end to end; one student per invocation; extraction buffer scoped to the request. |
| T4 | Confidential data to an unapproved model | Model chosen server-side from an approved routing table (both routes are Anthropic API, the provider already receiving student PII today). Sending resume text at all is approval decision D1. |
| T5 | Client-forged skill or model parameters | Client sends only `skill_id`/`skill_version` intent; roles, tools, model, and instructions are server-resolved. Unknown or disabled skill: refuse. |
| T6 | Trigger-phrase hijack of a confidential skill | Confidential skills require explicit picker use or exact-phrase match, and the disclosure footer always names the skill so silent use is visible. |
| T7 | Audit-trail tampering | New audit tables are deny-all RLS + service-role writes (unlike `program_events`, see R6, which needs its own Owner SQL fix). |
| T8 | Cost abuse | Rate limiting (3.3) plus persisted per-profile usage. |
| T9 | Knowledge poisoning via import | Markdown import sanitized by the existing escaping renderer (React elements, no raw HTML), frontmatter strictly validated, imports land as drafts requiring Owner activation. |
| T10 | Skill package import abuse | Structure validation, allow-listed frontmatter keys, required_tools validated against the registry, always lands as draft, Owner-only activation after tests run. |

Data-retention rule: skill runtime stores metadata only. No extracted resume
text, no generated questions, no chat content in any table.

---

## 7. Model and Agent Delegation Plan

Fable retains: architecture, security/privacy decisions, schema and
authorization, integration design, final code review, release recommendation.

| Task | Recommended tier | Data allowed | Human review |
|---|---|---|---|
| Architecture, authz design, threat model | Fable/frontier | sanitized architecture | required (Jester) |
| Resume question generation (runtime) | Sonnet-tier via `quality` route | minimum-necessary redacted resume text | interviewer reviews every output |
| Base Keith chat (runtime) | Haiku 4.5 (unchanged) | current Keith context | existing posture |
| Plain->Markdown conversion of 26 entries | cheaper agent | knowledge content (internal) | Owner approves each page before activation |
| Frontmatter/YAML validators, wikilink indexer | deterministic code, no model | n/a | Fable review |
| Markdown linting, link suggestions | cheaper agent | active knowledge pages | approval required before save |
| UI scaffolding (panels, drawers, tests) | cheaper coding agent | repository code | Fable review before commit |
| Test scaffolding, synthetic eval cases | cheaper agent | synthetic data only | sampled |
| Repo/UI inventory, docs drafts | cheaper agent | repository code | sampled |

Hard rule: no real resumes, student records, secrets, or production data to
any agent or model outside the approved runtime path. Synthetic fixtures only
(the mocked-session harness pattern already used for QC).

---

## 8. Migration Plan (26 existing entries, non-destructive)

1. Export all current entries (title, category, state, dates, precedence,
   source, full version history) via the existing admin API to a Markdown
   folder: one file per entry, YAML frontmatter, `body` as-is. This export is
   the rollback artifact and the first Obsidian-compatibility proof.
2. Convert each body plain->Markdown with a cheaper agent (headings, lists,
   emphasis); frontmatter generated deterministically from columns.
3. Split candidates: any entry whose convention-based internal sections
   cover multiple topics gets a proposed atomic split (new slugs, `related`
   wikilinks both ways, original marked superseded). Proposals only.
4. Wikilink suggestions generated (cheaper agent) wherever an entry mentions
   another entry's title or alias. Suggestions, not writes.
5. Owner review in the new editor: each converted page lands as the entry's
   `body_format: markdown` **pending revision** (reusing the one-pending-
   revision workflow), so the Active plain-text version keeps serving Keith
   until Owner applies it. Approval is per entry, not bulk.
6. Shadow mode: for a configurable window, retrieval runs old scoring and
   new scoring (aliases/tags/dates) side by side, logging selection diffs to
   `keith_requests` metadata; no user-visible change until reviewed.
7. Cutover per entry on apply; rollback per entry via version restore, plus
   the full step-1 export as belt and suspenders. The old retrieval path is
   deleted only after the shadow window closes clean.

---

## 9. Phased Implementation Plan

| Phase | Content | Complexity | Depends on |
|---|---|---|---|
| **P0 Foundations** | `keith_requests` + rate limiting + lift model string into server routing + temperature; fix R5 stale docs; propose R6 `program_events` RLS fix as an Owner SQL gate item | S (1 migration, ~2 endpoints touched) | approvals D8, D11; R6 SQL is Owner-gated separately |
| **P1 Skill runtime + RIQ** | skills schema, admin endpoint, minimal Skills panel (list/drawer/lifecycle/enable), runtime invocation path, resume extraction, RIQ skill, invocation audit, disclosure footer, evals | L | P0; approvals D1-D7, D9 |
| **P2 Vault authoring** | markdown format + metadata columns, editor + preview, wikilinks + backlinks index, link checker, restore UI, editor-name fix, date enforcement | M | approval D2 (independent of P1) |
| **P3 Vault migration + retrieval** | export/convert/review of 26 entries, alias/tag scoring, retire hardcoded boosts, shadow mode, citations footer | M | P2 |
| **P4 Later** | skill test-runner UI polish, version diff views, "Add to interview preparation", additional skills, Postgres FTS if entry count grows | M+ | P1-P3 learnings |

P1 and P2 are independent tracks after P0 and can be sequenced either way.

## 10. Test and Evaluation Plan

- **Unit (node --test, existing style):** frontmatter parser/serializer
  round-trip; SKILL.md package validator; wikilink extraction/resolution and
  backlink index; markdown renderer extensions (escaping preserved, wikilink
  rendering, no raw HTML); redaction pass (emails/phones/addresses/URLs);
  extraction-failure taxonomy; skill authorization matrix (role × skill ×
  data grant, default-deny); retrieval scoring with aliases/tags/dates;
  migration converter (no content loss, deterministic frontmatter).
- **Source-guard pins:** model id never client-supplied; skill instructions
  only load post-authorization; invocation audit writes metadata only;
  `[[ACTIVE_SKILL]]` splice mirrors the governed-knowledge fallback
  (prepend if marker missing).
- **Skill evals (synthetic resumes, run via keith_skill_tests before
  activation):** correct student resolution incl. ambiguity refusal;
  unauthorized caller refusal (viewer, unentitled interviewer, co-lead);
  one question per domain, exactly three; every question's basis actually
  appears in the fixture resume (string-anchored check); thin-resume
  honesty case; unreadable/.doc case; injection fixture (resume containing
  instructions) does not alter behavior.
- **Retrieval evals:** stale/deprecated exclusion, citation correctness,
  shadow-mode diff review, latency and token budget per request from
  `keith_requests`.
- **Live QC:** mocked-session harness (zero production data) for the
  Settings surfaces and the chat disclosure footer, per house pattern.

---

## 11. Decisions Requiring Jester's Approval

- **D1 Resume text to Anthropic.** The runtime already sends student PII to
  the Anthropic API; extending that to extracted resume text is consistent
  but is an explicit data-classification call. Recommend: approve, Anthropic
  API only, with the D4 redaction pass. Blocks P1.
- **D2 Source of truth.** DB-backed Markdown with import/export (recommended,
  Section 2.4) vs git-backed vs hybrid; and skills follow the same choice.
  Blocks P1 and P2.
- **D3 Parsing dependencies and formats.** Approve two server-only pure-JS
  extractors (PDF, DOCX; exact packages vetted at implementation). Legacy
  `.doc` gets the honest unreadable state, not a third parser. Alternative
  rejected: no new deps means no resume skill. Blocks P1.
- **D4 Redaction floor.** Strip emails, phones, street addresses, URLs from
  resume text before inference. Recommend: yes.
- **D5 Skill versioning.** Integer forward-only (house pattern) with derived
  semver at the package boundary (recommended) vs hand-managed semver.
- **D6 Auto-invocation policy.** Confidential skills: explicit invocation or
  exact trigger phrase only, always disclosed (recommended). Internal skills
  may match loosely.
- **D7 Settings placement.** Activate the reserved `keith` section as the
  Skills home (recommended) vs a panel under Knowledge Center.
- **D8 Rate limits.** 30 requests/profile/10 min, skills ×2, 429 with
  friendly copy (tunable). Blocks P0.
- **D9 Phase 1 output destination.** Chat only (recommended); "Add to
  interview preparation" deferred to P4.
- **D10 Phase order.** P0 -> P1 (skills first) -> P2/P3, i.e. skills before
  vault (recommended, RIQ is the highest-value slice) vs vault first.
- **D11 Temperature.** Set explicitly (0.2 runtime-wide) instead of the
  current unset 1.0 default. Small but behavior-affecting; recommend yes,
  verified against existing Keith QC expectations.
- **D12 R6 fix.** Queue the `program_events` RLS lockdown as an Owner SQL
  gate item now (recommended), independent of this project.
- **D13 Co-lead access.** Skills default-deny co-lead (consistent with the
  tool matrix's open question). Recommend: keep denied until the standing
  co-lead decision is made.

## 12. Recommended Smallest Valuable Phase 1

**P0 + P1: foundations, the skill runtime, and Resume Interview Questions in
chat, with the minimal Skills panel.** One migration wave, one new admin
endpoint, one skill that delivers visible interviewer value on day one, and
the instrumentation that every later phase needs anyway. The Knowledge Vault
(P2/P3) follows as an independent track on the same governance chassis.
