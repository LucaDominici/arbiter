// SPDX-License-Identifier: Apache-2.0
// Brownfield baseline for the muted-gate-test guard (#1835 follow-through): a
// legacy repo's pre-existing @Disabled tests are grandfathered via
// `--update-baseline` (per-file, per-marker-kind counts — line numbers drift,
// counts do not); NEW muted tests always fail. These tests render the CONSUMER
// template (the file a generated project actually runs) and drive it end-to-end.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [join('scripts', 'check-muted-test.mjs'), ...args], {
    encoding: 'utf-8',
    cwd: dir,
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const DISABLED_TEST = (n: number): string =>
  'package com.example;\n\nimport org.junit.jupiter.api.Disabled;\nimport org.junit.jupiter.api.Test;\n\nclass LegacyTest {\n' +
  Array.from(
    { length: n },
    (_, i) => `  @Disabled("cloudflare")\n  @Test\n  void legacy${i}() {}\n`,
  ).join('\n') +
  '}\n'

describe('check-muted-test template — brownfield baseline', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'muted-baseline-'))
    const data = makeConfig(dir, { language: 'java' }) as unknown as Record<string, unknown>
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(
      join(dir, 'scripts', 'check-muted-test.mjs'),
      renderTemplate('scripts/check-muted-test.mjs.ejs', data),
    )
    mkdirSync(join(dir, 'src', 'test', 'java', 'com', 'example'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const legacyPath = (): string =>
    join(dir, 'src', 'test', 'java', 'com', 'example', 'LegacyTest.java')

  it('without a baseline, pre-existing @Disabled tests fail closed (strict default)', () => {
    writeFileSync(legacyPath(), DISABLED_TEST(2))
    const r = run(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('jvm @Disabled')
    expect(r.stderr).toContain('--update-baseline')
  })

  it('--update-baseline grandfathers the current state; the next run passes', () => {
    writeFileSync(legacyPath(), DISABLED_TEST(2))
    expect(run(dir, ['--update-baseline']).status).toBe(0)
    const baseline = JSON.parse(readFileSync(join(dir, 'muted-tests-baseline.json'), 'utf-8'))
    expect(baseline.baselined['src/test/java/com/example/LegacyTest.java']['jvm @Disabled']).toBe(2)
    const r = run(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('grandfathered')
  })

  it('a NEW @Disabled in a grandfathered file (count above baseline) fails', () => {
    writeFileSync(legacyPath(), DISABLED_TEST(2))
    run(dir, ['--update-baseline'])
    writeFileSync(legacyPath(), DISABLED_TEST(3))
    const r = run(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('baseline allows 2')
  })

  it('a NEW muted test in a NEW file fails even with a baseline present', () => {
    writeFileSync(legacyPath(), DISABLED_TEST(1))
    run(dir, ['--update-baseline'])
    writeFileSync(
      join(dir, 'src', 'test', 'java', 'com', 'example', 'FreshTest.java'),
      DISABLED_TEST(1).replace('LegacyTest', 'FreshTest'),
    )
    const r = run(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('FreshTest.java')
  })

  it('REMOVING muted tests never fails (count below baseline)', () => {
    writeFileSync(legacyPath(), DISABLED_TEST(3))
    run(dir, ['--update-baseline'])
    writeFileSync(legacyPath(), DISABLED_TEST(1))
    expect(run(dir).status).toBe(0)
  })

  it('an unparseable baseline fails CLOSED (exit 2), never silently disables the gate', () => {
    writeFileSync(legacyPath(), DISABLED_TEST(1))
    writeFileSync(join(dir, 'muted-tests-baseline.json'), '{ not json')
    const r = run(dir)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('invalid JSON')
  })

  it('the emitted empty baseline is equivalent to no baseline (strict)', () => {
    const data = makeConfig(dir, { language: 'java' }) as unknown as Record<string, unknown>
    writeFileSync(
      join(dir, 'muted-tests-baseline.json'),
      renderTemplate('scripts/muted-tests-baseline.json.ejs', data),
    )
    writeFileSync(legacyPath(), DISABLED_TEST(1))
    expect(run(dir).status).toBe(1)
  })

  it('--update-baseline with no muted tests writes an empty baseline and passes', () => {
    writeFileSync(
      join(dir, 'src', 'test', 'java', 'com', 'example', 'CleanTest.java'),
      'package com.example;\nimport org.junit.jupiter.api.Test;\nclass CleanTest { @Test void ok() {} }\n',
    )
    expect(run(dir, ['--update-baseline']).status).toBe(0)
    expect(existsSync(join(dir, 'muted-tests-baseline.json'))).toBe(true)
    expect(run(dir).status).toBe(0)
  })
})
