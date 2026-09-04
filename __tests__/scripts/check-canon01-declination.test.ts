import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-canon01-declination.mjs')

interface Fixture {
  dir: string
  cleanup: () => void
}

/** Minimal synthetic repo: one hook mechanism, one script mechanism, empty ledgers. */
function makeRoot(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'canon01-test-'))
  for (const d of [
    'scripts',
    '.claude/hooks',
    'src/templates/claude/hooks',
    'src/templates/scripts',
  ])
    mkdirSync(join(dir, d), { recursive: true })
  write(dir, '.dogfood-divergences.json', '[]')
  write(dir, 'scripts/canon01-self-only.json', JSON.stringify({ selfOnly: [] }))
  write(dir, 'scripts/canon01-baseline.json', JSON.stringify({ divergences: 0, selfOnly: 0 }))
  write(dir, '.claude/settings.json', JSON.stringify({ hooks: {} }))
  write(dir, 'scripts/check-all.mjs', '// no mechanisms\n')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function write(root: string, rel: string, body: string): void {
  const target = join(root, rel)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, body)
}

/** Declare a check-all mechanism at `scripts/<name>` plus the backing file. */
function withGateMechanism(root: string, name: string): void {
  write(root, `scripts/${name}`, '// mechanism\n')
  write(root, 'scripts/check-all.mjs', `runCheck('some check', 'node', ['scripts/${name}'])\n`)
}

/** Declare a settings.json hook mechanism plus the backing file. */
function withHookMechanism(root: string, name: string): void {
  write(root, `.claude/hooks/${name}`, '// hook\n')
  write(
    root,
    '.claude/settings.json',
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: `node .claude/hooks/${name}` }] },
        ],
      },
    }),
  )
}

