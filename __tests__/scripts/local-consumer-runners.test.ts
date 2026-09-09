import { afterEach, describe, expect, it } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const RUNNERS = [
  ['scripts/check-arc42-slots.mjs.ejs', 'doc-set --arc42'],
  ['scripts/check-doc-set.mjs.ejs', 'doc-set'],
  ['scripts/check-doc-freshness.mjs.ejs', 'doc-set --freshness'],
  ['scripts/gold-audit.mjs.ejs', 'gold-audit'],
] as const
const created: string[] = []

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture(template: (typeof RUNNERS)[number][0], source = 'process.exit(0)') {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-local-runner-'))
  created.push(dir)
  mkdirSync(join(dir, 'scripts/lib'), { recursive: true })
  mkdirSync(join(dir, 'node_modules/@arbiter/cli/dist'), { recursive: true })
  writeFileSync(join(dir, 'scripts/runner.mjs'), renderTemplate(template, makeConfig(dir)))
  writeFileSync(
    join(dir, 'scripts/lib/run-helpers.mjs'),
    renderTemplate('scripts/lib/run-helpers.mjs.ejs', makeConfig(dir)),
  )
  writeFileSync(join(dir, 'node_modules/@arbiter/cli/dist/cli.js'), source)
  return dir
}

function run(dir: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [join(dir, 'scripts/runner.mjs'), '--json'], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  })
}

describe('consumer-local Arbiter runners (#2578)', () => {
  it.each(RUNNERS)('uses the installed CLI and forwards arguments: %s', (template, command) => {
    const result = run(
      fixture(template, "process.stdout.write(process.argv.slice(2).join(' ')); process.exit(0)"),
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`${command} --json`)
  })

  it.each(RUNNERS)('returns ERROR 2 when the local CLI is missing: %s', (template) => {
    const dir = fixture(template)
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
    const result = run(dir)
    expect(result.status).toBe(2)
    expect(existsSync(join(dir, 'node_modules/@arbiter/cli/dist/cli.js'))).toBe(false)
  })

  it.each(RUNNERS)(
    'does not fall back to ambient arbiter or npx when local CLI is missing: %s',
    (template) => {
      const dir = fixture(template)
      const bin = join(dir, 'ambient-bin')
      const touched = join(dir, 'ambient-invoked')
      mkdirSync(bin)
      for (const command of ['arbiter', 'npx']) {
        const sentinel = join(bin, command)
        writeFileSync(sentinel, `#!/bin/sh\n: > ${JSON.stringify(touched)}\nexit 0\n`)
        chmodSync(sentinel, 0o755)
      }
      rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
      const result = run(dir, { PATH: bin })
      expect(result.status).toBe(2)
      expect(existsSync(touched)).toBe(false)
    },
  )

  it.each(RUNNERS)('preserves policy 1 and child ERROR 2: %s', (template) => {
    expect(run(fixture(template, 'process.exit(1)')).status).toBe(1)
    expect(run(fixture(template, 'process.exit(2)')).status).toBe(2)
  })

  it.each(RUNNERS)('returns ERROR 2 for a directory or dangling local CLI: %s', (template) => {
    for (const kind of ['directory', 'dangling'] as const) {
      const dir = fixture(template)
      const cli = join(dir, 'node_modules/@arbiter/cli/dist/cli.js')
      rmSync(cli)
      if (kind === 'directory') mkdirSync(cli)
      else symlinkSync(join(dir, 'does-not-exist'), cli)
      expect(run(dir).status, `${kind} local CLI`).toBe(2)
    }
  })

  it.each(RUNNERS)(
    'returns ERROR 2 for an unreadable local CLI when permissions apply: %s',
    (template) => {
      // Root bypasses mode bits, so this portable subprocess assertion has no claim there.
      if (process.getuid?.() === 0) return
      const dir = fixture(template)
      const cli = join(dir, 'node_modules/@arbiter/cli/dist/cli.js')
      chmodSync(cli, 0o000)
      try {
        expect(run(dir).status).toBe(2)
      } finally {
        chmodSync(cli, 0o644)
      }
    },
  )

  it.each(RUNNERS)('returns ERROR 2 when the local CLI terminates by signal: %s', (template) => {
    expect(run(fixture(template, "process.kill(process.pid, 'SIGTERM')")).status).toBe(2)
  })
})
