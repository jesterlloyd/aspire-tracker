// lib/server/budget/concur.js
//
// BUDGET-CONCUR-1 (Owner, 2026-09-30): "have a better way for Keith to help me submit to Concur ...
// when I open a receipt modal, it shows what to put in Concur". On request, Keith (the prepare-concur
// Skill) drafts the Concur entry for one filed Personal (Concur) receipt from the receipt's own fields
// and the reimbursement policy: the Knowledge Center entries the question retrieves, and the Program
// Budget's policy rules. The draft is saved on the receipt (budget_receipts.concur_guidance), so it
// opens instantly next time and costs one model call per receipt.
//
// The amount, the date and the 60-day deadline are the app's, never the model's. Marking a receipt
// Submitted or Reimbursed is not here: the panel writes each row's status through expense_update, the
// same path as the Sheet's Stage and its Concur checkbox, so the three always agree.

import { BudgetError, notEnabled, updateExpense, internals as I } from './engine.js'
import { runKeithSkill } from '../keith/runKeithSkill.js'
import { retrieveGovernedKnowledge } from '../keith/knowledgeRetrieval.js'
import { PREPARE_CONCUR, DRAFT_LATE_NOTE } from '../keith/skillDefs.js'
import { concurDeadline, concurTiming } from '../../../src/lib/budget/receiptChecks.js'
import { needsPolicyConfirm } from '../../../src/lib/budget/filedModel.js'
import { pacificToday, usd } from '../../../src/lib/budget/budgetModel.js'
import { statedTotal } from '../../../src/lib/budget/receiptModel.js'

export const CONCUR_SKILL = PREPARE_CONCUR.key
export const LATE_NOTE_SKILL = DRAFT_LATE_NOTE.key
// RECEIPTS-REDESIGN-1: the deadline is the ONE rule (receiptChecks.concurDeadline), read from the owner's
// 'concur_60_days' policy rule; with no rule on file it is 60 days, as before.
const DEFAULT_RULE = Object.freeze({ key: 'concur_60_days', enabled: true, params: { deadline_days: 60 } })
export async function concurRule(db) {
  const { data, error } = await db.from('budget_policy_rules').select('*').eq('key', 'concur_60_days').limit(1)
  return error || !data?.[0] ? DEFAULT_RULE : data[0]
}
const OFF = 'Keith’s Prepare for Concur skill is off. Turn it on in Settings > Keith > Skills (Activate, then Enable).'
const NOT_ENABLED = 'Concur drafts need their database update (20261026000000_budget_concur.sql).'

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100

/** The question the Knowledge Center is searched with: the policy words, then what was bought. */
export function policyQuestion(receipt, rows) {
  const meal = rows.some(r => r.business_purpose || (r.attendees || []).length)
  return ['Concur business expense reimbursement policy receipt business purpose documentation',
    receipt.vendor, ...new Set(rows.map(r => r.category).filter(Boolean)), meal ? 'meals attendees' : '', rows.some(r => r.subscription) ? 'subscription' : '']
    .filter(Boolean).join(' ')
}

/** What Keith is sent about the receipt: its own fields only, no file and no card number. */
export function receiptInput(receipt, rows) {
  return {
    vendor: receipt.vendor, date: receipt.date, order_number: receipt.order_number || '', total: receipt.total,
    lines: rows.map(r => ({ item: r.item, category: r.category, amount: r.amount, subscription: r.subscription || null, platform: r.tag === 'platform' })),
    business_purpose: rows.find(r => r.business_purpose)?.business_purpose || '',
    attendees: (rows.find(r => (r.attendees || []).length)?.attendees || []).map(a => [a.name, a.title, a.organization, a.relationship].filter(Boolean).join(', ')),
  }
}

/**
 * Keith drafts the Concur entry for a filed receipt, and it is saved on the receipt. `complete` is
 * the model call (a test passes a stub). Returns the saved guidance.
 */
