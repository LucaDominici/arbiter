// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { injectDevDependency } from '../../src/utils/pkg.js'

describe('injectDevDependency (#1314 install-channel guard)', () => {
  let dir: string
  const pkgPath = (): string => join(dir, 'package.json')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arb-pkg-'))
    writeFileSync(pkgPath(), JSON.stringify({ name: 'demo', devDependencies: {} }, null, 2))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('injects a registry-pinned version', () => {
    injectDevDependency(dir, 'jscpd', '5.0.6', false)
    const pkg = JSON.parse(readFileSync(pkgPath(), 'utf-8')) as {
      devDependencies: Record<string, string>
    }
    expect(pkg.devDependencies['jscpd']).toBe('5.0.6')
  })

  it('does not overwrite an existing dependency', () => {
    writeFileSync(pkgPath(), JSON.stringify({ devDependencies: { jscpd: '1.0.0' } }))
    injectDevDependency(dir, 'jscpd', '5.0.6', false)
    const pkg = JSON.parse(readFileSync(pkgPath(), 'utf-8')) as {
      devDependencies: Record<string, string>
    }
    expect(pkg.devDependencies['jscpd']).toBe('1.0.0')
  })

  // Option C: volatile local install channels are structurally impossible.
  it.each([
    ['file:../arbiter/arbiter-cli-0.1.0.tgz'],
    ['file:../arbiter'],
    ['link:../arbiter'],
    ['portal:../arbiter'],
    ['./vendor/arbiter-cli-0.1.0.tgz'],
    ['https://example.com/pkg.tar.gz'],
  ])('throws on a volatile install channel: %s', (version) => {
    expect(() => injectDevDependency(dir, '@arbiter/cli', version, false)).toThrow(/volatile/i)
    // package.json must be left untouched (no partial write).
    const pkg = JSON.parse(readFileSync(pkgPath(), 'utf-8')) as {
      devDependencies: Record<string, string>
    }
    expect(pkg.devDependencies['@arbiter/cli']).toBeUndefined()
  })

  it('rejects a volatile version even in dryRun (validated before the dryRun short-circuit)', () => {
    expect(() => injectDevDependency(dir, '@arbiter/cli', 'file:../x.tgz', true)).toThrow(
      /volatile/i,
    )
  })
})
