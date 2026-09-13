// MASTHEAD-SCENE-2/PHASE-1: the list of installed scene files, read from the
// artwork folder at build time by the host's bundler (Vite injects it as
// __MASTHEAD_SCENE_FILES__). Node only. Phase 2 turns this into a served
// manifest so no host ever needs to scan the folder.
import { readdirSync } from 'node:fs'

export function listSceneFiles(dir) {
  try {
    // Recursive: city packs live in one subfolder per city
    // (public/masthead/LosAngeles/LosAngeles_Day.webp); flat files still count.
    return readdirSync(dir, { recursive: true })
      .map(f => String(f).replace(/\\/g, '/'))
      .filter(f => /\.(webp|png|jpe?g)$/i.test(f))
      .sort()
  } catch {
    return []
  }
}
