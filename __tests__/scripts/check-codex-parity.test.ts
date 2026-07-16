// SPDX-License-Identifier: Apache-2.0
// Codex-track parity contract — non-vacuity + unit suite (ADR-106, #1966).
//
// Mutation tests run against ISOLATED tmpdir bakes (real generators, mutated
// copies) — never the live worktree. The CANON-22-drop test below is the
// wave's TDD ceremony RED: it must fail against the harness skeleton and only
// pass once the real parity comparison lands (GREEN).

import { describe, it, expect, afterEach } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync, rmSync, symlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runParityCheck } from '../../scripts/lib/codex-parity-lib.mjs'
import {
  cleanChildEnv,
  resolveMergeBaseBaseline,
  checkGoldenEvolution,
} from '../../scripts/check-codex-parity.mjs'
import { bakeBothTracks, cleanupBake, dropCanon22, parityCtx } from './codex-parity-fixture.js'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const CHECK_SCRIPT = join(repoRoot, 'scripts', 'check-codex-parity.mjs')

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

  it('fixture concurrency: two CONCURRENT spawned checks over separate bakes do not cross-contaminate (hardening 10)', async () => {
    dir = bakeBothTracks()
    const dirB = bakeBothTracks()
    try {
      dropCanon22(dirB)
      const spawn = (baked: string) =>
        execFileAsync('node', [CHECK_SCRIPT, '--baked-dir', baked], {
          encoding: 'utf-8',
          env: cleanChildEnv(),
          cwd: repoRoot,
          timeout: 120_000,
        }).then(
          (r) => ({ code: 0, stdout: r.stdout }),
          (e: { code?: number; stdout?: string }) => ({
            code: e.code ?? -1,
            stdout: e.stdout ?? '',
          }),
        )
      const [clean, drifted] = await Promise.all([spawn(dir), spawn(dirB)])
      // The clean fixture never reports derivation drift; the mutated one must.
      // (Both runs share the repo's committed data files, so identity-drift vs
      // the real-init baseline appears in BOTH consistently — the assertion
      // here is isolation: the mutation in B must not bleed into A.)
      expect(clean.stdout).not.toContain('derived-drift')
      expect(drifted.code).toBe(1)
      expect(drifted.stdout).toContain('derived-drift')
    } finally {
      cleanupBake(dirB)
    }
  }, 180_000)
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

// ─── shallow-clone fail-closed fixture (E2E for hardening 17) ────────────────

describe('shallow-clone fail-closed (spawned)', () => {
  it('exits 2 with remediation when origin/main history is missing', () => {
    const cloneDir = mkdtempSync(join(tmpdir(), 'arbiter-parity-shallow-'))
    try {
      execFileSync(
        'git',
        ['clone', '--depth', '1', '--quiet', `file://${repoRoot}`, join(cloneDir, 'repo')],
        { encoding: 'utf-8' },
      )
      const shallowRepo = join(cloneDir, 'repo')
      // the script only needs node stdlib + minimatch — reuse the real node_modules
      symlinkSync(join(repoRoot, 'node_modules'), join(shallowRepo, 'node_modules'))
      let exitCode = 0
      let stderr = ''
      try {
        execFileSync('node', [join(shallowRepo, 'scripts', 'check-codex-parity.mjs')], {
          encoding: 'utf-8',
          env: cleanChildEnv(),
          cwd: shallowRepo,
        })
      } catch (err) {
        const e = err as { status?: number; stderr?: string }
        exitCode = e.status ?? -1
        stderr = e.stderr ?? ''
      }
      expect(exitCode, 'must fail closed (exit 2), never skip silently').toBe(2)
      expect(stderr).toContain('fails closed')
    } finally {
      rmSync(cloneDir, { recursive: true, force: true })
    }
  }, 60_000)
})

// ─── E2E: the real gate entrypoint (bake via CLI init) ──────────────────────

describe('check-codex-parity.mjs end to end', () => {
  it('full run (real bake through `init`) is green on this repo', async () => {
    const { stdout } = await execFileAsync('node', [CHECK_SCRIPT], {
      encoding: 'utf-8',
      env: cleanChildEnv(),
      cwd: repoRoot,
      timeout: 240_000,
    })
    expect(stdout).toContain('check-codex-parity: OK')
    expect(stdout).toMatch(/parity-surface: (\d+)\/\1 \(100%\)/)
  }, 300_000)

  it('drift injected into a pre-baked tree turns the spawned check red', async () => {
    const bakeDir = bakeBothTracks()
    try {
      dropCanon22(bakeDir)
      let failed = false
      let stdout = ''
      try {
        await execFileAsync('node', [CHECK_SCRIPT, '--baked-dir', bakeDir], {
          encoding: 'utf-8',
          env: cleanChildEnv(),
          cwd: repoRoot,
          timeout: 120_000,
        })
      } catch (err) {
        const e = err as { code?: number; stdout?: string }
        failed = e.code === 1
        stdout = e.stdout ?? ''
      }
      expect(failed, 'spawned check must exit 1 on injected drift').toBe(true)
      expect(stdout).toContain('derived-drift')
    } finally {
      cleanupBake(bakeDir)
    }
  }, 180_000)
})
