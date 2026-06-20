// SPDX-License-Identifier: Apache-2.0
// #1413: the per-stack false-gap meta-gate — validate each standards/gold-registry.<stack>.yml
// parses, carries no RISKY check, and references only known threshold_refs.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

const SCRIPT = resolve('scripts/check-gold-registries.mjs')

function run(standards: string): { status: number; out: string } {
  const r = spawnSync('node', [SCRIPT, '--standards', standards], { encoding: 'utf-8' })
  return { status: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

const THRESHOLDS = `version: '1.0.0'
thresholds:
  coverage.line:
    gold: 90
    light: 80
    medium: 60
    heavy: 40
`

function makeStandards(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gold-registries-'))
  const std = join(dir, 'standards')
  mkdirSync(std, { recursive: true })
  writeFileSync(join(std, 'thresholds.yml'), THRESHOLDS)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(std, name), content)
  return { dir: std, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-gold-registries (#1413)', () => {
  it('the SHIPPED standards/ registries pass (no RISKY, refs resolve)', () => {
    const r = run(resolve('standards'))
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/all checks SAFE/)
  })

  it('the shipped go/python/rust registries exist and every check is SAFE (#1426)', () => {
    const stdDir = resolve('standards')
    for (const stack of ['go', 'python', 'rust']) {
      const file = join(stdDir, `gold-registry.${stack}.yml`)
      expect(existsSync(file), `${stack} registry must ship`).toBe(true)
      const doc = parseYaml(readFileSync(file, 'utf-8')) as {
        profile?: string
        checks?: Array<{ risk?: string }>
      }
      expect(doc.profile).toBe(stack)
      expect(Array.isArray(doc.checks) && doc.checks.length > 0).toBe(true)
      for (const c of doc.checks ?? []) expect(c.risk).not.toBe('RISKY')
    }
    // The meta-gate accepts all shipped registries together (go/python/rust refs resolve).
    const r = run(stdDir)
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/all checks SAFE/)
  })

  it('a SAFE per-stack registry with valid value checks passes', () => {
    const { dir, cleanup } = makeStandards({
      'gold-registry.go.yml': `version: '1.0.0'
checks:
  - id: GO-COV-01
    type: value
    args: { path: cover.json, format: json, select: 'total.lines.pct', op: gte }
    threshold_ref: coverage.line
    risk: SAFE
`,
    })
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('a RISKY check fails the meta-gate (exit 1)', () => {
    const { dir, cleanup } = makeStandards({
      'gold-registry.go.yml': `version: '1.0.0'
checks:
  - id: GO-01
    type: file_exists
    args: { path: README.md }
    risk: RISKY
`,
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/RISKY/)
    } finally {
      cleanup()
    }
  })

  it('a value check referencing an unknown threshold_ref fails (exit 1)', () => {
    const { dir, cleanup } = makeStandards({
      'gold-registry.go.yml': `version: '1.0.0'
checks:
  - id: GO-01
    type: value
    args: { path: cover.json, format: json, select: 'pct', op: gte }
    threshold_ref: does.not.exist
    risk: SAFE
`,
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/unknown threshold_ref/)
    } finally {
      cleanup()
    }
  })

  it('a value check missing op/select/threshold fails (exit 1)', () => {
    const { dir, cleanup } = makeStandards({
      'gold-registry.go.yml': `version: '1.0.0'
checks:
  - id: GO-01
    type: value
    args: { path: cover.json, format: json }
    risk: SAFE
`,
    })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('no per-stack registries → exit 0 (nothing to check)', () => {
    const { dir, cleanup } = makeStandards({})
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
