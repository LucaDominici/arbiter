import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'
import type { Archetype } from '../../../src/wizard/types.js'

interface RealityContactBlock {
  archetype: string
  required: boolean
  suite: string
  recorded_at: string
  passed: boolean
}

function configFor(archetype: Archetype = 'library') {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
    buildTool: 'npm',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
    archetype,
  })
}

function sha256(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex')
}

const DONE_CLAIM_PROMPT = 'task complete, ready to merge'
const BENIGN_PROMPT = 'can you explain this function?'

function setup(archetype: Archetype = 'library') {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-done-evidence-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })

  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })

  writeFileSync(
    join(hooksDir, 'lib.mjs'),
    renderTemplate('claude/hooks/lib.mjs.ejs', configFor(archetype)),
  )

  const hookPath = join(hooksDir, 'guard-done-evidence.mjs')
  writeFileSync(
    hookPath,
    renderTemplate('claude/hooks/guard-done-evidence.mjs.ejs', configFor(archetype)),
  )

  writeTaskStateFile(dir, { phase: 'verification', tier: 'Standard', taskId: '#407' })

  // Create a representative pinned file
  const srcDir = join(dir, 'src')
  mkdirSync(srcDir, { recursive: true })
  const pinnedContent = 'export const answer = 42;\n'
  writeFileSync(join(srcDir, 'main.ts'), pinnedContent)

  return { dir, hookPath, pinnedContent }
}

function writeEvidence(
  dir: string,
  opts: {
    all_green?: boolean
    pinnedContent?: string
    pinnedPath?: string
    includePinnedFiles?: boolean
    reality_contact?: RealityContactBlock | null
    includeRealityContact?: boolean
  } = {},
) {
  const {
    all_green = true,
    pinnedContent = 'export const answer = 42;\n',
    pinnedPath = 'src/main.ts',
    includePinnedFiles = true,
    reality_contact,
    includeRealityContact = false,
  } = opts

  const evidence: Record<string, unknown> = {
    version: 1,
    captured_at: new Date().toISOString(),
    task_id: '#407',
    all_green,
    gate_level: 'L2',
    pinned_files: includePinnedFiles ? [{ path: pinnedPath, sha256: sha256(pinnedContent) }] : [],
  }

  if (includeRealityContact) {
    evidence.reality_contact = reality_contact ?? null
  }

  writeFileSync(join(dir, '.claude', '.last-done-evidence.json'), JSON.stringify(evidence, null, 2))
}

function runHook(
  hookPath: string,
  dir: string,
  prompt: string,
  // env is the dogfood activation switch (#1872): default ON so the pre-existing
  // enforcement tests keep exercising the guard; inert-case tests pass an explicit
  // override. A bare `{}` clears the env var so the hook falls through to arbiter.json.
  envOverride: Record<string, string> = { ARBITER_EVIDENCE_HARNESS: '1' },
) {
  const baseEnv = { ...process.env }
  delete baseEnv.ARBITER_EVIDENCE_HARNESS
  return spawnSync('node', [hookPath], {
    cwd: dir,
    input: JSON.stringify({ prompt }),
    encoding: 'utf-8',
    env: { ...baseEnv, ...envOverride },
  })
}

function writeArbiterConfig(dir: string, evidenceHarness: boolean) {
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify({ features: { evidenceHarness } }, null, 2),
  )
}

