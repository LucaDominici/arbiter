// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/check-m16-handoff.test.ts
//
// #2103 — the M16 handoff-contract SOFT gate: dispatch-template files (ship-queue /
// wave-drain briefs) must carry the M16 handoff-contract marker. Executes the real
// script (CANON-07 — no string assertions on source).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-m16-handoff.mjs')

const MARKER = 'M16 handoff-contract: subagents never own waits'

/** A temp "repo root" with a synthetic dispatch-template corpus. */
function corpusRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'm16-gate-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

function runGate(root: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf-8' })
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-m16-handoff.mjs (#2103) — dispatch templates must carry the M16 marker', () => {
  const dirs: string[] = []
  const keep = (d: string): string => {
    dirs.push(d)
    return d
  }
  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  it('a dispatch template WITHOUT the M16 marker fails the gate, naming the file', () => {
    const root = keep(
      corpusRepo({
        '.claude/skills/wave-drain/SKILL.md': '# Wave Drain\n\nBrief agents in parallel.\n',
      }),
    )
    const r = runGate(root)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('.claude/skills/wave-drain/SKILL.md')
    expect(r.stderr).toContain('M16')
  })

  it('every existing corpus file WITH the marker passes', () => {
    const marked = `# Wave Drain\n\n${MARKER}\n`
    const root = keep(
      corpusRepo({
        '.claude/skills/wave-drain/SKILL.md': marked,
        'docs/methodology/agent-orchestration-and-context-hygiene.md': `### M16 — Terminal handoff\n\n${MARKER}\n`,
      }),
    )
    const r = runGate(root)
    expect(r.status).toBe(0)
  })

  it('a corpus file that does not exist in this repo is skipped (skill may be absent)', () => {
    const root = keep(
      corpusRepo({
        '.claude/skills/wave-drain/SKILL.md': `# Wave Drain\n\n${MARKER}\n`,
      }),
    )
    const r = runGate(root)
    expect(r.status).toBe(0)
  })

  it('--self-test proves both directions with pure fixtures', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--self-test'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
  })
})
