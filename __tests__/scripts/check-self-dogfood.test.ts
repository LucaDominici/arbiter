import { describe, it, expect } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildRenderContext,
  templateToMaterialized,
  TEMPLATE_ROOTS,
  isAllowlisted,
  isConfigGated,
  normalizeLines,
  computeDiff,
  hashDiff,
  classifyDivergence,
  exportedSymbols,
  missingExports,
} from '../../scripts/check-self-dogfood.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const checkerPath = join(repoRoot, 'scripts/check-self-dogfood.mjs')

/**
 * Build a disposable root that is complete enough for the full dogfood checker:
 * source/dist freshness, template rendering, raw hooks, and external parity all
 * remain active. Synthetic drift is written only inside this directory.
 */
function createDogfoodProbeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-dogfood-probe-'))
  for (const path of [
    'src',
    '.claude',
    '.arbiter/ship',
    '.github',
    'scripts',
    'schemas',
    'dist',
    'arbiter.json',
    'package.json',
    '.dogfood-divergences.json',
  ]) {
    cpSync(join(repoRoot, path), join(root, path), { recursive: true })
  }
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  return root
}

function runDogfoodProbe(root: string, timeout: number, extraArgs: string[] = []) {
  return spawnSync('node', [checkerPath, '--root', root, ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout,
  })
}

/** diffHash currently pinned for a divergence entry in a probe root's manifest. */
function divergenceEntry(root: string, path: string) {
  const entries = JSON.parse(readFileSync(join(root, '.dogfood-divergences.json'), 'utf-8'))
  return entries.find((e: { path: string }) => e.path === path) as {
    diffHash?: string
    allowedDroppedExports?: string[]
  }
}

// ─── buildRenderContext ───────────────────────────────────────────────────────

describe('buildRenderContext', () => {
  it('reads testCommand from package.json (npm run test)', () => {
    const cfg = {
      governanceLevel: 'L2',
      tools: ['claude'],
      features: {},
    }
    const ctx = buildRenderContext(cfg)
    // arbiter's package.json has a 'test' script → should produce 'npm run test'
    expect(ctx.testCommand).toBe('npm run test')
  })

  it('reads lintCommand from package.json (npm run lint)', () => {
    const cfg = {
      governanceLevel: 'L2',
      tools: ['claude'],
      features: {},
    }
    const ctx = buildRenderContext(cfg)
    expect(ctx.lintCommand).toBe('npm run lint')
  })

  it('sets enableEvidenceHarness=false when feature flag is false', () => {
    const cfg = {
      features: { evidenceHarness: false },
    }
    const ctx = buildRenderContext(cfg)
    expect(ctx.enableEvidenceHarness).toBe(false)
  })

  it('sets enableEvidenceHarness=true when feature flag is true', () => {
    const cfg = {
      features: { evidenceHarness: true },
    }
    const ctx = buildRenderContext(cfg)
    expect(ctx.enableEvidenceHarness).toBe(true)
  })

  it('defaults to L2 governance level', () => {
    const cfg = {}
    const ctx = buildRenderContext(cfg)
    expect(ctx.governanceLevel).toBe('L2')
  })

  it('passes through tools array from config', () => {
    const cfg = { tools: ['claude', 'codex'] }
    const ctx = buildRenderContext(cfg)
    expect(ctx.tools).toEqual(['claude', 'codex'])
  })

  it('resolves the rendered wave concurrency from automation or collaboration mode', () => {
    expect(
      buildRenderContext({
        collaborationMode: 'peer-review',
        automation: { maxParallelWorktrees: 7 },
      }).maxParallelWorktrees,
    ).toBe(7)
    expect(buildRenderContext({ collaborationMode: 'trunk-solo' }).maxParallelWorktrees).toBe(1)
  })
})

// ─── templateToMaterialized ───────────────────────────────────────────────────

