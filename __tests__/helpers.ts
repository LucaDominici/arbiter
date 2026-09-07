import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Language, ProjectConfig } from '../src/wizard/types.js'
import { presetToTiers, defaultPresetForLevel } from '../src/invariants/filter.js'
import { acquireLock } from '../src/utils/file-lock.js'
import { renderTemplate } from '../src/utils/render.js'
import { loadGateRegistry } from '../src/generators/check-all.js'
import { buildGateEvidence, captureGateStart } from '../scripts/lib/gate-evidence.mjs'
export { DEFAULT_THRESHOLDS } from '../src/config/schema.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Derive the mutation-lock path for a given repo checkout root (#2026).
 *
 * Suffixed with a short hash of `repoRoot` so distinct checkouts (e.g.
 * parallel ADR-103 worktree lanes) get distinct lock files under the shared
 * OS tmpdir, while repeated calls for the SAME checkout keep resolving to
 * the same stable path (preserving same-checkout serialization).
 */
export function dogfoodRepoMutationLockPath(repoRoot: string): string {
  const hash = createHash('sha1').update(repoRoot).digest('hex').slice(0, 12)
  return join(tmpdir(), `arbiter-check-self-dogfood-repo-mutation-${hash}.lock`)
}

const DOGFOOD_REPO_MUTATION_LOCK_PATH = dogfoodRepoMutationLockPath(process.cwd())

/**
 * `check-self-dogfood.test.ts` and `check-self-dogfood-external.test.ts` each
 * spawn `node scripts/check-self-dogfood.mjs` against the LIVE repo checkout,
 * and several of those tests transiently mutate a real tracked file (write →
 * spawn → restore) to prove the gate goes red. Vitest runs different test
 * files concurrently by default, so without exclusion one file's spawned
 * check can observe another file's in-flight mutation window — a
 * load-sensitive cross-file race (same shape as the #1891 SIGKILL-flake-budget
 * and #1907 dogfood races). Serializes every such test across BOTH files via
 * the product's own file-lock primitive (`acquireLock` fails fast on
 * contention, so poll it rather than block-wait).
 *
 * The lock path is scoped per checkout root (#2026): ADR-103 supports
 * parallel worktree lanes, and a single GLOBAL lock file would make unrelated
 * checkouts contend/time out on each other through a shared tmp file.
 */
export async function withRealRepoMutationLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      const lock = await acquireLock(DOGFOOD_REPO_MUTATION_LOCK_PATH, {
        staleAgeMs: 5 * 60 * 1000,
      })
      try {
        return await fn()
      } finally {
        await lock.release()
      }
    } catch (e) {
      const code = e instanceof Error ? (e as Error & { code?: string }).code : undefined
      if ((code !== 'E_LOCK_BUSY' && code !== 'E_LOCK_CONFLICT') || Date.now() > deadline) throw e
      await sleep(100)
    }
  }
}

/**
 * Write the unified task document (`.claude/.task/status.json`) for a test fixture (#1206).
 * Replaces the legacy pattern of writing individual `.claude/.task-*` dotfiles.
 */
export function writeTaskStateFile(
  dir: string,
  fields: {
    phase?: string
    plan?: string
    tier?: string
    taskId?: string
    branch?: string
  } = {},
): void {
  const taskDir = join(dir, '.claude', '.task')
  mkdirSync(taskDir, { recursive: true })
  const status = {
    taskId: fields.taskId ?? '',
    phase: fields.phase ?? 'preflight',
    tier: fields.tier ?? '',
    plan: fields.plan ?? '',
    branch: fields.branch ?? '',
    cursor: { tddPhase: null, lastAction: '', nextAction: '' },
    handoffStrategy: null,
    handoffReady: false,
    runId: 'test',
    timestamps: {},
    gateDecisions: [],
  }
  writeFileSync(join(taskDir, 'status.json'), JSON.stringify(status, null, 2) + '\n')
}

/**
 * Create a temp directory with language-specific marker files.
 */
export function createTestProject(language: Language = 'unknown'): string {
  const dir = mkdtempSync(join(tmpdir(), `arbiter-test-${language}-`))

  switch (language) {
    case 'typescript':
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
          devDependencies: {
            typescript: '^5.0.0',
            eslint: '^9.0.0',
            prettier: '^3.0.0',
          },
        }),
      )
      break
    case 'java':
      writeFileSync(join(dir, 'build.gradle'), 'plugins { id "java" }')
      break
    case 'rust':
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "test"\nversion = "0.1.0"')
      break
    case 'go':
      writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.22')
      break
    case 'python':
      writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "test"')
      break
    case 'multi':
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
        }),
      )
      mkdirSync(join(dir, 'backend'), { recursive: true })
      writeFileSync(join(dir, 'backend', 'build.gradle'), 'plugins { id "java" }')
      break
  }

  return dir
}

