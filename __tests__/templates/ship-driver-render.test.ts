// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const SHIP_VARS = { shipLabel: 'ship', harnessCmd: 'claude' }
const dummyDir = '/tmp/arbiter-ship-render-test'

function baseData(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...makeConfig(dummyDir), ...SHIP_VARS, ...overrides } as unknown as Record<
    string,
    unknown
  >
}

function renderSupervisor(overrides: Record<string, unknown> = {}): string {
  return renderTemplate('ship/supervisor.sh.ejs', baseData(overrides))
}

function renderTickPrompt(overrides: Record<string, unknown> = {}): string {
  return renderTemplate('ship/TICK_PROMPT.md.ejs', baseData(overrides))
}

function renderShipCommand(): string {
  return renderTemplate('claude/commands/ship.md.ejs', baseData({}))
}

function renderPeerShipCommand(): string {
  return renderTemplate(
    'claude/commands/ship.md.ejs',
    baseData({ collaborationMode: 'peer-review' }),
  )
}

describe('supervisor.sh.ejs render', () => {
  it('is fail-closed bash with HALT + bounded ticks', () => {
    const sh = renderSupervisor()
    expect(sh).toContain('set -euo pipefail')
    expect(sh).toContain('.arbiter/ship/HALT')
    expect(sh).toContain('MAX_TICKS')
  })

  it('contains no sequencing/phase logic (engine owns it)', () => {
    const sh = renderSupervisor()
    for (const phase of ['red-team-review', 'refactor', 'verification', 'preflight']) {
      expect(sh).not.toContain(phase)
    }
  })

  it('tolerates gh failure in the backlog check (no bare $(gh) under set -e)', () => {
    const sh = renderSupervisor()
    expect(sh).toMatch(/if\s+!\s+open=\$\(gh issue list/)
    expect(sh).toContain("--json number --jq 'length'")
  })

  it('quotes the ship label substitution (injection guard)', () => {
    const sh = renderSupervisor()
    expect(sh).toContain("--label 'ship'")
  })

  it('does not bake permission escalation', () => {
    const sh = renderSupervisor()
    expect(sh).not.toContain('--dangerously-skip-permissions')
    expect(sh).toContain('--permission-mode acceptEdits')
    expect(sh).toContain('--max-turns')
  })

  it('never touches engine attempts state', () => {
    expect(renderSupervisor()).not.toContain('attempts.json')
  })

  it('contains no pilot provenance strings', () => {
    const sh = renderSupervisor()
    expect(sh.toLowerCase()).not.toContain('redux')
    expect(sh.toLowerCase()).not.toContain('haben')
  })

  it('renders identically across governance levels (driver is level-agnostic)', () => {
    expect(renderSupervisor({ governanceLevel: 'L1' })).toBe(
      renderSupervisor({ governanceLevel: 'L4' }),
    )
  })
})

describe('TICK_PROMPT.md.ejs render', () => {
  it('keeps sequencing engine-owned; fix-on-red is prose 2-strike judgment (no dead ship-on-red verb)', () => {
    const md = renderTickPrompt()
    expect(md).toContain('arbiter ship')
    // ship-on-red was retired — fix-on-red is now the agent's 2-strike judgment from PR history.
    expect(md).not.toContain('arbiter ship-on-red')
    expect(md).toContain('2-strike')
    expect(md).toMatch(/needs-human/)
    expect(md).not.toContain('attempts.json')
  })

  it('pins the branch-protection hard rule (no --admin)', () => {
    const md = renderTickPrompt()
    expect(md).toContain('--admin')
    expect(md).toMatch(/[Nn]ever use `--admin`/)
  })

  it('keeps the floor rules', () => {
    const md = renderTickPrompt()
    expect(md).toMatch(/[Nn]ever push/)
    expect(md).toContain('--no-verify')
    expect(md).toMatch(/[Nn]ever commit to main/i)
    expect(md).toMatch(/needs-human/)
  })

  it('forbids self-modification of driver files', () => {
    const md = renderTickPrompt()
    expect(md).toMatch(/[Nn]ever modify the driver files/)
  })

  it('AC-2043.4: renders the CONFIGURED escalation max-strikes (not a hardcoded 2)', () => {
    const md = renderTickPrompt({
      e2ePolicy: { escalation: { strikes: [2, 3, 5], maxStrikes: 3 } },
    })
    expect(md).toMatch(/3-strike/)
    expect(md).not.toMatch(/2-strike rule is final/)
  })

  it('AC-2043.4: defaults to the 2-strike ladder when no e2ePolicy is declared', () => {
    const md = renderTickPrompt()
    expect(md).toMatch(/2-strike/)
  })

  it('contains no pilot provenance strings', () => {
    const md = renderTickPrompt()
    expect(md.toLowerCase()).not.toContain('redux')
    expect(md.toLowerCase()).not.toContain('haben')
  })
})

describe('cross-stack render (DoD: stacks × governance)', () => {
  const stacks = ['typescript', 'java', 'rust', 'go', 'python'] as const
  const levels = ['L1', 'L2', 'L3', 'L4'] as const

  it('renders both templates without error for every stack × level', () => {
    for (const language of stacks) {
      for (const governanceLevel of levels) {
        const sh = renderSupervisor({ language, governanceLevel })
        const md = renderTickPrompt({ language, governanceLevel })
        expect(sh).toContain('set -euo pipefail')
        expect(md).toContain('2-strike')
      }
    }
  })

  it('output is stack-invariant (no language conditionals in the driver)', () => {
    const base = renderSupervisor({ language: 'typescript' })
    for (const language of stacks) {
      expect(renderSupervisor({ language })).toBe(base)
    }
  })
})

describe('ship command local-only state (#2343)', () => {
  it('does not put .arbiter/ in the shared .git/info/exclude', () => {
    const excludeLoop = renderShipCommand().match(/for pattern in[\s\S]*?\ndone/)?.[0]
    expect(excludeLoop).toBeDefined()
    expect(excludeLoop).toContain('".claude/.task/"')
    expect(excludeLoop).not.toContain('".arbiter/"')
  })

  it('removes only a legacy .arbiter/ entry from the shared worktree exclude', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-ship-exclude-'))
    const main = join(root, 'main')
    const worktree = join(root, 'worktree')
    try {
      expect(spawnSync('git', ['init', main]).status).toBe(0)
      expect(
        spawnSync('git', ['-C', main, 'commit', '--allow-empty', '-m', 'init'], {
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Arbiter Test',
            GIT_AUTHOR_EMAIL: 'arbiter-test',
            GIT_COMMITTER_NAME: 'Arbiter Test',
            GIT_COMMITTER_EMAIL: 'arbiter-test',
          },
        }).status,
      ).toBe(0)
      expect(
        spawnSync('git', ['-C', main, 'worktree', 'add', '-b', 'test-worktree', worktree]).status,
      ).toBe(0)

      const excludePath = join(main, '.git', 'info', 'exclude')
      writeFileSync(excludePath, 'before\n.arbiter/\nafter\n.arbiter-cache/\n')
      const block = renderShipCommand().match(
        /## Local-only state[\s\S]*?```bash\n([\s\S]*?)```/,
      )?.[1]
      expect(block).toBeDefined()

      const first = spawnSync('bash', ['-c', block as string], { cwd: worktree })
      expect(first.status, first.stderr.toString()).toBe(0)
      const expected =
        'before\nafter\n.arbiter-cache/\n' +
        '.claude/.task-*\n.claude/.task/\n.claude/plans/\n.agents-dispatched\n'
      expect(readFileSync(excludePath, 'utf8')).toBe(expected)

      expect(spawnSync('bash', ['-c', block as string], { cwd: worktree }).status).toBe(0)
      expect(readFileSync(excludePath, 'utf8')).toBe(expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('ship command cross-model sidecar (#2357)', () => {
  it('preserves the automatic Codex seat when the manual panel is recorded', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-ship-sidecar-'))
    try {
      expect(
        spawnSync('git', ['init', '-q', '-b', 'task/#2357-template'], { cwd: root }).status,
      ).toBe(0)
      execFileSync('git', ['config', 'user.email', 'arbiter-test'], { cwd: root })
      execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: root })
      execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'fixture'], { cwd: root })
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

      mkdirSync(join(root, '.claude', '.task'), { recursive: true })
      mkdirSync(join(root, '.arbiter', 'evidence', 'cross-model', '_2357'), { recursive: true })
      writeFileSync(
        join(root, '.claude', '.task', 'status.json'),
        JSON.stringify({ taskId: '#2357' }),
      )
      writeFileSync(
        join(root, '.arbiter', 'evidence', 'cross-model', '_2357', 'dispatch.json'),
        JSON.stringify({
          taskId: '#2357',
          branch: 'task/#2357-template',
          sha,
          fulfilled: [{ provider: 'codex', cliVersion: '0.5.1', envelope: 'codex.json' }],
          degraded: [],
        }),
      )
      writeFileSync(
        join(root, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify({
          count: 1,
          agents: ['codex-reviewer'],
          taskId: '#2357',
          branch: 'task/#2357-template',
          sha,
        }),
      )

      const block = renderPeerShipCommand().match(
        /## Refactor \/ code-review evidence[\s\S]*?```bash\n([\s\S]*?)```/,
      )?.[1]
      expect(block).toBeDefined()
      const result = spawnSync('bash', ['-c', block as string], { cwd: root, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      expect(
        JSON.parse(readFileSync(join(root, '.arbiter', 'agents-dispatched.json'), 'utf8')),
      ).toEqual({
        count: 2,
        agents: ['bugs', 'codex-reviewer'],
        taskId: '#2357',
        branch: 'task/#2357-template',
        sha,
      })

      writeFileSync(
        join(root, '.arbiter', 'evidence', 'cross-model', '_2357', 'dispatch.json'),
        JSON.stringify({
          taskId: '#2357',
          branch: 'task/#2357-template',
          sha,
          fulfilled: [{}],
          degraded: [],
        }),
      )
      const malformed = spawnSync('bash', ['-c', block as string], { cwd: root, encoding: 'utf8' })
      expect(malformed.status, malformed.stderr).toBe(0)
      expect(
        JSON.parse(readFileSync(join(root, '.arbiter', 'agents-dispatched.json'), 'utf8')),
      ).toMatchObject({ count: 2, agents: ['bugs', 'domain'] })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not treat a dispatch artifact for another task as fulfilled', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-ship-sidecar-task-binding-'))
    try {
      expect(
        spawnSync('git', ['init', '-q', '-b', 'task/#2357-task-binding'], { cwd: root }).status,
      ).toBe(0)
      execFileSync('git', ['config', 'user.email', 'arbiter-test'], { cwd: root })
      execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: root })
      execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'fixture'], { cwd: root })
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

      mkdirSync(join(root, '.claude', '.task'), { recursive: true })
      mkdirSync(join(root, '.arbiter', 'evidence', 'cross-model', '_2357'), { recursive: true })
      writeFileSync(
        join(root, '.claude', '.task', 'status.json'),
        JSON.stringify({ taskId: '#2357' }),
      )
      writeFileSync(
        join(root, '.arbiter', 'evidence', 'cross-model', '_2357', 'dispatch.json'),
        JSON.stringify({
          taskId: '#other-task',
          branch: 'task/#2357-task-binding',
          sha,
          fulfilled: [{}],
          degraded: [],
        }),
      )

      const block = renderPeerShipCommand().match(
        /## Refactor \/ code-review evidence[\s\S]*?```bash\n([\s\S]*?)```/,
      )?.[1]
      expect(block).toBeDefined()
      const result = spawnSync('bash', ['-c', block as string], { cwd: root, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      expect(
        JSON.parse(readFileSync(join(root, '.arbiter', 'agents-dispatched.json'), 'utf8')),
      ).toMatchObject({
        count: 2,
        agents: ['bugs', 'domain'],
        taskId: '#2357',
        branch: 'task/#2357-task-binding',
        sha,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses to write the manual reviewer sidecar through a symlinked .arbiter directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-ship-sidecar-symlink-'))
    const outside = mkdtempSync(join(tmpdir(), 'arbiter-ship-sidecar-outside-'))
    try {
      expect(
        spawnSync('git', ['init', '-q', '-b', 'task/#2357-sidecar-symlink'], { cwd: root }).status,
      ).toBe(0)
      execFileSync('git', ['config', 'user.email', 'arbiter-test'], { cwd: root })
      execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: root })
      execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'fixture'], { cwd: root })
      mkdirSync(join(root, '.claude', '.task'), { recursive: true })
      writeFileSync(
        join(root, '.claude', '.task', 'status.json'),
        JSON.stringify({ taskId: '#2357' }),
      )
      symlinkSync(outside, join(root, '.arbiter'), 'dir')

      const block = renderPeerShipCommand().match(
        /## Refactor \/ code-review evidence[\s\S]*?```bash\n([\s\S]*?)```/,
      )?.[1]
      expect(block).toBeDefined()
      const result = spawnSync('bash', ['-c', block as string], { cwd: root, encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(existsSync(join(outside, 'agents-dispatched.json'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('fails closed when the active task state is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-ship-sidecar-no-task-'))
    try {
      expect(
        spawnSync('git', ['init', '-q', '-b', 'task/#2357-no-task'], { cwd: root }).status,
      ).toBe(0)
      execFileSync('git', ['config', 'user.email', 'arbiter-test'], { cwd: root })
      execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: root })
      execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'fixture'], { cwd: root })

      const block = renderPeerShipCommand().match(
        /## Refactor \/ code-review evidence[\s\S]*?```bash\n([\s\S]*?)```/,
      )?.[1]
      expect(block).toBeDefined()
      const result = spawnSync('bash', ['-c', block as string], { cwd: root, encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(existsSync(join(root, '.arbiter', 'agents-dispatched.json'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ── #1292 (ADR-093 §5): self-only boundary — locked forever ──────────────────
//
// Template-authoring rules (CANON-04/05/13/14/18), matrix promotion
// (CANON-02/03, INV-32), selfOnly invariants (INV-107/108/111/117/120) and
// kit-leakage guards (INV-85, kit-source) are arbiter-self concerns. They must
// NEVER be emitted into a consumer driver (INV-115 map-fiction). Table-driven:
// every rendered driver artifact × every banned marker.

describe('self-only boundary (#1292, ADR-093 §5)', () => {
  const artifacts: ReadonlyArray<readonly [string, () => string]> = [
    ['supervisor.sh', () => renderSupervisor()],
    ['TICK_PROMPT.md', () => renderTickPrompt()],
    ['claude command ship.md', renderShipCommand],
  ]

  // Exact tokens (anchored so the dual-sided INV-114 in ship.md never false-positives).
  const selfOnlyTokens = [
    'INV-107',
    'INV-108',
    'INV-111',
    'INV-117',
    'INV-120',
    'INV-85',
    'INV-32',
  ] as const

  for (const [name, render] of artifacts) {
    it(`${name} contains no CANON-NN references (consumers have no CANON.md)`, () => {
      expect(render()).not.toMatch(/CANON-\d+/)
    })

    for (const token of selfOnlyTokens) {
      it(`${name} does not leak self-only token ${token}`, () => {
        expect(render()).not.toMatch(new RegExp(`\\b${token}(?!\\d)`))
      })
    }

    it(`${name} contains no cross-language-matrix references (matrix promotion is self-only)`, () => {
      expect(render()).not.toContain('cross-language-matrix')
    })

    it(`${name} contains no src/templates paths (template authoring is self-only)`, () => {
      expect(render()).not.toContain('src/templates')
    })

    it(`${name} contains no kit-source references (kit leakage, INV-85)`, () => {
      expect(render()).not.toMatch(/\bkit-source\b/)
    })
  }
})
