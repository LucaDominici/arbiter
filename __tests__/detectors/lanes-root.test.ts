// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectLanes } from '../../src/detectors/lanes.js'
import { cleanupTestProject } from '../helpers.js'

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-lanes-root-'))
}

// ── G1b unit 8 (#1318.1): root module is the canonical backend lane ───────────
// language.ts already detects a root `go.mod` as a Go project, but lanes.ts only
// recognised `backend/go.mod` — so root-only Go projects got NO backend lane and
// every lane-gated Go governance step silently no-op'd. Root module is canonical;
// `backend/` is the optional split-out variant.
describe('detectLanes — root module canonical backend lane (#1318.1)', () => {
  let dir: string
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('detects backend lane from a root go.mod (canonical, no backend/ subdir)', () => {
    dir = makeTmp()
    writeFileSync(join(dir, 'go.mod'), 'module example.com/api\n\ngo 1.22')
    expect(detectLanes(dir).lanes).toContain('backend')
  })

  it('detects backend lane from a root Cargo.toml', () => {
    dir = makeTmp()
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"')
    expect(detectLanes(dir).lanes).toContain('backend')
  })

  it('detects backend lane from a root pom.xml', () => {
    dir = makeTmp()
    writeFileSync(join(dir, 'pom.xml'), '<project/>')
    expect(detectLanes(dir).lanes).toContain('backend')
  })

  it('still detects backend lane from a backend/ subdir (split variant preserved)', () => {
    dir = makeTmp()
    mkdirSync(join(dir, 'backend'))
    writeFileSync(join(dir, 'backend', 'go.mod'), 'module x\n\ngo 1.22')
    expect(detectLanes(dir).lanes).toContain('backend')
  })

  it('does not add a backend lane to a root frontend-only project (package.json + react)', () => {
    dir = makeTmp()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }))
    expect(detectLanes(dir).lanes).not.toContain('backend')
  })

  it('root go.mod backend lane is idempotent', () => {
    dir = makeTmp()
    writeFileSync(join(dir, 'go.mod'), 'module x\n\ngo 1.22')
    expect(detectLanes(dir)).toEqual(detectLanes(dir))
  })
})
