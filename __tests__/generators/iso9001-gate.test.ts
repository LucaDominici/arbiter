// SPDX-License-Identifier: Apache-2.0
// #1253: the ISO 9001 gate must be ENFORCEABLE — exit 0 on a clean QMS, exit 1 on
// a broken one. Renders the generated artefacts to a temp project and runs the gate.

import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateIso9001 } from '../../src/generators/iso9001.js'

let dir: string
afterEach(() => {
  if (dir) cleanupTestProject(dir)
})

/** Run the generated gate; return { code, out }. code 0 = pass, 1 = fail, 2 = error. */
function runGate(projectDir: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', ['scripts/check-iso9001.mjs'], {
      cwd: projectDir,
      encoding: 'utf-8',
    })
    return { code: 0, out }
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

function scaffold(): string {
  const d = createTestProject('typescript')
  generateIso9001(makeConfig(d, { language: 'typescript', industryOverlay: 'iso9001' }))
  return d
}

describe('check-iso9001 gate — enforceable (#1253)', () => {
  it('exits 0 on the freshly-scaffolded (clean) quality management system', () => {
    dir = scaffold()
    const { code, out } = runGate(dir)
    expect(out).toContain('check-iso9001: OK')
    expect(code).toBe(0)
  })

  it('exits 1 when an RTM row is Done but its test_ref file is missing', () => {
    dir = scaffold()
    const rtmPath = join(dir, 'docs/quality/REQUIREMENTS_TRACEABILITY.md')
    const rtm = readFileSync(rtmPath, 'utf-8').replace(
      '| QR-001 | Customer requirements captured and reviewed (§8.2) | | | Missing | #1 | Replace with your requirements-review ref |',
      '| QR-001 | Customer requirements captured and reviewed (§8.2) | src/req.ts | __tests__/missing.test.ts | Done | | |',
    )
    writeFileSync(rtmPath, rtm)
    const { code, out } = runGate(dir)
    expect(code).toBe(1)
    expect(out).toContain('test_ref file not found')
  })

  it('exits 1 when a controlled document is registered but absent on disk', () => {
    dir = scaffold()
    const docPath = join(dir, 'docs/quality/DOCUMENT_CONTROL.md')
    const doc = readFileSync(docPath, 'utf-8').replace(
      '| DOC-001 | docs/quality/REQUIREMENTS_TRACEABILITY.md | 1.0.0 | quality-lead | active | annual |',
      '| DOC-001 | docs/quality/DOES_NOT_EXIST.md | 1.0.0 | quality-lead | active | annual |',
    )
    writeFileSync(docPath, doc)
    const { code, out } = runGate(dir)
    expect(code).toBe(1)
    expect(out).toContain('controlled_document not found on disk')
  })

  it('exits 1 when a controlled document lacks a semver doc_version', () => {
    dir = scaffold()
    const docPath = join(dir, 'docs/quality/DOCUMENT_CONTROL.md')
    const doc = readFileSync(docPath, 'utf-8').replace(
      '| DOC-001 | docs/quality/REQUIREMENTS_TRACEABILITY.md | 1.0.0 | quality-lead | active | annual |',
      '| DOC-001 | docs/quality/REQUIREMENTS_TRACEABILITY.md |  | quality-lead | active | annual |',
    )
    writeFileSync(docPath, doc)
    const { code, out } = runGate(dir)
    expect(code).toBe(1)
    expect(out).toContain('doc_version must be semver')
  })

  it('exits 1 when an open CAPA has no tracking issue_ref', () => {
    dir = scaffold()
    const capaPath = join(dir, 'docs/quality/CAPA_LOG.md')
    const capa = readFileSync(capaPath, 'utf-8').replace(
      '<!-- CAPA_END -->',
      '| CAPA-001 | flaky test | rerun | fix root cause | open | |\n<!-- CAPA_END -->',
    )
    writeFileSync(capaPath, capa)
    const { code, out } = runGate(dir)
    expect(code).toBe(1)
    expect(out).toContain('requires a tracking issue_ref')
  })

  it('exits 0 when the open CAPA carries an issue_ref (round-trip)', () => {
    dir = scaffold()
    const capaPath = join(dir, 'docs/quality/CAPA_LOG.md')
    const capa = readFileSync(capaPath, 'utf-8').replace(
      '<!-- CAPA_END -->',
      '| CAPA-001 | flaky test | rerun | fix root cause | open | #42 |\n<!-- CAPA_END -->',
    )
    writeFileSync(capaPath, capa)
    expect(runGate(dir).code).toBe(0)
  })

  it('exits 2 when the RTM file is absent (fail-closed error)', () => {
    dir = scaffold()
    execFileSync('rm', [join(dir, 'docs/quality/REQUIREMENTS_TRACEABILITY.md')])
    expect(runGate(dir).code).toBe(2)
  })
})