describe('templateToMaterialized', () => {
  it('strips .ejs extension and maps to .claude/', () => {
    const result = templateToMaterialized('/repo/src/templates/claude/hooks/lib.mjs.ejs')
    expect(result).toMatch(/\.claude\/hooks\/lib\.mjs$/)
    expect(result).not.toContain('.ejs')
  })

  it('handles nested paths', () => {
    const result = templateToMaterialized('/repo/src/templates/claude/skills/tdd/SKILL.md.ejs')
    expect(result).toMatch(/\.claude\/skills\/tdd\/SKILL\.md$/)
  })

  it('handles root-level templates', () => {
    const result = templateToMaterialized('/repo/src/templates/claude/CLAUDE.md.ejs')
    expect(result).toMatch(/\.claude\/CLAUDE\.md$/)
  })

  // #1290 — ship-driver family routes to .arbiter/ship/
  it('maps the ship family to .arbiter/ship/', () => {
    const result = templateToMaterialized('/repo/src/templates/ship/supervisor.sh.ejs')
    expect(result).toMatch(/\.arbiter\/ship\/supervisor\.sh$/)
  })

  it('throws on a template path outside every TEMPLATE_ROOTS family (fail-closed)', () => {
    expect(() => templateToMaterialized('/repo/src/templates/unknown/x.md.ejs')).toThrow()
  })

  it('TEMPLATE_ROOTS is the corpus SSOT and includes both families', () => {
    expect(Object.keys(TEMPLATE_ROOTS)).toEqual(['src/templates/claude/', 'src/templates/ship/'])
  })
})

// ─── isAllowlisted ────────────────────────────────────────────────────────────

describe('isAllowlisted', () => {
  it('allowlists lines with LucaDominici/arbiter', () => {
    expect(isAllowlisted("githubOwner: 'LucaDominici/arbiter'")).toBe(true)
  })

  it('allowlists lines with absolute paths', () => {
    expect(isAllowlisted('command: "/usr/bin/node"')).toBe(true)
    expect(isAllowlisted('cwd: /home/user/project')).toBe(true)
  })

  it('does not allowlist normal content lines', () => {
    expect(isAllowlisted('node scripts/check-all.mjs')).toBe(false)
    expect(isAllowlisted('## Invariants')).toBe(false)
    expect(isAllowlisted('import { join } from "node:path";')).toBe(false)
  })
})

// ─── isConfigGated ────────────────────────────────────────────────────────────

describe('isConfigGated', () => {
  const templatesDir = '/repo/src/templates/claude'

  it('gates guard-done-evidence.mjs when enableEvidenceHarness is false', () => {
    const ctx = { enableEvidenceHarness: false }
    const path = `${templatesDir}/hooks/guard-done-evidence.mjs.ejs`
    expect(isConfigGated(path, ctx)).toBe(true)
  })

  it('does not gate guard-done-evidence.mjs when enableEvidenceHarness is true', () => {
    const ctx = { enableEvidenceHarness: true }
    const path = `${templatesDir}/hooks/guard-done-evidence.mjs.ejs`
    expect(isConfigGated(path, ctx)).toBe(false)
  })

  it('does not gate other hooks regardless of config', () => {
    const ctx = { enableEvidenceHarness: false }
    const path = `${templatesDir}/hooks/lib.mjs.ejs`
    expect(isConfigGated(path, ctx)).toBe(false)
  })
})

// ─── normalizeLines ───────────────────────────────────────────────────────────

describe('normalizeLines', () => {
  it('drops blank lines', async () => {
    const result = await normalizeLines('line1\n\n\nline2\n', '/fake/test.md')
    expect(result).not.toContain('')
  })

  it('trims trailing whitespace', async () => {
    const result = await normalizeLines('  hello world  \n  foo  \n', '/fake/test.md')
    for (const line of result) {
      expect(line).toBe(line.trimEnd())
    }
  })

  it('filters allowlisted lines', async () => {
    const content = 'normal line\nLucaDominici/arbiter specific\nanother line\n'
    const result = await normalizeLines(content, '/fake/test.md')
    expect(result).not.toContain('LucaDominici/arbiter specific')
    expect(result).toContain('normal line')
  })

  it('normalizes markdown table padding via Prettier', async () => {
    const loose = `| x | y |
|---|---|
| hello | world |
`
    const tight = `| x     | y     |
| ----- | ----- |
| hello | world |
`
    const r1 = await normalizeLines(loose, '/fake/test.md')
    const r2 = await normalizeLines(tight, '/fake/test.md')
    // Both should produce same normalized output
    expect(r1).toEqual(r2)
  })
})

