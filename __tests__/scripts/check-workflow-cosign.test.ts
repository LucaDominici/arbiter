import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-workflow-cosign.mjs')

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeFixture(overrides: {
  releaseContent?: string
  prodContent?: string
  cosignCopyContent?: string
}): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cosign-test-'))
  const wf = join(dir, 'src', 'templates', 'github', 'workflows')
  const cc = join(wf, '_cosign-copy')
  mkdirSync(cc, { recursive: true })

  const VALID_RELEASE = 'steps:\n  - run: cosign sign --yes $IMAGE\n'
  const VALID_PROD =
    'on:\n  release:\n    types: [published]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n'
  const VALID_COPY =
    'steps:\n  - run: |\n      cosign verify \\\n        --certificate-identity-regexp="https://github.com" \\\n        --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \\\n        $IMAGE\n      cosign copy $IMAGE $TARGET\n'

  writeFileSync(join(wf, '05-release.yml.ejs'), overrides.releaseContent ?? VALID_RELEASE)
  writeFileSync(join(wf, '10-deploy-prod.yml.ejs'), overrides.prodContent ?? VALID_PROD)
  writeFileSync(join(cc, 'sample.ejs'), overrides.cosignCopyContent ?? VALID_COPY)

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-workflow-cosign.mjs (INV-95/97/98)', () => {
  it('exits 0 when all cosign supply-chain invariants satisfied', () => {
    const { dir, cleanup } = makeFixture({})
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 2 when workflow templates directory missing (fail-closed, INV-53)', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'cosign-empty-'))
    try {
      const result = run(emptyDir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('ERROR')
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('exits 2 when _cosign-copy directory is empty (fail-closed, INV-53)', () => {
    // Build a fixture without _cosign-copy/*.ejs files
    const dir = mkdtempSync(join(tmpdir(), 'cosign-nocopy-'))
    try {
      const wf = join(dir, 'src', 'templates', 'github', 'workflows')
      mkdirSync(join(wf, '_cosign-copy'), { recursive: true })
      writeFileSync(join(wf, '05-release.yml.ejs'), 'cosign sign $IMAGE\n')
      writeFileSync(join(wf, '10-deploy-prod.yml.ejs'), 'on:\n  release:\n    types: [published]\n')
      // _cosign-copy/ exists but has no .ejs files
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('ERROR')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // INV-95: 05-release.yml.ejs must invoke `cosign sign ` (with trailing space)
  it('exits 1 when 05-release.yml.ejs lacks cosign sign step [INV-95]', () => {
    const { dir, cleanup } = makeFixture({
      releaseContent: 'steps:\n  - run: cosign sign-blob --yes artifact.json\n',
    })
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-95')
    } finally {
      cleanup()
    }
  })

  // INV-98: 10-deploy-prod.yml.ejs must contain release: trigger
  it('exits 1 when 10-deploy-prod.yml.ejs lacks release: trigger [INV-98]', () => {
    const { dir, cleanup } = makeFixture({
      prodContent: 'on:\n  workflow_dispatch:\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n',
    })
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-98')
    } finally {
      cleanup()
    }
  })

  // INV-98: push.branches trigger must be absent from top-30-line header
  it('exits 1 when 10-deploy-prod.yml.ejs has branches: trigger in on: block [INV-98]', () => {
    const { dir, cleanup } = makeFixture({
      prodContent:
        'on:\n  release:\n    types: [published]\n  push:\n    branches:\n      - main\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n',
    })
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-98')
    } finally {
      cleanup()
    }
  })

  // INV-97: each _cosign-copy/*.ejs must contain cosign verify
  it('exits 1 when _cosign-copy partial lacks cosign verify [INV-97]', () => {
    const { dir, cleanup } = makeFixture({
      cosignCopyContent: 'steps:\n  - run: |\n      cosign copy $IMAGE $TARGET\n',
    })
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-97')
    } finally {
      cleanup()
    }
  })

  // INV-97: --certificate-identity-regexp flag required
  it('exits 1 when _cosign-copy partial missing --certificate-identity-regexp [INV-97]', () => {
    const { dir, cleanup } = makeFixture({
      cosignCopyContent:
        'steps:\n  - run: |\n      cosign verify \\\n        --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \\\n        $IMAGE\n      cosign copy $IMAGE $TARGET\n',
    })
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-97')
      expect(result.stderr).toContain('certificate-identity-regexp')
    } finally {
      cleanup()
    }
  })

  // INV-97: cosign copy required (not docker/crane tag)
  it('exits 1 when _cosign-copy partial uses docker tag instead of cosign copy [INV-97]', () => {
    const { dir, cleanup } = makeFixture({
      cosignCopyContent:
        'steps:\n  - run: |\n      cosign verify \\\n        --certificate-identity-regexp="https://github.com" \\\n        --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \\\n        $IMAGE\n      docker tag $IMAGE $TARGET\n',
    })
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-97')
      expect(result.stderr).toContain('cosign copy')
    } finally {
      cleanup()
    }
  })
})
