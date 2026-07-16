// SPDX-License-Identifier: Apache-2.0
// ADR-103 (#1873): rule 50 is templated DUAL-SIDE. The arbiter-self file
// (.claude/rules/50-batch-execution.md) is the claude template body plus a
// frontmatter block. Since ADR-106 (#1966) the Codex track DERIVES the rule
// from the same claude template (the parallel codex copy was deleted), so
// codex-side parity is structural: this suite pins the derivation mapping
// and refuses any resurrected parallel copy. A carve-out edit therefore
// lands on the claude template + self file only, and reaches Codex for free.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CODEX_DERIVED_RULES } from '../../src/generators/codex-known-limitations.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SELF_FILE = join(repoRoot, '.claude', 'rules', '50-batch-execution.md')
const CLAUDE_TEMPLATE = join(
  repoRoot,
  'src',
  'templates',
  'claude',
  'rules',
  '50-batch-execution.md',
)
const LEGACY_CODEX_TEMPLATE = join(
  repoRoot,
  'src',
  'templates',
  'codex',
  'rules',
  '50-batch-execution.md',
)

/** Strip the leading `--- ... ---` frontmatter block, if present. */
function body(content: string): string {
  if (!content.startsWith('---\n')) return content
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return content
  return content.slice(end + '\n---\n'.length).replace(/^\n/, '')
}

describe('rule 50 dual-side parity (ADR-103, #1873)', () => {
  it('self file body is byte-equal to the claude template', () => {
    const self = body(readFileSync(SELF_FILE, 'utf-8'))
    const template = readFileSync(CLAUDE_TEMPLATE, 'utf-8')
    expect(self).toBe(template)
  })

  it('codex side is DERIVED from the claude template — no parallel copy exists (ADR-106)', () => {
    const mapping = CODEX_DERIVED_RULES.find((r) => r.file === '50-batch-execution.md')
    expect(mapping, 'rule 50 must stay in the codex derivation plan').toBeDefined()
    expect(mapping!.template).toBe('claude/rules/50-batch-execution.md')
    expect(
      existsSync(LEGACY_CODEX_TEMPLATE),
      'a resurrected parallel codex copy would reintroduce the #1966 drift class',
    ).toBe(false)
  })

  it('documents the worktree-isolated carve-out with ALL-conditions semantics', () => {
    const template = readFileSync(CLAUDE_TEMPLATE, 'utf-8')
    expect(template).toMatch(/ADR-103/)
    expect(template).toMatch(/carve-out/i)
    expect(template).toMatch(/worktree/i)
    // The exemption is conditional on ALL conditions holding.
    expect(template).toMatch(/ALL of the following/i)
    // Deps stay prohibited even under the carve-out.
    expect(template).toMatch(/package\.json/)
    // Lock-order rule is stated (leaf gate-exec, total order).
    expect(template).toMatch(/gate-lock ≺ worktree-lock ≺ wave-claim/)
  })

  it('keeps the baseline prohibitions for same-tree parallel agents', () => {
    const template = readFileSync(CLAUDE_TEMPLATE, 'utf-8')
    expect(template).toMatch(/Prohibited in Parallel Agents/)
    expect(template).toMatch(/Commit to git/)
    expect(template).toMatch(/Create branches or tags/)
  })
})
