// SPDX-License-Identifier: Apache-2.0
// #1090: the raw .mjs hook corpus must be checked by the dogfood gate. These
// hooks are emitted verbatim by src/generators/claude.ts (no EJS render), so the
// .ejs-only corpus walk historically never saw them. checkRawHooks closes that
// gap: undocumented drift fails the gate (fail-closed, INV-45), intentional
// self-hardening is skipped via .dogfood-divergences.json.
import { describe, it, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

// Import the gate module (path resolved via file URL so a '#' in the worktree
// path does not break the dynamic import).
const modUrl = new URL('../../scripts/check-self-dogfood.mjs', import.meta.url).href

describe('check-self-dogfood raw .mjs hook corpus (#1090)', () => {
  it('REQUIRED_RAW_HOOKS lists the 8 hooks emitted verbatim by claude.ts', async () => {
    const mod = await import(modUrl)
    expect(mod.REQUIRED_RAW_HOOKS).toContain('stop-dangerous.mjs')
    expect(mod.REQUIRED_RAW_HOOKS).toContain('enforce-read-only.mjs')
    expect(mod.REQUIRED_RAW_HOOKS).not.toContain('check-no-orphan-todo.mjs')
    expect(mod.REQUIRED_RAW_HOOKS).not.toContain('check-no-placeholders.mjs')
    expect(mod.REQUIRED_RAW_HOOKS).toContain('post-brainstorm-stop.mjs')
    expect(mod.REQUIRED_RAW_HOOKS).toContain('pre-spawn-worktree-guard.mjs')
    expect(mod.REQUIRED_RAW_HOOKS.length).toBe(8)
  })

  it('passes against the real repo (every raw hook matches or is allowlisted)', async () => {
    const mod = await import(modUrl)
    const { drifted } = await mod.checkRawHooks(repoRoot)
    expect(drifted).toEqual([])
  })

  it('counts every required hook as either checked or skipped (none silently dropped)', async () => {
    const mod = await import(modUrl)
    const { checked, skipped, drifted } = await mod.checkRawHooks(repoRoot)
    expect(checked + skipped + drifted.length).toBe(mod.REQUIRED_RAW_HOOKS.length)
  })

  it('FAILS CLOSED on undocumented drift in a shipped raw hook', async () => {
    const mod = await import(modUrl)
    // Build a throwaway repo mirror: copy the real templates + .claude hooks,
    // then mutate ONE materialized hook that is NOT allowlisted (stop-dangerous)
    // so its content no longer matches the shipped template. With an empty
    // divergence set, checkRawHooks must report it as drift.
    const tmp = mkdtempSync(join(tmpdir(), 'rawhooks-'))
    mkdirSync(join(tmp, 'src/templates/claude/hooks'), { recursive: true })
    mkdirSync(join(tmp, '.claude/hooks'), { recursive: true })
    cpSync(join(repoRoot, 'src/templates/claude/hooks'), join(tmp, 'src/templates/claude/hooks'), {
      recursive: true,
    })
    cpSync(join(repoRoot, '.claude/hooks'), join(tmp, '.claude/hooks'), { recursive: true })
    writeFileSync(
      join(tmp, '.claude/hooks/stop-dangerous.mjs'),
      '// drifted: this line is not in the shipped template\nprocess.exit(0)\n',
    )
    // Empty divergence registry (CANON-14 #1838: Map<absPath, entry>, was Set)
    const { drifted } = await mod.checkRawHooks(tmp, new Map())
    expect(drifted.some((d) => d.name === 'stop-dangerous.mjs')).toBe(true)
  })
})

// ─── #2327: the export-surface rule is wired into the raw-hook corpus too ────
// The only currently-allowlisted raw hook (enforce-read-only.mjs) exports
// nothing, so the real tree cannot exercise this path. These build a throwaway
// root with a hand-built divergence Map — checkRawHooks accepts one — and prove
// the wiring fires, and that it discriminates rather than rejecting everything.

describe('raw-hook corpus honours the export-surface rule (#2327)', () => {
  function rawHookRoot(templateBody: string, materializedBody: string) {
    const root = mkdtempSync(join(tmpdir(), 'rawhooks-exports-'))
    mkdirSync(join(root, 'src/templates/claude/hooks'), { recursive: true })
    mkdirSync(join(root, '.claude/hooks'), { recursive: true })
    writeFileSync(join(root, 'src/templates/claude/hooks/stop-dangerous.mjs'), templateBody)
    writeFileSync(join(root, '.claude/hooks/stop-dangerous.mjs'), materializedBody)
    const divergences = new Map([
      [
        join(root, '.claude/hooks/stop-dangerous.mjs'),
        { path: 'hooks/stop-dangerous.mjs', reason: 'probe', diffHash: 'not-the-real-hash' },
      ],
    ])
    return { root, divergences }
  }

  it('flags a materialized raw hook that drops a template export', async () => {
    const mod = await import(modUrl)
    const { root, divergences } = rawHookRoot(
      'export function helper() {}\nprocess.exit(0)\n',
      'function helper() {}\nprocess.exit(0)\n',
    )
    const { drifted, exportDrops } = await mod.checkRawHooks(root, divergences)
    const hit = drifted.find((d: { name: string }) => d.name === 'stop-dangerous.mjs')
    expect(hit?.reason).toContain('drops export')
    expect(hit?.reason).toContain('helper')
    expect([...exportDrops]).toEqual([join(root, '.claude/hooks/stop-dangerous.mjs')])
  })

  it('does NOT flag an ADDED export — that stays an ordinary pinned-diff decision', async () => {
    const mod = await import(modUrl)
    const { root, divergences } = rawHookRoot(
      'export function helper() {}\nprocess.exit(0)\n',
      'export function helper() {}\nexport function extra() {}\nprocess.exit(0)\n',
    )
    const { drifted, exportDrops } = await mod.checkRawHooks(root, divergences)
    const hit = drifted.find((d: { name: string }) => d.name === 'stop-dangerous.mjs')
    // Still red — the pinned hash is deliberately wrong — but for the HASH
    // reason, which --update-divergences can legitimately clear.
    expect(hit?.reason).toContain('CHANGED beyond the approved pin')
    expect(hit?.reason).not.toContain('drops export')
    expect([...exportDrops]).toEqual([])
  })

  it('does NOT flag a non-.mjs pair (rule is scoped to ES modules)', async () => {
    const mod = await import(modUrl)
    expect(
      mod.exportSurfaceViolation(
        {},
        '/x/.claude/rules/90-exec-protocol.md',
        'export function gone() {}\n',
        '\n',
      ),
    ).toBeNull()
  })
})
