// lib/server/keith/skillDefs.js
//
// KEITH-FOUNDATION-1: what each Skill that runs through runKeithSkill declares in code. The prompt
// (instruction_body), the on/off switch, the roles and the mode live in keith_skills and are the
// Owner's; the rest is here, because it is code:
//
//   inputs         the ONLY input names the runner will send. Anything else is refused, so a
//                  feature cannot quietly hand Keith a record the Skill never asked for.
//   outputVersion  bump it when the schema or the parse changes. A provenance row's skill_version
//                  is `<keith_skills.version>.<outputVersion>`, so a prompt change (the lifecycle
//                  bumps keith_skills.version) and a schema change are both visible.
//   schema         the raw output, checked by outputSchema.validate. Invalid output is dropped.
//   parse          the validated JSON to the stored output (it may clean further, and may throw).
//   request        the model call: system, messages, route overrides, timeout.
//   provenance     the confidence and reason for the record, from the output.
//   labelOf        shadow mode: the one label Keith gave, compared with the person's decision.
//   entityType     what the output attaches to.
//   intent         keith_requests.intent, so Usage & Cost keeps its existing grouping.
//
// A new Keith feature adds an entry here and calls runKeithSkill; nothing calls the model directly.

import { parseReading } from '../../../src/lib/budget/receiptModel.js'
import { lowestConfidence } from '../../../src/lib/keith/provenanceModel.js'

const NUMISH = { type: ['number', 'string', 'null'] }
const TEXTISH = { type: ['string', 'null'] }

export const READ_RECEIPT = Object.freeze({
  key: 'read-receipt',
  outputVersion: 1,
  intent: 'receipt_reading',
  entityType: 'budget_receipt',
  field: 'reading',
  inputs: Object.freeze(['receipt_file', 'categories', 'corrections', 'today']),
  schema: {
    type: 'object',
    required: ['lines'],
    properties: {
      document_type: TEXTISH, vendor: TEXTISH, order_number: TEXTISH, date: TEXTISH, date_confidence: TEXTISH,
      card_last4: TEXTISH, subtotal: NUMISH, tax: NUMISH, shipping: NUMISH, tip: NUMISH, total: NUMISH,
      lines: {
        type: 'array', maxItems: 200,
        items: {
          type: 'object',
          properties: {
            item: TEXTISH, quantity: NUMISH, amount: NUMISH, category: TEXTISH, confidence: TEXTISH, reason: TEXTISH,
            flags: { type: ['array', 'null'], items: { type: 'string' } },
          },
        },
      },
      unreadable_fields: { type: ['array', 'null'] },
      has_shipping_address: { type: ['boolean', 'null'] },
    },
  },
  // The reading as it always was (receiptModel.parseReading): categories held to the list, the card
  // cut to its last four, amounts cleaned. The stored output is this, never the raw completion.
  parse: (json, input) => parseReading(JSON.stringify(json), input.categories.value),
  // The prompt is unchanged from BUDGET-B2: the skill's instructions as the system prompt, then the
  // categories, the owner's corrections, today's date, and the file.
  request: ({ skill, input }) => {
    const categories = input.categories.value
    const examples = input.corrections.value
    const intro = [
      `CATEGORIES (use exactly one of these for each line): ${categories.join('; ')}.`,
      examples.length ? `THE OWNER'S PAST CORRECTIONS (use them for items like these):\n${examples.map(x => `- "${x.item}"${x.vendor ? ` from ${x.vendor}` : ''}: ${x.to_category}${x.from_category ? ` (not ${x.from_category})` : ''}`).join('\n')}` : '',
      `Today is ${input.today.value}. Read the receipt below and return the JSON object.`,
    ].filter(Boolean).join('\n\n')
    return {
      system: skill.instruction_body,
      messages: [{ role: 'user', content: [{ type: 'text', text: intro }, ...input.receipt_file.value] }],
      route: (r) => ({ ...r, maxTokens: Math.max(r.maxTokens, 3000), temperature: 0 }),
      timeoutMs: 50000,
    }
  },
  provenance: (out) => ({
    confidence: lowestConfidence(out.lines),
    reason: out.lines.filter(l => l.reason).map(l => `${l.item}: ${l.reason}`).join('\n').slice(0, 4000) || null,
  }),
  labelOf: null,
})

export const SKILL_DEFS = Object.freeze({ [READ_RECEIPT.key]: READ_RECEIPT })

/** What a Read line in the Keith mark's card calls each kind of input, singular and plural. */
export const INPUT_LABELS = Object.freeze({
  budget_receipt_file: ['file', 'files'],
  budget_category_correction: ['past correction', 'past corrections'],
})
