import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

function configFor() {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
    buildTool: 'npm',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
  })
}

function sha256(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex')
}

const DONE_CLAIM_PROMPT = 'task complete, ready to merge'
const BENIGN_PROMPT = 'can you explain this function?'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-done-evidence-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })

  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })

  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', configFor()))

  const hookPath = join(hooksDir, 'guard-done-evidence.mjs')
  writeFileSync(hookPath, renderTemplate('claude/hooks/guard-done-evidence.mjs.ejs', configFor()))

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
  } = {},
) {
  const {
    all_green = true,
    pinnedContent = 'export const answer = 42;\n',
    pinnedPath = 'src/main.ts',
    includePinnedFiles = true,
  } = opts

  const evidence = {
    version: 1,
    captured_at: new Date().toISOString(),
    task_id: '#407',
    all_green,
    gate_level: 'L2',
    pinned_files: includePinnedFiles ? [{ path: pinnedPath, sha256: sha256(pinnedContent) }] : [],
  }

  writeFileSync(join(dir, '.claude', '.last-done-evidence.json'), JSON.stringify(evidence, null, 2))
}

function runHook(hookPath: string, dir: string, prompt: string) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    input: JSON.stringify({ prompt }),
    encoding: 'utf-8',
  })
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
