// SPDX-License-Identifier: Apache-2.0
// Codex-track SELF-parity gate — spawn-heavy E2E (ADR-106 addendum, #1966).
//
// TDD RED: scripts/check-codex-self-parity.mjs does NOT exist yet — this file
// is the test-only commit that precedes it. The script is only ever SPAWNED
// (never imported), so the file collects cleanly while it is absent and each
// test fails on its own exit-code/output assertions.
//
// INTEGRATION scope by repo taxonomy (mirrors codex-parity-e2e.test.ts): every
// test spawns the real gate entrypoint against a fixture --repo-root whose
// materialized .agents/** + .codex/** come from the SAME dist emission path
// the script itself runs (loadConfig → resolveProjectConfig → generateCodex
// into the fixture — the check-self-dogfood.mjs:749 precedent; an empty dir,
// so skipIfExists can never suppress output). The pristine fixture is green
// by construction and every red below asserts exactly one injected mutation.
// No circularity: builder and script share the emission path, but the script
// compares its own fresh temp emission against the fixture's materialized
// tree — the thing each test mutates.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanChildEnv } from '../../../scripts/check-codex-parity.mjs'
import { CANON22_HEADING } from '../../../scripts/lib/codex-parity-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..')
const CHECK_SCRIPT = join(repoRoot, 'scripts', 'check-codex-self-parity.mjs')

// The repo-convention doc front matter (the exact .agents/rules/
// 05-agent-lifecycle.md block shape at HEAD) — a repo-side-only decoration
// the self-parity normalizer must strip before comparing (M1).
const DOC_FRONT_MATTER =
  '---\n' +
  "title: 'Agent Lifecycle Rule'\n" +
  "doc_version: '1.0.0'\n" +
  'status: active\n' +
  "last_review: '2026-05-20'\n" +
  "owner: ''\n" +
  "canonical_id: ''\n" +
  "tags: ['audience/agent', 'audience/dev', 'kind/internal']\n" +
  'related: []\n' +
  '---\n' +
  '\n'

// ─── Fixture builder ─────────────────────────────────────────────────────────

/** Dynamic-import a compiled dist module, failing with the repo's standard remediation. */
async function importDist<T>(rel: string): Promise<T> {
  const url = pathToFileURL(join(repoRoot, 'dist', rel)).href
  try {
    return (await import(url)) as T
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err)
    throw new Error(
      `cannot import dist/${rel} (${detail}) — run "npm run build" first; ` +
        'scripts/ and tests cannot import .ts directly (#1267)',
    )
  }
}

/**
 * Materialize the codex track into `fixtureRoot` via the EXACT emission the
 * gate script performs: loadConfig(fixtureRoot) → resolveProjectConfig
 * (fixtureRoot, 'arbiter', stored) → generateCodex with targetDir=fixtureRoot.
 * Both sides of every comparison therefore resolve the same detector-driven
 * config against the same tree.
 */
async function emitCodexTrackInto(fixtureRoot: string): Promise<void> {
  const { loadConfig } = await importDist<{
    loadConfig: (dir: string) => Record<string, unknown> | null
  }>('utils/config.js')
  const { resolveProjectConfig } = await importDist<{
    resolveProjectConfig: (
      targetDir: string,
      projectName: string,
      stored: Record<string, unknown>,
    ) => { config: Record<string, unknown> }
  }>('config/resolve-project-config.js')
  const { generateCodex } = await importDist<{
    generateCodex: (config: Record<string, unknown>, opts: { dryRun: boolean }) => unknown
  }>('generators/codex.js')

  const stored = loadConfig(fixtureRoot)
  if (stored === null) throw new Error(`fixture ${fixtureRoot} has no arbiter.json`)
  const { config } = resolveProjectConfig(fixtureRoot, 'arbiter', stored)
  generateCodex({ ...config, targetDir: fixtureRoot }, { dryRun: false })
}

