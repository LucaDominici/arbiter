import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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
})
