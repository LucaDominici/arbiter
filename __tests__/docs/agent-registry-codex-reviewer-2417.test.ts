// SPDX-License-Identifier: Apache-2.0
// __tests__/docs/agent-registry-codex-reviewer-2417.test.ts
// #2417 AC-1/C: AGENT_REGISTRY.md's "Source of truth: `.claude/agents/<name>.md`"
// contract is broken by the `codex-reviewer` row — it is a CLI seat
// (`arbiter review cross-model`), not an agent file. Every row without a
// matching local agent file must say so explicitly; every real agent file
// must have a row. This is the registry parity test referenced by #2417.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const REGISTRY_PATH = resolve('.claude/AGENT_REGISTRY.md')
const AGENTS_DIR = resolve('.claude/agents')

/** Parse `| \`name\` | ... |` rows out of the "## Agents" markdown table. */
function parseAgentRows(registrySrc: string): { name: string; row: string }[] {
  const section = registrySrc.split('## Agents')[1]?.split('## Interaction Chains')[0] ?? ''
  const rows: { name: string; row: string }[] = []
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|(.*)\|$/)
    if (m) rows.push({ name: m[1], row: line })
  }
  return rows
}

describe('AGENT_REGISTRY.md ↔ .claude/agents/*.md parity (#2417)', () => {
  const registrySrc = readFileSync(REGISTRY_PATH, 'utf-8')
  const rows = parseAgentRows(registrySrc)
  const localAgentFiles = new Set(
    readdirSync(AGENTS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, '')),
  )

  it('every real .claude/agents/*.md file has a matching registry row', () => {
    for (const name of localAgentFiles) {
      expect(rows.some((r) => r.name === name)).toBe(true)
    }
  })

  it('every row without a matching local agent file declares itself a CLI seat', () => {
    for (const { name, row } of rows) {
      if (!localAgentFiles.has(name)) {
        expect(row.toLowerCase()).toContain('cli seat')
      }
    }
  })

  it('the codex-reviewer row specifically is labelled a CLI seat, not an agent file', () => {
    const codexRow = rows.find((r) => r.name === 'codex-reviewer')
    expect(codexRow).toBeDefined()
    expect(codexRow?.row.toLowerCase()).toContain('cli seat')
    expect(codexRow?.row).toContain('arbiter review cross-model')
  })
})
