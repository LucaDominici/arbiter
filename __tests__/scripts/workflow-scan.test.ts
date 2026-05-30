// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1096 — shared workflow-scan helpers extracted from the
// workflow/action check-*.mjs scripts. Verifies the walker and the
// --help/--dir parser preserve the behavior of the inlined originals.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { collectYamlFiles, parseHelpAndDir } from '../../scripts/lib/workflow-scan.mjs'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'workflow-scan-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('collectYamlFiles', () => {
  it('returns [] when the directory does not exist', () => {
    expect(collectYamlFiles(join(tmp, 'absent'))).toEqual([])
  })

  it('collects .yml and .yaml, ignoring other extensions', () => {
    writeFileSync(join(tmp, 'ci.yml'), 'name: ci')
    writeFileSync(join(tmp, 'release.yaml'), 'name: release')
    writeFileSync(join(tmp, 'notes.txt'), 'ignore')
    const found = collectYamlFiles(tmp)
      .map((p) => p.split('/').pop())
      .sort()
    expect(found).toEqual(['ci.yml', 'release.yaml'])
  })

  it('recurses into subdirectories', () => {
    mkdirSync(join(tmp, 'nested'))
    writeFileSync(join(tmp, 'top.yml'), 'a')
    writeFileSync(join(tmp, 'nested', 'inner.yaml'), 'b')
    const found = collectYamlFiles(tmp)
      .map((p) => p.split('/').pop())
      .sort()
    expect(found).toEqual(['inner.yaml', 'top.yml'])
  })

  it('skips symbolic links', () => {
    writeFileSync(join(tmp, 'real.yml'), 'a')
    symlinkSync(join(tmp, 'real.yml'), join(tmp, 'link.yml'))
    const found = collectYamlFiles(tmp).map((p) => p.split('/').pop())
    expect(found).toEqual(['real.yml'])
  })

  it('returns absolute paths joined to the scanned dir', () => {
    writeFileSync(join(tmp, 'ci.yml'), 'a')
    expect(collectYamlFiles(tmp)).toEqual([join(tmp, 'ci.yml')])
  })

  it('swallows readdir errors silently by default', () => {
    // A path that exists but is a FILE, not a dir → readdirSync throws ENOTDIR.
    const filePath = join(tmp, 'a-file.yml')
    writeFileSync(filePath, 'x')
    expect(collectYamlFiles(filePath)).toEqual([])
  })

  it('invokes onReadError when readdir fails', () => {
    const filePath = join(tmp, 'a-file.yml')
    writeFileSync(filePath, 'x')
    const seen: Array<{ dir: string; msg: string }> = []
    const result = collectYamlFiles(filePath, {
      onReadError: (dir, err) => seen.push({ dir, msg: err.message }),
    })
    expect(result).toEqual([])
    expect(seen).toHaveLength(1)
    expect(seen[0].dir).toBe(filePath)
    expect(seen[0].msg.length).toBeGreaterThan(0)
  })
})

describe('parseHelpAndDir', () => {
  it('defaults to process.cwd() when no --dir is given', () => {
    expect(parseHelpAndDir([], { usage: 'u' })).toEqual({ cwd: process.cwd() })
  })

  it('resolves the --dir argument', () => {
    expect(parseHelpAndDir(['--dir', tmp], { usage: 'u' })).toEqual({ cwd: resolve(tmp) })
  })

  it('ignores a trailing --dir with no value (defaults to cwd)', () => {
    expect(parseHelpAndDir(['--dir'], { usage: 'u' })).toEqual({ cwd: process.cwd() })
  })

  // --help / -h call process.exit, so exercise via a subprocess.
  // Resolve the helper relative to THIS test file (not process.cwd()) and import
  // it via a file:// URL so the child `import` works even when the repo path
  // contains characters like `#` that are invalid in a bare path-as-URL.
  const helperPath = fileURLToPath(new URL('../../scripts/lib/workflow-scan.mjs', import.meta.url))
  const helperHref = pathToFileURL(helperPath).href
  const driver = (flag: string): { status: number; stdout: string } => {
    const code = `import { parseHelpAndDir } from ${JSON.stringify(
      helperHref,
    )}; parseHelpAndDir([${JSON.stringify(flag)}], { usage: 'USAGE-MARKER\\n' }); console.log('SHOULD-NOT-REACH')`
    const r = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf-8' })
    return { status: r.status ?? 1, stdout: r.stdout ?? '' }
  }

  it('prints usage and exits 0 on --help', () => {
    const r = driver('--help')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('USAGE-MARKER')
    expect(r.stdout).not.toContain('SHOULD-NOT-REACH')
  })

  it('prints usage and exits 0 on -h', () => {
    const r = driver('-h')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('USAGE-MARKER')
    expect(r.stdout).not.toContain('SHOULD-NOT-REACH')
  })
})
