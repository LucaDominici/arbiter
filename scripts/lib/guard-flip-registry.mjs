// SPDX-License-Identifier: Apache-2.0
// arbiter — guard-flip discrimination registry (A6, #1497). For each anti-fake-green guard, a PROOF
// that it discriminates: a planted BAD case it must reject and a CLEAN case it must accept. The
// guard-flip harness (scripts/check-guard-flip.mjs) enumerates the GUARDS SSOT and requires an
// entry here for every guard — a guard with no entry is presumed vacuous and FAILS CI.
//
// Entry shapes:
//   { kind: 'file-scan', inject: 'dir' | 'cwd', plantBad(dir), plantClean(dir) }
//     inject 'dir' → the guard is run with `--dir <fixture>`; 'cwd' → the guard is run FROM the
//     fixture dir (guards that read package.json/.github from process.cwd() with no --dir flag).
//   { kind: 'file-scan', argv(dir) => string[], plantBad(dir), plantClean(dir) }
//     argv → the guard takes bespoke flags (--evidence-dir/--file/--plan…, the anti-context-rot
//     gates, #1943 M11); the harness spawns `node <script> ...argv(fixtureDir)` from the repo root.
//   { kind: 'core', flip() => { bad, clean } }  // a gh-audit guard, proven via its pure classifier
//
// Pure semantics export — no entry point, no process.exit (see check-fail-closed-audit SKIP_FILES).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { classifyReview, classifyOwnership } from './anti-fake-green-core.mjs'

const write = (dir, rel, body) => {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}
const wf = (dir, name, body) => write(dir, join('.github', 'workflows', name), body)
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString()

// A workflow gate step whose failure is swallowed by a literal-true continue-on-error.
const GATE_SWALLOWED = `name: ci
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - name: L1 gate
        run: node scripts/check-all.mjs L1
        continue-on-error: true
`
const GATE_CLEAN = GATE_SWALLOWED.replace(/\s+continue-on-error: true/, '')

// A secret-backed gate step. The bad variant silently `exit 0`s on an empty secret; the clean
// variant fails loud unless the sanctioned `vars.SKIP_X=true` opt-out is set.
const secretStep = (run, env) =>
  `name: deploy
on: [push]
jobs:
  s:
    runs-on: ubuntu-latest
    steps:
      - name: gate
        env:
${env}
        run: |
${run}
`
const SECRET_BAD = secretStep(
  '          [[ -z "$BASE_URL" ]] && { echo skip; exit 0; }\n          run-it',
  '          BASE_URL: ${{ secrets.TEST_BASE_URL }}',
)
const SECRET_CLEAN = secretStep(
  '          test -n "$BASE_URL" || { [ "${SKIP_X}" = "true" ] && exit 0 || { echo "::error::x"; exit 1; }; }\n          run-it',
  '          BASE_URL: ${{ secrets.TEST_BASE_URL }}\n          SKIP_X: ${{ vars.SKIP_X }}',
)

const STUB_DOC = '# Moved\n\nThis page has moved to [the new home](./new.md).\n'
const REAL_DOC = '# Real\n\n' + 'genuine content here. '.repeat(30) + '\n'

// ── anti-context-rot fixtures (E1-E7 #1943, M11 flip-coverage) ────────────────────────────────

/** A schema-valid agent-return envelope (E1); override fields to plant a violation. */
const envelope = (overrides = {}) =>
  JSON.stringify(
    {
      schema: 'arbiter-agent-return-v1',
      agent: 'red-team',
      role: 'reviewer',
      taskId: '#1',
      branch: 'main',
      sha: 'deadbeefcafe',
      ts: '2026-01-01T00:00:00Z',
      verdict: 'PASS',
      confidence: 0.9,
      findings: [],
      ...overrides,
    },
    null,
    2,
  )

/** A skeptic envelope carrying one refutation verdict targeting finding `f1` (E2). */
const skeptic = (verdict) =>
  JSON.stringify({ role: 'skeptic', refutations: [{ target: 'f1', verdict }] }, null, 2)

/** Refutation marker: N=3 skeptics required over one acted-on finding (E2). */
const REFUTATION_MARKER = JSON.stringify({ skeptics: 3, findings: ['f1'] }, null, 2)

