// NGRP-WORKSPACE-1: read hooks for the NGRP cycle tables.
//
// The tables (ngrp_cycles, ngrp_candidates) ship in migration
// 20260903000000_ngrp_foundation.sql, which is Owner-gated and NOT yet
// applied. Until it is, PostgREST reports the tables as missing (PGRST205 /
// 42P01). These hooks fail SOFT on that specific condition: the workspace
// renders fully from the canonical students state with neutral defaults, and
// `provisioned: false` tells the UI to disable the persisted actions and say
// why. Any other error surfaces normally.
//
// Reads only. Every NGRP write goes through service-role endpoints (see
// docs/product/NGRP-WORKSPACE-1.md); no client insert/update exists here.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'

const missingTable = (error) =>
  error && (
    error.code === 'PGRST205' ||           // PostgREST: table not in schema cache
    error.code === '42P01' ||              // Postgres: relation does not exist
    /find the table|does not exist/i.test(error.message || '')
  )

export function useNgrpCycles() {
  const query = useQuery({
    queryKey: ['ngrp_cycles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ngrp_cycles')
        .select('*')
        .order('residency_start_date', { ascending: false, nullsFirst: false })
      if (error) {
        if (missingTable(error)) return { provisioned: false, cycles: [] }
        throw error
      }
      return { provisioned: true, cycles: data || [] }
    },
    staleTime: 60_000,
  })
  return {
    provisioned: query.data?.provisioned ?? true,   // optimistic until first result
    cycles: query.data?.cycles || [],
    loading: query.isLoading,
    error: query.error || null,
  }
}

// Candidate rows for one cycle. Cycle-scoped (an NGRP cycle spans several
// ASPIRE cohorts), joined to the canonical students client-side by student_id.
export function useNgrpCandidates(cycleId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: ['ngrp_candidates', cycleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ngrp_candidates')
        .select('*')
        .eq('cycle_id', cycleId)
      if (error) {
        if (missingTable(error)) return []
        throw error
      }
      return data || []
    },
    enabled: Boolean(cycleId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
  return {
    candidates: query.data || [],
    loading: query.isLoading,
    error: query.error || null,
    refetch: query.refetch,
  }
}
