/* global process */
// KNOWLEDGE-ENRICH-1: the Owner-triggered vault enrichment endpoint.
//
// Two actions, orchestrated by the client so no single serverless invocation
// ever holds more than ONE model call:
//   enrich_plan   - read the whole ACTIVE corpus, one model call, return the
//                   validated vault plan (tag vocabulary, per-entry aliases/
//                   tags/links). Nothing is written.
//   enrich_entry  - one entry: re-read it and the catalog server-side, one
//                   model call, run the hard validation gates, and write a
//                   PENDING REVISION through the same constraints the manual
//                   submit path enforces. Nothing else is written.
//
// OWNER ONLY - stricter than knowledge-admin's Owner/Admin. Generating
// proposed content across the whole governed corpus is an Owner act, like
// lifecycle.
//
// WHAT THIS ENDPOINT CANNOT DO, BY CONSTRUCTION:
//   * It never touches an entry's live body, state, or version - its only
//     write is an INSERT into knowledge_revisions, whose UNIQUE(entry_id)
//     means it cannot even overwrite a pending revision a human authored:
//     an existing revision makes the insert fail and the entry is reported
//     as skipped.
//   * It never activates anything. Apply remains the Owner's act in the
//     existing panel, through the existing RPC.
//   * The model id comes from modelRouting's QUALITY route - the id appears
//     nowhere in this file, and nothing about the model is taken from the
//     client.
//
// The plan travels client -> server between phases because the CLIENT is the
// orchestrator (Vercel's per-invocation budget cannot hold 27 model calls).
// The server treats it as untrusted input: validatePlan re-normalizes it
// against the real corpus on every call, and the entry body itself is always
// re-read server-side, never accepted from the client.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { resolveRoute, QUALITY_ROUTE } from '../lib/server/keith/modelRouting.js'
import {
  buildPlanPrompt, buildEntryPrompt, extractJson, validatePlan, validateEnrichment,
  ENRICH_CAPS,
} from '../lib/server/keith/knowledgeEnrichment.js'

const ANTHROPIC_TIMEOUT_MS = 45000
// Conversion output can exceed the chat route's 2048-token ceiling, so the
// budget is overridden HERE, for this workload only. The model id is not.
const MAX_OUTPUT_TOKENS = 8192

const ACTION_SCHEMAS = {
  enrich_plan:  ['action'],
  enrich_entry: ['action', 'entry_id', 'plan_entry'],
}

function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' }
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  let user
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { authenticated: false, status: 401, reason: 'invalid_token' }
    user = data.user
  } catch {
    return { authenticated: false, status: 401, reason: 'verify_threw' }
  }
  try {
    const admin = serviceClient()
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner, full_name, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    if (profile.is_active === false) return { authenticated: false, status: 403, reason: 'deactivated' }
    return {
      authenticated: true, profileId: profile.id, role: profile.role || '',
      isOwner: profile.is_owner === true, userName: profile.full_name || '',
    }
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' }
  }
}

async function callAnthropic(prompt) {
  const route = resolveRoute(QUALITY_ROUTE)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS)
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: route.model,
        temperature: route.temperature,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}))
      return { ok: false, error: errorBody?.error?.type || `http_${response.status}` }
    }
    const json = await response.json()
    const text = (json?.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    return {
      ok: true, text,
      usage: { input: json?.usage?.input_tokens ?? 0, output: json?.usage?.output_tokens ?? 0 },
      model: route.model,
    }
  } catch (err) {
    clearTimeout(timeoutId)
    return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'network' }
  }
}