/** Plant an E2 fixture: marker + three skeptic verdicts for finding f1. */
const plantRefutation = (d, verdicts) => {
  write(d, join('returns', 'task', 'refutation-required.json'), REFUTATION_MARKER)
  verdicts.forEach((v, i) => write(d, join('returns', 'task', `skeptic-${i}.json`), skeptic(v)))
}

/** One dry-pass ledger line (E3). */
const pass = (n, seed, newFindings) => JSON.stringify({ pass: n, seed, newFindings }) + '\n'

/** A HANDOFF task section; `tierRow` plants/omits the Suggested-tier contract row (E6a). */
const handoff = (tierRow) =>
  '# Handoff: fixture\n\n### 1. Do the thing\n\n' +
  '- **What:** implement it\n- **Where:** src/a.ts\n- **AC:** it works\n' +
  '- **Verify:** `npm test`\n' +
  (tierRow ? '- **Suggested tier:** haiku\n' : '')

/** git helper for the E7 fixture repo (never touches the host repo). */
const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  })

/**
 * Renders the REAL scripts/build-kernel-plugin.mjs (via its `--out=` flag, #2548) into
 * `dir`, as a child process — never imported, so this pure registry module never takes a
 * hard dependency on dist/ being built. Used for the 'kernel plugin parity (#2548)' fixture
 * below: `plantClean` renders and stops; `plantBad` renders and then corrupts one file, so
 * the gate must catch real content drift rather than merely a directory's existence.
 */
const KERNEL_PLUGIN_GENERATOR = fileURLToPath(
  new URL('../build-kernel-plugin.mjs', import.meta.url),
)
const renderKernelPluginInto = (dir) =>
  execFileSync('node', [KERNEL_PLUGIN_GENERATOR, `--out=${dir}`], { stdio: 'ignore' })

/**
 * Plant an E7 fixture: a real git repo whose `base` branch declares src/a.ts and whose
 * HEAD commit touches `touchedFile` — inside (clean) or outside (bad) the manifest.
 */
const plantManifestRepo = (d, touchedFile) => {
  write(d, 'plan.md', '## Group: G\nFiles: src/a.ts\nRead-set: src/a.ts\n')
  const repo = join(d, 'repo')
  write(repo, join('src', 'a.ts'), 'export const a = 1\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'branch', 'base')
  write(repo, touchedFile, 'export const x = 2\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'work')
}

const pkg = (testScript) =>
  JSON.stringify({ name: 'fx', version: '0.0.0', scripts: { 'test:unit': testScript } }, null, 2)

/**
 * Plant an assertion-delta fixture repo (#2161): a `base` branch with two assertions, then a
 * HEAD commit that either drops one with nothing added (bad) or keeps both and adds a third
 * (clean, net-positive delta — a legitimate strengthening refactor).
 */
const plantAssertionDeltaRepo = (d, keepBoth) => {
  const repo = join(d, 'repo')
  const two = "it('x', () => {\n  expect(1).toBe(1)\n  expect(2).toBe(2)\n})\n"
  write(repo, join('src', 'a.test.ts'), two)
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'branch', 'base')
  const next = keepBoth
    ? "it('x', () => {\n  expect(1).toBe(1)\n  expect(2).toBe(2)\n  expect(3).toBe(3)\n})\n"
    : "it('x', () => {\n  expect(1).toBe(1)\n})\n"
  write(repo, join('src', 'a.test.ts'), next)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'test: refactor')
}

// ── CANON-25 absence-family fixtures (#2301) ──────────────────────────────────────────────────
// The forbidden tokens below are ASSEMBLED at runtime, never written literally: this file is a
// tracked .mjs and every one of these gates scans tracked .mjs files, so a literal fixture token
// would make the repo fail its own gate.
const ORPHAN = `// TO${'DO'}: unbound work item`
const ANCHORED = `// TO${'DO'}(#2301): bound work item`
const PLACEHOLDER_TOKEN = `// ${'FIX'}${'ME'}: left behind`
const WORK_REF = ['via', 'fera'].join('')

/** A minimal git repo at `dir` with `files` committed. Never touches the host repo. */
const gitFixture = (dir, files) => {
  for (const [rel, body] of Object.entries(files)) write(dir, rel, body)
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'fixture')
}

