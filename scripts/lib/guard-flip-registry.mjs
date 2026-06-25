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
//   { kind: 'core', flip() => { bad, clean } }  // a gh-audit guard, proven via its pure classifier
//
// Pure semantics export — no entry point, no process.exit (see check-fail-closed-audit SKIP_FILES).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

const pkg = (testScript) =>
  JSON.stringify({ name: 'fx', version: '0.0.0', scripts: { 'test:unit': testScript } }, null, 2)

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
}