/**
 * Initialize a git repo in the given directory.
 */
export function initGit(dir: string, remote?: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], {
    cwd: dir,
    stdio: 'ignore',
  })
  if (remote) {
    execFileSync('git', ['remote', 'add', 'origin', remote], {
      cwd: dir,
      stdio: 'ignore',
    })
  }
}

/**
 * Remove a test project directory.
 */
export function cleanupTestProject(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Build a ProjectConfig fixture with sensible defaults.
 * Pass overrides for any field you need to vary.
 */
export function makeConfig(dir: string, overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  const governanceLevel = overrides.governanceLevel ?? 'L2'
  return {
    targetDir: dir,
    projectName: 'test-project',
    description: 'Test project',
    language: 'typescript',
    framework: null,
    archetype: 'library',
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    buildTool: 'npm',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --check .',
    tools: ['claude', 'codex'],
    governanceLevel,
    useGitHub: false,
    githubOwner: null,
    githubRepo: null,
    existing: {
      agentsMd: false,
      claudeDir: false,
      agentsDir: false,
      aiRulez: false,
      settingsJson: false,
      checkAllScript: false,
      geminiDir: false,
      windsurfRules: false,
      aiderConf: false,
      tests: false,
      ciWorkflows: false,
      lintConfig: false,
    },
    languageHooks: [],
    enableDebtGates: governanceLevel !== 'L1',
    enableSuppressions: true,
    enableSecurityScanning: governanceLevel !== 'L1',
    enableSoloDevMode: false,
    invariantTiers: presetToTiers(defaultPresetForLevel(governanceLevel)),
    basePackage: undefined,
    contractType: 'none',
    lanes: [],
    ...overrides,
  }
}

/**
 * #2041: render check-all.mjs.ejs the way the generator does. The template is
 * now registry-driven — the emitted gate calls come from the declarative
 * gate-registry.yml.ejs manifest (loadGateRegistry), so a bare makeConfig
 * render throws on the absent `gates` key. This helper mirrors
 * generateCheckAll's enrichment (coverage/mutation floors per the fixed
 * threshold profile + the registry) so render tests exercise exactly the data
 * the generator feeds the template.
 */
export function renderCheckAll(data: Record<string, unknown>): string {
  const enriched: Record<string, unknown> = {
    coverageThreshold: 80,
    coverageEnabled: true,
    mutationEnabled: true,
    binarySizeBytes: 0,
    ...data,
  }
  return renderTemplate('scripts/check-all.mjs.ejs', {
    ...enriched,
    gates: loadGateRegistry(enriched),
  })
}

/**
 * #2328 — materialize the shared gate-pass verifier into a fixture project,
 * exactly as `generateCheckAll` co-emits it, so hooks and `.githooks/pre-push`
 * can resolve `scripts/lib/gate-evidence.mjs`.
 */
export function materializeGateEvidenceLib(dir: string): void {
  const libDir = join(dir, 'scripts', 'lib')
  mkdirSync(libDir, { recursive: true })
  const cfg = makeConfig(dir, { language: 'typescript' })
  // #2427 added gate-mutex.mjs: `.githooks/pre-push` now launches the gate
  // THROUGH it, so a fixture without it no longer runs the hook's gate at all.
  for (const name of [
    'gate-evidence.mjs',
    'gate-mutex.mjs',
    'run-helpers.mjs',
    'evidence-binding.mjs',
  ]) {
    writeFileSync(join(libDir, name), renderTemplate(`scripts/lib/${name}.ejs`, cfg))
  }
}

/**
 * #2328 — stamp a REAL schema-v3 gate-pass marker for `dir` through the writer
 * path, optionally planting `overrides` on top. Fixtures must never hand-write
 * the marker: a hand-maintained literal is how one of them ends up with an
 * empty field nobody notices.
 */
export function writeGatePassEvidence(
  dir: string,
  opts: {
    level?: string
    taskId?: string
    stampedIn?: string
    overrides?: Record<string, unknown>
  } = {},
): Record<string, unknown> {
  // #2427: the writer now REQUIRES the identity captured at gate start. The
  // fixture captures it immediately before building, which is the honest
  // stand-in for a gate whose tree did not move while it ran.
  const root = opts.stampedIn ?? dir
  const built = buildGateEvidence({
    root,
    level: opts.level ?? 'L2',
    taskId: opts.taskId ?? 'unknown',
    start: captureGateStart(root),
  }) as Record<string, unknown> | null
  if (built === null) throw new Error(`writeGatePassEvidence: no git checkout at ${dir}`)
  const marker = { ...built, ...(opts.overrides ?? {}) }
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(join(dir, '.arbiter', 'gate-pass.json'), JSON.stringify(marker, null, 2) + '\n')
  return marker
}