// ─── computeDiff ─────────────────────────────────────────────────────────────

describe('computeDiff', () => {
  it('returns null when expected and actual are equal', () => {
    const lines = ['line1', 'line2', 'line3']
    expect(computeDiff(lines, [...lines])).toBeNull()
  })

  it('returns added lines when actual has extra content', () => {
    const expected = ['line1', 'line2']
    const actual = ['line1', 'line2', 'line3-new']
    const diff = computeDiff(expected, actual)
    expect(diff).not.toBeNull()
    expect(diff?.added).toContain('line3-new')
    expect(diff?.removed).toHaveLength(0)
  })

  it('returns removed lines when expected has content missing from actual', () => {
    const expected = ['line1', 'line2', 'line3-old']
    const actual = ['line1', 'line2']
    const diff = computeDiff(expected, actual)
    expect(diff).not.toBeNull()
    expect(diff?.removed).toContain('line3-old')
    expect(diff?.added).toHaveLength(0)
  })

  it('returns both added and removed on mixed drift', () => {
    const expected = ['a', 'b', 'c']
    const actual = ['a', 'b', 'd']
    const diff = computeDiff(expected, actual)
    expect(diff?.removed).toContain('c')
    expect(diff?.added).toContain('d')
  })

  it('returns null for empty arrays', () => {
    expect(computeDiff([], [])).toBeNull()
  })

  it('DETECTS duplicate-line drift (regression: BLOCKER-8, INV-45)', () => {
    // Set-based diff would consider these equal (same UNIQUE lines).
    // Position-aware diff must flag the extra "x" as added drift.
    const expected = ['x', 'y']
    const actual = ['x', 'y', 'x']
    const diff = computeDiff(expected, actual)
    expect(diff).not.toBeNull()
    expect(diff?.added).toEqual(['x'])
    expect(diff?.removed).toHaveLength(0)
  })

  it('DETECTS missing duplicate-line drift (mirror case)', () => {
    const expected = ['x', 'y', 'x']
    const actual = ['x', 'y']
    const diff = computeDiff(expected, actual)
    expect(diff).not.toBeNull()
    expect(diff?.removed).toEqual(['x'])
    expect(diff?.added).toHaveLength(0)
  })

  it('preserves multiset semantics on multi-line counts', () => {
    // expected has 3 of "a", actual has 1 → 2 should be removed
    const expected = ['a', 'a', 'a', 'b']
    const actual = ['a', 'b']
    const diff = computeDiff(expected, actual)
    expect(diff?.removed).toEqual(['a', 'a'])
    expect(diff?.added).toHaveLength(0)
  })
})

// ─── .dogfood-divergences.json anchored rationales (#1092) ────────────────────

describe('.dogfood-divergences.json — anchored rationales (#1092)', () => {
  const ANCHOR = /#\d+|INV-\d+|CANON-\d+|ADR-\d+|\d{4}-\d{2}-\d{2}|RT-[A-Z]+-\d+/
  const path = fileURLToPath(new URL('../../.dogfood-divergences.json', import.meta.url))
  const entries = JSON.parse(readFileSync(path, 'utf-8')) as Array<{
    path: string
    reason: string
    diffHash?: string
  }>

  it('every entry has path + reason', () => {
    for (const e of entries) {
      expect(typeof e.path, `entry ${JSON.stringify(e)}`).toBe('string')
      expect(typeof e.reason, `entry ${e.path}`).toBe('string')
    }
  })

  it('every divergence reason carries a traceability anchor (#NNN, INV/CANON/ADR-NN, date, or RT-XX)', () => {
    const unanchored = entries.filter((e) => !ANCHOR.test(e.reason)).map((e) => e.path)
    expect(unanchored, `unanchored divergence rationale(s): ${unanchored.join(', ')}`).toEqual([])
  })

  // CANON-14 (#1838): the manifest is an approved-diff registry, not a skip list.
  it('every entry pins its approved diff (diffHash, CANON-14 #1838)', () => {
    const unpinned = entries.filter((e) => !e.diffHash).map((e) => e.path)
    expect(unpinned, `unpinned divergence entr(ies): ${unpinned.join(', ')}`).toEqual([])
  })
})

