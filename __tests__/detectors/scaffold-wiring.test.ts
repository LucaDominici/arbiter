// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkScaffoldWiring } from '../../src/detectors/scaffold-wiring.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-scaffold-wiring-'))
}

describe('checkScaffoldWiring (#1835)', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns no unwired scripts when scripts/ is absent', () => {
    expect(checkScaffoldWiring(dir).unwired).toEqual([])
  })

  it('returns no unwired scripts when scripts/ has none matching check-*.mjs', () => {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'helper.mjs'), '// not a check script')
    expect(checkScaffoldWiring(dir).unwired).toEqual([])
  })

  it('ignores check-all.mjs itself as a candidate', () => {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-all.mjs'), '// the gate itself')
    expect(checkScaffoldWiring(dir).unwired).toEqual([])
  })

  it('flags a check-*.mjs script referenced by none of check-all.mjs/run.sh/Makefile', () => {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-all.mjs'), '// references nothing')
    writeFileSync(join(dir, 'scripts', 'check-orphan.mjs'), '// dead')
    const { unwired } = checkScaffoldWiring(dir)
    expect(unwired).toEqual([{ path: 'scripts/check-orphan.mjs' }])
  })

  it('does not flag a script referenced by check-all.mjs', () => {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(
      join(dir, 'scripts', 'check-all.mjs'),
      "runCheck('x', 'node', ['scripts/check-wired.mjs']);",
    )
    writeFileSync(join(dir, 'scripts', 'check-wired.mjs'), '// wired')
    expect(checkScaffoldWiring(dir).unwired).toEqual([])
  })

  it('does not flag a script referenced only by run.sh', () => {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-all.mjs'), '// gate')
    writeFileSync(join(dir, 'scripts', 'check-via-run.mjs'), '// wired via run.sh')
    writeFileSync(join(dir, 'run.sh'), '#!/bin/sh\nnode scripts/check-via-run.mjs\n')
    expect(checkScaffoldWiring(dir).unwired).toEqual([])
  })

  it('does not flag a script referenced only by Makefile', () => {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-all.mjs'), '// gate')
    writeFileSync(join(dir, 'scripts', 'check-via-make.mjs'), '// wired via Makefile')
    writeFileSync(join(dir, 'Makefile'), 'audit:\n\tnode scripts/check-via-make.mjs\n')
    expect(checkScaffoldWiring(dir).unwired).toEqual([])
  })

  it('reports multiple unwired scripts, sorted', () => {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-all.mjs'), '// gate')
    writeFileSync(join(dir, 'scripts', 'check-zeta.mjs'), '// dead')
    writeFileSync(join(dir, 'scripts', 'check-alpha.mjs'), '// dead')
    const { unwired } = checkScaffoldWiring(dir)
    expect(unwired.map((u) => u.path)).toEqual([
      'scripts/check-alpha.mjs',
      'scripts/check-zeta.mjs',
    ])
  })
})
