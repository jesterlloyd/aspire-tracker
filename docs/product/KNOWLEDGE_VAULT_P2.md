# Knowledge Vault (P2): Decisions, Scope, and Gate State

Status: **BUILT AND VERIFIED LOCALLY. AT THE MIGRATION GATE.** Not committed,
not pushed, not deployed. **No SQL applied.** The migration
`supabase/migrations/20260807000001_knowledge_vault_markdown.sql` is prepared
and frozen pending the production PRECHECK.

Plan of record: `docs/product/KEITH_SKILLS_KNOWLEDGE_VAULT_PLAN.md`, Sections
2.3, 2.4 and 3.2. This file records what the Owner decided on 2026-08-07 where
that plan left a real product choice, and what is explicitly out of scope.

Read-only PRECHECK: `db/audit/knowledge_vault_precheck.sql`.

---

## 1. Decisions locked 2026-08-07

| # | Question the plan left open | Decision | Consequence |
|---|---|---|---|
| D-A | The plan converts all existing entry bodies plain→Markdown via an agent. That step was **not executable** — there is no production database access, and production knowledge content is not given to a delegated agent. | **Opt-in per entry.** Every existing entry stays `body_format = 'plain'` and renders byte-identically. Markdown is the default for NEW pages only; an existing page converts when its author chooses, through the normal revision workflow. | The migration rewrites **zero rows**. Keith's answers cannot change as a result of applying it. |
| D-B | The plan says retrieval should exclude entries past `expires_at`. It has never been enforced, and the production blast radius was unknowable without data. | **Advisory only.** Expiry and `review_date` surface as a "Needs review" card and column. Retrieval behavior is unchanged. | Retrieval reports a `staleCount` so the *later* decision to start excluding is made on evidence. **Enforcement is NOT part of this release.** |
| D-C | The plan retires the two hardcoded retrieval patches (CS-Link aliases; email-routing aliases plus the +50 canon boost) once real aliases exist. | **Add generic alias/tag scoring, keep both patches.** Alias matches score like titles (+6), tags like categories (+3). | Scoring is **strictly additive** — no query can rank lower than before. Retiring the patches is a separate, evidence-backed change once aliases are populated in production. |
| D-D | Adding metadata columns without extending the snapshot tables would make `governance_restore_knowledge_version` silently destructive. | **Snapshot and restore everything.** Versions and revisions carry the same five fields; three RPCs are replaced so a restore returns a page completely. | `governance_change_knowledge_state` is deliberately **not** replaced: it touches no content column. |

`superseded_by` is intentionally **not** versioned. It is a lifecycle
relationship between two entries, in the same family as `state`, which this
schema has never versioned either. Restoring an old body must not resurrect a
supersession pointer that governance has since resolved.

---

## 2. Deferred — explicitly NOT in this release

### 2.1 Knowledge-table grant hardening (Owner-gated security item)

`knowledge_entries`, `knowledge_entry_versions` and `knowledge_revisions` carry
**no explicit `REVOKE`** from `anon` / `authenticated`. They rely on deny-all
RLS alone, unlike the newer `keith_*` chassis, which revokes explicitly and then
grants narrowly to `service_role`.

This release **changes none of that.** Tightening it is a real permissions
change and is queued as a **separate Owner-gated hardening item**. The new
`knowledge_links` table does follow the current chassis, which grants nothing
that did not already exist and revokes nothing anyone was using.

PRECHECK check 4 records the current grant matrix, so that future change has a
before-picture.

### 2.2 Expiry enforcement in retrieval

Deferred by D-B. The input to the decision is PRECHECK Q5: the count **and the
names** of Active entries already past `expires_at`.

---

## 3. Future roadmap — Knowledge Center Graph View

**NOT part of this migration or this release.** Recorded here so the shape is
agreed before anyone starts.

A visual view of the governed knowledge graph, alongside the existing table.

- **List | Graph** view toggle in Knowledge Center.
- **Global Graph** (the whole vault) and **Local Graph** (one page and its
  immediate neighbourhood).
- **Nodes** are governed knowledge pages.
- **Edges are derived ONLY from explicit governed relationships** in the first
  version: resolved `[[wikilinks]]` via `knowledge_links`, and supersession via
  `superseded_by`.
- **Surfaces** orphan pages, broken links, hubs, and stale or deprecated
  relationships — the same signals the link checker and review queue already
  compute, shown structurally instead of as a list.
- **Clicking a node reuses the existing knowledge entry drawer.** It does not
  introduce a second editor or a parallel content experience.

Two hard constraints:

1. **No AI-inferred semantic relationships as authoritative graph edges in v1.**
   An edge must correspond to something an author explicitly wrote. A suggested
   or inferred relationship may only ever be a clearly-labelled proposal, never
   a line on the governed graph.
2. **Do not build it until the Markdown vault is live and enough real wikilinks
   exist for the visualization to be meaningful.** A graph of a handful of
   pages with almost no edges is a worse answer than the table it replaces.

The data this needs already exists once the migration is applied:
`knowledge_links` carries source, target, status and match basis, and
`superseded_by` carries the lifecycle edge. No further schema is anticipated.

---

## 4. Gate state

| Item | State |
|---|---|
| Application code | Built, uncommitted |
| Tests | 3857/3857 pass (39 new; the Knowledge Center previously had **zero** dedicated tests) |
| Lint | Parity on every touched file — no new problems |
| Production build | Green |
| Migration | Prepared, **frozen**, **not applied** |
| PRECHECK | Delivered; awaiting production Q0 and Q5 results |
| Commit / push / deploy | Not performed |

The migration must not be altered between PRECHECK and application unless the
production results require it.
