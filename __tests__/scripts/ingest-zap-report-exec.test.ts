// SPDX-License-Identifier: Apache-2.0
// #1887-E: ingest-zap-report.mjs was only ever render-tested (never executed) and
// never actually wired into the workflows that produce its input — this exercises
// the emitted script end-to-end against fixture ZAP report JSON, proving the
// threshold gate (the whole point of the script) actually works, not just that it
// renders without EJS leaks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function zapReport(alerts: Array<{ riskcode: number; name: string }>) {
  return JSON.stringify({
    site: [{ alerts: alerts.map((a) => ({ ...a, instances: [{}] })) }],
  })
}

describe('ingest-zap-report.mjs — materialized execution (#1887-E)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-zap-ingest-'))
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    const content = renderTemplate('scripts/ingest-zap-report.mjs.ejs', makeConfig(dir))
    writeFileSync(join(dir, 'scripts', 'ingest-zap-report.mjs'), content, 'utf-8')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 (PASS) when there are no HIGH/MEDIUM alerts', () => {
    writeFileSync(join(dir, 'zap-report.json'), zapReport([{ riskcode: 1, name: 'Low finding' }]))
    const out = execFileSync('node', ['scripts/ingest-zap-report.mjs'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    expect(out).toContain('PASS')
  })

  it('exits 1 (FAIL) when a HIGH alert exceeds the default threshold of 0', () => {
    writeFileSync(join(dir, 'zap-report.json'), zapReport([{ riskcode: 3, name: 'SQL Injection' }]))
    expect(() => execFileSync('node', ['scripts/ingest-zap-report.mjs'], { cwd: dir })).toThrow()
  })

  it('exits 1 (FAIL) when a MEDIUM alert exceeds the default threshold of 0', () => {
    writeFileSync(
      join(dir, 'zap-report.json'),
      zapReport([{ riskcode: 2, name: 'Missing security header' }]),
    )
    expect(() => execFileSync('node', ['scripts/ingest-zap-report.mjs'], { cwd: dir })).toThrow()
  })

  it('exits 0 when alerts are within an explicit --high-threshold/--medium-threshold', () => {
    writeFileSync(
      join(dir, 'zap-report.json'),
      zapReport([
        { riskcode: 3, name: 'SQL Injection' },
        { riskcode: 2, name: 'Missing security header' },
      ]),
    )
    const out = execFileSync(
      'node',
      ['scripts/ingest-zap-report.mjs', '--high-threshold', '1', '--medium-threshold', '1'],
      { cwd: dir, encoding: 'utf-8' },
    )
    expect(out).toContain('PASS')
  })

  it('exits 2 (per script convention, exit 1 here — no report file) when the report is missing', () => {
    expect(() =>
      execFileSync('node', ['scripts/ingest-zap-report.mjs'], { cwd: dir, stdio: 'pipe' }),
    ).toThrow()
  })

  it('respects a custom --report path', () => {
    const customPath = join(dir, 'custom-zap.json')
    writeFileSync(customPath, zapReport([{ riskcode: 0, name: 'Info only' }]))
    const out = execFileSync('node', ['scripts/ingest-zap-report.mjs', '--report', customPath], {
      cwd: dir,
      encoding: 'utf-8',
    })
    expect(out).toContain('PASS')
  })
})
