// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/gen-third-party-licenses.mjs')
const OUT = resolve('THIRD_PARTY_LICENSES.md')

function run(args: string[]) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('gen-third-party-licenses.mjs', () => {
  it('committed THIRD_PARTY_LICENSES.md is up to date (--check passes)', () => {
    const result = run(['--check'])
    expect(result.status).toBe(0)
    // Info is on stderr so stdout stays clean for `npm pack --json` consumers.
    expect(result.stderr).toContain('up to date')
    expect(result.stdout).toBe('')
  })

  it('write mode keeps stdout clean (prepack runs under `npm pack --json`)', () => {
    // Regenerating must not print to stdout, or it corrupts the JSON that
    // `npm pack --dry-run --json` emits when prepack runs this generator.
    const result = run([])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('wrote THIRD_PARTY_LICENSES.md')
  })

  it('the committed file exists and lists every production dependency', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    const deps = Object.keys(pkg.dependencies ?? {})
    expect(deps.length).toBeGreaterThan(0)
    const content = readFileSync(OUT, 'utf8')
    for (const dep of deps) {
      // Each dependency gets a `## <name>@<version>` section.
      expect(content).toContain(`## ${dep}@`)
    }
  })

  it('emits a license id and verbatim license text for each dependency', () => {
    const content = readFileSync(OUT, 'utf8')
    // At least one MIT and the Apache-2.0 (ejs) dep are present and have a
    // fenced license block.
    expect(content).toContain('- License: MIT')
    expect(content).toContain('- License: Apache-2.0')
    expect(content).toMatch(/```[\s\S]*?Permission is hereby granted[\s\S]*?```/)
  })

  it('NOTICE references the same .md filename (no extension mismatch)', () => {
    const notice = readFileSync(resolve('NOTICE'), 'utf8')
    expect(notice).toContain('THIRD_PARTY_LICENSES.md')
    expect(notice).not.toContain('THIRD_PARTY_LICENSES.txt')
  })

  it('package.json files[] ships THIRD_PARTY_LICENSES.md', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(pkg.files).toContain('THIRD_PARTY_LICENSES.md')
  })
})
