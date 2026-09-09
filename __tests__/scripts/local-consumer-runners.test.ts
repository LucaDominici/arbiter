import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  mkdirSync(join(dir, 'node_modules/@arbiter/cli/dist'), { recursive: true })
  writeFileSync(join(dir, 'runner.mjs'), renderTemplate(template, makeConfig(dir)))
  writeFileSync(join(dir, 'node_modules/@arbiter/cli/dist/cli.js'), source)
  return dir
}

function run(dir: string) {
  return spawnSync(process.execPath, [join(dir, 'runner.mjs'), '--json'], {
    cwd: dir,
    encoding: 'utf-8',
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

  it.each(RUNNERS)('preserves policy 1 and child ERROR 2: %s', (template) => {
    expect(run(fixture(template, 'process.exit(1)')).status).toBe(1)
    expect(run(fixture(template, 'process.exit(2)')).status).toBe(2)
  })
})
