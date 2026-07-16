// SPDX-License-Identifier: Apache-2.0
// Codex-track parity contract — non-vacuity + unit suite (ADR-106, #1966).
//
// Mutation tests run against ISOLATED tmpdir bakes (real generators, mutated
// copies) — never the live worktree. The CANON-22-drop test below is the
// wave's TDD ceremony RED: it must fail against the harness skeleton and only
// pass once the real parity comparison lands (GREEN).
//
// UNIT scope only: everything here is in-process (direct generator bakes +
// lib calls, pure helpers with injected gitRun). The spawn/bake-heavy E2E
// (real `init` bake, drift injection, concurrency, shallow-clone) lives in
// __tests__/integration/gate/codex-parity-e2e.test.ts — integration scope by
// repo taxonomy, excluded from the instrumented coverage run.

import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runParityCheck } from '../../scripts/lib/codex-parity-lib.mjs'
import {
  cleanChildEnv,
  resolveMergeBaseBaseline,
  checkGoldenEvolution,
} from '../../scripts/check-codex-parity.mjs'
import { bakeBothTracks, cleanupBake, dropCanon22, parityCtx } from './codex-parity-fixture.js'

interface Finding {
  kind: string
  file: string
  message: string
}
interface ParityResult {
  status: 'PASS' | 'FAIL'
  findings: Finding[]
  surface: { total: number; classified: number }
}

function check(dir: string): ParityResult {
  return runParityCheck(parityCtx(dir)) as ParityResult
}

function kinds(result: ParityResult): string[] {
  return result.findings.map((f) => f.kind)
}

