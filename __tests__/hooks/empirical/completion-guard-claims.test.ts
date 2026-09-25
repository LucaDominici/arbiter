import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

// #2885 review: free-text negation/quotation heuristics failed open. A genuine
// completion claim must block whatever unrelated negation or apostrophes surround it.

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

const PRODUCERS = ['self', 'emitted'] as const

function setup(producer: (typeof PRODUCERS)[number]) {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-completion-claims-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', configFor()))
  const hookPath = join(hooksDir, 'guard-task-completion.mjs')
  writeFileSync(
    hookPath,
    producer === 'self'
      ? readFileSync(join(process.cwd(), '.claude/hooks/guard-task-completion.mjs'))
      : renderTemplate('claude/hooks/guard-task-completion.mjs.ejs', configFor()),
  )
  writeTaskStateFile(dir, { phase: 'refactor', tier: 'Standard', taskId: 'claims-task' })
  return { dir, hookPath }
}

const REPRODUCTIONS = [
  'There are no open issues; implementation complete.',
  "I'm done; task complete; I'm signing off.",
]

describe('#2885 completion guard — reviewer reproductions stay blocked', () => {
  for (const producer of PRODUCERS) {
    it.each(REPRODUCTIONS)(`${producer} exits 2 in refactor: %s`, (text) => {
      const { dir, hookPath } = setup(producer)
      try {
        const result = spawnSync('node', [hookPath], {
          cwd: dir,
          input: JSON.stringify({
            hook_event_name: 'Stop',
            session_id: 'claims-session',
            cwd: dir,
            last_assistant_message: text,
            stop_hook_active: false,
          }),
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env, ARBITER_SKIP_TDD: '1' },
        })
        expect(result.status).toBe(2)
        expect(result.stderr).toContain('COMPLETION GUARD')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
