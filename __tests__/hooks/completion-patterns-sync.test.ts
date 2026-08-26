// The completion-claim trigger regex lives in two hooks (guard-task-completion,
// stop-evidence-guard) and their shipped templates. A paraphrased claim that one
// copy catches and another misses splits the guard surface — the #A11 drift class.
// This pins (a) all four copies carry the identical literal, and (b) the literal
// actually matches the paraphrases the guards exist to catch.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const FILES = [
  '.claude/hooks/guard-task-completion.mjs',
  'src/templates/claude/hooks/guard-task-completion.mjs.ejs',
  '.claude/hooks/stop-evidence-guard.mjs',
  'src/templates/claude/hooks/stop-evidence-guard.mjs.ejs',
]

function extractPattern(path: string): string {
  const src = readFileSync(join(root, path), 'utf-8')
  const m = src.match(/COMPLETION_PATTERNS\s*=\s*\n?\s*(\/.*\/i)/)
  if (!m) throw new Error(`no COMPLETION_PATTERNS literal in ${path}`)
  return m[1]
}

describe('completion-claim pattern sync', () => {
  it('all four copies carry the identical regex literal', () => {
    const patterns = FILES.map(extractPattern)
    for (const p of patterns.slice(1)) {
      expect(p).toBe(patterns[0])
    }
  })

  it('the shared pattern matches common completion paraphrases', () => {
    const literal = extractPattern(FILES[0])
    const body = literal.slice(1, literal.lastIndexOf('/'))
    const re = new RegExp(body, 'i')
    const claims = [
      'task complete, ready to merge',
      'task completed',
      'the task is done',
      'task finished',
      'work is done',
      'implementation is complete',
      'implementation done',
      'all phases complete',
      'pr merged',
      'merged to main',
      'wrapping up now',
      'ready to close',
      'shipped',
    ]
    for (const c of claims) {
      expect(re.test(c), `should match: ${c}`).toBe(true)
    }
  })

  it('the shared pattern does not match benign in-progress prompts', () => {
    const literal = extractPattern(FILES[0])
    const body = literal.slice(1, literal.lastIndexOf('/'))
    const re = new RegExp(body, 'i')
    const benign = [
      'can you help me refactor this function?',
      'the red test now fails for the right reason',
      'run the gate before we go further',
      'what remains before this can merge?',
    ]
    for (const c of benign) {
      expect(re.test(c), `should not match: ${c}`).toBe(false)
    }
  })
})