// ─── CANON-14 auto-diff (#1838): hashDiff + classifyDivergence ────────────────

describe('hashDiff (CANON-14, #1838)', () => {
  it('is deterministic and order-independent across added/removed line ordering', () => {
    const a = { added: ['x', 'y'], removed: ['z'] }
    const b = { added: ['y', 'x'], removed: ['z'] }
    expect(hashDiff(a)).toBe(hashDiff(b))
  })

  it('distinguishes different diffs', () => {
    expect(hashDiff({ added: ['x'], removed: [] })).not.toBe(
      hashDiff({ added: ['y'], removed: [] }),
    )
  })

  it('hashes a null diff to a distinct sentinel (healed divergence can never collide)', () => {
    expect(hashDiff(null)).toBe('no-diff')
    expect(hashDiff({ added: [], removed: [] })).not.toBe('no-diff')
  })
})

describe('classifyDivergence (CANON-14, #1838)', () => {
  const diff = { added: ['self-hardening line'], removed: [] }

  it('returns null when the recomputed diff matches the pinned hash (approved divergence)', () => {
    const entry = { path: 'hooks/x.mjs', reason: 'r', diffHash: hashDiff(diff) }
    expect(classifyDivergence(entry, diff)).toBeNull()
  })

  it('FAILS a stale entry whose divergence healed (diff now null)', () => {
    const entry = { path: 'hooks/x.mjs', reason: 'r', diffHash: hashDiff(diff) }
    const violation = classifyDivergence(entry, null)
    expect(violation).not.toBeNull()
    expect(violation?.reason).toContain('stale divergence entry')
  })

  it('FAILS an entry with no pinned diffHash (migration fail-closed)', () => {
    const entry = { path: 'hooks/x.mjs', reason: 'r' }
    const violation = classifyDivergence(entry, diff)
    expect(violation).not.toBeNull()
    expect(violation?.reason).toContain('no pinned diffHash')
  })

  it('FAILS when the diff changed beyond the approved pin (the guard-done-evidence class, #1836 F2)', () => {
    const entry = { path: 'hooks/x.mjs', reason: 'r', diffHash: hashDiff(diff) }
    const grown = { added: [...diff.added, 'NEW unreviewed drift'], removed: [] }
    const violation = classifyDivergence(entry, grown)
    expect(violation).not.toBeNull()
    expect(violation?.reason).toContain('CHANGED beyond the approved pin')
    expect(violation?.added).toContain('NEW unreviewed drift')
  })
})

// ─── T4 dogfood-closure: dated divergences (audit-mode is a STAGE) ────────────
describe('classifyDivergence expiry (T4 dogfood-closure)', () => {
  const diff = { added: ['self-hardening line'], removed: [] }
  const NOW = Date.parse('2026-07-12')

  it('passes an unexpired dated divergence whose pinned diff still matches', () => {
    const entry = { path: 'x', reason: 'r', diffHash: hashDiff(diff), expires: '2026-08-15' }
    expect(classifyDivergence(entry, diff, NOW)).toBeNull()
  })

  it('FAILS (red-path) an expired dated divergence even while its pinned diff still matches', () => {
    const entry = { path: 'x', reason: 'r', diffHash: hashDiff(diff), expires: '2026-06-01' }
    const violation = classifyDivergence(entry, diff, NOW)
    expect(violation).not.toBeNull()
    expect(violation?.reason).toContain('expired on 2026-06-01')
  })

  it('FAILS an entry with an unparseable expires value (fail-closed)', () => {
    const entry = { path: 'x', reason: 'r', diffHash: hashDiff(diff), expires: 'soon' }
    const violation = classifyDivergence(entry, diff, NOW)
    expect(violation).not.toBeNull()
    expect(violation?.reason).toContain('unparseable "expires"')
  })

  it('leaves undated (permanent-by-design) divergences unaffected', () => {
    const entry = { path: 'x', reason: 'r', diffHash: hashDiff(diff) }
    expect(classifyDivergence(entry, diff, NOW)).toBeNull()
  })
})

// ─── CANON-14 non-vacuity proof: drift INSIDE an allowlisted file goes red ────
// Before #1838 an allowlist entry skipped the whole file — new drift inside it
// was invisible (the class that let guard-done-evidence vs stop-evidence-guard
// slip, per epic #1836). This mutates an ALLOWLISTED materialized file in a
// disposable checker root and requires red.

