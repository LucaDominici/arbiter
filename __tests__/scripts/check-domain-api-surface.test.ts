// SPDX-License-Identifier: Apache-2.0
// Tests for scripts/check-domain-api-surface.mjs (INV-125)
// R1-R10: gate behaviour across SKIP, PASS, FAIL, and error paths
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const GATE = join(process.cwd(), 'scripts/check-domain-api-surface.mjs')

function run(dir: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(process.execPath, [GATE], {
    env: { ...process.env, REPO_ROOT: dir, ...env },
    encoding: 'utf8',
  })
  return { status: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'inv125-'))
}

function writeManifest(dir: string, data: unknown): void {
  writeFileSync(join(dir, 'domain-api-surface.json'), JSON.stringify(data, null, 2))
}

describe('check-domain-api-surface.mjs (INV-125)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // R1: manifest absent → SKIP (exit 0)
  it('R1: exits 0 (SKIP) when manifest is absent', () => {
    const r = run(tmpDir)
    expect(r.status).toBe(0)
    expect(r.out).toContain('SKIP')
  })

  // R2: all fields reachable → PASS (exit 0)
  it('R2: exits 0 (PASS) when all persisted fields are reachable', () => {
    writeManifest(tmpDir, {
      schema: 'arbiter-domain-api-surface-v1',
      resources: [
        {
          resource: 'User',
          domainFields: [
            { name: 'id', persisted: true, inRequestSchema: false, inResponseSchema: true },
            { name: 'name', persisted: true, inRequestSchema: true, inResponseSchema: true },
          ],
        },
      ],
    })
    const r = run(tmpDir)
    expect(r.status).toBe(0)
    expect(r.out).toContain('PASS')
  })

  // R3: persisted field missing from both schemas → FAIL (exit 1)
  it('R3: exits 1 (FAIL) when persisted field absent from both schemas', () => {
    writeManifest(tmpDir, {
      schema: 'arbiter-domain-api-surface-v1',
      resources: [
        {
          resource: 'Order',
          domainFields: [
            { name: 'total', persisted: true, inRequestSchema: false, inResponseSchema: false },
          ],
        },
      ],
    })
    const r = run(tmpDir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('FAIL')
    expect(r.out).toContain('Order.total')
  })

  // R4: non-persisted field absent from schemas → PASS
  it('R4: exits 0 (PASS) when non-persisted field is absent from both schemas', () => {
    writeManifest(tmpDir, {
      schema: 'arbiter-domain-api-surface-v1',
      resources: [
        {
          resource: 'Product',
          domainFields: [
            {
              name: 'computedRank',
              persisted: false,
              inRequestSchema: false,
              inResponseSchema: false,
            },
          ],
        },
      ],
    })
    const r = run(tmpDir)
    expect(r.status).toBe(0)
    expect(r.out).toContain('PASS')
  })

  // R5: invalid JSON → error (exit 2)
  it('R5: exits 2 when manifest is invalid JSON', () => {
    writeFileSync(join(tmpDir, 'domain-api-surface.json'), '{not valid json')
    const r = run(tmpDir)
    expect(r.status).toBe(2)
    expect(r.out).toContain('ERROR')
  })

  // R6: wrong schema field → error (exit 2)
  it('R6: exits 2 when manifest schema field is wrong', () => {
    writeManifest(tmpDir, { schema: 'wrong-schema-v99', resources: [] })
    const r = run(tmpDir)
    expect(r.status).toBe(2)
    expect(r.out).toContain('ERROR')
  })

  // R7: missing resources array → error (exit 2)
  it('R7: exits 2 when resources is not an array', () => {
    writeManifest(tmpDir, { schema: 'arbiter-domain-api-surface-v1', resources: null })
    const r = run(tmpDir)
    expect(r.status).toBe(2)
    expect(r.out).toContain('ERROR')
  })

  // R8: multiple gaps reported
  it('R8: reports all gaps when multiple persisted fields are unreachable', () => {
    writeManifest(tmpDir, {
      schema: 'arbiter-domain-api-surface-v1',
      resources: [
        {
          resource: 'Payment',
          domainFields: [
            { name: 'amount', persisted: true, inRequestSchema: false, inResponseSchema: false },
            { name: 'currency', persisted: true, inRequestSchema: false, inResponseSchema: false },
            { name: 'status', persisted: true, inRequestSchema: false, inResponseSchema: true },
          ],
        },
      ],
    })
    const r = run(tmpDir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('Payment.amount')
    expect(r.out).toContain('Payment.currency')
    expect(r.out).not.toContain('Payment.status')
  })

  // R9: empty resources array → PASS (nothing to check)
  it('R9: exits 0 (PASS) for empty resources array', () => {
    writeManifest(tmpDir, {
      schema: 'arbiter-domain-api-surface-v1',
      resources: [],
    })
    const r = run(tmpDir)
    expect(r.status).toBe(0)
    expect(r.out).toContain('PASS')
  })

  // R10: persisted field with inRequestSchema=true only → PASS
  it('R10: exits 0 (PASS) when persisted field is in request schema only', () => {
    writeManifest(tmpDir, {
      schema: 'arbiter-domain-api-surface-v1',
      resources: [
        {
          resource: 'Config',
          domainFields: [
            { name: 'secret', persisted: true, inRequestSchema: true, inResponseSchema: false },
          ],
        },
      ],
    })
    const r = run(tmpDir)
    expect(r.status).toBe(0)
    expect(r.out).toContain('PASS')
  })
})