/** An invariant catalog + AGENTS.md pair; `mirrored` decides whether AGENTS.md carries the row. */
const plantCatalogParity = (d, mirrored) => {
  // id and title must sit on SEPARATE lines: the catalog parser is line-based and skips to the
  // next line after matching an id, so a one-line entry parses as zero invariants (vacuous pass).
  write(
    d,
    'catalog.ts',
    "export const CATALOG = [\n  {\n    id: 'INV-01',\n    title: 'Thing is enforced',\n  },\n]\n",
  )
  write(d, 'AGENTS.md', mirrored ? '# A\n\n- **INV-01:** Thing is enforced\n' : '# A\n\nno rows\n')
}

/** A CANON.md whose single entry either cites a wired gate (clean) or is prose only (bad). */
const plantCanonParity = (d, wired) => {
  write(d, 'scripts/check-fixture-gate.mjs', 'process.exit(0)\n')
  write(d, 'check-all.mjs', "runCheck('fixture', 'node', ['scripts/check-fixture-gate.mjs'])\n")
  write(d, 'settings.json', '{}\n')
  write(
    d,
    'CANON.md',
    '## CANON-01 — fixture rule\n\n**Rule:** a rule.\n\n**Enforcement:** ' +
      (wired ? '`scripts/check-fixture-gate.mjs` (L1 gate)' : 'checked at PR review.') +
      '\n',
  )
}

const plantComplexityRatchet = (d, source) => {
  write(d, 'eslint.config.mjs', "export default [{ files: ['**/*.js'] }]\n")
  write(d, 'scripts/fixture.js', 'export const ok = true\n')
  write(
    d,
    'scripts/debt-baseline.json',
    JSON.stringify({
      version: 2,
      capturedAt: '2026-09-23',
      commit: 'fixture',
      archetype: 'fixture',
      metrics: {
        complexityViolations: { value: 0, unit: 'count', direction: 'lower-is-better' },
      },
    }),
  )
  write(d, 'src/a.js', source)
}

const plantPublicApiRatchet = (d, source) => {
  write(
    d,
    'scripts/debt-baseline.json',
    JSON.stringify({
      version: 2,
      capturedAt: '2026-09-24',
      commit: 'fixture',
      archetype: 'fixture',
      metrics: { publicApiSurface: { value: 1, unit: 'count', direction: 'lower-is-better' } },
    }),
  )
  write(d, 'src/a.ts', source)
}

