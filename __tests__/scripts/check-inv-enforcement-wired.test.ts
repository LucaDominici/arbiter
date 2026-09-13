import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-inv-enforcement-wired.mjs')

function run(catalogPath: string, gatePath: string) {
  const r = spawnSync('node', [SCRIPT, `--catalog=${catalogPath}`, `--gate=${gatePath}`], {
    encoding: 'utf-8',
    cwd: resolve('.'),
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'canon09-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-inv-enforcement-wired.mjs (INV-52 / CANON-09)', () => {
  it('exits 0 when all catalog enforcement scripts are wired in gate', () => {
    // #2563: the cited script must be REAL (check-domain-api-surface.mjs exists under
    // scripts/) — the new per-token existence pass resolves against the real repo tree
    // even for temp-fixture catalogs, so a fabricated name here would now (correctly)
    // fail as ENFORCEMENT PATH NOT FOUND instead of exercising the wiring check.
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(
        catalog,
        `{ id: "INV-01", enforcement: "scripts/check-domain-api-surface.mjs" }`,
      )
      writeFileSync(gate, `runCheck("foo", "node", ["scripts/check-domain-api-surface.mjs"])`)
      expect(run(catalog, gate).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an enforcement script is absent from gate', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(catalog, `{ id: "INV-01", enforcement: "scripts/check-missing.mjs" }`)
      writeFileSync(gate, `runCheck("other", "node", ["scripts/check-other.mjs"])`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('check-missing.mjs')
    } finally {
      cleanup()
    }
  })

  it('ignores check-all.mjs self-reference in catalog', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      // catalog references check-all.mjs itself — should not trigger failure
      writeFileSync(catalog, `{ id: "INV-XX", enforcement: "scripts/check-all.mjs" }`)
      writeFileSync(gate, `// gate file with no other scripts`)
      expect(run(catalog, gate).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('reports all missing scripts, not just the first', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(catalog, `{ enforcement: "scripts/check-a.mjs + scripts/check-b.mjs" }`)
      writeFileSync(gate, `// empty gate`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('check-a.mjs')
      expect(result.stdout).toContain('check-b.mjs')
    } finally {
      cleanup()
    }
  })

  // RED tests: prove the CANON-09 blind spot (#1148 Slice A)
  // These MUST fail against the old regex before the fix is applied.

  it('exits 1 when enforcement cites a non-check- script absent from gate [EXPLOIT #1148]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(
        catalog,
        `  id: 'INV-99',\n  enforcement: 'scripts/verify-fake.mjs (L1 fail-closed)',`,
      )
      writeFileSync(gate, `// gate with no scripts`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('verify-fake.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when enforcement cites a digit-containing script absent from gate [EXPLOIT #1148]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(catalog, `  id: 'INV-99',\n  enforcement: 'scripts/check-inv-42.mjs (L1)',`)
      writeFileSync(gate, `// gate with no scripts`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('check-inv-42.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when enforcement cites a .mjs.ejs Track-B template ((?!\\.ejs) lookahead guards)', () => {
    // Use a script name NOT in TRACK_B_EXEMPT so only the lookahead prevents the false positive.
    // Removing (?!\.ejs) from the regex would match check-domain-api-surface.mjs → exit 1.
    // #2563: the cited template must be a REAL file (check-domain-api-surface.mjs.ejs exists
    // under src/templates/scripts/) — the new per-token existence pass added for #2563 resolves
    // against the real repo tree even for temp-fixture catalogs, so a fabricated name here would
    // now (correctly) fail as ENFORCEMENT PATH NOT FOUND instead of exercising the lookahead.
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(
        catalog,
        `  id: 'INV-44',\n  enforcement: 'src/templates/scripts/check-domain-api-surface.mjs.ejs',`,
      )
      writeFileSync(gate, `// gate with no scripts`)
      expect(run(catalog, gate).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  // #1153: hook-style citations — bare `(name.mjs)` with no scripts/ prefix —
  // were invisible to the wiring check. A citation to a nonexistent hook is
  // fiction enforcement and must fail; an existing hook must pass.
  it('exits 1 when a bare hook citation points at a nonexistent script [#1153]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(catalog, `  id: 'INV-77',\n  enforcement: 'hook (check-ghost-xyz.mjs) + CI',`)
      writeFileSync(gate, `// gate with no scripts`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('check-ghost-xyz.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a bare hook citation points at an existing .claude/hooks script [#1153]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      // check-no-orphan-todo.mjs exists under .claude/hooks/ in the repo (cwd).
      writeFileSync(
        catalog,
        `  id: 'INV-06',\n  enforcement: 'hook (check-no-orphan-todo.mjs) + CI',`,
      )
      writeFileSync(gate, `// gate with no scripts`)
      expect(run(catalog, gate).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  // #1664: inverse-citation style — filename OUTSIDE the parens, the parens
  // carrying trigger context (e.g. `Claude hook: check-no-pii.mjs (PostToolUse,
  // Edit|Write)`). This escaped BOTH the wiring (no scripts/ prefix) and the
  // paren-existence (no filename inside parens) passes. RED before the fix: a
  // fictional hook in this style passed GREEN.
  it('exits 1 when a check-* hook is cited name-outside-parens and does not exist [#1664]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(
        catalog,
        `  id: 'INV-12',\n  enforcement: 'Claude hook: check-ghost-nonexistent.mjs (PostToolUse, Edit|Write)',`,
      )
      writeFileSync(gate, `// gate with no scripts`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('check-ghost-nonexistent.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 0 for the real name-outside-parens citation style pointing at an existing hook [#1664]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      // check-no-pii.mjs exists under .claude/hooks/ — the live line-189 style.
      writeFileSync(
        catalog,
        `  id: 'INV-12',\n  enforcement: 'Claude hook: check-no-pii.mjs (PostToolUse, Edit|Write)',`,
      )
      writeFileSync(gate, `// gate with no scripts`)
      expect(run(catalog, gate).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('folds case so an uppercase check-* typo cannot escape the existence pass [#1664]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(catalog, `  id: 'INV-12',\n  enforcement: 'hook Check-Ghost-Upper.mjs (Stop)',`)
      writeFileSync(gate, `// gate with no scripts`)
      const result = run(catalog, gate)
      expect(result.status).toBe(1)
      expect(result.stdout.toLowerCase()).toContain('check-ghost-upper.mjs')
    } finally {
      cleanup()
    }
  })

  it('passes against the real catalog and check-all.mjs', () => {
    const result = run(resolve('src/invariants/catalog.ts'), resolve('scripts/check-all.mjs'))
    expect(result.status).toBe(0)
  })
})

// #2278: TRACK_B_EXEMPT is a CLAIM — "this script is generated for target
// projects". Nothing verified it, so `evidence-collect.mjs` sat exempt while no
// generator emitted it and INV-33 cited it as enforcement: a promise nothing
// kept, invisible BECAUSE it was exempt. An exemption must now be proven by an
// exact emission literal in src/generators/ (`scripts/<name>.ejs` for
// renderTemplate, or the bare `<name>` for name-list loops). A prose mention is
// not proof — that is the same unverified-assertion class this gate exists to kill.
describe('TRACK_B_EXEMPT emission verification (#2278)', () => {
  function runWithGenerators(generatorsDir: string) {
    const r = spawnSync(
      'node',
      [
        SCRIPT,
        `--catalog=${resolve('src/invariants/catalog.ts')}`,
        `--gate=${resolve('scripts/check-all.mjs')}`,
        `--generators=${generatorsDir}`,
      ],
      { encoding: 'utf-8', cwd: resolve('.') },
    )
    return { status: r.status ?? 1, stdout: r.stdout ?? '' }
  }

  it('exits 1 when an exempt script is emitted by no generator [#2278]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Empty generators dir: every exemption is unproven, so each must be named.
      const result = runWithGenerators(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('evidence-collect.mjs')
      expect(result.stdout).toContain('verify-tokens.mjs')
    } finally {
      cleanup()
    }
  })

  it('does not accept an unquoted prose mention as proof of emission [#2278]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeFileSync(
        join(dir, 'prose.ts'),
        '// the github-owned trio (check-workflow-perms.mjs/check-ci-tiers.mjs) is emitted here\n',
      )
      const result = runWithGenerators(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('check-workflow-perms.mjs')
    } finally {
      cleanup()
    }
  })

  it('accepts both emission literal styles: renderTemplate path and bare name [#2278]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeFileSync(
        join(dir, 'emit.ts'),
        `renderTemplate('scripts/verify-tokens.mjs.ejs', data)\n` +
          `for (const name of ['check-workflow-perms.mjs'] as const) emit(name)\n`,
      )
      const result = runWithGenerators(dir)
      expect(result.status).toBe(1)
      // Assert on the whole violation line — a bare filename substring would also be
      // absent if the pass ignored the fixture dir entirely (decorative assert).
      expect(result.stdout).not.toContain('no generator: verify-tokens.mjs')
      expect(result.stdout).not.toContain('no generator: check-workflow-perms.mjs')
      expect(result.stdout).toContain('evidence-collect.mjs')
    } finally {
      cleanup()
    }
  })
})

// #2563: every enforcement string must resolve to a real mechanism — a file-ish token
// (.mjs/.ts/.java/.yml/.yaml) that exists on disk, or an explicit per-ID allowlist entry
// (mechanism + reason) for a genuinely non-file case. A vague string with no file token and
// no allowlist entry is exactly the "35 of 134 name no file" defect the issue reports.
describe('enforcement resolution — every string names a real mechanism (#2563)', () => {
  function runResolve(catalogPath: string, allowlistPath?: string) {
    const args = [SCRIPT, `--catalog=${catalogPath}`, `--gate=${resolve('scripts/check-all.mjs')}`]
    if (allowlistPath) args.push(`--allowlist=${allowlistPath}`)
    const r = spawnSync('node', args, { encoding: 'utf-8', cwd: resolve('.') })
    return { status: r.status ?? 1, stdout: r.stdout ?? '' }
  }

  it('exits 1 when enforcement names no file-ish token and has no allowlist entry [EXPLOIT #2563]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const allowlist = join(dir, 'allowlist.json')
      // Mirrors the issue's own confirmed instance (INV-28): a claim that reads as real
      // ("CI", "pre-merge hook") but names no checkable mechanism at all.
      writeFileSync(
        catalog,
        `  id: 'INV-999',\n  enforcement: 'CI (drift check / pre-merge hook)',`,
      )
      writeFileSync(allowlist, '{}')
      const result = runResolve(catalog, allowlist)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ENFORCEMENT NAMES NO MECHANISM')
      expect(result.stdout).toContain('INV-999')
    } finally {
      cleanup()
    }
  })

  it('does not accept a substring/keyword match in place of a per-ID allowlist entry [EXPLOIT #2563]', () => {
    // An allowlist keyed by keyword ("contains CI") would re-green the exact defect above.
    // The real allowlist is keyed by exact INV id — an entry for a DIFFERENT id must not
    // rescue this one.
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const allowlist = join(dir, 'allowlist.json')
      writeFileSync(
        catalog,
        `  id: 'INV-999',\n  enforcement: 'CI (drift check / pre-merge hook)',`,
      )
      writeFileSync(
        allowlist,
        JSON.stringify({ 'INV-28': { mechanism: 'code review', reason: 'unrelated id' } }),
      )
      const result = runResolve(catalog, allowlist)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('INV-999')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the exact INV id has an allowlist entry with mechanism + reason', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const allowlist = join(dir, 'allowlist.json')
      writeFileSync(catalog, `  id: 'INV-999',\n  enforcement: 'code review / manual',`)
      writeFileSync(
        allowlist,
        JSON.stringify({
          'INV-999': {
            mechanism: 'code review',
            reason: 'process invariant',
            enforcement: 'code review / manual',
          },
        }),
      )
      expect(runResolve(catalog, allowlist).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a cited file-ish token does not exist on disk [EXPLOIT #2563]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      writeFileSync(
        catalog,
        `  id: 'INV-999',\n  enforcement: 'scripts/check-does-not-exist-xyz.mjs',`,
      )
      const result = runResolve(catalog)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ENFORCEMENT PATH NOT FOUND')
      expect(result.stdout).toContain('check-does-not-exist-xyz.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a cited .githooks/<name> token exists (no file extension)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      writeFileSync(catalog, `  id: 'INV-999',\n  enforcement: '.githooks/pre-commit + CI',`)
      expect(runResolve(catalog).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes against the real catalog with the real allowlist (INV-28 honestly resolved, not weakened)', () => {
    const result = runResolve(resolve('src/invariants/catalog.ts'))
    expect(result.status).toBe(0)
  })
})

// Codex diff-review P1 findings on #2563 — each closes one specific exploit against the
// #2563 gate itself, proven failing-then-passing.
describe('Codex P1 hardening (#2563)', () => {
  function runResolve(catalogPath: string, allowlistPath?: string) {
    const args = [SCRIPT, `--catalog=${catalogPath}`, `--gate=${resolve('scripts/check-all.mjs')}`]
    if (allowlistPath) args.push(`--allowlist=${allowlistPath}`)
    const r = spawnSync('node', args, { encoding: 'utf-8', cwd: resolve('.') })
    return { status: r.status ?? 1, stdout: r.stdout ?? '' }
  }

  // P1 #1: an allowlist entry not bound to the exact enforcement text would still pass
  // after the catalog reverted to a previously-flagged false claim — the allowlist review
  // would be reviewing wording that no longer exists.
  it('exits 1 when the catalog enforcement text drifts from the allowlisted text [P1 #1]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const allowlist = join(dir, 'allowlist.json')
      // The catalog was reverted to the exact false claim the issue reports for INV-28.
      writeFileSync(catalog, `  id: 'INV-28',\n  enforcement: 'CI (drift check / pre-merge hook)',`)
      // But the allowlist still carries the entry reviewed against the OLD, honest wording.
      writeFileSync(
        allowlist,
        JSON.stringify({
          'INV-28': {
            mechanism: 'code review (manual) — no automated check exists',
            reason: 'honest gap, reviewed against different wording',
            enforcement: 'code review (manual) — no automated check exists',
          },
        }),
      )
      const result = runResolve(catalog, allowlist)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('STALE ALLOWLIST ENTRY')
      expect(result.stdout).toContain('INV-28')
    } finally {
      cleanup()
    }
  })

  // P1 #2: a fabricated path must not pass by matching a real basename living elsewhere,
  // and a foreign-repo exemption must not rescue a fabricated path either (it must match
  // the exact exempted token, not just end in the exempted basename).
  it('exits 1 for a fabricated path riding on a real basename [P1 #2]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      // check-secret-presence.mjs is real under scripts/ — the fabricated directory must
      // not be accepted via basename fallback.
      writeFileSync(catalog, `  id: 'INV-999',\n  enforcement: 'fake/check-secret-presence.mjs',`)
      const result = runResolve(catalog)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ENFORCEMENT PATH NOT FOUND')
      expect(result.stdout).toContain('fake/check-secret-presence.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 1 for a fabricated path ending in the exact foreign-exempt basename [P1 #2]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      writeFileSync(
        catalog,
        `  id: 'INV-999',\n  enforcement: 'fake/dir/check-arbiter-contract.mjs',`,
      )
      const result = runResolve(catalog)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('fake/dir/check-arbiter-contract.mjs')
    } finally {
      cleanup()
    }
  })

  // P1 #3: valid catalog syntax the original hand-rolled parser missed — double-quoted
  // ids, and an explicitly empty enforcement literal.
  it('resolves a double-quoted id and still flags an unresolvable claim [P1 #3]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const allowlist = join(dir, 'allowlist.json')
      writeFileSync(catalog, `{ id: "INV-999", enforcement: "CI (invented check)" }`)
      writeFileSync(allowlist, '{}')
      const result = runResolve(catalog, allowlist)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('INV-999')
    } finally {
      cleanup()
    }
  })

  it('exits 1 on an explicitly empty enforcement literal [P1 #3]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      writeFileSync(catalog, `  id: 'INV-999',\n  enforcement: '',`)
      const result = runResolve(catalog)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ENFORCEMENT FIELD IS EMPTY')
      expect(result.stdout).toContain('INV-999')
    } finally {
      cleanup()
    }
  })

  // P1 #4: the tokenizer must resolve tokens beyond the original 5 extensions.
  it('exits 1 when a non-mjs/ts/java/yml extension token does not exist [P1 #4]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      writeFileSync(
        catalog,
        `  id: 'INV-999',\n  enforcement: 'scripts/check-domain-api-surface.mjs + docs/missing.json',`,
      )
      const result = runResolve(catalog)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ENFORCEMENT PATH NOT FOUND')
      expect(result.stdout).toContain('docs/missing.json')
    } finally {
      cleanup()
    }
  })
})

