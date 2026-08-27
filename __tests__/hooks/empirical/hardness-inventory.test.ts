import { spawnSync } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(process.cwd())
const VERIFIER = join(REPO_ROOT, 'scripts/check-hardness-inventory.mjs')
const MANIFEST = join(REPO_ROOT, '.arbiter/hooks-manifest.json')

type ManifestEntry = { file: string; [k: string]: unknown }
type Manifest = { version: number; hooks: ManifestEntry[] }

function isManifest(v: unknown): v is Manifest {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['version'] === 'number' &&
    Array.isArray((v as Record<string, unknown>)['hooks'])
  )
}

function runVerifier(extraArgs: string[] = []) {
  return spawnSync('node', [VERIFIER, ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
}

describe('check-hardness-inventory', () => {
  it('passes on the real repo tree (all hooks match manifest, HARD hooks exit correctly)', () => {
    const result = runVerifier()
    if (result.status !== 0) {
      process.stderr.write(result.stdout + result.stderr)
    }
    expect(result.status).toBe(0)
  })

  it('exits 1 when manifest references a non-existent hook file (drift detection)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-manifest-drift-'))
    try {
      const raw = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as unknown
      if (!isManifest(raw)) throw new Error('Invalid manifest shape')
      const manifest = raw
      const broken: Manifest = {
        ...manifest,
        hooks: [
          ...manifest.hooks,
          {
            file: 'ghost-hook-that-does-not-exist.mjs',
            classification: 'HARD',
            spawnable: true,
            expectedExitCode: 1,
            fixture: { type: 'env-only', env: {} },
            rationale: 'synthetic drift test',
          },
        ],
      }
      const brokenManifestPath = join(tmpDir, 'hooks-manifest.json')
      writeFileSync(brokenManifestPath, JSON.stringify(broken, null, 2))

      const result = runVerifier(['--manifest', brokenManifestPath])
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/ghost-hook|not found|drift/i)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('exits 1 when a HARD spawnable hook exits 0 on known violation (ceremony regression)', () => {
    // Use a synthetic single-entry manifest pointing only to ssot-guard,
    // so drift detection passes (exactly one file, one entry) and only the
    // empirical exit-code assertion fires — confirming ceremony regression detection.
    const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-hook-regression-'))
    try {
      const fakeHooksDir = join(tmpDir, 'hooks')
      mkdirSync(fakeHooksDir, { recursive: true })
      writeFileSync(
        join(fakeHooksDir, 'pre-edit-ssot-guard.mjs'),
        '#!/usr/bin/env node\n// FAKE: always exits 0 (ceremony regression)\nprocess.exit(0);\n',
      )

      const raw = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as unknown
      if (!isManifest(raw)) throw new Error('Invalid manifest shape')
      const manifest = raw
      const ssotEntry = manifest.hooks.find((h) => h.file === 'pre-edit-ssot-guard.mjs')
      const syntheticManifest: Manifest = {
        version: 1,
        hooks: ssotEntry ? [ssotEntry] : [],
      }
      const syntheticManifestPath = join(tmpDir, 'hooks-manifest.json')
      writeFileSync(syntheticManifestPath, JSON.stringify(syntheticManifest, null, 2))

      const result = runVerifier(['--manifest', syntheticManifestPath, '--hooks-dir', fakeHooksDir])
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/ceremony regression|hardness-drift/i)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('exits 1 when a Codex entry points to a hook absent from the Codex config template (Codex parity)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-codex-parity-'))
    try {
      const syntheticManifest: Manifest = {
        version: 1,
        hooks: [
          {
            file: 'my-hook-not-in-template.mjs',
            classification: 'SOFT',
            tools: ['codex'],
            rationale: 'test Codex parity',
          },
        ],
      }
      const manifestPath = join(tmpDir, 'hooks-manifest.json')
      writeFileSync(manifestPath, JSON.stringify(syntheticManifest, null, 2))

      const hooksDir = join(tmpDir, 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(join(hooksDir, 'my-hook-not-in-template.mjs'), '#!/usr/bin/env node\n')

      const codexTemplate = join(tmpDir, 'config.toml.ejs')
      writeFileSync(codexTemplate, '# codex config\n# no hooks listed here\n')

      const result = runVerifier([
        '--manifest',
        manifestPath,
        '--hooks-dir',
        hooksDir,
        '--codex-template',
        codexTemplate,
      ])
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/codex|missing from/i)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ─── #2326: self-surface hardness ────────────────────────────────────────────
// The template surface is probed by staging each hook into a tmpdir next to a
// template-rendered lib.mjs. That model is structurally wrong for arbiter's OWN
// materialized hooks, and was falsified empirically before these tests were written:
//
//   1. Self hooks are repo-root scoped (`if (!file.startsWith(process.cwd())) exit(0)`),
//      a deliberate self-hardening the templates do not carry. A fixture in os.tmpdir()
//      therefore makes every one of them exit 0 — GREEN ON A DEAD HOOK.
//   2. `.claude/hooks/lib.mjs` imports `../../scripts/lib/suppressions-shared.mjs`, which
//      cannot resolve from a tmpdir — so the self pair cannot be staged at all, and a hook
//      staged beside the TEMPLATE lib is not the pair that broke in #2324.
//
// Self mode therefore spawns each hook IN PLACE with cwd at the repo root and writes its
// fixture inside that repo. Selected by `selfSurface: true` on the manifest — never by a
// path heuristic, so the template invocation keeps byte-identical behaviour.

const SETTINGS = join(REPO_ROOT, '.claude/settings.json')
const SELF_MANIFEST = join(REPO_ROOT, '.arbiter/self-hooks-manifest.json')

/** A minimal self-shaped repo: <tmp>/.claude/hooks + a real lib.mjs sibling. */
function selfFixture(hookBody: string, libBody = 'export const probeSentinel = 1\n') {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-selfhard-'))
  const hooksDir = join(root, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(join(hooksDir, 'lib.mjs'), libBody)
  writeFileSync(join(hooksDir, 'hooks.mjs'), '// dispatcher, not a hook\n')
  writeFileSync(join(hooksDir, 'probe-guard.mjs'), hookBody)
  return { root, hooksDir }
}

function selfManifest(root: string, entry: Record<string, unknown>) {
  const path = join(root, 'self-manifest.json')
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      selfSurface: true,
      hooks: [{ file: 'probe-guard.mjs', ...entry }],
    }),
  )
  return path
}

// A hook shaped like arbiter's real ones: repo-root scoped, imports its sibling lib.
const GUARD = (exitCode: number) => `#!/usr/bin/env node
import { probeSentinel } from './lib.mjs'
const file = process.env['CLAUDE_TOOL_INPUT_PATH'] ?? ''
if (!file) process.exit(0)
if (!file.startsWith(process.cwd())) process.exit(0)
if (probeSentinel !== 1) process.exit(0)
process.stderr.write('probe-guard: violation\\n')
process.exit(${exitCode})
`

const FILE_FIXTURE = {
  classification: 'HARD',
  tools: ['claude'],
  spawnable: true,
  expectedExitCode: 2,
  fixture: { type: 'file-with-content', content: 'violation\n', envKey: 'CLAUDE_TOOL_INPUT_PATH' },
  rationale: '#2326 self-surface probe',
}

describe('check-hardness-inventory — self surface (#2326)', () => {
  it('observes a self hook that blocks: in-place spawn, cwd at repo root (AC-1)', () => {
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      const result = runVerifier([
        '--manifest',
        selfManifest(root, FILE_FIXTURE),
        '--hooks-dir',
        hooksDir,
      ])
      expect(result.stdout + result.stderr).toMatch(/exits 2 on violation fixture/)
      expect(result.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('flips RED when a HARD self hook stops blocking — planted defect (AC-4)', () => {
    const { root, hooksDir } = selfFixture(GUARD(1))
    try {
      const result = runVerifier([
        '--manifest',
        selfManifest(root, FILE_FIXTURE),
        '--hooks-dir',
        hooksDir,
      ])
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/ceremony regression detected/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('runs the hook against its OWN lib.mjs, never a template-rendered one (AC-8)', () => {
    // The guard exits 0 unless its sibling lib exports `probeSentinel`. The template lib
    // does not, so a staged run cannot reach the violation path — and a hook that exits 0
    // where 2 is expected is a FAIL. Passing proves the real sibling was used.
    const { root, hooksDir } = selfFixture(GUARD(2), 'export const probeSentinel = 1\n')
    try {
      const result = runVerifier([
        '--manifest',
        selfManifest(root, FILE_FIXTURE),
        '--hooks-dir',
        hooksDir,
      ])
      expect(result.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('excludes lib.mjs and hooks.mjs from the self drift walk (AC-7)', () => {
    // Neither is a hook; the template filter only skips `lib.mjs.ejs`, so without the
    // self-mode widening both would demand a nonsense manifest entry.
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      const result = runVerifier([
        '--manifest',
        selfManifest(root, FILE_FIXTURE),
        '--hooks-dir',
        hooksDir,
      ])
      expect(result.stdout + result.stderr).not.toMatch(/'(lib|hooks)\.mjs' has no manifest entry/)
      expect(result.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails on an undeclared self hook, and never passes vacuously on an empty manifest (AC-7)', () => {
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      writeFileSync(
        join(hooksDir, 'undeclared-guard.mjs'),
        '#!/usr/bin/env node\nprocess.exit(0)\n',
      )
      const declared = runVerifier([
        '--manifest',
        selfManifest(root, FILE_FIXTURE),
        '--hooks-dir',
        hooksDir,
      ])
      expect(declared.status).toBe(1)
      expect(declared.stdout + declared.stderr).toMatch(/undeclared-guard\.mjs.*no manifest entry/)

      const emptyPath = join(root, 'empty.json')
      writeFileSync(emptyPath, JSON.stringify({ version: 1, selfSurface: true, hooks: [] }))
      const empty = runVerifier(['--manifest', emptyPath, '--hooks-dir', hooksDir])
      expect(empty.status).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('REFUSES a fixture.path outside the sandbox instead of writing it (AC-9)', () => {
    // The self surface writes fixtures into the live repo and deletes them afterwards.
    // An unguarded `fixture.path` is therefore a write-then-delete primitive aimed at the
    // working tree — and the manifest that arms it is protected by neither enforce-read-only
    // nor ssotGuardPatterns. A mis-authored `"path": "AGENTS.md"` must FAIL, not fire.
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      const victim = join(root, 'AGENTS.md')
      const original = '# tracked file that must survive\n'
      writeFileSync(victim, original)
      const manifestPath = selfManifest(root, {
        ...FILE_FIXTURE,
        fixture: { ...FILE_FIXTURE.fixture, path: 'AGENTS.md' },
      })
      const result = runVerifier(['--manifest', manifestPath, '--hooks-dir', hooksDir])
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/outside the fixture sandbox/)
      expect(readFileSync(victim, 'utf-8')).toBe(original)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('REFUSES a fixture.path that escapes the repo via traversal (AC-9)', () => {
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      const manifestPath = selfManifest(root, {
        ...FILE_FIXTURE,
        fixture: { ...FILE_FIXTURE.fixture, path: '../escaped.ts' },
      })
      const result = runVerifier(['--manifest', manifestPath, '--hooks-dir', hooksDir])
      expect(result.status).toBe(1)
      expect(existsSync(join(root, '..', 'escaped.ts'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('REFUSES a fixture whose deletable parent is outside the exact sandbox root', () => {
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      const trackedParent = join(root, 'tracked-parent')
      const keeper = join(trackedParent, 'keeper.txt')
      mkdirSync(trackedParent)
      writeFileSync(keeper, 'must survive\n')
      const manifestPath = selfManifest(root, {
        ...FILE_FIXTURE,
        fixture: {
          ...FILE_FIXTURE.fixture,
          path: 'tracked-parent/.arb-hardness-probe.ts',
        },
      })
      const result = runVerifier(['--manifest', manifestPath, '--hooks-dir', hooksDir])
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/outside the fixture sandbox/)
      expect(readFileSync(keeper, 'utf-8')).toBe('must survive\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails an ADVISORY entry whose hook actually blocks (AC-6)', () => {
    // ADVISORY is otherwise an unasserted waiver: the spawn arm only exercises HARD entries,
    // so declaring a live blocker ADVISORY silently removes it from the gate. This caught two
    // real mis-declarations in this manifest's first version.
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      const manifestPath = selfManifest(root, {
        classification: 'ADVISORY',
        tools: ['claude'],
        spawnable: false,
        rationale: 'claims to be advisory while its source blocks',
      })
      const result = runVerifier(['--manifest', manifestPath, '--hooks-dir', hooksDir])
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/declared ADVISORY but its source contains/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a promotedBy claim the hook source does not back (AC-6)', () => {
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      const manifestPath = selfManifest(root, {
        classification: 'ADVISORY',
        tools: ['claude'],
        spawnable: false,
        promotedBy: 'ARBITER_NOT_IN_SOURCE',
        rationale: 'unbacked promotion claim',
      })
      const result = runVerifier(['--manifest', manifestPath, '--hooks-dir', hooksDir])
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/promotion claim is unbacked/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails when a hook exits right but never reaches its violation branch (AC-8)', () => {
    // enforce-read-only exits 2 fail-closed on an UNRESOLVABLE path (INV-96). If the self
    // lib's resolveToolInputPath regresses — the #2324 shape — the hook exits 2 for the wrong
    // reason and an exit-code-only probe reports PASS. expectStderr pins the code path.
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      const manifestPath = selfManifest(root, {
        ...FILE_FIXTURE,
        expectStderr: 'this-string-is-never-printed',
      })
      const result = runVerifier(['--manifest', manifestPath, '--hooks-dir', hooksDir])
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/did not reach the violation branch/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves a path-only fixture target byte-identical (AC-9)', () => {
    // Provoked by a real near-miss: a "write the fixture" helper pointed at
    // docs/internal/SYSTEM/DECISIONS.md truncated that tracked SSOT. path-only fixtures
    // must be structurally incapable of that.
    const { root, hooksDir } = selfFixture(GUARD(2))
    try {
      const guarded = join(root, 'GUARDED.md')
      const original = '# guarded SSOT\nline two\n'
      writeFileSync(guarded, original)
      const manifestPath = selfManifest(root, {
        ...FILE_FIXTURE,
        fixture: { type: 'path-only', path: 'GUARDED.md', envKey: 'CLAUDE_TOOL_INPUT_PATH' },
      })
      const result = runVerifier(['--manifest', manifestPath, '--hooks-dir', hooksDir])
      expect(result.status).toBe(0)
      expect(readFileSync(guarded, 'utf-8')).toBe(original)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes every fixture it writes, including on the failing path (AC-9)', () => {
    const { root, hooksDir } = selfFixture(GUARD(1))
    try {
      const manifestPath = selfManifest(root, {
        ...FILE_FIXTURE,
        fixture: {
          type: 'file-with-content',
          // Sandbox-legal AND src/-relative — the shape the real manifest uses for the
          // INV-12 guard. A path outside the sandbox is REFUSED before any write, which
          // would make this test pass for the wrong reason and prove nothing about cleanup.
          path: 'src/.arb-hardness-tmp/probe.ts',
          content: "import { spawnSync } from 'node:child_process'\n",
          envKey: 'CLAUDE_TOOL_INPUT_PATH',
        },
      })
      const result = runVerifier(['--manifest', manifestPath, '--hooks-dir', hooksDir])
      expect(result.status).toBe(1)
      // Red for the PLANTED DEFECT, not for a refused fixture — the two failure modes are
      // indistinguishable by exit code alone.
      expect(result.stdout + result.stderr).toMatch(/ceremony regression detected/)
      expect(result.stdout + result.stderr).not.toMatch(/outside the fixture sandbox/)
      // A surviving child_process import under src/ would itself be an INV-12 violation.
      expect(readdirSync(join(root, 'src'))).toEqual([])
      expect(readdirSync(root).filter((f) => f.startsWith('.arb-hardness'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('arbiter self hooks are declared and observed (#2326)', () => {
  function loadSelfManifest(): Manifest {
    const raw = JSON.parse(readFileSync(SELF_MANIFEST, 'utf-8')) as unknown
    if (!isManifest(raw)) throw new Error('self manifest has an invalid shape')
    return raw
  }

  it('declares every hook wired in settings.json, and every HARD entry blocks via exit 2 (AC-6)', () => {
    const declared = new Set(loadSelfManifest().hooks.map((h) => h.file))
    const wired = new Set(
      [...readFileSync(SETTINGS, 'utf-8').matchAll(/([a-z0-9-]+\.mjs)/g)].map((m) => m[1]),
    )
    expect([...wired].filter((f) => !declared.has(f))).toEqual([])

    const hardWithWrongCode = loadSelfManifest().hooks.filter(
      (h) => h['classification'] === 'HARD' && h['expectedExitCode'] !== 2,
    )
    expect(hardWithWrongCode.map((h) => h.file)).toEqual([])
  })

  it('observes the self post-commit hook blocking git -C commit empirically (#2340)', () => {
    const templateManifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as Manifest
    const templateEntry = templateManifest.hooks.find((h) => h.file === 'post-commit-check.mjs.ejs')
    const selfEntry = loadSelfManifest().hooks.find((h) => h.file === 'post-commit-check.mjs')
    expect(templateEntry).toMatchObject({ classification: 'HARD', expectedExitCode: 2 })
    expect(selfEntry).toMatchObject({ classification: 'HARD', expectedExitCode: 2 })

    const root = mkdtempSync(join(tmpdir(), 'arbiter-post-commit-self-'))
    const target = join(root, 'repo with spaces')
    try {
      mkdirSync(target)
      spawnSync('git', ['init'], { cwd: target, encoding: 'utf-8' })
      spawnSync('git', ['config', 'user.email', 'test@arbiter.test'], {
        cwd: target,
        encoding: 'utf-8',
      })
      spawnSync('git', ['config', 'user.name', 'Arbiter Test'], {
        cwd: target,
        encoding: 'utf-8',
      })
      spawnSync(
        'git',
        ['-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'bad commit message'],
        {
          cwd: target,
          encoding: 'utf-8',
        },
      )
      const result = spawnSync('node', [join(REPO_ROOT, '.claude/hooks/post-commit-check.mjs')], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_TOOL_INPUT_COMMAND: `git -C "${target}" commit`,
        },
        input: '',
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/INV-22/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('empirically observes the two isolated-root #2342 self hooks', () => {
    const entries = loadSelfManifest().hooks.filter((h) =>
      ['pre-edit-ssot-guard.mjs', 'enforce-gate-before-pr.mjs'].includes(h.file),
    )
    expect(entries).toHaveLength(2)
    expect(entries.every((h) => h['spawnable'] === true)).toBe(true)

    const result = runVerifier([
      '--manifest',
      SELF_MANIFEST,
      '--hooks-dir',
      join(REPO_ROOT, '.claude/hooks'),
    ])
    const out = result.stdout + result.stderr
    expect(result.status).toBe(0)
    expect(out).toMatch(/pre-edit-ssot-guard\.mjs exits 2 on violation fixture/)
    expect(out).toMatch(/enforce-gate-before-pr\.mjs exits 2 on violation fixture/)
  })

  it('records the #2326 self-hook surface in ADR-032 and INV-36 (#2341)', () => {
    const adr = readFileSync(
      join(REPO_ROOT, 'docs/internal/ADR/032-hook-hardness-manifest.md'),
      'utf-8',
    )
    const catalog = readFileSync(join(REPO_ROOT, 'src/invariants/catalog.ts'), 'utf-8')

    expect(adr).toContain('.arbiter/self-hooks-manifest.json')
    expect(adr).toContain('selfSurface: true')
    expect(catalog).toMatch(/id: 'INV-36'[\s\S]*?selfSurface: true/)
    expect(catalog).toMatch(/id: 'INV-36'[\s\S]*?in-place self-hook probes/)
  })

  it('keeps at least 12 self hooks empirically observed, not merely declared (AC-10)', () => {
    const observed = loadSelfManifest().hooks.filter((h) => h['spawnable'] === true)
    expect(observed.length).toBeGreaterThanOrEqual(12)
  })

  it('gives every non-spawnable entry a written rationale (AC-6)', () => {
    const unexplained = loadSelfManifest().hooks.filter(
      (h) => typeof h['rationale'] !== 'string' || (h['rationale'] as string).trim() === '',
    )
    expect(unexplained.map((h) => h.file)).toEqual([])
  })

  it('is wired into the gate under a name distinct from the template run (AC-3)', () => {
    // Parity gates are keyed by name into a Map; a duplicate name would let the passing
    // template run mask a failing self run.
    const gate = readFileSync(join(REPO_ROOT, 'scripts/check-all.mjs'), 'utf-8')
    expect(gate).toMatch(/--hooks-dir['"\s,]+\.claude\/hooks/)
    expect(gate).toMatch(/hardness inventory \(self hooks\)/)
    const parity = readFileSync(join(REPO_ROOT, 'scripts/check-local-ci-parity.mjs'), 'utf-8')
    expect(parity).toMatch(/hardness inventory \(self hooks\)/)
  })

  it('records the measured runtime and the surface matrix in HOOK-CONTRACTS.md (AC-3, AC-5)', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs/internal/SYSTEM/HOOK-CONTRACTS.md'), 'utf-8')
    for (const check of [
      'check-hook-contracts.mjs',
      'check-hardness-inventory.mjs',
      'check-hook-routing.mjs',
      'check-self-dogfood.mjs',
      'probe-hooks.mjs',
    ]) {
      expect(doc).toContain(check)
    }
    expect(doc).toMatch(/## Hook check surface matrix/)
    // Assert an actual figure, not the word "measured" — AC-3 requires a recorded cost, and a
    // grep for the adjective keeps nothing honest.
    expect(doc).toMatch(/measured[^.]*?\d+(\.\d+)?\s*(ms|s)\b/i)
    expect(doc).toMatch(/12 of 30/)
  })

  it('mutates no tracked state when run against the real hooks dir (AC-2)', () => {
    const snapshot = () => ({
      head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' }).stdout,
      branch: spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
      }).stdout,
      status: spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf-8' })
        .stdout,
    })
    const before = snapshot()
    runVerifier(['--manifest', SELF_MANIFEST, '--hooks-dir', join(REPO_ROOT, '.claude/hooks')])
    expect(snapshot()).toEqual(before)
  })
})