describe('allowlisted-file drift detection is non-vacuous (CANON-14, #1838)', () => {
  it('a mutated .claude/rules/90-exec-protocol.md (allowlisted) turns the gate red', () => {
    const root = createDogfoodProbeRoot()
    const target = join(root, '.claude/rules/90-exec-protocol.md')
    const original = readFileSync(target, 'utf-8')
    try {
      writeFileSync(
        target,
        original + '\nsynthetic drift beyond the approved divergence\n',
        'utf-8',
      )
      const r = runDogfoodProbe(root, 120_000)
      expect(r.status).not.toBe(0)
      expect(r.stdout + r.stderr).toContain('90-exec-protocol.md')
      expect(r.stdout + r.stderr).toContain('CHANGED beyond the approved pin')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 150_000)
})

// ─── non-vacuity proof for the ship family (#1290) ────────────────────────────
// The dogfood gate must actually WALK src/templates/ship/ — a mapped-but-unwalked
// family passes vacuously. We mutate the materialized supervisor in a disposable
// root, run the full checker, and require it to go red.

describe('ship-family drift detection is non-vacuous (#1290)', () => {
  it('a mutated .arbiter/ship/supervisor.sh turns the gate red', () => {
    const root = createDogfoodProbeRoot()
    const target = join(root, '.arbiter/ship/supervisor.sh')
    const original = readFileSync(target, 'utf-8')
    try {
      writeFileSync(target, original + 'echo drift-sentinel\n', 'utf-8')
      const r = runDogfoodProbe(root, 300_000)
      expect(r.status).not.toBe(0)
      expect(r.stdout + r.stderr).toContain('supervisor.sh')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 360_000)
})

// ─── debt-toolchain twin drift is non-vacuous (#2229) ────────────────────────
// The debt toolchain (debt-lib / debt-report / capture-debt-baseline) ships a
// .ejs twin under src/templates/scripts/ but falls outside the check-scripts
// family's check-/record- basename filter. A single-sided edit to the
// materialized script is therefore undetected — the exact drift class #2229
// widens the family to catch.

describe('debt-toolchain twin drift is non-vacuous (#2229)', () => {
  it('a single-sided edit to scripts/debt-lib.mjs (without the .ejs twin) turns the gate red', () => {
    const root = createDogfoodProbeRoot()
    const target = join(root, 'scripts/debt-lib.mjs')
    const original = readFileSync(target, 'utf-8')
    try {
      writeFileSync(target, original + 'synthetic debt-lib drift sentinel\n', 'utf-8')
      const r = runDogfoodProbe(root, 300_000)
      expect(r.status).not.toBe(0)
      expect(r.stdout + r.stderr).toContain('debt-lib')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 360_000)

  it('an in-sync debt pair passes (no drift)', () => {
    const root = createDogfoodProbeRoot()
    try {
      const r = runDogfoodProbe(root, 300_000)
      expect(r.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 360_000)
})

// ─── #2327: a dropped export is un-absorbable by --update-divergences ────────
// #2324 in miniature: `.claude/hooks/lib.mjs` silently lost `isPathInThisRepo`,
// a sibling hook imported it, and the hook crashed on every Edit/Write for 18
// days. The whole-file hash DID notice each change — but `--update-divergences`
// ABSORBED it. The rule below is deliberately not hash-derived, so re-pinning
// cannot clear it: an approved divergence may add, replace or reimplement, it
// may never DROP an export the template ships.

describe('exportedSymbols (#2327)', () => {
  it('collects function, async function, const, let, class and default exports', () => {
    const src = [
      'export function alpha() {}',
      'export async function beta() {}',
      'export const gamma = 1',
      'export let delta = 2',
      'export class Epsilon {}',
      'export default function () {}',
    ].join('\n')
    expect([...(exportedSymbols(src) as Set<string>)].sort()).toEqual([
      'Epsilon',
      'alpha',
      'beta',
      'default',
      'delta',
      'gamma',
    ])
  })

  it('collects named export lists, honouring `as` renames and newlines', () => {
    const src = 'const a = 1\nconst b = 2\nexport {\n  a,\n  b as zeta,\n}\n'
    expect([...(exportedSymbols(src) as Set<string>)].sort()).toEqual(['a', 'zeta'])
  })

  it('ignores a bare `export` occurrence inside ordinary prose/identifiers', () => {
    expect([...(exportedSymbols('const exported = 1\n') as Set<string>)]).toEqual([])
  })

  it('returns null when the surface is not statically knowable (`export * from`)', () => {
    expect(exportedSymbols("export * from './other.mjs'\n")).toBeNull()
  })
})

describe('missingExports (#2327)', () => {
  it('reports a symbol the template exports and the materialized copy does not', () => {
    expect(
      missingExports('export function isPathInThisRepo() {}\n', 'export function other() {}\n'),
    ).toEqual(['isPathInThisRepo'])
  })

  it('does NOT report an export the materialized copy ADDS (legitimate divergence)', () => {
    expect(
      missingExports(
        'export function shared() {}\n',
        'export function shared() {}\nexport function extra() {}\n',
      ),
    ).toEqual([])
  })

  it('does NOT report a reimplementation that keeps the export name', () => {
    expect(
      missingExports('export function shared() { return 1 }\n', 'export const shared = () => 2\n'),
    ).toEqual([])
  })

  it('honours a reviewed per-entry allowedDroppedExports allowlist', () => {
    expect(missingExports('export function only() {}\n', '\n', ['only'])).toEqual([])
    expect(missingExports('export function only() {}\n', '\n', ['somethingElse'])).toEqual(['only'])
  })

  it('stays silent when either surface is unknowable rather than guessing a mass drop', () => {
    expect(missingExports('export function a() {}\n', "export * from './x.mjs'\n")).toEqual([])
  })
})

describe('a dropped export survives --update-divergences (#2327/#2324)', () => {
  it('plants the #2324 defect (isPathInThisRepo dropped) and stays RED after a re-pin', () => {
    const root = createDogfoodProbeRoot()
    const target = join(root, '.claude/hooks/lib.mjs')
    try {
      const before = divergenceEntry(root, 'hooks/lib.mjs').diffHash
      // The exact #2324 shape: the function body stays, the `export` keyword
      // vanishes, so a sibling hook's `import { isPathInThisRepo }` breaks.
      const dropped = readFileSync(target, 'utf-8').replace(
        'export function isPathInThisRepo(',
        'function isPathInThisRepo(',
      )
      expect(dropped).not.toContain('export function isPathInThisRepo(')
      writeFileSync(target, dropped, 'utf-8')

      // Run 1: the sanctioned repair. It must NOT re-pin this entry...
      const repin = runDogfoodProbe(root, 300_000, ['--update-divergences'])
      expect(repin.status).not.toBe(0)
      const repinned = divergenceEntry(root, 'hooks/lib.mjs')
      expect(repinned.diffHash).toBe(before)
      // allowedDroppedExports is a HUMAN-only field: the sanctioned repair must
      // never invent the very escape hatch that would clear the failure.
      expect(repinned.allowedDroppedExports).toBeUndefined()

      // Run 2: ...and the gate must still be RED, naming the dropped symbol.
      const after = runDogfoodProbe(root, 300_000)
      expect(after.status).not.toBe(0)
      const out = after.stdout + after.stderr
      expect(out).toContain('isPathInThisRepo')
      expect(out).toContain('drops export')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 660_000)

  it('does NOT over-block: an ADDED export in the same file stays approvable', () => {
    const root = createDogfoodProbeRoot()
    const target = join(root, '.claude/hooks/lib.mjs')
    try {
      writeFileSync(
        target,
        readFileSync(target, 'utf-8') +
          '\nexport function syntheticAddedHelper() {\n  return 1\n}\n',
        'utf-8',
      )
      // An added export is a legitimate divergence: the re-pin absorbs it and
      // the gate goes green. If this fails, the rule rejects everything and
      // proves nothing.
      const repin = runDogfoodProbe(root, 300_000, ['--update-divergences'])
      expect(repin.stdout + repin.stderr).not.toContain('drops export')
      const after = runDogfoodProbe(root, 300_000)
      expect(after.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 660_000)
})
