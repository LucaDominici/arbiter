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

// ── CANON-24 absence-family fixtures (#2301) ──────────────────────────────────────────────────
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
  // ── CANON-24 absence-asserting family (#2301): keyed by their scripts/check-all.mjs check name.
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
    argv: (d) => [d],
    // a user-facing throw carrying a raw literal instead of a t() key
    plantBad: (d) => write(d, join('src', 'a.ts'), "throw new UserFacingError('a raw message')\n"),
    plantClean: (d) => write(d, join('src', 'a.ts'), "throw new UserFacingError(t('a.key'))\n"),
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
}
