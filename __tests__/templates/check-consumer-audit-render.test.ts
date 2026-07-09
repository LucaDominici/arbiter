// SPDX-License-Identifier: Apache-2.0
// CANON-04 render test (#1864, follow-up to #1859/#1861): the generated consumer-audit
// gate must parse BOTH `npm pack --json` schemas (npm < 12 array, npm >= 12 keyed-object)
// and must propagate the source project's `packageManager` pin into the throwaway probe
// package.json, so a consumer under corepack cannot drift to npm@latest.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(tpl: string, overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}

type Gate = {
  tarballNameFromPackOutput: (stdout: string) => string | null
  readSourcePackageManager: (repoRoot: string) => string | undefined
  probePackageJson: (packageManager: string | undefined) => Record<string, unknown>
}

let gate: Gate
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'consumeraudit-'))
  const file = join(dir, 'check-consumer-audit.mjs')
  writeFileSync(file, render('scripts/check-consumer-audit.mjs.ejs'))
  gate = (await import(pathToFileURL(file).href)) as unknown as Gate
  rmSync(dir, { recursive: true, force: true })
})

describe('scripts/check-consumer-audit.mjs.ejs — render (#1864)', () => {
  it('renders an executable node gate with shebang and INV-53 exit codes', () => {
    const content = render('scripts/check-consumer-audit.mjs.ejs')
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(content).toContain('process.exit')
  })
})

describe('tarballNameFromPackOutput — accepts both npm pack --json schemas (#1864)', () => {
  it('parses the npm < 12 ARRAY schema: [{ filename }]', () => {
    const stdout = JSON.stringify([{ name: 'pkg', version: '1.0.0', filename: 'pkg-1.0.0.tgz' }])
    expect(gate.tarballNameFromPackOutput(stdout)).toBe('pkg-1.0.0.tgz')
  })

  it('parses the npm >= 12 keyed-OBJECT schema: { "<pkg>": { filename } }', () => {
    const stdout = JSON.stringify({
      pkg: { name: 'pkg', version: '1.0.0', filename: 'pkg-1.0.0.tgz' },
    })
    expect(gate.tarballNameFromPackOutput(stdout)).toBe('pkg-1.0.0.tgz')
  })

  it('returns null on unparseable JSON', () => {
    expect(gate.tarballNameFromPackOutput('not json')).toBeNull()
  })

  it('returns null when the array entry is missing filename', () => {
    expect(gate.tarballNameFromPackOutput(JSON.stringify([{ name: 'pkg' }]))).toBeNull()
  })

  it('returns null when the keyed-object entry is missing filename', () => {
    expect(gate.tarballNameFromPackOutput(JSON.stringify({ pkg: { name: 'pkg' } }))).toBeNull()
  })

  it('returns null on an empty array or empty object', () => {
    expect(gate.tarballNameFromPackOutput('[]')).toBeNull()
    expect(gate.tarballNameFromPackOutput('{}')).toBeNull()
  })

  it('returns null on other malformed-but-valid-JSON payloads (null, number, string)', () => {
    expect(gate.tarballNameFromPackOutput('null')).toBeNull()
    expect(gate.tarballNameFromPackOutput('42')).toBeNull()
    expect(gate.tarballNameFromPackOutput('"oops"')).toBeNull()
  })
})

describe('probe package.json propagates the source packageManager pin (#1864)', () => {
  it('includes packageManager when declared', () => {
    expect(gate.probePackageJson('npm@10.9.8')).toMatchObject({
      name: 'consumer-probe',
      private: true,
      version: '0.0.0',
      packageManager: 'npm@10.9.8',
    })
  })

  it('omits packageManager when undeclared (undefined)', () => {
    const pkg = gate.probePackageJson(undefined)
    expect(pkg).toMatchObject({ name: 'consumer-probe', private: true, version: '0.0.0' })
    expect(pkg).not.toHaveProperty('packageManager')
  })

  it('omits packageManager for an empty-string pin', () => {
    expect(gate.probePackageJson('')).not.toHaveProperty('packageManager')
  })
})

describe('readSourcePackageManager — reads the source project package.json pin (#1864)', () => {
  it('returns the packageManager field when declared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'srcpkg-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'src', packageManager: 'npm@10.9.8' }),
    )
    expect(gate.readSourcePackageManager(dir)).toBe('npm@10.9.8')
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns undefined when the field is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'srcpkg-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'src' }))
    expect(gate.readSourcePackageManager(dir)).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns undefined (never throws) when package.json is missing/malformed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'srcpkg-'))
    expect(() => gate.readSourcePackageManager(dir)).not.toThrow()
    expect(gate.readSourcePackageManager(dir)).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
