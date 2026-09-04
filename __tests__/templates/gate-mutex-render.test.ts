// SPDX-License-Identifier: Apache-2.0
/**
 * CANON-04/CANON-07 — `scripts/lib/gate-mutex.mjs.ejs` renders, and the EMITTED
 * script is executed here rather than merely inspected.
 *
 * #2427 ships the per-repo gate mutex into every governed project: the emitted
 * `.githooks/pre-push` launches the gate through it and the emitted
 * `scripts/check-all.mjs` re-execs itself under it. A consumer whose copy does
 * not run would silently lose the serialisation AND the foreground teardown, so
 * these tests exercise the rendered file end to end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { deriveGateKey, gateLockPath } from '../../src/commands/gate-exec.js'
import { makeConfig } from '../helpers.js'

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeRepo(): string {
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2427-tpl-'))))
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
  return dir
}

describe('#2427 — the emitted gate mutex renders and runs', () => {
  let libDir: string
  let emitted: string

  beforeAll(() => {
    libDir = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2427-lib-'))))
    const scriptsLib = join(libDir, 'scripts', 'lib')
    mkdirSync(scriptsLib, { recursive: true })
    const cfg = makeConfig(libDir, { language: 'typescript' })
    for (const name of ['gate-mutex.mjs', 'run-helpers.mjs']) {
      writeFileSync(join(scriptsLib, name), renderTemplate(`scripts/lib/${name}.ejs`, cfg))
    }
    emitted = join(scriptsLib, 'gate-mutex.mjs')
  })

  it('the emitted mutex derives the same lock path the engine does', () => {
    const repo = makeRepo()
    const r = spawnSync('node', [emitted, 'path', '--dir', repo], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(gateLockPath(deriveGateKey(repo)))
  })

  it('the emitted mutex runs the gate and forwards its exit code verbatim', () => {
    const repo = makeRepo()
    const xdg = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2427-xdg-'))))
    const env = { ...process.env, XDG_RUNTIME_DIR: xdg, ARBITER_GATE_MUTEX_HELD: '' }
    const ran = join(repo, 'ran')
    const ok = spawnSync(
      'node',
      [
        emitted,
        'run',
        '--dir',
        repo,
        '--',
        'node',
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(ran)}, 'x')`,
      ],
      { env, encoding: 'utf-8', timeout: 30_000 },
    )
    expect(ok.status).toBe(0)
    expect(existsSync(ran)).toBe(true)

    const red = spawnSync(
      'node',
      [emitted, 'run', '--dir', repo, '--', 'node', '-e', 'process.exit(1)'],
      {
        env,
        encoding: 'utf-8',
        timeout: 30_000,
      },
    )
    expect(red.status).toBe(1)
  }, 60_000)

  it('the emitted mutex refuses an empty command instead of locking nothing', () => {
    const repo = makeRepo()
    const r = spawnSync('node', [emitted, 'run', '--dir', repo, '--'], {
      encoding: 'utf-8',
      timeout: 30_000,
    })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/nothing to run/i)
  })
})
