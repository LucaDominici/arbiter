import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig } from '../../helpers.js'

const RAW_HOOK = join(process.cwd(), 'src/templates/claude/hooks/check-no-unused-exports.mjs')
const DEBOUNCE_DIR = join(tmpdir(), 'arbiter-hook-debounce')

function makeRawHook(): { dir: string; hookPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-unused-exports-'))
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(
    join(hooksDir, 'lib.mjs'),
    renderTemplate(
      'claude/hooks/lib.mjs.ejs',
      makeConfig(dir, { language: 'typescript', projectName: 'unused-exports-test' }),
    ),
  )
  const hookPath = join(hooksDir, 'check-no-unused-exports.mjs')
  writeFileSync(hookPath, readFileSync(RAW_HOOK, 'utf-8'))
  return { dir, hookPath }
}

function installFakeNpx(dir: string): string {
  const binDir = join(dir, 'bin')
  mkdirSync(binDir, { recursive: true })
  const npxPath = join(binDir, 'npx')
  writeFileSync(
    npxPath,
    `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ issues: [\n  { file: 'src/util.ts', exports: [{ name: 'neverImported', line: 2 }], types: [] },\n]}))\n`,
  )
  chmodSync(npxPath, 0o755)
  return binDir
}

function runHook(hookPath: string, dir: string, filePath: string, binDir: string) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    encoding: 'utf-8',
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    timeout: 5000,
  })
}

describe('check-no-unused-exports — emitted raw hook', () => {
  let dir: string
  let hookPath: string
  let binDir: string

  beforeEach(() => {
    rmSync(DEBOUNCE_DIR, { recursive: true, force: true })
    ;({ dir, hookPath } = makeRawHook())
    binDir = installFakeNpx(dir)
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'util.ts'), 'export const neverImported = 1\n')
    writeFileSync(join(dir, 'src', 'other.ts'), 'export const used = 1\n')
  })

  afterEach(() => {
    rmSync(DEBOUNCE_DIR, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 when the edited file has no unused exports', () => {
    const result = runHook(hookPath, dir, join(dir, 'src', 'other.ts'), binDir)

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('exits 2 and names an unused export in the edited file', () => {
    const result = runHook(hookPath, dir, join(dir, 'src', 'util.ts'), binDir)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unused exports detected (knip):')
    expect(result.stderr).toContain('src/util.ts:2')
    expect(result.stderr).toContain('neverImported')
  })
})
