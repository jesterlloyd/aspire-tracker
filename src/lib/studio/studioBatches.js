// src/lib/studio/studioBatches.js
//
// STUDIO-1: a Studio send is cut into the bulk endpoint's batches (its ceiling is 75 a request),
// sent one after another, each with its own batch id. Pure.
export const BATCH_MAX = 75

/** Split a list into batches of at most `size`, in order. */
export function toBatches(list, size = BATCH_MAX) {
  const out = []
  for (let i = 0; i < (list || []).length; i += size) out.push(list.slice(i, i + size))
  return out
}
