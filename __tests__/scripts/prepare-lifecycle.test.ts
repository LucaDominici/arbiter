// SPDX-License-Identifier: Apache-2.0
// #9001: `npm install github:LucaDominici/arbiter#<ref>` (a git dependency) runs
// npm's `prepare` lifecycle script but never `prepack` — only `prepack` used to
// build. A git-ref install therefore produced a package with no dist/, and
// `bin: dist/cli.js` was broken. Fixed by having `prepare` additionally run
// scripts/prepare-lifecycle.mjs, which builds when dist is missing and either
// (a) running from inside a `node_modules` directory, or (b) running from
// inside npm's own cache dir (`npm_config_cache`) — measured empirically
// (npm 11.16.0): a git dependency's `prepare` runs with cwd inside npm's cache
// clone, BEFORE the build output gets packed into the consumer's
// node_modules via the `files` allowlist. Never builds for a plain
// contributor `npm install`/`npm ci` in this repo, where CI already builds
// explicitly and unconditionally building here would double that cost for
// jobs that don't need dist at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT_SRC = readFileSync(resolve(ROOT, 'scripts', 'prepare-lifecycle.mjs'), 'utf-8')

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'arbiter-prepare-lifecycle-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

/** Copies prepare-lifecycle.mjs under `packageRoot/scripts/` and a stub `npm` onto PATH
 * that just logs its argv instead of actually building, then runs the script with
 * cwd = packageRoot and a deterministic, unrelated `npm_config_cache`. Returns the
 * stub's call log (empty string if never invoked). */
function runPrepareLifecycle(packageRoot: string, npmConfigCache?: string): string {
  mkdirSync(resolve(packageRoot, 'scripts'), { recursive: true })
  writeFileSync(resolve(packageRoot, 'scripts', 'prepare-lifecycle.mjs'), SCRIPT_SRC)

  const binDir = resolve(workDir, '.bin')
  mkdirSync(binDir, { recursive: true })
  const logPath = resolve(workDir, 'npm-calls.log')
  const stubNpm = resolve(binDir, 'npm')
  writeFileSync(stubNpm, `#!/bin/sh\necho "$@" >> "${logPath}"\nexit 0\n`)
  chmodSync(stubNpm, 0o755)

  execFileSync('node', [resolve(packageRoot, 'scripts', 'prepare-lifecycle.mjs')], {
    cwd: packageRoot,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      npm_config_cache: npmConfigCache ?? resolve(workDir, 'unrelated-npm-cache'),
    },
  })

  try {
    return readFileSync(logPath, 'utf-8')
  } catch {
    return ''
  }
}

describe('scripts/prepare-lifecycle.mjs (#9001)', () => {
  it('package.json prepare runs the lifecycle script in addition to hooksPath', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.prepare).toContain('core.hooksPath')
    expect(pkg.scripts.prepare).toContain('node scripts/prepare-lifecycle.mjs')
  })

  it('builds when installed as a git dependency (nested under node_modules, no dist)', () => {
    const packageRoot = resolve(workDir, 'consumer', 'node_modules', '@arbiter', 'cli')
    mkdirSync(packageRoot, { recursive: true })

    const log = runPrepareLifecycle(packageRoot)

    expect(log.trim()).toBe('run build')
  })

  it('does NOT build for a plain contributor install (not under node_modules)', () => {
    const packageRoot = resolve(workDir, 'arbiter-repo-checkout')
    mkdirSync(packageRoot, { recursive: true })

    const log = runPrepareLifecycle(packageRoot)

    expect(log).toBe('')
  })

  it('does NOT rebuild when dist/cli.js already exists', () => {
    const packageRoot = resolve(workDir, 'consumer', 'node_modules', '@arbiter', 'cli')
    mkdirSync(resolve(packageRoot, 'dist'), { recursive: true })
    writeFileSync(resolve(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n')

    const log = runPrepareLifecycle(packageRoot)

    expect(log).toBe('')
  })

  it("builds when running inside npm's cache dir (git dependency clone, no dist)", () => {
    const npmCache = resolve(workDir, 'npm-cache')
    const packageRoot = resolve(npmCache, '_cacache', 'tmp', 'git-cloneXXXXXX')
    mkdirSync(packageRoot, { recursive: true })

    const log = runPrepareLifecycle(packageRoot, npmCache)

    expect(log.trim()).toBe('run build')
  })

  it('the full package.json "prepare" command survives a non-git cwd (#2351)', () => {
    // Real npm 11 behaviour observed on a self-hosted CI runner: prepare's cwd
    // is npm's internal git-clone tmp dir, and `git config` there can fail with
    // "fatal: not in a git directory" (exit 128) depending on the npm/git
    // version pairing. With `&&`, that failure aborted the ENTIRE prepare step
    // before prepare-lifecycle.mjs ever ran — silently shipping a git-dependency
    // consumer a package with no dist/. The git-config half only matters for a
    // real contributor checkout of this repo; it must never be able to block a
    // consumer's install.
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>
    }
    mkdirSync(resolve(workDir, 'scripts'), { recursive: true })
    writeFileSync(resolve(workDir, 'scripts', 'prepare-lifecycle.mjs'), SCRIPT_SRC)
    const notAGitDir = mkdtempSync(join(tmpdir(), 'arbiter-not-a-git-dir-'))
    writeFileSync(join(notAGitDir, 'package.json'), '{}')
    execFileSync(
      'cp',
      ['-r', resolve(workDir, 'scripts'), resolve(notAGitDir, 'scripts')],
      {},
    )

    const result = spawnSync('sh', ['-c', pkg.scripts.prepare], {
      cwd: notAGitDir,
      encoding: 'utf-8',
      env: { ...process.env, npm_config_cache: resolve(workDir, 'unrelated-npm-cache') },
    })

    expect(result.status, result.stderr).toBe(0)
    rmSync(notAGitDir, { recursive: true, force: true })
  })
})