describe('guard-done-evidence — empirical spawn', () => {
  it('exits 2 on done claim when evidence file is missing', () => {
    const { dir, hookPath } = setup()
    try {
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/missing|not found/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when all_green is false', () => {
    const { dir, hookPath } = setup()
    try {
      writeEvidence(dir, { all_green: false })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/all_green.*false|gate.*fail/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when a pinned file SHA does not match current tree', () => {
    const { dir, hookPath } = setup()
    try {
      // Capture evidence with original content
      writeEvidence(dir, { pinnedContent: 'original content\n' })
      // Then modify the pinned file (drift)
      writeFileSync(join(dir, 'src', 'main.ts'), 'modified content\n')

      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/sha.*mismatch|drift|modified/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when a pinned file listed in evidence does not exist on disk', () => {
    const { dir, hookPath } = setup()
    try {
      writeEvidence(dir, { pinnedPath: 'src/ghost.ts' })

      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/ghost\.ts|not found|missing/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when evidence is valid and all SHAs match', () => {
    const { dir, hookPath, pinnedContent } = setup()
    try {
      writeEvidence(dir, { all_green: true, pinnedContent })

      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 on benign prompt regardless of evidence state', () => {
    const { dir, hookPath } = setup()
    try {
      // No evidence file at all — but prompt is benign, so no check
      const result = runHook(hookPath, dir, BENIGN_PROMPT)
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when pinned_files is empty (no files were pinned)', () => {
    const { dir, hookPath } = setup()
    try {
      writeEvidence(dir, { all_green: true, includePinnedFiles: false })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/empty|no pinned/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 on done claim when phase is not verification (phase guard)', () => {
    const { dir, hookPath } = setup()
    try {
      // Overwrite phase to a non-verification phase — hook should stand down
      writeTaskStateFile(dir, { phase: 'green', tier: 'Standard', taskId: '#407' })
      // No evidence file — but hook should exit 0 because phase guard fires first
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('guard-done-evidence — reality-contact (backend-web-db)', () => {
  it('exits 2 when reality_contact block is missing for backend-web-db', () => {
    const { dir, hookPath, pinnedContent } = setup('backend-web-db')
    try {
      writeEvidence(dir, { all_green: true, pinnedContent })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/reality.contact/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when reality_contact.suite is wrong for backend-web-db', () => {
    const { dir, hookPath, pinnedContent } = setup('backend-web-db')
    try {
      writeEvidence(dir, {
        all_green: true,
        pinnedContent,
        includeRealityContact: true,
        reality_contact: {
          archetype: 'backend-web-db',
          required: true,
          suite: 'render-smoke',
          recorded_at: new Date().toISOString(),
          passed: true,
        },
      })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/live-api-e2e/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when reality_contact.passed is false for backend-web-db', () => {
    const { dir, hookPath, pinnedContent } = setup('backend-web-db')
    try {
      writeEvidence(dir, {
        all_green: true,
        pinnedContent,
        includeRealityContact: true,
        reality_contact: {
          archetype: 'backend-web-db',
          required: true,
          suite: 'live-api-e2e',
          recorded_at: new Date().toISOString(),
          passed: false,
        },
      })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/passed.*false|false.*passed/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 with valid reality_contact for backend-web-db', () => {
    const { dir, hookPath, pinnedContent } = setup('backend-web-db')
    try {
      writeEvidence(dir, {
        all_green: true,
        pinnedContent,
        includeRealityContact: true,
        reality_contact: {
          archetype: 'backend-web-db',
          required: true,
          suite: 'live-api-e2e',
          recorded_at: new Date().toISOString(),
          passed: true,
        },
      })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('guard-done-evidence — reality-contact (frontend-spa)', () => {
  it('exits 2 when reality_contact block is missing for frontend-spa', () => {
    const { dir, hookPath, pinnedContent } = setup('frontend-spa')
    try {
      writeEvidence(dir, { all_green: true, pinnedContent })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/reality.contact/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when reality_contact.suite is wrong for frontend-spa', () => {
    const { dir, hookPath, pinnedContent } = setup('frontend-spa')
    try {
      writeEvidence(dir, {
        all_green: true,
        pinnedContent,
        includeRealityContact: true,
        reality_contact: {
          archetype: 'frontend-spa',
          required: true,
          suite: 'live-api-e2e',
          recorded_at: new Date().toISOString(),
          passed: true,
        },
      })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/render-smoke|visual-regression/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when reality_contact.passed is false for frontend-spa', () => {
    const { dir, hookPath, pinnedContent } = setup('frontend-spa')
    try {
      writeEvidence(dir, {
        all_green: true,
        pinnedContent,
        includeRealityContact: true,
        reality_contact: {
          archetype: 'frontend-spa',
          required: true,
          suite: 'render-smoke',
          recorded_at: new Date().toISOString(),
          passed: false,
        },
      })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
      expect(result.stderr).toMatch(/passed.*false|false.*passed/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 with valid reality_contact for frontend-spa', () => {
    const { dir, hookPath, pinnedContent } = setup('frontend-spa')
    try {
      writeEvidence(dir, {
        all_green: true,
        pinnedContent,
        includeRealityContact: true,
        reality_contact: {
          archetype: 'frontend-spa',
          required: true,
          suite: 'render-smoke',
          recorded_at: new Date().toISOString(),
          passed: true,
        },
      })
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT)
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('guard-done-evidence — flag gate (#1872)', () => {
  // The hook is materialized for dogfood regardless of the flag, but must stay
  // inert (exit 0) until features.evidenceHarness is true. The flag is the
  // owner-flippable one-line switch; env ARBITER_EVIDENCE_HARNESS overrides for
  // testing/CI. See issue #1872 safe-path step 2.

  it('is inert (exit 0) when ARBITER_EVIDENCE_HARNESS=0, even on a done claim with no evidence', () => {
    const { dir, hookPath } = setup()
    try {
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT, { ARBITER_EVIDENCE_HARNESS: '0' })
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is inert when env unset and no arbiter.json exists (fail-open)', () => {
    const { dir, hookPath } = setup()
    try {
      // {} clears the env var — hook falls through to arbiter.json, which is absent
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT, {})
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is inert when arbiter.json has features.evidenceHarness: false', () => {
    const { dir, hookPath } = setup()
    try {
      writeArbiterConfig(dir, false)
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT, {})
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('enforces (exit 2) when arbiter.json has features.evidenceHarness: true and evidence is missing', () => {
    const { dir, hookPath } = setup()
    try {
      writeArbiterConfig(dir, true)
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT, {})
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('env=0 overrides arbiter.json: true → inert', () => {
    const { dir, hookPath } = setup()
    try {
      writeArbiterConfig(dir, true)
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT, { ARBITER_EVIDENCE_HARNESS: '0' })
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('env=1 overrides arbiter.json: false → enforces', () => {
    const { dir, hookPath } = setup()
    try {
      writeArbiterConfig(dir, false)
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT, { ARBITER_EVIDENCE_HARNESS: '1' })
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/DONE EVIDENCE/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('flag gate fires before the phase guard: inert even in verification with a done claim', () => {
    const { dir, hookPath } = setup()
    try {
      // phase is already 'verification' from setup(); no evidence file present.
      // With the flag off, the hook must exit 0 WITHOUT touching evidence checks.
      const result = runHook(hookPath, dir, DONE_CLAIM_PROMPT, { ARBITER_EVIDENCE_HARNESS: '0' })
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
