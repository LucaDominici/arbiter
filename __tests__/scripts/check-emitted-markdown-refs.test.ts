// SPDX-License-Identifier: Apache-2.0
// TDD guard for #2415 — emitted-markdown reference resolver. Every script,
// package-manager script, arbiter command and hook cited inside an EMITTED
// markdown playbook (.claude/commands, .claude/skills, .claude/agents,
// AGENTS.md, .agents/**, README.md) must resolve against the EMITTED tree it
// ships in — not against arbiter's own repo. References inside fenced code
// blocks count. Fail-closed: a missing input is an error, never a pass.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  checkEmittedTree,
  discoverEmittedRoots,
  checkEmittedMarkdownRefs,
} from '../../scripts/check-emitted-markdown-refs.mjs'
import { loadCommandSurface } from '../../scripts/lib/cli-command-names.mjs'

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CLI_SRC = readFileSync(join(REPO_ROOT, 'src', 'cli.ts'), 'utf-8')
const SURFACE = loadCommandSurface(CLI_SRC)

function makeTree(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'emitted-md-refs-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const NPM_PROJECT = {
  'package.json': JSON.stringify({ name: 'x', scripts: { test: 'vitest', build: 'tsc' } }),
  'package-lock.json': '{}',
}

function problemsFor(files: Record<string, string>): string[] {
  const { dir, cleanup } = makeTree(files)
  try {
    return checkEmittedTree(dir, SURFACE).problems
  } finally {
    cleanup()
  }
}

describe('checkEmittedTree — script references (#2415)', () => {
  it('reports no problem when every cited script exists in the emitted tree', () => {
    expect(
      problemsFor({
        ...NPM_PROJECT,
        'scripts/check-all.mjs': '// emitted',
        '.claude/commands/ship.md': 'Run `node scripts/check-all.mjs L1` before commit.\n',
      }),
    ).toEqual([])
  })

  it('FAILs with file:line on a script the emitted tree never receives', () => {
    const problems = problemsFor({
      ...NPM_PROJECT,
      '.claude/skills/wave-drain/SKILL.md': 'line one\nRoute: `node scripts/route-auditors.mjs`\n',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('.claude/skills/wave-drain/SKILL.md:2')
    expect(problems[0]).toContain('scripts/route-auditors.mjs')
  })

  it('catches a reference that only appears inside a fenced code block', () => {
    const problems = problemsFor({
      ...NPM_PROJECT,
      '.claude/commands/drain.md':
        '# Drain\n\n```bash\nnode scripts/verify-pr-closes.mjs 12\n```\n',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('.claude/commands/drain.md:4')
    expect(problems[0]).toContain('scripts/verify-pr-closes.mjs')
  })

  it('accepts a missing script whose invocation is existence-guarded in the same file', () => {
    expect(
      problemsFor({
        ...NPM_PROJECT,
        '.claude/commands/ship.md':
          '`[ -f scripts/issue-readiness.mjs ] && node scripts/issue-readiness.mjs --body-file f`\n',
      }),
    ).toEqual([])
  })
})

describe('checkEmittedTree — package-manager references (#2415)', () => {
  it('FAILs when the cited npm script is absent from the emitted package.json', () => {
    const problems = problemsFor({
      ...NPM_PROJECT,
      'AGENTS.md': 'Run `npm run coverage` first.\n',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('AGENTS.md:1')
    expect(problems[0]).toContain('npm run coverage')
  })

  it('FAILs when the package manager contradicts the emitted lockfile', () => {
    const problems = problemsFor({
      ...NPM_PROJECT,
      '.claude/skills/configure/SKILL.md': '```bash\nbun run test\n```\n',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('bun')
    expect(problems[0]).toMatch(/package manager/i)
  })

  it('FAILs on any package-manager invocation in a tree with no package.json', () => {
    const problems = problemsFor({
      'go.mod': 'module example.com/x\n',
      '.claude/commands/ship.md': '- [ ] New tests pass (`npm run test run <path>`)\n',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/package\.json/)
  })
})

describe('checkEmittedTree — arbiter command references (#2415)', () => {
  it('FAILs on an arbiter command that src/cli.ts never registers', () => {
    const problems = problemsFor({
      ...NPM_PROJECT,
      '.claude/agents/red-team.md': '```bash\nnpx arbiter ghostcmd --json\n```\n',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('ghostcmd')
  })

  it('accepts an alias invocation and a positional argument read as a subcommand', () => {
    expect(
      problemsFor({
        ...NPM_PROJECT,
        '.claude/commands/wt-close.md': '`arbiter wt close` then `arbiter ship #123`\n',
      }),
    ).toEqual([])
  })
})

describe('checkEmittedTree — hook references (#2415)', () => {
  it('FAILs on a .claude/hooks handler the emitted tree does not contain', () => {
    const problems = problemsFor({
      ...NPM_PROJECT,
      'AGENTS.md': 'The `.claude/hooks/ghost-guard.mjs` hook blocks it.\n',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('.claude/hooks/ghost-guard.mjs')
  })
})

describe('the emitted living examples (#2415 AC-3)', () => {
  it('discovers exactly the generated example trees', () => {
    const roots = discoverEmittedRoots(join(REPO_ROOT, 'examples'))
    expect(roots.length).toBeGreaterThanOrEqual(3)
    expect(roots.map((r) => r.split('/').pop()).sort()).toEqual([
      'go-library',
      'python-library',
      'ts-library',
    ])
  })

  it('resolves every reference in every emitted example', () => {
    const { problems } = checkEmittedMarkdownRefs({
      examplesDir: join(REPO_ROOT, 'examples'),
      cliSrc: CLI_SRC,
    })
    expect(problems).toEqual([])
  })
})