export async function prepareConcur(db, actor, { id, complete }) {
  const { data: recs, error } = await db.from('budget_receipts').select('*').eq('id', id).limit(1)
  if (error) throw new BudgetError('db_failed', 'The receipt could not be read.', 500)
  const rec = recs?.[0]
  if (!rec) throw new BudgetError('not_found', 'That receipt no longer exists.', 404)
  if (!('concur_guidance' in rec)) throw new BudgetError('not_enabled', NOT_ENABLED, 409)
  if (rec.status !== 'accepted') throw new BudgetError('invalid_state', 'Only a filed receipt can be prepared for Concur.', 409)
  const ids = rec.expense_ids || []
  const expenses = ids.length ? (await I.q(db.from('budget_expenses').select('*').in('id', ids))).filter(e => !e.deleted_at) : []
  if (!expenses.length) throw new BudgetError('no_rows', 'This receipt’s rows have been deleted from the Sheet.', 409)
  if (!expenses.every(e => e.payment_method === 'personal_concur')) throw new BudgetError('not_concur', 'Only a Personal (Concur) purchase goes to Concur.', 409)
  const subIds = [...new Set(expenses.map(e => e.subscription_id).filter(Boolean))]
  const [categories, subs, rulesRes] = await Promise.all([
    I.categoriesOf(db),
    subIds.length ? I.q(db.from('budget_subscriptions').select('id, name').in('id', subIds)) : [],
    db.from('budget_policy_rules').select('label, message, tone, applies_to, enabled').order('sort_order'),
  ])
  const cat = new Map(categories.map(c => [c.id, c.name]))
  const sub = new Map(subs.map(s => [s.id, s.name]))
  const d = rec.draft || {}, p = rec.proposal || {}
  const receipt = {
    vendor: d.vendor || p.vendor || rec.file_name, date: d.date || p.date || '', order_number: d.order_number || p.order_number || '',
    total: statedTotal(d, p),
  }
  const rows = expenses.map(e => ({
    item: e.item, category: cat.get(e.category_id) || null, amount: round2(e.amount), subscription: e.subscription_id ? sub.get(e.subscription_id) || 'Subscription' : null,
    tag: e.tag || null, business_purpose: e.business_purpose || '', attendees: Array.isArray(e.attendees) ? e.attendees : [],
  }))
  const rules = (rulesRes.error ? [] : rulesRes.data || []).filter(r => r.enabled !== false).map(r => `- ${r.label}: ${r.message}`).join('\n')
  const knowledge = await retrieveGovernedKnowledge(db, policyQuestion(receipt, rows))

  const out = await runKeithSkill(db, CONCUR_SKILL, {
    receipt: { value: receiptInput(receipt, rows), refs: [{ type: 'budget_receipt', id }] },
    policy: { value: knowledge.block || '', refs: (knowledge.slugs || []).map(s => ({ type: 'knowledge_entry', id: s })) },
    rules: { value: rules, refs: [] },
  }, { actor, entity: { id, field: 'concur_guidance' }, complete, invocationMode: 'receipt_panel' })
  if (!out.ok) {
    if (out.reason === 'off') throw new BudgetError('keith_off', OFF, 409)
    if (out.reason === 'denied') throw new BudgetError('forbidden', out.message, 403)
    throw new BudgetError('keith_failed', 'Keith could not draft the Concur entry. Try again in a moment.', 502)
  }
  const amount = round2(rows.reduce((a, r) => a + r.amount, 0))
  const guidance = {
    ...out.output,
    vendor: receipt.vendor, date: receipt.date, amount, order_number: receipt.order_number,
    due_by: concurDeadline(receipt.date, await concurRule(db)),
    policy_found: !!knowledge.governedCovered, policy_entries: knowledge.slugs || [],
    provenance_id: out.provenanceId || null, prepared_at: new Date().toISOString(), prepared_by: actor?.full_name || '',
  }
  const { error: saveError } = await db.from('budget_receipts').update({ concur_guidance: guidance, concur_prepared_at: guidance.prepared_at }).eq('id', id)
  if (saveError) {
    if (notEnabled(saveError)) throw new BudgetError('not_enabled', NOT_ENABLED, 409)
    throw new BudgetError('save_failed', 'The Concur draft could not be saved.', 500)
  }
  // A new draft has new checks, so an earlier confirmation no longer stands (best effort: before
  // 20261101000000 there is no such column).
  await db.from('budget_receipts').update({ policy_confirmed_at: null, policy_confirmed_by: null }).eq('id', id)
  return { guidance }
}

// ── RECEIPTS-REDESIGN-1 (Owner, 2026-10-01): the receipt's own stage, policy tick and late note ──

const REDESIGN = 'This needs the Receipts database update (20261101000000_receipts_redesign.sql).'
const STAGES = ['recorded', 'submitted', 'reimbursed']
async function filedReceipt(db, id) {
  const { data, error } = await db.from('budget_receipts').select('*').eq('id', id).limit(1)
  if (error) throw new BudgetError('db_failed', 'The receipt could not be read.', 500)
  const rec = data?.[0]
  if (!rec) throw new BudgetError('not_found', 'That receipt no longer exists.', 404)
  if (rec.status !== 'accepted') throw new BudgetError('invalid_state', 'Only a filed receipt goes to Concur.', 409)
  const ids = rec.expense_ids || []
  const rows = ids.length ? (await I.q(db.from('budget_expenses').select('*').in('id', ids))).filter(e => !e.deleted_at) : []
  return { rec, rows, concur: rows.filter(e => e.payment_method === 'personal_concur' && e.status !== 'void') }
}

/**
 * Mark a filed receipt Submitted to Concur, Reimbursed, or back (Undo). Every Personal (Concur) row
 * of the receipt moves through updateExpense, the Sheet's own path, so the Stage, the Submitted to
 * Concur box, the stored dates and the history line all follow. Marking Submitted from here waits
 * for the policy tick when Keith's draft carries a warning; the Sheet and Close month do not ask
 * (Owner, 2026-10-01: the confirmation gates the receipt modal only).
 */
