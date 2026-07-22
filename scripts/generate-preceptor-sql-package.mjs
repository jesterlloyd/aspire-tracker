import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const handoffPath = join(root, 'docs/product/PHASE_2C_PRECEPTOR_AUTHORIZATION_HANDOFF.md')
const marker = '## Appendix A:'
const current = readFileSync(handoffPath, 'utf8')
const markerIndex = current.indexOf(marker)

if (markerIndex < 0) throw new Error(`Missing handoff marker: ${marker}`)

const appendices = [
  ['Appendix A: Phase 2B migration', 'supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql'],
  ['Appendix B: Phase 2C migration', 'supabase/migrations/20260723000000_preceptor_assignment_authorization.sql'],
  ['Appendix C: Phase 2B preflight / verification / rollback', 'db/audit/preceptor_mirror_repair_preflight_and_verification.sql'],
  ['Appendix D: Phase 2C preflight / verification / rollback', 'db/audit/preceptor_assignment_authorization_preflight_and_verification.sql'],
  ['Appendix E: Preceptor email-uniqueness preflight', 'db/audit/preceptor_email_uniqueness_preflight.sql'],
]

const rendered = appendices.map(([title, relativePath]) => {
  const sql = readFileSync(join(root, relativePath), 'utf8').replace(/\n?$/, '\n')
  return `## ${title} (${relativePath})\n\n\`\`\`sql\n${sql}\`\`\`\n`
}).join('\n')

const prefix = current.slice(0, markerIndex).replace(/\s*$/, '\n\n')
writeFileSync(handoffPath, `${prefix}${rendered}\n_End of Final Owner SQL Review Package._\n`)
