// SPDX-License-Identifier: Apache-2.0
// RED phase (#1442): a Track-B container-image digest-pin gate must be emitted and
// wired into the generated check-all.mjs at L1, so governed target projects that ship
// containers fail closed on a mutable (non-@sha256) third-party base image.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../helpers.js'

function renderCheck(overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate('scripts/check-image-pins.mjs.ejs', data)
}
function renderGateCheckAll(overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderCheckAll(data)
}

/** Render the gate to a temp file, drop a Dockerfile in a temp dir, run it, return exit code. */
function runGate(dockerfile: string | null): number {
  const scriptDir = mkdtempSync(join(tmpdir(), 'imgpin-s-'))
  const repoDir = mkdtempSync(join(tmpdir(), 'imgpin-r-'))
  try {
    const scriptPath = join(scriptDir, 'check-image-pins.mjs')
    writeFileSync(scriptPath, renderCheck())
    if (dockerfile !== null) writeFileSync(join(repoDir, 'Dockerfile'), dockerfile)
    const r = spawnSync('node', [scriptPath, '--dir', repoDir], { encoding: 'utf-8' })
    return r.status ?? -1
  } finally {
    rmSync(scriptDir, { recursive: true, force: true })
    rmSync(repoDir, { recursive: true, force: true })
  }
}

const PINNED = 'node@sha256:abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcab'

describe('scripts/check-image-pins.mjs.ejs — container digest-pin gate (#1442)', () => {
  it('renders an executable node gate with a shebang and INV-53 exit codes', () => {
    const content = renderCheck()
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(content).toContain('process.exit(1)')
    expect(content).toContain('process.exit(0)')
  })

  it('targets Dockerfile FROM lines and the @sha256 digest form', () => {
    const content = renderCheck()
    expect(content).toContain('FROM')
    expect(content).toContain('@sha256:')
    expect(content.toLowerCase()).toContain('scratch')
  })

  it('is wired into the generated check-all.mjs at L1 (typescript)', () => {
    expect(renderGateCheckAll({ language: 'typescript', governanceLevel: 'L1' })).toContain(
      'check-image-pins.mjs',
    )
  })

  it('is wired into the generated check-all.mjs for a go project', () => {
    expect(renderGateCheckAll({ language: 'go', governanceLevel: 'L1' })).toContain(
      'check-image-pins.mjs',
    )
  })

  // ── functional behaviour ──────────────────────────────────────────────────
  it('exits 0 when there is no Dockerfile (vacuous pass)', () => {
    expect(runGate(null)).toBe(0)
  })

  it('exits 1 on an unpinned third-party FROM (mutable tag)', () => {
    expect(runGate('FROM node:22\nRUN echo hi\n')).toBe(1)
  })

  it('exits 0 when the base image is @sha256-pinned', () => {
    expect(runGate(`FROM ${PINNED}\nRUN echo hi\n`)).toBe(0)
  })

  it('exits 0 for FROM scratch (unpinnable, exempt)', () => {
    expect(runGate('FROM scratch\nCOPY x /\n')).toBe(0)
  })

  it('exits 0 for a build-stage alias reference (exempt)', () => {
    expect(runGate(`FROM ${PINNED} AS build\nFROM build\nRUN echo hi\n`)).toBe(0)
  })

  it('exits 0 for an unpinned FROM carrying the allow comment', () => {
    expect(runGate('FROM node:22 # arbiter-allow-unpinned: dev base\n')).toBe(0)
  })
})