export async function setReceiptStage(db, actor, { id, to, today = pacificToday() }) {
  if (!STAGES.includes(to)) throw new BudgetError('invalid_stage', 'Choose Submitted to Concur, Reimbursed, or not submitted.')
  const { rec, concur } = await filedReceipt(db, id)
  if (!concur.length) throw new BudgetError('not_concur', 'Only a Personal (Concur) purchase goes to Concur.', 409)
  const forward = to === 'submitted' && concur.some(e => e.status === 'recorded')
  // Before 20261101000000 the tick cannot be stored, so the modal keeps it for the session and nothing is asked here.
  if (forward && 'policy_confirmed_at' in rec && needsPolicyConfirm(rec.concur_guidance) && !rec.policy_confirmed_at) throw new BudgetError('confirm_first', 'Confirm the business purpose first.', 409)
  const before = concur.map(e => ({ id: e.id, status: e.status }))
  const rows = []
  for (const e of concur) rows.push(e.status === to ? null : await updateExpense(db, actor, { id: e.id, patch: { status: to }, today }))
  const saved = rows.filter(Boolean)
  return {
    stage: to, changed: saved.length, before,
    submitted_at: saved.map(r => r.concur_submitted_at).filter(Boolean).sort().pop() || null,
    reimbursed_at: saved.map(r => r.reimbursed_at).filter(Boolean).sort().pop() || null,
  }
}

/** The owner's tick on Keith's policy check: who confirmed it and when, on the receipt and in the log. */
export async function confirmPolicy(db, actor, { id, confirmed = true }) {
  const { rec, rows } = await filedReceipt(db, id)
  if (!('policy_confirmed_at' in rec)) throw new BudgetError('not_enabled', REDESIGN, 409)
  const at = confirmed ? new Date().toISOString() : null
  const { error } = await db.from('budget_receipts').update({ policy_confirmed_at: at, policy_confirmed_by: confirmed ? actor?.id || null : null }).eq('id', id)
  if (error) throw new BudgetError('save_failed', 'The confirmation could not be saved.', 500)
  const who = actor?.full_name || actor?.email || ''
  await I.logChanges(db, 'receipt', id, rows[0]?.budget_id || null, 'update', [{ field: 'policy_confirmed', old: !!rec.policy_confirmed_at, new: { confirmed: !!confirmed, by: who } }], actor)
  if (confirmed && rows[0]?.budget_id) {
    const d = rec.draft || {}, p = rec.proposal || {}
    await I.logEvent(db, rows[0].budget_id, 'policy_confirmed', `${d.vendor || p.vendor || 'Receipt'} ${usd(statedTotal(d, p))}: business purpose confirmed as necessary for ASPIRE operations.`, actor, null, { receipt: id }).catch(() => {})
  }
  return { confirmed: !!confirmed, confirmed_at: at, confirmed_by: confirmed ? who : '' }
}

/**
 * Keith drafts the note Concur asks for when an expense is past the limit: one paragraph with a
 * [REASON] placeholder for the owner. Only for a receipt that IS late and not yet submitted. Saved on
 * the receipt, so it opens with the modal next time.
 */
export async function draftLateNote(db, actor, { id, complete, today = pacificToday() }) {
  const { rec, concur } = await filedReceipt(db, id)
  if (!('late_note' in rec)) throw new BudgetError('not_enabled', REDESIGN, 409)
  if (!concur.length) throw new BudgetError('not_concur', 'Only a Personal (Concur) purchase goes to Concur.', 409)
  const d = rec.draft || {}, p = rec.proposal || {}
  const date = d.date || p.date || ''
  const t = concurTiming(date, await concurRule(db), today)
  if (!t || t.timing !== 'late' || !concur.some(e => e.status === 'recorded')) throw new BudgetError('not_late', 'A late note is only for a receipt past the limit and not yet submitted.', 409)
  const out = await runKeithSkill(db, LATE_NOTE_SKILL, {
    receipt: { value: {
      vendor: d.vendor || p.vendor || rec.file_name, date, total: statedTotal(d, p), order_number: d.order_number || p.order_number || '',
      lines: concur.map(e => ({ item: e.item, amount: round2(e.amount), subscription: !!e.subscription_id, platform: e.tag === 'platform' })),
      due_by: t.deadline, days_late: -t.daysLeft,
    }, refs: [{ type: 'budget_receipt', id }] },
  }, { actor, entity: { id, field: 'late_note' }, complete, invocationMode: 'receipt_panel' })
  if (!out.ok) {
    if (out.reason === 'off') throw new BudgetError('keith_off', 'Keith’s Draft Late Note skill is off. Turn it on in Settings > Keith > Skills (Activate, then Enable).', 409)
    if (out.reason === 'denied') throw new BudgetError('forbidden', out.message, 403)
    throw new BudgetError('keith_failed', 'Keith could not draft the late note. Try again in a moment.', 502)
  }
  const note = { text: out.output.note, drafted_at: new Date().toISOString(), provenance_id: out.provenanceId || null }
  const { error } = await db.from('budget_receipts').update({ late_note: note }).eq('id', id)
  if (error) throw new BudgetError('save_failed', 'The late note could not be saved.', 500)
  return { late_note: note }
}