// Only ACTIVE entries are enriched or offered as link targets: revisions only
// exist for active entries, and the plan should not point readers at drafts.
const CORPUS_COLS = 'id, slug, title, category, state, body, body_format, aliases, tags, source_attribution, precedence_rank, review_date, confidence'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'model_unavailable' })

  const requestId = `ke_${randomUUID().slice(0, 8)}`
  const auth = await verifyCaller(req)
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: auth.reason || 'unauthorized' })
  // OWNER ONLY. Admins review; the Owner triggers.
  if (!auth.isOwner) return res.status(403).json({ error: 'owner_required' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = String(body.action || '')
  const schema = ACTION_SCHEMAS[action]
  if (!schema) return res.status(400).json({ error: 'unknown_action' })
  const extra = Object.keys(body).filter(k => k !== 'action' && !schema.includes(k))
  if (extra.length) return res.status(400).json({ error: 'unexpected_field', field: extra[0] })

  const db = serviceClient()

  try {
    switch (action) {
      case 'enrich_plan': {
        const { data: entries, error } = await db.from('knowledge_entries')
          .select(CORPUS_COLS).eq('state', 'active').order('title')
        if (error) return res.status(500).json({ error: 'internal_error' })
        const corpus = entries || []
        if (!corpus.length) return res.status(409).json({ error: 'empty_corpus' })

        const prompt = buildPlanPrompt(corpus)
        const call = await callAnthropic(prompt)
        if (!call.ok) return res.status(502).json({ error: 'model_failed', detail: call.error })

        const parsed = validatePlan(extractJson(call.text), corpus)
        if (!parsed.ok) return res.status(502).json({ error: 'plan_unparseable' })

        console.log('[knowledge-enrich] plan', {
          request_id: requestId, entries: corpus.length,
          input_tokens: call.usage.input, output_tokens: call.usage.output,
        })
        return res.status(200).json({
          plan: parsed.plan,
          warnings: parsed.warnings,
          model: call.model,
          usage: call.usage,
          // The run manifest: what Phase B should iterate, with skip reasons
          // decided up front so the client never guesses.
          manifest: corpus.map(e => ({
            id: e.id, title: e.title, slug: e.slug,
            chars: String(e.body || '').length,
            skip: String(e.body || '').length > ENRICH_CAPS.maxSourceChars ? 'too_large' : null,
          })),
        })
      }

      case 'enrich_entry': {
        const entryId = String(body.entry_id || '')
        if (!/^[0-9a-f-]{36}$/i.test(entryId)) return res.status(400).json({ error: 'invalid_request', field: 'entry_id' })

        // The catalog and the entry are ALWAYS re-read server-side.
        const { data: entries, error } = await db.from('knowledge_entries')
          .select(CORPUS_COLS).eq('state', 'active')
        if (error) return res.status(500).json({ error: 'internal_error' })
        const catalog = entries || []
        const entry = catalog.find(e => e.id === entryId)
        if (!entry) return res.status(404).json({ error: 'not_found_or_not_active' })
        if (String(entry.body || '').length > ENRICH_CAPS.maxSourceChars) {
          return res.status(409).json({ error: 'skipped', reason: 'too_large' })
        }

        // No-clobber: an existing pending revision - human or AI - is never
        // replaced. The DB's UNIQUE(entry_id) backstops this check.
        const { data: pending } = await db.from('knowledge_revisions')
          .select('id').eq('entry_id', entryId).maybeSingle()
        if (pending) return res.status(409).json({ error: 'skipped', reason: 'pending_revision_exists' })

        // The client-supplied plan slice is UNTRUSTED: re-validate it against
        // the real corpus before it shapes anything.
        const planCheck = validatePlan(
          { entries: [{ ...(body.plan_entry || {}), id: entryId }] }, catalog)
        const planSlice = planCheck.ok ? planCheck.plan.entries.find(p => p.id === entryId) : { aliases: [], tags: [], links: [], flags: [] }

        const prompt = buildEntryPrompt(entry, planSlice, catalog)
        const call = await callAnthropic(prompt)
        if (!call.ok) return res.status(502).json({ error: 'model_failed', detail: call.error })

        const proposal = extractJson(call.text)
        const gate = validateEnrichment({ entry, proposal, plan: planSlice, catalog })
        if (!gate.ok) {
          console.warn('[knowledge-enrich] gate failed', { request_id: requestId, entry_id: entryId, reason: gate.reason })
          return res.status(422).json({ error: 'gate_failed', reason: gate.reason, detail: gate.detail })
        }

        // The ONLY write: a pending revision, same shape and caps as the
        // manual submit path. body_format flips to markdown - that IS the
        // conversion, and it takes effect only when the Owner applies.
        const row = {
          entry_id: entry.id,
          title: entry.title,
          category: entry.category,
          body: gate.body,
          source_attribution: entry.source_attribution || '',
          precedence_rank: entry.precedence_rank ?? 100,
          change_note: gate.changeNote,
          author_id: auth.profileId,
          submitted_at: new Date().toISOString(),
          body_format: 'markdown',
          aliases: planSlice.aliases,
          tags: planSlice.tags,
          review_date: entry.review_date,
          confidence: entry.confidence,
        }
        const { data: rev, error: iErr } = await db.from('knowledge_revisions').insert(row).select('id').maybeSingle()
        if (iErr) {
          if (iErr.code === '23505') return res.status(409).json({ error: 'skipped', reason: 'pending_revision_exists' })
          console.error('[knowledge-enrich] insert failed', { request_id: requestId, code: iErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }

        try {
          await db.from('activity_logs').insert({
            user_id: auth.profileId, user_name: auth.userName, user_role: auth.role,
            action_type: 'knowledge_enrichment_proposed', entity_type: 'knowledge_entry',
            entity_id: String(entry.id), description: 'AI-assisted enrichment proposed as pending revision',
            metadata: {
              revision_id: rev.id, model: call.model,
              input_tokens: call.usage.input, output_tokens: call.usage.output,
              links: gate.links.length, unresolved_unwrapped: gate.unresolvedUnwrapped,
              flags: gate.flags.length,
            },
          })
        } catch { /* audit is best-effort; the revision already exists */ }

        console.log('[knowledge-enrich] proposed', {
          request_id: requestId, entry_id: entry.id,
          input_tokens: call.usage.input, output_tokens: call.usage.output,
        })
        return res.status(200).json({
          success: true, revision_id: rev.id,
          links: gate.links, flags: gate.flags,
          unresolved_unwrapped: gate.unresolvedUnwrapped,
          usage: call.usage, model: call.model,
        })
      }

      default:
        return res.status(400).json({ error: 'unknown_action' })
    }
  } catch (err) {
    console.error('[knowledge-enrich] unhandled', { request_id: requestId, action, reason: err?.message })
    return res.status(500).json({ error: 'internal_error' })
  }
}
