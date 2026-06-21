import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig } from '../../helpers.js'

const TPL_DIR = join(process.cwd(), 'src/templates/claude/hooks')

// The hook now imports resolveToolInputPath from ./lib.mjs, so it must be spawned from a
// directory where lib.mjs is a sibling. Materialize hook + rendered lib.mjs into a temp dir;
// the hook anchors SSOT paths to the git repo root (cwd), so we keep cwd = the arbiter repo.
let HOOK = ''
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-ssot-guard-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'lib.mjs'),
    renderTemplate(
      'claude/hooks/lib.mjs.ejs',
      makeConfig(process.cwd(), { projectName: 'arbiter' }),
    ),
  )
  HOOK = join(dir, 'pre-edit-ssot-guard.mjs')
  writeFileSync(HOOK, readFileSync(join(TPL_DIR, 'pre-edit-ssot-guard.mjs'), 'utf-8'))
})

function run(filePath: string, extraEnv: Record<string, string> = {}) {
  // Strip ARBITER_SSOT_BYPASS from inherited env so the hook runs in its
  // natural enforced state unless the test explicitly overrides it.
  const baseEnv = { ...process.env }
  delete baseEnv['ARBITER_SSOT_BYPASS']
  return spawnSync('node', [HOOK], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    // Empty stdin so resolveToolInputPath falls back to the env var (the contract this
    // test exercises); a non-empty CLAUDE_TOOL_INPUT_PATH still drives the path.
    input: '',
    env: { ...baseEnv, CLAUDE_TOOL_INPUT_PATH: filePath, ...extraEnv },
  })
}

describe('pre-edit-ssot-guard', () => {
  it('exits 2 when editing AGENTS.md', () => {
    const result = run('AGENTS.md')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('SSOT GUARD')
  })

  it('exits 2 when editing .claude/CLAUDE.md', () => {
    const result = run('.claude/CLAUDE.md')
    expect(result.status).toBe(2)
  })

  it('exits 2 when editing docs/SYSTEM/DECISIONS.md', () => {
    const result = run('docs/SYSTEM/DECISIONS.md')
    expect(result.status).toBe(2)
  })

  it('exits 2 when editing docs/SYSTEM/CANON.md', () => {
    const result = run('docs/SYSTEM/CANON.md')
    expect(result.status).toBe(2)
  })

  it('exits 0 for non-SSOT files', () => {
    const result = run('src/commands/init.ts')
    expect(result.status).toBe(0)
  })

  it('exits 0 when ARBITER_SSOT_BYPASS=1 even on SSOT file', () => {
    const result = run('AGENTS.md', { ARBITER_SSOT_BYPASS: '1' })
    expect(result.status).toBe(0)
  })

  it('exits 0 for AGENTS.md outside the repo root (#173 repoRoot anchor)', () => {
    // Simulate an absolute path to an AGENTS.md in a completely different directory
    const result = run('/tmp/other-project/AGENTS.md')
    expect(result.status).toBe(0)
  })

  it('exits 2 for absolute path to AGENTS.md inside repo root (#173)', () => {
    const repoRoot = process.cwd()
    const result = run(join(repoRoot, 'AGENTS.md'))
    expect(result.status).toBe(2)
  })
})
