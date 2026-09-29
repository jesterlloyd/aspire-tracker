// lib/server/keith/checkinShadow.js
//
// KEITH-CHECKIN-1: the shadow-mode figures for sort-checkin-reply, and the rule that holds auto-close
// shut. Kept apart from runKeithSkill.js so the skill definition can use it without an import cycle.
//
// Turning auto-close on is refused (setSkillMode -> gateOn) until SHADOW_DAYS have passed since
// Keith's first shadow sort AND no reply Keith would have closed was kept open by a person.

import { SKILL_KEY, agrees, keptOpenCount, gateState } from '../../../src/lib/keith/checkinSortModel.js'
import { computeAgreement } from '../../../src/lib/keith/provenanceModel.js'

export async function checkinShadowFigures(db) {
  const { data, error } = await db.from('keith_provenance').select('output, human_diff, created_at')
    .eq('skill_key', SKILL_KEY).eq('mode', 'shadow').order('created_at', { ascending: true })
  if (error) return { firstShadowAt: null, keptOpen: 0, agreement: computeAgreement([]), sorted: 0 }
  const pairs = (data || []).map(r => ({ keith: r.output?.label ?? null, human: r.human_diff?.label ?? null }))
  return {
    firstShadowAt: data?.[0]?.created_at || null,
    keptOpen: keptOpenCount(pairs),
    agreement: computeAgreement(pairs, agrees),
    sorted: pairs.length,
  }
}

export async function checkinGateOn(db, now = Date.now()) {
  const f = await checkinShadowFigures(db)
  const g = gateState({ firstShadowAt: f.firstShadowAt, keptOpen: f.keptOpen, now })
  return { ok: g.ok, message: g.message, figures: f }
}
