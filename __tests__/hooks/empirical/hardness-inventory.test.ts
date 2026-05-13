import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(process.cwd())
const VERIFIER = join(REPO_ROOT, 'scripts/check-hardness-inventory.mjs')
const MANIFEST = join(REPO_ROOT, '.arbiter/hooks-manifest.json')

type ManifestEntry = { file: string; [k: string]: unknown }
type Manifest = { version: number; hooks: ManifestEntry[] }

function isManifest(v: unknown): v is Manifest {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['version'] === 'number' &&
    Array.isArray((v as Record<string, unknown>)['hooks'])
  )
}

function runVerifier(extraArgs: string[] = []) {
  return spawnSync('node', [VERIFIER, ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
}

describe('check-hardness-inventory', () => {
  it('passes on the real repo tree (all hooks match manifest, HARD hooks exit correctly)', () => {
    const result = runVerifier()
    if (result.status !== 0) {
      process.stderr.write(result.stdout + result.stderr)
    }
    expect(result.status).toBe(0)
  })

  it('fails when manifest references a non-existent hook file (drift detection)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-manifest-drift-'))
    try {
      const raw = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as unknown
      if (!isManifest(raw)) throw new Error('Invalid manifest shape')
      const manifest = raw
      const broken: Manifest = {
        ...manifest,
        hooks: [
          ...manifest.hooks,
          {
            file: 'ghost-hook-that-does-not-exist.mjs',
            classification: 'HARD',
            spawnable: true,
            expectedExitCode: 1,
            fixture: { type: 'env-only', env: {} },
            rationale: 'synthetic drift test',
          },
        ],
      }
      const brokenManifestPath = join(tmpDir, 'hooks-manifest.json')
      writeFileSync(brokenManifestPath, JSON.stringify(broken, null, 2))

      const result = runVerifier(['--manifest', brokenManifestPath])
      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toMatch(/ghost-hook|not found|drift/i)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('fails when a HARD spawnable hook exits 0 on known violation (ceremony regression)', () => {
    // Use a synthetic single-entry manifest pointing only to ssot-guard,
    // so drift detection passes (exactly one file, one entry) and only the
    // empirical exit-code assertion fires — confirming ceremony regression detection.
    const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-hook-regression-'))
    try {
      const fakeHooksDir = join(tmpDir, 'hooks')
      mkdirSync(fakeHooksDir, { recursive: true })
      writeFileSync(
        join(fakeHooksDir, 'pre-edit-ssot-guard.mjs'),
        '#!/usr/bin/env node\n// FAKE: always exits 0 (ceremony regression)\nprocess.exit(0);\n',
      )

      const raw = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as unknown
      if (!isManifest(raw)) throw new Error('Invalid manifest shape')
      const manifest = raw
      const ssotEntry = manifest.hooks.find((h) => h.file === 'pre-edit-ssot-guard.mjs')
      const syntheticManifest: Manifest = {
        version: 1,
        hooks: ssotEntry ? [ssotEntry] : [],
      }
      const syntheticManifestPath = join(tmpDir, 'hooks-manifest.json')
      writeFileSync(syntheticManifestPath, JSON.stringify(syntheticManifest, null, 2))

      const result = runVerifier(['--manifest', syntheticManifestPath, '--hooks-dir', fakeHooksDir])
      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toMatch(/ceremony regression|hardness-drift/i)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
