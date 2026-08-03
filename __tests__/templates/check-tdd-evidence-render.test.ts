// SPDX-License-Identifier: Apache-2.0
// RED phase (#1446, INV-131): the TDD red→green evidence re-verification gate that
// arbiter runs on ITSELF must be emitted into governed targets and wired into the
// generated check-all.mjs at L2 — so a target's CI re-verifies its own evidence on a
// fresh checkout. Self-contained (no arbiter CLI dependency). Missing or inconsistent
// evidence → the generated gate fails (exit 1); absent origin/main or no task-ID
// commits → vacuous pass (exit 0).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(tpl: string, overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}
const renderGate = () => render('scripts/check-tdd-evidence.mjs.ejs')
const renderCheckAll = (o: Record<string, unknown> = {}) => render('scripts/check-all.mjs.ejs', o)

function parseRenderedTaskIds(subjectLog: string): string[] {
  const scriptDir = mkdtempSync(join(tmpdir(), 'tdd-p-'))
  const parserModule = join(scriptDir, 'parser.mjs')
  try {
    const rendered = renderGate().replace(
      /\ntry \{\n[ ]{2}run\(\)\n\} catch \(err\) \{[\s\S]*$/,
      '\n',
    )
    writeFileSync(parserModule, `${rendered}\nexport { parseTaskIds }\n`)
    const result = spawnSync(
      'node',
      [
        '--input-type=module',
        '--eval',
        `import { parseTaskIds } from ${JSON.stringify(pathToFileURL(parserModule).href)}; ` +
          `process.stdout.write(JSON.stringify(parseTaskIds(${JSON.stringify(subjectLog)})))`,
      ],
      { encoding: 'utf-8' },
    )
    expect(result.status).toBe(0)
    return JSON.parse(result.stdout)
  } finally {
    rmSync(scriptDir, { recursive: true, force: true })
  }
}

const FAIL_LOG = ' FAIL  __tests__/foo.test.ts > foo > does the thing\nexpected 1 to equal 2\n'

function validEvidence(sha: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    $schemaVersion: 1,
    task_id: '#42',
    test_path: 'src/foo.test.ts',
    test_commit_sha: sha,
    test_run_log: FAIL_LOG,
    observed_failure: 'expected 1 to equal 2',
    recorded_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  })
}

/**
 * Build a temp git repo with origin/main synthesised via update-ref, an optional
 * feature commit `feat(#42): ...`, an optional evidence file, then run the rendered
 * gate. Returns the exit code.
 */
function runScenario(opts: {
  taskCommit?: boolean
  skipTrailer?: boolean
  evidence?: (featureSha: string) => string | null
}): number {
  const scriptDir = mkdtempSync(join(tmpdir(), 'tdd-s-'))
  const repo = mkdtempSync(join(tmpdir(), 'tdd-r-'))
  const g = (args: string[]) =>
    spawnSync('git', args, { cwd: repo, encoding: 'utf-8' }).stdout?.trim() ?? ''
  try {
    writeFileSync(join(scriptDir, 'check-tdd-evidence.mjs'), renderGate())
    spawnSync('git', ['init', '-b', 'main'], { cwd: repo })
    g(['config', 'user.email', 't@example.com'])
    g(['config', 'user.name', 'tester'])
    g(['config', 'commit.gpgsign', 'false'])
    // base commit, then point origin/main at it
    writeFileSync(join(repo, 'README.md'), '# base\n')
    g(['add', '.'])
    g(['commit', '-m', 'chore: base'])
    g(['update-ref', 'refs/remotes/origin/main', 'HEAD'])

    if (opts.taskCommit) {
      mkdirSync(join(repo, 'src'), { recursive: true })
      writeFileSync(join(repo, 'src', 'foo.test.ts'), 'test("foo", () => {})\n')
      g(['add', '.'])
      const msg = opts.skipTrailer
        ? 'feat(#42): add foo\n\nARBITER-SKIP-TDD: 1'
        : 'feat(#42): add foo'
      g(['commit', '-m', msg])
    }
    const featureSha = g(['rev-parse', 'HEAD'])

    if (opts.evidence) {
      const body = opts.evidence(featureSha)
      if (body !== null) {
        mkdirSync(join(repo, '.arbiter', 'evidence', 'tdd'), { recursive: true })
        writeFileSync(join(repo, '.arbiter', 'evidence', 'tdd', '#42.json'), body)
      }
    }
    const r = spawnSync('node', [join(scriptDir, 'check-tdd-evidence.mjs'), '--dir', repo], {
      encoding: 'utf-8',
    })
    return r.status ?? -1
  } finally {
    rmSync(scriptDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
}

describe('scripts/check-tdd-evidence.mjs.ejs — target TDD-evidence gate (#1446)', () => {
  it('renders an executable node gate with shebang and INV-53 exit codes', () => {
    const content = renderGate()
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(content).toContain('process.exit(1)')
    expect(content).toContain('process.exit(0)')
    expect(content).toContain('process.exit(2)')
  })

  it('is self-contained: no arbiter CLI / tsx / src/cli dependency', () => {
    const content = renderGate()
    expect(content).not.toContain('src/cli')
    expect(content).not.toContain('tsx')
    expect(content).not.toContain('npx arbiter')
  })

  it('extracts task IDs from conventional-commit subject tails', () => {
    expect(
      parseRenderedTaskIds(
        'feat(pr-tooling): merge-watch + capacity-probe + gate-exec advisory (#2098)',
      ),
    ).toEqual(['#2098'])
  })

  // ── A/B/C fail-closed harness ───────────────────────────────────────────────
  it('A: PASS (exit 0) for a complete, consistent evidence file', () => {
    expect(runScenario({ taskCommit: true, evidence: (sha) => validEvidence(sha) })).toBe(0)
  })

  it('B: FAIL (exit 1) when evidence is MISSING for a task-ID commit', () => {
    expect(runScenario({ taskCommit: true, evidence: () => null })).toBe(1)
  })

  it('C: FAIL (exit 1) when test_commit_sha is not in git history', () => {
    expect(
      runScenario({
        taskCommit: true,
        evidence: () => validEvidence('0'.repeat(40)),
      }),
    ).toBe(1)
  })

  it('C: FAIL (exit 1) when test_run_log carries no RED failure signature', () => {
    expect(
      runScenario({
        taskCommit: true,
        evidence: (sha) => validEvidence(sha, { test_run_log: 'everything is fine' }),
      }),
    ).toBe(1)
  })

  it('C: FAIL (exit 1) on the forbidden ARBITER-SKIP-TDD trailer', () => {
    expect(
      runScenario({ taskCommit: true, skipTrailer: true, evidence: (sha) => validEvidence(sha) }),
    ).toBe(1)
  })

  it('vacuous PASS (exit 0) when there are no task-ID commits', () => {
    expect(runScenario({ taskCommit: false })).toBe(0)
  })
})

describe('check-all.mjs wiring (#1446) — cross-stack', () => {
  // Rendered at L1: the gate lives inside the runtime full-gate guard (L2+, #1720),
  // which is emitted into the script string regardless of the governance level passed
  // to the template (the L2+ scoping is a runtime guard, not an EJS compile-time one).
  for (const language of ['typescript', 'go', 'python', 'java'] as const) {
    it(`emits the tdd-evidence gate (L2-scoped) for ${language}`, () => {
      expect(renderCheckAll({ language, governanceLevel: 'L1' })).toContain(
        'check-tdd-evidence.mjs',
      )
    })
  }
})
