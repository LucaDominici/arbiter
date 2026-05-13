import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runReviewPlan } from '../../src/commands/review.js'
import { buildReviewPrompt, type SubagentDispatcher } from '../../src/review/dispatch.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(__dirname, '..', 'fixtures', 'plans')

function withProjectDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-review-cmd-'))
  writeFileSync(join(dir, 'AGENTS.md'), '# project agents\n')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function disp(verdict: 'PASS' | 'WARN' | 'FAIL'): SubagentDispatcher {
  return {
    run: () => ({ stdout: `verdict: ${verdict}\n`, exitCode: 0 }),
  }
}

describe('runReviewPlan (#235)', () => {
  let env: ReturnType<typeof withProjectDir>
  beforeEach(() => {
    env = withProjectDir()
  })
  afterEach(() => env.cleanup())

  it('returns exit code 0 for pass fixture', () => {
    const result = runReviewPlan({
      file: join(FIXTURES, 'pass.md'),
      dir: env.dir,
      dispatcher: disp('PASS'),
    })
    expect(result.exitCode).toBe(0)
    expect(result.verdict).toBe('PASS')
  })

  it('returns exit code 1 for warn fixture', () => {
    const result = runReviewPlan({
      file: join(FIXTURES, 'warn.md'),
      dir: env.dir,
      dispatcher: disp('WARN'),
    })
    expect(result.exitCode).toBe(1)
  })

  it('returns exit code 2 for fail fixture', () => {
    const result = runReviewPlan({
      file: join(FIXTURES, 'fail.md'),
      dir: env.dir,
      dispatcher: disp('FAIL'),
    })
    expect(result.exitCode).toBe(2)
    expect(result.verdict).toBe('FAIL')
  })

  it('returns exit code 2 with ERROR verdict when file is missing', () => {
    const result = runReviewPlan({
      file: join(env.dir, 'nonexistent.md'),
      dir: env.dir,
      dispatcher: disp('PASS'),
    })
    expect(result.exitCode).toBe(2)
    expect(result.verdict).toBe('ERROR')
  })

  it('buildReviewPrompt embeds the real pass.md fixture verbatim (W-5)', () => {
    // Snapshot lock for the XML prompt builder against a known fixture.
    // Any future regression in escapeXml, tier wiring, or envelope shape
    // surfaces here.
    const planContent = readFileSync(join(FIXTURES, 'pass.md'), 'utf-8')
    const prompt = buildReviewPrompt({
      planContent,
      dir: env.dir,
      tier: 'Standard',
    })
    // Envelope frame
    expect(prompt).toMatch(/^<review version="1">/)
    expect(prompt).toMatch(/<\/review>$/)
    // Tier + passCount wiring
    expect(prompt).toContain('<tier>Standard</tier>')
    expect(prompt).toMatch(/<passCount>\d+<\/passCount>/)
    // SSOT digest is a real SHA-256 (64 hex), not the all-zeros fallback
    expect(prompt).toMatch(/<ssotDigest>[0-9a-f]{64}<\/ssotDigest>/)
    expect(prompt).not.toContain('<ssotDigest>' + '0'.repeat(64))
    // Fixture text appears inside the <plan> block (escaping leaves
    // alphanumerics untouched)
    expect(prompt).toContain('Add user-profile endpoint')
    expect(prompt).toContain('assertTenantOwns(userId)')
  })
})
