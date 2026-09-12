// SPDX-License-Identifier: Apache-2.0
// #2660: the published package ships only what a consumer can reach, and its size is a
// warning, not a gate. Measured on main 763437a1: 32 of 37 `scripts/lib` modules (≈276 KB) were
// arbiter's own gate helpers with no import path from anything shipped, and 280 of 299 `.d.ts`
// files (≈362 KB) were unreachable from the four `exports` entry points — yet a byte budget
// three times re-baselined by hand was red on a 1 KB change to a shipped helper.
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, resolve } from 'node:path'
import { classifyPackSize } from '../../scripts/check-pack-size.mjs'

const root = resolve(__dirname, '../..')
let shipped: string[] = []

beforeAll(() => {
  // --ignore-scripts: prepack would `rm -rf dist` and rebuild under every other test spawning
  // dist/cli.js in the same vitest run; the file roster does not depend on the lifecycle scripts.
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf-8',
  })
  shipped = (JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>)[0].files
    .map((f) => f.path)
    .sort()
}, 120_000)

// Transitive relative `.mjs` imports (static and dynamic) starting from the given files.
function importClosure(seeds: string[]): Set<string> {
  const re = /(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+\.mjs)['"]/g
  const seen = new Set<string>()
  const queue = [...seeds]
  while (queue.length > 0) {
    const file = queue.shift() as string
    if (seen.has(file) || !existsSync(join(root, file))) continue
    seen.add(file)
    const src = readFileSync(join(root, file), 'utf-8')
    for (const m of src.matchAll(re))
      queue.push(posix.normalize(posix.join(posix.dirname(file), m[1])))
  }
  return seen
}

describe('published package surface (#2660)', () => {
  it('ships exactly the scripts/lib modules reachable from the shipped scripts — no arbiter-only gate helpers', () => {
    const shippedScripts = shipped.filter((p) => /^scripts\/[^/]+\.mjs$/.test(p))
    expect(shippedScripts.length).toBeGreaterThan(0)
    const needed = [...importClosure(shippedScripts)]
      .filter((p) => p.startsWith('scripts/lib/'))
      .sort()
    const shippedLib = shipped.filter((p) => p.startsWith('scripts/lib/')).sort()
    expect(shippedLib).toEqual(needed)
  })

  it('dist never imports scripts/lib at runtime (the shipped helpers exist only for the shipped scripts)', () => {
    // grep exits 1 when nothing matches — that is the passing case, not a failure.
    const r = spawnSync(
      'grep',
      ['-rlE', String.raw`(from|import)\s*\(?\s*['"][^'"]*scripts/lib/`, 'dist', '--include=*.js'],
      { cwd: root, encoding: 'utf-8' },
    )
    expect([0, 1]).toContain(r.status)
    const offenders = (r.stdout ?? '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.includes('/generators/')) // generators name the CONSUMER's scripts/lib as emission targets
    expect(offenders).toEqual([])
  })

  it('ships exactly the .d.ts closure of the exports entry points, as tsc resolves it', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
      exports: Record<string, { import: string }>
    }
    const probeDir = mkdtempSync(join(tmpdir(), 'arbiter-dts-probe-'))
    try {
      const entries = Object.values(pkg.exports).map((e) => resolve(root, e.import))
      writeFileSync(
        join(probeDir, 'probe.ts'),
        entries.map((p, i) => `import * as m${i} from '${p}'`).join('\n') +
          `\nexport const all = [${entries.map((_, i) => `m${i}`).join(', ')}]\n`,
      )
      const out = execFileSync(
        'npx',
        [
          'tsc',
          '--ignoreConfig',
          '--noEmit',
          '--listFiles',
          '--module',
          'nodenext',
          '--moduleResolution',
          'nodenext',
          '--target',
          'es2022',
          '--types',
          'node',
          '--skipLibCheck',
          join(probeDir, 'probe.ts'),
        ],
        { cwd: root, encoding: 'utf-8' },
      )
      const closure = out
        .split('\n')
        .filter((l) => l.startsWith(root + '/dist/') && l.endsWith('.d.ts'))
        .map((l) => l.slice(root.length + 1))
        .sort()
      expect(closure.length).toBeGreaterThan(0)
      expect(shipped.filter((p) => p.endsWith('.d.ts'))).toEqual(closure)
    } finally {
      rmSync(probeDir, { recursive: true, force: true })
    }
  })

  it('pack size is a warning, never an exit code (owner decision, #2660)', () => {
    for (const size of [1, 4_999_999, 5_000_001, 5_242_881, 50_000_000]) {
      expect(classifyPackSize(size).exitCode, `size ${size}`).toBe(0)
    }
    expect(classifyPackSize(50_000_000).level).toBe('warn')
    expect(classifyPackSize(1).level).toBe('ok')
  })
})
