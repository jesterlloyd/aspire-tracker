// src/portal/unit/unitInterviewsApi.js
//
// NGRP-INTERVIEWS-1 Phase 3: the browser side of /api/portal/unit-interviews, through the Unit
// Leader Portal's own apiFetch (the caller's JWT). Every call returns apiFetch's
// { ok, status, data, error } and never throws.
import { apiFetch, ALL_UNITS } from './unitLeaderApi'

const call = (action, body = {}) => apiFetch('/api/portal/unit-interviews', { method: 'POST', body: { action, ...body } })

export const fetchUnitInterviews = unitKey => call('overview', unitKey && unitKey !== ALL_UNITS ? { unit_key: unitKey } : {})
export const fetchRubricBook = candidateId => call('rubric_get', { candidate_id: candidateId })
export const saveNgrpRubric = (candidateId, fields) => call('rubric_save', { candidate_id: candidateId, ...fields })
export const openInterviewTimes = block => call('times_open', block)
export const removeInterviewTimes = blockId => call('times_remove', { block_id: blockId })
export const setInterviewSlotBlocked = (slotId, blocked) => call(blocked ? 'slot_block' : 'slot_unblock', { slot_id: slotId })
