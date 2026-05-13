/**
 * Shared helpers for review subagent prompt construction (#235, #236).
 *
 * Both `dispatch.ts` (plan review) and `multi-agent.ts` (code review)
 * embed:
 *   - an `ssotDigest` of `AGENTS.md` so the agent can verify it has the
 *     same source-of-truth view as the orchestrator
 *   - XML-escaped prompt content
 *
 * The two helpers used to live duplicated in each file. This module is
 * the canonical home — both callers must import from here.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SHA-256 of `<dir>/AGENTS.md`. Returns 64 zeros when AGENTS.md is
 * absent so the digest field can always be embedded — agents are
 * expected to flag the all-zero digest as a missing-SSOT condition.
 */
export function computeSsotDigest(dir: string): string {
  const agentsPath = join(dir, 'AGENTS.md')
  if (!existsSync(agentsPath)) return '0'.repeat(64)
  const body = readFileSync(agentsPath, 'utf-8')
  return createHash('sha256').update(body).digest('hex')
}

/**
 * Minimal XML escape for `<`, `>`, `&`. Prompts are emitted to stdout
 * as a streamable XML envelope; full attribute/CDATA escaping is not
 * required because we never embed user content inside attributes.
 */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