describe('check-codex-parity — non-vacuity mutations (#1966)', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir !== undefined) cleanupBake(dir)
    dir = undefined
  })

  it('goes RED when the codex derivation drops the CANON-22 section (mutation 3a — the #1966 regression)', () => {
    dir = bakeBothTracks()
    dropCanon22(dir)

    const result = check(dir)

    expect(result.status, 'a CANON-22-less codex exec protocol must fail the parity check').toBe(
      'FAIL',
    )
    const hit = result.findings.find(
      (f) =>
        f.file === '.agents/rules/90-exec-protocol.md' &&
        (f.kind === 'derived-drift' || f.kind === 'golden-mismatch'),
    )
    expect(
      hit,
      `expected a derived-drift/golden-mismatch finding for .agents/rules/90-exec-protocol.md, got: ${JSON.stringify(result.findings)}`,
    ).toBeDefined()
  })

  it('non-vacuity baseline: the unmutated fixture bake PASSES with 100% parity surface', () => {
    dir = bakeBothTracks()
    const result = check(dir)
    expect(result.findings, 'clean bake must have zero findings').toEqual([])
    expect(result.status).toBe('PASS')
    expect(result.surface.classified).toBe(result.surface.total)
    expect(result.surface.total).toBeGreaterThan(0)
    // lib default is repo semantics: baseline sub-check runs unless the
    // orchestrator explicitly opts a fixture out
    expect(result.baseline).toBe('checked')
  })

  it('skipBaseline (fixture mode) reports the baseline sub-check as skipped but keeps non-vacuity', () => {
    dir = bakeBothTracks()
    const result = runParityCheck({
      ...parityCtx(dir),
      skipBaseline: true,
      baseline: undefined, // no baseline data needed — and none validated
      mergeBaseBaseline: undefined,
    }) as ParityResult & { baseline: string }
    expect(result.status).toBe('PASS')
    expect(result.baseline).toBe('skipped')
    // the empty-track non-vacuity check must survive the skip
    const empty = runParityCheck({
      ...parityCtx(dir),
      bakedDir: `${dir}/definitely-empty-subdir`,
      manifestFiles: [],
      skipBaseline: true,
      baseline: undefined,
      mergeBaseBaseline: undefined,
    }) as ParityResult
    expect(empty.findings.some((f) => f.kind === 'empty-track')).toBe(true)
  })

  it('mutation 3b — Known-Limitations drift: a table missing emitted hooks is red', () => {
    dir = bakeBothTracks()
    const codexMd = join(dir, '.agents', 'CODEX.md')
    const text = readFileSync(codexMd, 'utf-8')
    // keep the section + header but drop every generated row (the pre-#1966
    // manual-table failure mode: fewer rows than emitted hooks)
    const mutated = text
      .split('\n')
      .filter((l) => !/^\| `[^`]+\.mjs` \|/.test(l))
      .join('\n')
    writeFileSync(codexMd, mutated)

    const result = check(dir)
    expect(result.status).toBe('FAIL')
    expect(kinds(result)).toContain('known-limitations-missing')
  })

  it('mutation 3b-bis — a stale table row naming a non-emitted hook is red', () => {
    dir = bakeBothTracks()
    const codexMd = join(dir, '.agents', 'CODEX.md')
    const text = readFileSync(codexMd, 'utf-8')
    const marker = '| `stop-dangerous.mjs` |'
    expect(text).toContain(marker)
    writeFileSync(
      codexMd,
      text.replace(marker, '| `ghost-hook.mjs` | Enforces nothing | None |\n' + marker),
    )

    const result = check(dir)
    expect(result.status).toBe('FAIL')
    const stale = result.findings.filter((f) => f.kind === 'known-limitations-stale')
    expect(stale.some((f) => f.message.includes('ghost-hook.mjs'))).toBe(true)
  })

  it('mutation 3c — allowlist staleness: an entry whose divergence no longer exists is red', () => {
    dir = bakeBothTracks()
    // Pin a "divergence" between two files that are actually identical → healed
    const result = runParityCheck(
      parityCtx(dir, {
        allowlist: {
          $schemaVersion: 1,
          entries: [
            {
              codexPath: '.agents/rules/05-agent-lifecycle.md',
              claudePath: '.claude/rules/05-agent-lifecycle.md',
              reason: 'stale approved divergence (fixture)',
              codexHash: 'a'.repeat(64),
              claudeHash: 'b'.repeat(64),
            },
          ],
        },
      }),
    ) as ParityResult
    expect(result.status).toBe('FAIL')
    expect(kinds(result)).toContain('stale-allowlist')
    // and the same path now multi-classes (DERIVED + ALLOWLISTED) — no precedence
    expect(kinds(result)).toContain('multi-class')
  })

  it('mutation — missing emitted file: a manifest entry deleted from disk is red', () => {
    dir = bakeBothTracks()
    const ctx = parityCtx(dir) // manifest captured BEFORE the deletion
    rmSync(join(dir, '.agents', 'plan', 'README.md'))
    const result = runParityCheck(ctx) as ParityResult
    expect(result.status).toBe('FAIL')
    expect(kinds(result)).toContain('manifest-missing')
  })

  it('mutation — extra emitted file: a stray file under a track root is red twice (manifest + unclassified)', () => {
    dir = bakeBothTracks()
    const ctx = parityCtx(dir)
    writeFileSync(join(dir, '.agents', 'rogue.md'), 'unregistered emission\n')
    const result = runParityCheck(ctx) as ParityResult
    expect(result.status).toBe('FAIL')
    expect(kinds(result)).toContain('manifest-extra')
    expect(kinds(result)).toContain('unclassified')
  })

  it('mutation — wrongly-exclusive shared rule: a declaration swallowing a DERIVED file is red', () => {
    dir = bakeBothTracks()
    const base = parityCtx(dir)
    const exclusive = JSON.parse(JSON.stringify(base.exclusive)) as {
      declarations: { id: string; track: string; pattern: string; reason: string }[]
    }
    exclusive.declarations.push({
      id: 'wrongly-exclusive',
      track: 'codex',
      pattern: '.agents/rules/90-exec-protocol.md',
      reason: 'fixture: shared rule wrongly declared exclusive',
    })
    const result = runParityCheck(parityCtx(dir, { exclusive })) as ParityResult
    expect(result.status).toBe('FAIL')
    const multi = result.findings.filter((f) => f.kind === 'multi-class')
    expect(multi.some((f) => f.file === '.agents/rules/90-exec-protocol.md')).toBe(true)
  })
})

// ─── golden evolution heuristic (hardening 15) ───────────────────────────────

describe('checkGoldenEvolution', () => {
  const golden = '__tests__/fixtures/codex-parity/golden/rules/90-exec-protocol.md.golden'
  const canonical = 'src/templates/claude/rules/90-exec-protocol.md.ejs'

  it('modified goldens WITHOUT a canonical claude-template change are refused', () => {
    const findings = checkGoldenEvolution([golden], [golden]) as Finding[]
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('golden-unjustified')
  })

  it('goldens evolving together with their canonical source pass', () => {
    expect(checkGoldenEvolution([golden, canonical], [golden, canonical])).toEqual([])
  })

  it('newly added goldens (bootstrap/extension) are not the modification case', () => {
    expect(checkGoldenEvolution([], [golden])).toEqual([])
  })
})

// ─── merge-base resolution fails closed (hardening 17) ───────────────────────

describe('resolveMergeBaseBaseline', () => {
  it('fails closed with remediation text when the merge-base is unresolvable', () => {
    const failingGit = () => {
      throw new Error('fatal: no merge base found (shallow clone)')
    }
    const result = resolveMergeBaseBaseline(failingGit) as { error?: string }
    expect(result.error).toBeDefined()
    expect(result.error).toContain('fails closed')
    expect(result.error).toContain('fetch-depth: 0')
  })

  it('reports BOOTSTRAP when the baseline did not exist at merge-base', () => {
    const gitRun = (_cmd: string, args: string[]) => {
      if (args[0] === 'merge-base') return 'abc123\n'
      throw new Error('fatal: path exists on disk, but not in abc123')
    }
    const result = resolveMergeBaseBaseline(gitRun) as { baseline?: unknown }
    expect(result.baseline).toBe('BOOTSTRAP')
  })

  it('fails closed on a corrupt baseline at merge-base', () => {
    const gitRun = (_cmd: string, args: string[]) =>
      args[0] === 'merge-base' ? 'abc123\n' : 'not-json{'
    const result = resolveMergeBaseBaseline(gitRun) as { error?: string }
    expect(result.error).toContain('not valid JSON')
  })
})

// ─── spawn hygiene ───────────────────────────────────────────────────────────

describe('cleanChildEnv', () => {
  it('strips every ARBITER_* variable and keeps the rest', () => {
    const env = cleanChildEnv({
      PATH: '/usr/bin',
      ARBITER_SKIP_TDD: '1',
      ARBITER_POST_CLEAR: '1',
      HOME: '/home/user',
    })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/user' })
  })
})
