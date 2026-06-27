import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'
import { parsePinnedNpm, planDriftCheck } from '../../scripts/check-npm-ci-drift.mjs'

const SCRIPT = resolve('scripts/check-npm-ci-drift.mjs')

type RunResult = { status: number; stdout: string; stderr: string }

function runDrift(root: string): RunResult {
  const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'npm-ci-drift-'))
}

// Build an in-sync (no-deps) lockfile in `root` for the given package.json object,
// using the PINNED npm so the fixture matches what the gate validates against.
function relock(root: string, pkg: Record<string, unknown>): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2))
  const r = spawnSync('npx', ['-y', 'npm@10', 'install', '--package-lock-only'], {
    cwd: root,
    encoding: 'utf-8',
  })
  if (r.status !== 0) throw new Error(`relock failed: ${r.stderr}`)
}

describe('check-npm-ci-drift — pure logic', () => {
  it('parsePinnedNpm extracts the version from an npm@X.Y.Z spec', () => {
    expect(parsePinnedNpm('npm@10.9.8')).toBe('10.9.8')
    expect(parsePinnedNpm(' npm@10.9.8 ')).toBe('10.9.8')
  })

  it('parsePinnedNpm rejects non-npm / malformed specs', () => {
    expect(parsePinnedNpm('pnpm@9.0.0')).toBeNull()
    expect(parsePinnedNpm('npm@^10')).toBeNull()
    expect(parsePinnedNpm('npm')).toBeNull()
    expect(parsePinnedNpm(undefined)).toBeNull()
    expect(parsePinnedNpm(42 as unknown as string)).toBeNull()
  })

  it('planDriftCheck returns NA when there is no package.json', () => {
    const plan = planDriftCheck({
      hasPackageJson: false,
      hasLock: false,
      pkg: null,
      parseError: false,
    })
    expect(plan.action).toBe('na')
  })

  it('planDriftCheck returns NA when there is no lockfile', () => {
    const plan = planDriftCheck({
      hasPackageJson: true,
      hasLock: false,
      pkg: { packageManager: 'npm@10.9.8' },
      parseError: false,
    })
    expect(plan.action).toBe('na')
  })

  it('planDriftCheck returns error (exit 2) on an unreadable package.json', () => {
    const plan = planDriftCheck({
      hasPackageJson: true,
      hasLock: true,
      pkg: null,
      parseError: true,
    })
    expect(plan.action).toBe('error')
  })

  it('planDriftCheck FAILs when the packageManager pin is missing (#1684)', () => {
    const plan = planDriftCheck({ hasPackageJson: true, hasLock: true, pkg: {}, parseError: false })
    expect(plan.action).toBe('fail')
  })

  it('planDriftCheck schedules a check when a pin and lockfile are present', () => {
    const plan = planDriftCheck({
      hasPackageJson: true,
      hasLock: true,
      pkg: { packageManager: 'npm@10.9.8' },
      parseError: false,
    })
    expect(plan.action).toBe('check')
    expect(plan.npmVersion).toBe('10.9.8')
  })
})

describe('check-npm-ci-drift — CLI exit contract (INV-53)', () => {
  it('exits 0 (NA) on a directory with no package.json', () => {
    const root = makeRoot()
    try {
      expect(runDrift(root).status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('exits 1 when the packageManager pin is missing but a lockfile exists', () => {
    const root = makeRoot()
    try {
      relock(root, { name: 'nopin', version: '1.0.0' })
      const r = runDrift(root)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('packageManager')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // reproduce-RED (#1684): the gate must FAIL on a lock that is out of sync with
  // package.json under the PINNED npm — the exact npm-10-vs-npm-11 skew that broke CI.
  it('exits 1 (drift) on a deliberately-skewed lockfile, exit 0 once relocked', () => {
    const root = makeRoot()
    try {
      // GREEN: in-sync, dependency-free lock under the pinned npm.
      relock(root, { name: 'drift', version: '1.0.0', packageManager: 'npm@10.9.8' })
      expect(runDrift(root).status).toBe(0)

      // RED: declare a dependency that the committed lock does not contain → drift.
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
          {
            name: 'drift',
            version: '1.0.0',
            packageManager: 'npm@10.9.8',
            dependencies: { 'left-pad': '1.3.0' },
          },
          null,
          2,
        ),
      )
      const red = runDrift(root)
      expect(red.status).toBe(1)
      expect(red.stderr).toContain('out of sync')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// #1684 dual-track: the inline npm-ci drift block is mirrored into the generated TS
// gate (SKIP-neutral) and absent for non-npm stacks.
describe('check-npm-ci-drift — generated gate mirror (#1684)', () => {
  it('TypeScript generated check-all contains the inline npm-ci drift block', () => {
    const dir = makeRoot()
    try {
      generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          buildTool: 'npm',
          governanceLevel: 'L1',
          enableSecurityScanning: false,
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain('[CHECK] npm-ci drift')
      expect(content).toContain('packageManager')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('non-npm (Go) generated check-all does NOT contain the drift block', () => {
    const dir = makeRoot()
    try {
      generateCheckAll(
        makeConfig(dir, {
          language: 'go',
          buildTool: 'go',
          governanceLevel: 'L1',
          enableSecurityScanning: false,
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain('[CHECK] npm-ci drift')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
