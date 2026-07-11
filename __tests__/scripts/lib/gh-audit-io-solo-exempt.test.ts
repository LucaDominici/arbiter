// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/lib/gh-audit-io-solo-exempt.test.ts
//
// detectSoloExempt() (#1874 audit finding): the ADR-091 attestation candidate
// path was still 'docs/ADR/091-...' after the Wave 2 migration moved the ADR
// SSOT to 'docs/internal/ADR/' — so a repo with a real trunk-solo attestation
// (at the CORRECT current path) was never recognized as exempt.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const LIB = pathToFileURL(resolve('scripts/lib/gh-audit-io.mjs')).href

function makeRepo(opts: { attestationPath?: string; collaborationMode?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'gh-audit-io-solo-'))
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify({ collaborationMode: opts.collaborationMode ?? 'trunk-solo' }),
  )
  if (opts.attestationPath) {
    const abs = join(dir, opts.attestationPath)
    mkdirSync(resolve(abs, '..'), { recursive: true })
    writeFileSync(abs, '# ADR-091 attestation\n')
  }
  return dir
}

describe('detectSoloExempt (#1874)', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('is exempt when the attestation exists at the CURRENT ADR path (docs/internal/ADR/)', async () => {
    const { detectSoloExempt } = await import(LIB)
    const dir = makeRepo({
      attestationPath: 'docs/internal/ADR/091-single-dev-exception-attestation.md',
    })
    dirs.push(dir)
    expect(detectSoloExempt(dir)).toBe(true)
  })

  it('is NOT exempt when only the stale pre-migration path has the attestation', async () => {
    const { detectSoloExempt } = await import(LIB)
    const dir = makeRepo({ attestationPath: 'docs/ADR/091-single-dev-exception-attestation.md' })
    dirs.push(dir)
    expect(detectSoloExempt(dir)).toBe(false)
  })

  it('is NOT exempt when collaborationMode is not trunk-solo, even with the attestation present', async () => {
    const { detectSoloExempt } = await import(LIB)
    const dir = makeRepo({
      attestationPath: 'docs/internal/ADR/091-single-dev-exception-attestation.md',
      collaborationMode: 'team',
    })
    dirs.push(dir)
    expect(detectSoloExempt(dir)).toBe(false)
  })

  it('is NOT exempt when trunk-solo but no attestation doc exists at all (config-laundering defense)', async () => {
    const { detectSoloExempt } = await import(LIB)
    const dir = makeRepo()
    dirs.push(dir)
    expect(detectSoloExempt(dir)).toBe(false)
  })
})