// Codex diff-review round 2 on #2563 — 4 remaining bypasses beyond round 1.
describe('Codex round-2 hardening (#2563)', () => {
  function runResolve(catalogPath: string, allowlistPath?: string) {
    const args = [SCRIPT, `--catalog=${catalogPath}`, `--gate=${resolve('scripts/check-all.mjs')}`]
    if (allowlistPath) args.push(`--allowlist=${allowlistPath}`)
    const r = spawnSync('node', args, { encoding: 'utf-8', cwd: resolve('.') })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  // Round 2, #1: a comment between `enforcement:` and its string value defeated the value
  // regex silently, so the whole entry was treated as having no enforcement field at all
  // (a vacuous pass) instead of failing on the parse gap.
  it('fails closed (exit 2) when a comment sits between enforcement: and its value [R2 #1]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      writeFileSync(
        catalog,
        `  id: 'INV-999',\n  enforcement:\n    // a sneaky comment\n    'CI (invented check)',`,
      )
      const result = runResolve(catalog)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('INV-999')
    } finally {
      cleanup()
    }
  })

  // Round 2, #2: a path-traversal token must not resolve outside the repo root.
  it('rejects a path-traversal token that resolves outside the repo root [R2 #2]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      writeFileSync(
        catalog,
        `  id: 'INV-999',\n  enforcement: 'scripts/../../../../../../../../etc/passwd',`,
      )
      const result = runResolve(catalog)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ENFORCEMENT PATH NOT FOUND')
    } finally {
      cleanup()
    }
  })

  // Round 2, #3: an unrecognised extension under a known directory prefix must still be
  // treated as a file claim, not silently waved through as non-file prose.
  it('treats an unknown extension under scripts/ as a file claim and fails when absent [R2 #3]', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const catalog = join(dir, 'catalog.ts')
      const allowlist = join(dir, 'allowlist.json')
      writeFileSync(catalog, `  id: 'INV-999',\n  enforcement: 'scripts/not-a-real-check.py',`)
      // A matching non-file allowlist entry must NOT rescue this — it names no mechanism,
      // it names a specific (nonexistent) file, so the file-existence path must fire, not
      // the no-file-token allowlist path.
      writeFileSync(
        allowlist,
        JSON.stringify({
          'INV-999': {
            mechanism: 'code review',
            reason: 'should not apply',
            enforcement: 'scripts/not-a-real-check.py',
          },
        }),
      )
      const result = runResolve(catalog, allowlist)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ENFORCEMENT PATH NOT FOUND')
      expect(result.stdout).toContain('scripts/not-a-real-check.py')
    } finally {
      cleanup()
    }
  })

  it('passes against the real catalog after round-2 hardening', () => {
    const result = runResolve(resolve('src/invariants/catalog.ts'))
    expect(result.status).toBe(0)
  })
})
