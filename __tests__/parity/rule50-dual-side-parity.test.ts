// SPDX-License-Identifier: Apache-2.0
// ADR-103 (#1873): rule 50 is templated DUAL-SIDE. The arbiter-self file
// (.claude/rules/50-batch-execution.md) is the claude template body plus a
// frontmatter block, and the codex template mirrors the claude template
// byte-for-byte. Any carve-out edit must land on ALL THREE surfaces —
// this parity test makes a single-side edit impossible to merge.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const CODEX_TEMPLATE = join(repoRoot, 'src', 'templates', 'codex', 'rules', '50-batch-execution.md')

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

  it('codex template is byte-equal to the claude template', () => {
    const codex = readFileSync(CODEX_TEMPLATE, 'utf-8')
    const claude = readFileSync(CLAUDE_TEMPLATE, 'utf-8')
    expect(codex).toBe(claude)
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
