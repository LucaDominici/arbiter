// SPDX-License-Identifier: Apache-2.0
// CANON-04 render/parity coverage for the #2614 --require-marker requiredness signal.
// AC-3: the self gate and the generated consumer twin share the contract, tested executably —
// not just byte-compared: the rendered artifact is actually spawned and exercised.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const TEMPLATE = 'scripts/check-refutation-verdicts.mjs.ejs'

function render(): string {
  return renderTemplate(
    TEMPLATE,
    makeConfig('/tmp/test', { governanceLevel: 'L2' }) as unknown as Record<string, unknown>,
  )
}

describe('scripts/check-refutation-verdicts.mjs.ejs (#2614, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const rendered = render()
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('is byte-identical to the self-dogfooded gate', () => {
    expect(render()).toBe(
      readFileSync(
        resolve(import.meta.dirname, '../../scripts/check-refutation-verdicts.mjs'),
        'utf8',
      ),
    )
  })

  describe('the rendered artifact, spawned directly', () => {
    let tmpDir: string
    let scriptPath: string
    let evidenceDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'refutation-render-'))
      scriptPath = join(tmpDir, 'check-refutation-verdicts.mjs')
      writeFileSync(scriptPath, render())
      // the rendered gate imports its shared arg parser relatively — carry it along so this
      // is a real spawn of the emitted artifact, not just a syntax check.
      mkdirSync(join(tmpDir, 'lib'), { recursive: true })
      cpSync(
        resolve(import.meta.dirname, '../../scripts/lib/gate-args.mjs'),
        join(tmpDir, 'lib', 'gate-args.mjs'),
      )
      evidenceDir = join(tmpDir, '.arbiter', 'evidence', 'agent-returns')
      mkdirSync(evidenceDir, { recursive: true })
    })
    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    function run(extraArgs: string[] = []) {
      const r = spawnSync('node', [scriptPath, '--evidence-dir', evidenceDir, ...extraArgs], {
        encoding: 'utf-8',
        timeout: 10000,
      })
      return { exitCode: r.status ?? 1, stdout: r.stdout ?? '' }
    }

    it('AC-1: fails when a caller requires a marker for a task and none exists', () => {
      const r = run(['--require-marker', '#2614'])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/required.*#2614/i)
    })

    it('AC-2: absent --require-marker, a missing marker is still a vacuous pass', () => {
      expect(run().exitCode).toBe(0)
    })

    it('AC-2: an existing invalid-quorum failure is unchanged under --require-marker', () => {
      mkdirSync(join(evidenceDir, '_2614'), { recursive: true })
      writeFileSync(
        join(evidenceDir, '_2614', 'refutation-required.json'),
        JSON.stringify({ task: '#2614', skeptics: 0, findings: ['f1'] }),
      )
      expect(run(['--require-marker', '#2614']).exitCode).toBe(1)
    })
  })
})