/** The discrimination proofs, keyed by guard name (must cover every entry in GUARDS). */
export const FLIP_REGISTRY = {
  // ── gh-audit guards: proven via their pure classifiers ────────────────────────────────────
  'min-review-time': {
    kind: 'core',
    flip() {
      const base = {
        author: { login: 'alice' },
        createdAt: '2026-01-01T00:00:00Z',
        mergedAt: '2026-01-01T00:03:00Z',
        files: [{ path: 'src/x.ts' }],
        labels: [],
      }
      return {
        // 0 non-author approvals + 3-minute code merge → the unreviewed fast-merge fake-green.
        bad: classifyReview({ ...base, latestReviews: [] }).verdict,
        // a real non-author approval makes the same fast merge legitimate.
        clean: classifyReview({
          ...base,
          latestReviews: [{ author: { login: 'bob' }, state: 'APPROVED' }],
        }).verdict,
      }
    },
  },
  'ownership-distribution': {
    kind: 'core',
    flip() {
      const mk = (n, fn) =>
        Array.from({ length: n }, (_, i) => ({ labels: ['P0'], assignees: [{ login: fn(i) }] }))
      return {
        // 8/10 P0s on one owner → ownership concentration over the 30% threshold.
        bad: classifyOwnership(mk(10, (i) => (i < 8 ? 'a' : 'b'))).verdict,
        // evenly spread across 4 owners → well-distributed.
        clean: classifyOwnership(mk(12, (i) => ['a', 'b', 'c', 'd'][i % 4])).verdict,
      }
    },
  },

  // ── file-scan guards: proven on synthetic fixture dirs ────────────────────────────────────
  'muted-test': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) => write(d, join('__tests__', 'a.test.ts'), "it.skip('muted', () => {})\n"),
    plantClean: (d) =>
      write(d, join('__tests__', 'a.test.ts'), "it('ok', () => { expect(1).toBe(1) })\n"),
  },
  'skip-critical-e2e': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) => {
      write(d, 'playwright.config.ts', 'export default {}\n')
      write(d, join('e2e', 'a.spec.ts'), "test.skip('x', async () => {})\n")
    },
    plantClean: (d) => {
      write(d, 'playwright.config.ts', 'export default {}\n')
      write(d, join('e2e', 'a.spec.ts'), "test('x', async () => {})\n")
    },
  },
  'no-stub-redirects': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) => write(d, join('docs', 'old.md'), STUB_DOC),
    plantClean: (d) => write(d, join('docs', 'real.md'), REAL_DOC),
  },
  'grace-window': {
    kind: 'file-scan',
    inject: 'dir',
    // a far-future graceEndsAt hand-edited into arbiter.json keeps L2 gates WARN-only forever.
    plantBad: (d) =>
      write(
        d,
        'arbiter.json',
        JSON.stringify(
          { governanceLevel: 'L2', graceFromLevel: 'L1', graceEndsAt: daysFromNow(400) },
          null,
          2,
        ),
      ),
    plantClean: (d) => write(d, 'arbiter.json', JSON.stringify({ governanceLevel: 'L2' }, null, 2)),
  },
  'secret-presence': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) => wf(d, 'deploy.yml', SECRET_BAD),
    plantClean: (d) => wf(d, 'deploy.yml', SECRET_CLEAN),
  },
  'continue-on-error': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) => wf(d, 'ci.yml', GATE_SWALLOWED),
    plantClean: (d) => wf(d, 'ci.yml', GATE_CLEAN),
  },
  'no-empty-suite': {
    kind: 'file-scan',
    // this guard reads package.json from process.cwd(); run it FROM the fixture dir.
    inject: 'cwd',
    plantBad: (d) => write(d, 'package.json', pkg('vitest run --passWithNoTests')),
    plantClean: (d) => write(d, 'package.json', pkg('vitest run')),
  },
  'fixture-isolation': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) =>
      write(
        d,
        join('.arbiter', 'evidence', 'study', 'results.json'),
        JSON.stringify({ findings: [{ id: 'fake-001' }] }),
      ),
    plantClean: (d) =>
      write(
        d,
        join('.arbiter', 'evidence', 'tdd', 'clean.json'),
        JSON.stringify({
          id: '2181-ac1',
          test_run_log:
            'the anti-fake-green audit ran against a fake-green fixture\nwith a fake-db transcript',
        }),
      ),
  },

  'vacuous-optional-assertion': {
    kind: 'file-scan',
    inject: 'dir',
    // same default token on both sides of `??`/`.toEqual(` → the assertion cannot see removal.
    plantBad: (d) =>
      write(d, join('__tests__', 'a.test.ts'), 'expect(payload.data.x ?? []).toEqual([])\n'),
    // default differs from the checked value → absence already fails; not vacuous.
    plantClean: (d) =>
      write(
        d,
        join('__tests__', 'a.test.ts'),
        "expect(payload.data).toHaveProperty('x')\nexpect(payload.data.x).toEqual([])\n",
      ),
  },

  // ── anti-context-rot gates (E1-E7 #1943): proven via bespoke-argv fixtures ────────────────
  'agent-return': {
    kind: 'file-scan',
    argv: (d) => ['--evidence-dir', join(d, 'returns'), '--repo-root', d],
    // verdict outside the schema enum → the envelope shape the E1 gate must reject.
    plantBad: (d) =>
      write(d, join('returns', 'task', 'red-team-0.json'), envelope({ verdict: 'MAYBE' })),
    plantClean: (d) => write(d, join('returns', 'task', 'red-team-0.json'), envelope()),
  },
  'refutation-verdicts': {
    kind: 'file-scan',
    argv: (d) => ['--evidence-dir', join(d, 'returns')],
    // acted-on finding majority-REFUTED (1 UPHELD vs 2 REFUTED) → must fail adjudication.
    plantBad: (d) => plantRefutation(d, ['UPHELD', 'REFUTED', 'REFUTED']),
    plantClean: (d) => plantRefutation(d, ['UPHELD', 'UPHELD', 'REFUTED']),
  },
  'audit-dry-pass': {
    kind: 'file-scan',
    argv: (d) => ['--dir', join(d, 'audit')],
    // conclusion artifact present while the last pass is still wet (newFindings > 0).
    plantBad: (d) => {
      write(d, join('audit', 'report.md'), '# concluded\n')
      write(d, join('audit', 'pass-ledger.jsonl'), pass(1, 'a', 3) + pass(2, 'b', 2))
    },
    plantClean: (d) => {
      write(d, join('audit', 'report.md'), '# concluded\n')
      write(d, join('audit', 'pass-ledger.jsonl'), pass(1, 'a', 0) + pass(2, 'b', 0))
    },
  },
  'handoff-doc': {
    kind: 'file-scan',
    argv: (d) => ['--file', join(d, 'HANDOFF.md')],
    // task section missing the Suggested-tier row → silent expensive-model re-route (R7).
    plantBad: (d) => write(d, 'HANDOFF.md', handoff(false)),
    plantClean: (d) => write(d, 'HANDOFF.md', handoff(true)),
  },
  'touched-vs-manifest': {
    kind: 'file-scan',
    argv: (d) => [
      '--plan',
      join(d, 'plan.md'),
      '--group',
      'G',
      '--base',
      'base',
      '--repo-root',
      join(d, 'repo'),
    ],
    // HEAD touches src/b.ts while the manifest declares only src/a.ts → outside the write set.
    plantBad: (d) => plantManifestRepo(d, join('src', 'b.ts')),
    plantClean: (d) => plantManifestRepo(d, join('src', 'a.ts')),
  },

  // ── assertion-delta (#2161): proven on a real fixture repo (diff-based, needs real git history) ─
  'assertion-delta': {
    kind: 'file-scan',
    argv: (d) => ['--repo-root', join(d, 'repo'), '--range', 'base..HEAD'],
    // HEAD drops one of the two base assertions, adds none — the reward-hacking shape.
    plantBad: (d) => plantAssertionDeltaRepo(d, false),
    // HEAD keeps both base assertions and adds a third — net-positive, legitimate.
    plantClean: (d) => plantAssertionDeltaRepo(d, true),
  },
  // ── CANON-25 absence-asserting family (#2301): keyed by their scripts/check-all.mjs check name.
  // Each names the concrete change that must turn the gate red, and proves it by inverting it.
  // (`no passWithNoTests (INV-25)` needs no entry — the same script is proven above as
  //  `no-empty-suite`, and the roster resolves a proof by script as well as by name.)
  placeholders: {
    kind: 'file-scan',
    argv: (d) => [d],
    // a leftover marker in a scanned source file → the gate must see it
    plantBad: (d) => write(d, join('src', 'a.ts'), `export const a = 1\n${PLACEHOLDER_TOKEN}\n`),
    plantClean: (d) => write(d, join('src', 'a.ts'), 'export const a = 1\n// documented\n'),
  },
  'orphan TODOs': {
    kind: 'file-scan',
    // this gate resolves its scan dirs with join(process.cwd(), dir), so an absolute --dir would
    // land under the repo root; run it FROM the fixture with a relative dir instead.
    inject: 'cwd',
    argv: () => ['src'],
    // an unbound work item is the violation; the same line bound to a task id is clean
    plantBad: (d) => write(d, join('src', 'a.ts'), `${ORPHAN}\nexport const a = 1\n`),
    plantClean: (d) => write(d, join('src', 'a.ts'), `${ANCHORED}\nexport const a = 1\n`),
  },
  'i18n raw strings': {
    kind: 'file-scan',
    argv: (d) => [join(d, 'src'), '--inventory', join(d, 'inventory.json')],
    // The bad raw string is not covered by the loaded inventory.
    plantBad: (d) => {
      write(d, join('src', 'a.ts'), "throw new UserFacingError('a raw message')\n")
      write(
        d,
        'inventory.json',
        JSON.stringify([{ file: 'a.ts', text: "throw new UserFacingError('different')" }]),
      )
    },
    // The same raw string is clean only when the inventory names its exact file and text.
    plantClean: (d) => {
      const text = "throw new UserFacingError('a raw message')"
      write(d, join('src', 'a.ts'), `${text}\n`)
      write(d, 'inventory.json', JSON.stringify([{ file: 'a.ts', text }]))
    },
  },
  'no direct-fs outside the façade': {
    kind: 'file-scan',
    argv: (d) => ['--root', d],
    // a src/ module importing a WRITE op straight from node:fs, bypassing src/utils/fs.ts
    plantBad: (d) =>
      write(
        d,
        join('src', 'a.ts'),
        "import { writeFileSync } from 'node:fs'\nexport const w = () => writeFileSync('x', 'y')\n",
      ),
    // the same module reading through node:fs is not a façade bypass — must stay green
    plantClean: (d) =>
      write(
        d,
        join('src', 'a.ts'),
        "import { readFileSync } from 'node:fs'\nexport const r = () => readFileSync('x', 'utf-8')\n",
      ),
  },
  'no work refs': {
    kind: 'file-scan',
    inject: 'cwd',
    argv: () => ['all'],
    // a tracked source file carrying a private-repo provenance string
    plantBad: (d) => gitFixture(d, { 'src/a.ts': `export const origin = '${WORK_REF}'\n` }),
    plantClean: (d) => gitFixture(d, { 'src/a.ts': "export const origin = 'public'\n" }),
  },
  'no tracked artifacts (INV-117)': {
    kind: 'file-scan',
    env: (d) => ({ ARBITER_HOOK_GIT_CWD: d }),
    // a data/state file committed to the index — invisible to gitleaks and to the PII scan
    plantBad: (d) => gitFixture(d, { 'data.sqlite': 'SQLite format 3\u0000' }),
    plantClean: (d) => gitFixture(d, { 'README.md': '# fixture\n' }),
  },
  'no redacted tokens': {
    kind: 'file-scan',
    // #2514: file bodies now resolve against ARBITER_HOOK_GIT_CWD (the same root git ls-files
    // is listed from) instead of the script's own repo root — this is what makes the gate
    // fixture-injectable at all; before the fix every read landed on this live repo's own
    // src/kit/ tree regardless of the fixture, so no planted bad case could ever be seen.
    env: (d) => ({ ARBITER_HOOK_GIT_CWD: d }),
    // a kit-authored file carrying a forbidden lexicon token
    plantBad: (d) => gitFixture(d, { 'src/kit/a.ts': 'export const svc = "planning-service"\n' }),
    plantClean: (d) => gitFixture(d, { 'src/kit/a.ts': 'export const ok = 1\n' }),
  },
  'canon enforcement parity (B1)': {
    kind: 'file-scan',
    argv: (d) => [
      `--root=${d}`,
      `--canon=${join(d, 'CANON.md')}`,
      `--gate=${join(d, 'check-all.mjs')}`,
      `--settings=${join(d, 'settings.json')}`,
    ],
    // an Enforcement field that is prose with no wired citation and no dated promotion
    plantBad: (d) => plantCanonParity(d, false),
    plantClean: (d) => plantCanonParity(d, true),
  },
  'catalog parity': {
    kind: 'file-scan',
    argv: (d) => [`--catalog=${join(d, 'catalog.ts')}`, `--agents=${join(d, 'AGENTS.md')}`],
    // a catalog invariant with no matching row in AGENTS.md — the parity break
    plantBad: (d) => plantCatalogParity(d, false),
    plantClean: (d) => plantCatalogParity(d, true),
  },
  'kernel plugin parity (#2548)': {
    kind: 'file-scan',
    inject: 'dir',
    // Renders the REAL generator into the fixture dir so `dir` always reflects whatever
    // build-kernel-plugin.mjs emits TODAY — never a second, independently-maintained
    // fixture that could itself drift from the real output. plantBad then corrupts one
    // file: the gate must catch real content drift, not merely a directory's existence.
    plantClean: (d) => renderKernelPluginInto(d),
    plantBad: (d) => {
      renderKernelPluginInto(d)
      writeFileSync(join(d, 'stop-dangerous.mjs'), '// #2548 guard-flip: corrupted on purpose\n')
    },
  },
  'complexity ratchet (preventive)': {
    kind: 'file-scan',
    inject: 'cwd',
    argv: () => ['--gate', '--only-metric', 'complexityViolations'],
    plantBad: (d) =>
      plantComplexityRatchet(
        d,
        `export function f(x) {\n${Array.from({ length: 11 }, (_, i) => `  if (x === ${i + 1}) return ${i + 1}`).join('\n')}\n  return 0\n}\n`,
      ),
    plantClean: (d) => plantComplexityRatchet(d, 'export const ok = true\n'),
  },
  'public API ratchet (preventive)': {
    kind: 'file-scan',
    inject: 'cwd',
    argv: () => ['--gate', '--only-metric', 'publicApiSurface'],
    plantBad: (d) => plantPublicApiRatchet(d, 'export const a = 1\nexport const b = 2\n'),
    plantClean: (d) => plantPublicApiRatchet(d, 'export const a = 1\n'),
  },
  // #2560: check-todo-max-age.mjs newly admitted to the CANON-25 family via the declared roster
  // (gate-roster.mjs) — its old name/basename matched none of the three regexes, so it sat
  // outside the family entirely (the issue's proof case). Proven on the filesystem-only ABORT
  // path (#2526): a resolved scan set of ZERO files is a hard FAIL, never the vacuous "no
  // linked-issue references — PASS". Deliberately does not exercise the `gh api`-backed age check
  // (network, offline-unsafe) — the zero-files/zero-refs pair is what the roster admission is
  // proving: the gate cannot silently report clean by looking nowhere.
  'todo max-age': {
    kind: 'file-scan',
    argv: (d) => [d],
    // an empty directory (no source files at all) → resolved scan set is empty → ABORT (exit 1)
    plantBad: () => {},
    // one ordinary source file, zero linked-issue references → legitimate clean state → PASS (exit 0)
    plantClean: (d) => write(d, join('src', 'a.ts'), 'export const a = 1\n'),
  },

  // ── #2675: 12 of the 19 #2560 ABSENCE_EXEMPT candidates, promoted with a real flip proof —
  // each already reads its scan root from an argv flag (--dir/--root/--patterns/--gate), so no
  // new injection point was needed.
  'anti-drift: secret scan': {
    kind: 'file-scan',
    inject: 'dir',
    // an AWS-access-key-shaped string built at runtime (never a static literal in this source
    // file, so gitleaks/the secret scan never sees a real-looking token committed here) —
    // still matches check-secret-scan's own AKIA[0-9A-Z]{16} pattern once written to the fixture
    plantBad: (d) => write(d, 'config.js', `export const key = "AKIA${'ABCDEFGHIJKLMNOP'}"\n`),
    plantClean: (d) => write(d, 'config.js', 'export const ok = true\n'),
  },
  'anti-drift: validator helptext': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) =>
      write(
        d,
        join('scripts', 'check-fake.mjs'),
        '// anti-drift validator family (W6)\nconsole.log("no help flag here")\n',
      ),
    plantClean: (d) =>
      write(
        d,
        join('scripts', 'check-fake.mjs'),
        '// anti-drift validator family (W6)\n// supports --help\n',
      ),
  },
  'anti-drift: drift manifest': {
    kind: 'file-scan',
    inject: 'dir',
    // manifest hash disagrees with the actual file content
    plantBad: (d) => {
      write(
        d,
        join('.arbiter', 'drift-manifest.json'),
        JSON.stringify([{ path: 'generated.txt', hash: 'deadbeef' }]),
      )
      write(d, 'generated.txt', 'actual content\n')
    },
    // an empty manifest — nothing to check, nothing drifted
    plantClean: (d) => write(d, join('.arbiter', 'drift-manifest.json'), '[]'),
  },
  'anti-drift: workflow docs sync': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) => {
      write(d, join('.github', 'workflows', 'build.yml'), 'name: build\n')
      write(d, join('docs', 'readme.md'), '# hi\n')
    },
    plantClean: (d) => {
      write(d, join('.github', 'workflows', 'build.yml'), 'name: build\n')
      write(d, join('docs', 'readme.md'), '# build docs\nSee the build workflow.\n')
    },
  },
  'npm-ci drift (#1684)': {
    kind: 'file-scan',
    argv: (d) => ['--root', d],
    // a lockfile present but no exact npm@X.Y.Z packageManager pin — the network-free FAIL branch
    plantBad: (d) => {
      write(d, 'package.json', JSON.stringify({ name: 'fixture', version: '1.0.0' }))
      write(d, 'package-lock.json', '{}')
    },
    // no lockfile at all — not applicable, no npm invocation
    plantClean: (d) =>
      write(d, 'package.json', JSON.stringify({ name: 'fixture', version: '1.0.0' })),
  },
  'anti-drift: pii scan config': {
    kind: 'file-scan',
    argv: (d) => ['--patterns', join(d, 'patterns.txt')],
    plantBad: (d) => write(d, 'patterns.txt', '[unclosed\n'),
    plantClean: (d) => write(d, 'patterns.txt', String.raw`\d{3}-\d{2}-\d{4}` + '\n'),
  },
  'anti-drift: tier coverage': {
    kind: 'file-scan',
    argv: (d) => ['--gate', join(d, 'check-all.mjs')],
    plantBad: (d) =>
      write(
        d,
        'check-all.mjs',
        [
          "runCheck('build-kit', ...)",
          "runCheck('typecheck', ...)",
          "runCheck('lint', ...)",
          "runCheck('unit tests', ...)",
          "runCheck('spdx headers', ...)",
          "runCheck('orphan TODOs', ...)",
        ].join('\n') + '\n',
      ),
    plantClean: (d) =>
      write(
        d,
        'check-all.mjs',
        [
          "runCheck('build-kit', ...)",
          "runCheck('typecheck', ...)",
          "runCheck('lint', ...)",
          "runCheck('unit tests', ...)",
          "runCheck('spdx headers', ...)",
          "runCheck('orphan TODOs', ...)",
          "runCheck('ci tiers', ...)",
        ].join('\n') + '\n',
      ),
  },
  'anti-drift: suppression rationale': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) =>
      write(d, join('suppressions', 'pii-allowlist.json'), JSON.stringify([{ reason: 'short' }])),
    plantClean: (d) =>
      write(
        d,
        join('suppressions', 'pii-allowlist.json'),
        JSON.stringify([{ reason: 'a sufficiently long and meaningful rationale' }]),
      ),
  },
  'anti-drift: suppression expiry': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) =>
      write(
        d,
        join('suppressions', 'pii-allowlist.json'),
        JSON.stringify([{ expiresAt: daysFromNow(500) }]),
      ),
    plantClean: (d) =>
      write(
        d,
        join('suppressions', 'pii-allowlist.json'),
        JSON.stringify([{ expiresAt: daysFromNow(30) }]),
      ),
  },
  'anti-drift: pr size gate': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) =>
      write(d, join('config', 'pr-size-config.json'), JSON.stringify({ warnLines: 2000 })),
    plantClean: (d) =>
      write(d, join('config', 'pr-size-config.json'), JSON.stringify({ warnLines: 500 })),
  },
  'anti-drift: workflow runners': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) =>
      write(
        d,
        join('.github', 'workflows', 'x.yml'),
        'jobs:\n  build:\n    runs-on: macos-latest\n',
      ),
    plantClean: (d) =>
      write(
        d,
        join('.github', 'workflows', 'x.yml'),
        'jobs:\n  build:\n    runs-on: ubuntu-latest\n',
      ),
  },
  'anti-drift: workflow integrity': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) =>
      wf(
        d,
        'ci.yml',
        'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n        continue-on-error: true\n',
      ),
    plantClean: (d) =>
      wf(
        d,
        'ci.yml',
        'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n',
      ),
  },
  'anti-drift: workflow parallelism (INV-120)': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) =>
      wf(
        d,
        'ci.yml',
        'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n  b:\n    needs: a\n    runs-on: ubuntu-latest\n  c:\n    needs: b\n    runs-on: ubuntu-latest\n  d:\n    needs: c\n    runs-on: ubuntu-latest\n  e:\n    needs: d\n    runs-on: ubuntu-latest\n',
      ),
    plantClean: (d) =>
      wf(
        d,
        'ci.yml',
        'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n  b:\n    needs: a\n    runs-on: ubuntu-latest\n  c:\n    needs: b\n    runs-on: ubuntu-latest\n  d:\n    needs: c\n    runs-on: ubuntu-latest\n',
      ),
  },
  'anti-drift: unwired guards (#2159)': {
    kind: 'file-scan',
    inject: 'dir',
    plantBad: (d) => write(d, join('scripts', 'check-orphan.mjs'), '// guard\n'),
    plantClean: (d) => {
      write(d, join('scripts', 'check-orphan.mjs'), '// guard\n')
      write(d, join('scripts', 'check-all.mjs'), "run('scripts/check-orphan.mjs')\n")
    },
  },
  'anti-drift: docker action runner safety (#1756)': {
    kind: 'file-scan',
    inject: 'dir',
    // a denylisted docker-container action paired with an expression-based (self-hosted-capable) runner
    plantBad: (d) =>
      write(
        d,
        join('.github', 'workflows', 'x.yml'),
        'jobs:\n  build:\n    runs-on: ${{ vars.RUNNER }}\n    steps:\n      - uses: bridgecrewio/checkov-action@v12\n',
      ),
    plantClean: (d) =>
      write(
        d,
        join('.github', 'workflows', 'x.yml'),
        'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n',
      ),
  },
}