function run(root: string, extraArgs: string[] = []) {
  const r = spawnSync('node', [SCRIPT, `--root=${root}`, '--now=2026-08-15', ...extraArgs], {
    encoding: 'utf-8',
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-canon01-declination.mjs (#1922 — CANON-01 dual-sided declination)', () => {
  it('[RED] exits 1 and names a self mechanism mapped to nothing', () => {
    const { dir, cleanup } = makeRoot()
    try {
      withGateMechanism(dir, 'check-orphan-mechanism.mjs')
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('check-orphan-mechanism.mjs')
      expect(r.stdout).toContain('UNMAPPED')
    } finally {
      cleanup()
    }
  })

  it('[RED] exits 1 and names a registered hook with no template twin', () => {
    const { dir, cleanup } = makeRoot()
    try {
      withHookMechanism(dir, 'orphan-hook.mjs')
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('orphan-hook.mjs')
      expect(r.stdout).toContain('UNMAPPED')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the mechanism has a template emission twin', () => {
    const { dir, cleanup } = makeRoot()
    try {
      withGateMechanism(dir, 'check-emitted.mjs')
      write(dir, 'src/templates/scripts/check-emitted.mjs.ejs', '// template\n')
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a hook has a twin under src/templates/claude/hooks/', () => {
    const { dir, cleanup } = makeRoot()
    try {
      withHookMechanism(dir, 'emitted-hook.mjs')
      write(dir, 'src/templates/claude/hooks/emitted-hook.mjs.ejs', '// template\n')
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the mechanism carries a motivated self-only entry', () => {
    const { dir, cleanup } = makeRoot()
    try {
      withGateMechanism(dir, 'check-self-thing.mjs')
      write(
        dir,
        'scripts/canon01-self-only.json',
        JSON.stringify({
          selfOnly: [
            { path: 'scripts/check-self-thing.mjs', reason: 'audits the generator corpus' },
          ],
        }),
      )
      write(dir, 'scripts/canon01-baseline.json', JSON.stringify({ divergences: 0, selfOnly: 1 }))
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('[RED] exits 1 on a self-only entry with no reason (fail-closed)', () => {
    const { dir, cleanup } = makeRoot()
    try {
      withGateMechanism(dir, 'check-self-thing.mjs')
      write(
        dir,
        'scripts/canon01-self-only.json',
        JSON.stringify({ selfOnly: [{ path: 'scripts/check-self-thing.mjs' }] }),
      )
      write(dir, 'scripts/canon01-baseline.json', JSON.stringify({ divergences: 0, selfOnly: 1 }))
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('reason')
    } finally {
      cleanup()
    }
  })

  it('[RED] exits 1 on a self-only entry whose expires date has passed', () => {
    const { dir, cleanup } = makeRoot()
    try {
      withGateMechanism(dir, 'check-staged.mjs')
      write(
        dir,
        'scripts/canon01-self-only.json',
        JSON.stringify({
          selfOnly: [
            { path: 'scripts/check-staged.mjs', reason: 'pending audit', expires: '2026-01-01' },
          ],
        }),
      )
      write(dir, 'scripts/canon01-baseline.json', JSON.stringify({ divergences: 0, selfOnly: 1 }))
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('EXPIRED')
    } finally {
      cleanup()
    }
  })

  it('[RED] exits 1 when the divergence count grows beyond the baseline', () => {
    const { dir, cleanup } = makeRoot()
    try {
      write(dir, '.dogfood-divergences.json', JSON.stringify([{ path: 'a.md', reason: 'x' }]))
      write(dir, 'scripts/canon01-baseline.json', JSON.stringify({ divergences: 0, selfOnly: 0 }))
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('RATCHET')
      expect(r.stdout).toContain('divergences')
    } finally {
      cleanup()
    }
  })

  it('[RED] exits 1 when the self-only allowlist grows beyond the baseline', () => {
    const { dir, cleanup } = makeRoot()
    try {
      withGateMechanism(dir, 'check-self-thing.mjs')
      write(
        dir,
        'scripts/canon01-self-only.json',
        JSON.stringify({
          selfOnly: [{ path: 'scripts/check-self-thing.mjs', reason: 'audits the corpus' }],
        }),
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('RATCHET')
      expect(r.stdout).toContain('selfOnly')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a count is BELOW the baseline (monotone decrease is always allowed)', () => {
    const { dir, cleanup } = makeRoot()
    try {
      write(dir, 'scripts/canon01-baseline.json', JSON.stringify({ divergences: 5, selfOnly: 3 }))
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('--update-baseline lowers a stale baseline and refuses to raise it', () => {
    const { dir, cleanup } = makeRoot()
    try {
      write(dir, 'scripts/canon01-baseline.json', JSON.stringify({ divergences: 5, selfOnly: 3 }))
      expect(run(dir, ['--update-baseline']).status).toBe(0)
      // Lowered to the observed 0/0 — a subsequent growth can no longer be absorbed.
      write(dir, '.dogfood-divergences.json', JSON.stringify([{ path: 'a.md', reason: 'x' }]))
      const refused = run(dir, ['--update-baseline'])
      expect(refused.status).toBe(1)
      expect(refused.stdout).toContain('refus')
    } finally {
      cleanup()
    }
  })

  it('exits 2 when a required input is missing (invocation error, not a pass)', () => {
    const { dir, cleanup } = makeRoot()
    try {
      rmSync(join(dir, 'scripts/canon01-self-only.json'))
      const r = run(dir)
      expect(r.status).toBe(2)
    } finally {
      cleanup()
    }
  })

  it('exits 1 on a dead self-only entry that no live mechanism resolves to', () => {
    const { dir, cleanup } = makeRoot()
    try {
      write(
        dir,
        'scripts/canon01-self-only.json',
        JSON.stringify({ selfOnly: [{ path: 'scripts/check-gone.mjs', reason: 'used to exist' }] }),
      )
      write(dir, 'scripts/canon01-baseline.json', JSON.stringify({ divergences: 0, selfOnly: 1 }))
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('DEAD')
    } finally {
      cleanup()
    }
  })

  it('classifies external tool invocations without demanding a template twin', () => {
    const { dir, cleanup } = makeRoot()
    try {
      write(dir, 'scripts/check-all.mjs', "runCheck('lint', 'npx', ['eslint', 'src'])\n")
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('external-tool')
    } finally {
      cleanup()
    }
  })
  // #2405 — the twelve STAGED entries carried a generic reason text that cited a closed
  // issue scoped to a DIFFERENT registry. Re-dating them is the failure mode this issue
  // exists to end, so the contract is pinned here, against the COMMITTED registry:
  // a self-only entry is permanent-by-construction or it does not exist.
  describe('committed self-only registry contract (#2405)', () => {
    const REGISTRY = JSON.parse(
      readFileSync(resolve('scripts/canon01-self-only.json'), 'utf-8'),
    ) as { selfOnly: Array<{ path: string; reason: string; expires?: string }> }

    it('carries no STAGED (expires-dated) entry — audit-later is not a resolution', () => {
      const staged = REGISTRY.selfOnly.filter((e) => e.expires != null).map((e) => e.path)
      expect(staged).toEqual([])
    })

    it('carries no reason that defers, or cites the audit issue as still pending', () => {
      const deferring = REGISTRY.selfOnly.filter((e) =>
        /STILL PENDING|Audit under #|plausibly should also receive|issues\/2405/i.test(e.reason),
      ).map((e) => e.path)
      expect(deferring).toEqual([])
    })

    // The twelve entries #2405 audited. A resolved entry must CITE evidence, not assert a
    // verdict: the twelve pre-resolution reasons ran 272-464 chars and two named no artifact
    // at all, so the bar is length AND >=2 distinct concrete artifact references.
    const AUDITED_2405 = [
      'scripts/check-acceptance.mjs',
      'scripts/check-doc-path-citations.mjs',
      'scripts/check-doc-style.mjs',
      'scripts/check-evidence-bundle.mjs',
      'scripts/check-hook-doc-parity.mjs',
      'scripts/check-monthly-freshness.mjs',
      'scripts/check-nightly-freshness.mjs',
      'scripts/check-node-version-ssot.mjs',
      'scripts/check-npm-ci-drift.mjs',
      'scripts/check-reuse-survey.mjs',
      'scripts/check-workflow-hardening.mjs',
      'scripts/check-workflow-parallelism.mjs',
    ]
    const audited = () => REGISTRY.selfOnly.filter((e) => AUDITED_2405.includes(e.path))

    it('gives every audited entry a rationale that cites concrete artifacts', () => {
      const ARTIFACT = /[\w./-]+\.(?:ejs|mjs|yml|json|ts)\b/g
      const thin = audited()
        .filter((e) => e.reason.length < 600 || new Set(e.reason.match(ARTIFACT) ?? []).size < 2)
        .map((e) => e.path)
      expect(thin).toEqual([])
    })

    // A rationale that reads identically for two different checks is not a rationale, so the
    // contract is sentence-level, not whole-string: no substantial sentence (>=60 chars) may
    // be shared by two of the audited entries. Pre-#2405 all twelve shared the boilerplate
    // "Tracked by https://github.com/LucaDominici/arbiter/issues/2405." sentence. Scoped to
    // the audited set: the older permanent FAMILIES (the governance-doc gates, the published-
    // CLI-artifact gates) deliberately share one by-construction clause, and re-litigating
    // those is outside this issue.
    it('gives no two audited entries the same rationale sentence', () => {
      const bySentence = new Map<string, string[]>()
      for (const e of audited()) {
        for (const raw of e.reason.split(/(?<=\.)\s+/)) {
          const sentence = raw.trim()
          if (sentence.length < 60) continue
          bySentence.set(sentence, [...(bySentence.get(sentence) ?? []), e.path])
        }
      }
      const shared = [...bySentence.entries()].filter(([, paths]) => paths.length > 1)
      expect(shared.map(([sentence, paths]) => `${paths.join(' + ')}: ${sentence}`)).toEqual([])
    })

    it('no longer claims check-acceptance.mjs is self-only — it is emitted (ADR-110)', () => {
      expect(REGISTRY.selfOnly.map((e) => e.path)).not.toContain('scripts/check-acceptance.mjs')
    })

    it('pins the ratchet baseline to the registry it measures, and it fell', () => {
      const baseline = JSON.parse(
        readFileSync(resolve('scripts/canon01-baseline.json'), 'utf-8'),
      ) as { selfOnly: number }
      expect(baseline.selfOnly).toBe(REGISTRY.selfOnly.length)
      expect(baseline.selfOnly).toBeLessThan(85)
    })
  })

  // #2404 — every case above builds a SYNTHETIC repo, so none of them ever reads the
  // committed registry. A `expires` date that rolls past is therefore invisible to the
  // whole suite until the gate turns red in CI. This case runs the real gate against the
  // real `scripts/canon01-self-only.json` at the roll date that broke it.
  it('accepts the committed self-only registry at the 2026-08-30 roll date (#2404)', () => {
    const r = spawnSync('node', [SCRIPT, '--now=2026-08-30'], {
      cwd: resolve('.'),
      encoding: 'utf-8',
    })
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/EXPIRED/i)
    expect(r.status).toBe(0)
  })
})