/**
 * Build an independent pristine fixture: the REAL repo's arbiter.json + a
 * minimal TS scaffold (the bakeFixtureProject precedent, so detector-driven
 * resolution is deterministic), the emitted codex track, and the declared
 * repo-runtime artifact .agents/plan/PLAN.json (git-tracked task state, never
 * emitted). Caller removes it in `finally`.
 */
async function buildFixture(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-self-parity-'))
  copyFileSync(join(repoRoot, 'arbiter.json'), join(dir, 'arbiter.json'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'self-parity-fixture', version: '0.1.0', private: true }, null, 2),
  )
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const selfParityFixture = true\n')
  execFileSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf-8', env: cleanChildEnv() })
  await emitCodexTrackInto(dir)
  mkdirSync(join(dir, '.agents', 'plan'), { recursive: true })
  writeFileSync(
    join(dir, '.agents', 'plan', 'PLAN.json'),
    JSON.stringify({ task: '#1966', status: 'fixture' }, null, 2) + '\n',
  )
  return dir
}

// ─── Spawn helper ────────────────────────────────────────────────────────────

interface GateRun {
  status: number
  stdout: string
  stderr: string
}

function runGate(fixtureDir: string): GateRun {
  try {
    const stdout = execFileSync('node', [CHECK_SCRIPT, '--repo-root', fixtureDir], {
      encoding: 'utf-8',
      env: cleanChildEnv(),
      cwd: repoRoot,
      timeout: 120_000,
    })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

// ─── End to end ──────────────────────────────────────────────────────────────

describe('check-codex-self-parity.mjs end to end (self-track, #1966)', () => {
  it('detects CANON-22 drop in materialized 90-exec-protocol (the #1966 regression class)', async () => {
    const dir = await buildFixture()
    try {
      const rulePath = join(dir, '.agents', 'rules', '90-exec-protocol.md')
      const text = readFileSync(rulePath, 'utf-8')
      expect(text, 'fresh emission must contain the CANON-22 section').toContain(CANON22_HEADING)
      // The historical regression, replayed: the materialized copy silently
      // loses the whole Root-Cause Discipline section.
      writeFileSync(rulePath, text.slice(0, text.indexOf(CANON22_HEADING)).trimEnd() + '\n')

      const result = runGate(dir)
      expect(
        result.status,
        `injected CANON-22 drop must exit 1, got ${result.status}: ${result.stdout}${result.stderr}`,
      ).toBe(1)
      expect(result.stdout).toMatch(
        /check-codex-self-parity: STALE \.agents\/rules\/90-exec-protocol\.md — /i,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  it('pristine fixture is green: OK with a fully classified parity surface', async () => {
    const dir = await buildFixture()
    try {
      const result = runGate(dir)
      expect(
        result.status,
        `pristine fixture must pass, got ${result.status}: ${result.stdout}${result.stderr}`,
      ).toBe(0)
      expect(result.stdout).toContain('check-codex-self-parity: OK')
      expect(result.stdout).toMatch(/parity-surface: (\d+)\/\1/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  it('a deleted derived rule (60-incidental-capture) is a MISSING finding', async () => {
    const dir = await buildFixture()
    try {
      const rulePath = join(dir, '.agents', 'rules', '60-incidental-capture.md')
      expect(existsSync(rulePath), 'fresh emission must materialize the derived rule').toBe(true)
      rmSync(rulePath)

      const result = runGate(dir)
      expect(result.status, `deleted derived rule must exit 1, got: ${result.stdout}`).toBe(1)
      expect(result.stdout).toMatch(
        /check-codex-self-parity: MISSING \.agents\/rules\/60-incidental-capture\.md — /i,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  it('a hook block appended to the materialized .codex/config.toml is a STALE finding', async () => {
    const dir = await buildFixture()
    try {
      appendFileSync(
        join(dir, '.codex', 'config.toml'),
        '\n# fixture-injected drift (never emitted by the generator)\n' +
          '[hooks.rogue-injected]\n' +
          'command = "node .claude/hooks/rogue-injected.mjs"\n',
      )

      const result = runGate(dir)
      expect(result.status, `config.toml drift must exit 1, got: ${result.stdout}`).toBe(1)
      expect(result.stdout).toMatch(/check-codex-self-parity: STALE \.codex\/config\.toml — /i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  it('an extra unregistered file under .agents/rules is an UNCLASSIFIED finding', async () => {
    const dir = await buildFixture()
    try {
      writeFileSync(
        join(dir, '.agents', 'rules', '99-rogue.md'),
        '# Rogue Rule\n\nPresent in the repo tree, never emitted, not pinned, not a runtime artifact.\n',
      )

      const result = runGate(dir)
      expect(result.status, `unclassified extra file must exit 1, got: ${result.stdout}`).toBe(1)
      expect(result.stdout).toMatch(
        /check-codex-self-parity: UNCLASSIFIED \.agents\/rules\/99-rogue\.md — /i,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  it('tolerates the repo-convention doc front matter on a materialized rule (still green)', async () => {
    const dir = await buildFixture()
    try {
      const rulePath = join(dir, '.agents', 'rules', '05-agent-lifecycle.md')
      const body = readFileSync(rulePath, 'utf-8')
      // Repo convention adds a leading YAML doc block the templates never
      // carry — a front-matter-only difference is a normalized match (M1).
      writeFileSync(rulePath, DOC_FRONT_MATTER + body)

      const result = runGate(dir)
      expect(
        result.status,
        `front-matter-only difference must stay green, got ${result.status}: ${result.stdout}${result.stderr}`,
      ).toBe(0)
      expect(result.stdout).toContain('check-codex-self-parity: OK')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  it('fails closed (exit 2) when the --repo-root has no arbiter.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-self-parity-bare-'))
    try {
      const result = runGate(dir)
      expect(
        result.status,
        'a repo-root without arbiter.json must fail closed (exit 2), never pass silently',
      ).toBe(2)
      expect(result.stderr).toMatch(/arbiter\.json/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('RT-01/02: a dangling symlink under a track root is an UNREADABLE finding, not a crash', async () => {
    const dir = await buildFixture()
    try {
      symlinkSync(join(dir, 'no-such-target.md'), join(dir, '.codex', 'dangling-link.md'))
      const result = runGate(dir)
      expect(
        result.status,
        `a dangling symlink must classify as a finding (exit 1), got ${result.status}: ${result.stderr}`,
      ).toBe(1)
      expect(result.stdout.toUpperCase()).toContain('UNREADABLE')
      expect(result.stdout + result.stderr).not.toMatch(/at .*node:internal/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('RT-02: a FIFO under a track root is rejected without reading (no hang)', async () => {
    const dir = await buildFixture()
    try {
      execFileSync('mkfifo', [join(dir, '.agents', 'rules', 'pipe.md')], { env: cleanChildEnv() })
      const started = Date.now()
      const result = runGate(dir)
      expect(Date.now() - started, 'gate must not block on the FIFO').toBeLessThan(30_000)
      expect(result.status).toBe(1)
      expect(result.stdout.toUpperCase()).toContain('UNREADABLE')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('RT-05: an oversized markdown pair compares raw (no prettier OOM) and stays green', async () => {
    const dir = await buildFixture()
    try {
      const big = '# big\n\n' + 'lorem ipsum dolor sit amet '.repeat(50_000) + '\n'
      writeFileSync(join(dir, '.agents', 'rules', '99-big.md'), big)
      // register as runtime artifact so the extra file is classified, isolating the size path
      const raPath = join(dir, 'scripts', 'data', 'codex-self-parity-runtime-artifacts.json')
      writeFileSync(
        raPath,
        JSON.stringify(
          { runtimeArtifacts: ['.agents/plan/PLAN.json', '.agents/rules/99-big.md'] },
          null,
          2,
        ) + '\n',
      )
      const result = runGate(dir)
      expect(
        result.status,
        `oversized md must not abort the gate: ${result.stderr.slice(0, 300)}`,
      ).toBe(0)
      expect(result.stdout).toContain('check-codex-self-parity: OK')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
