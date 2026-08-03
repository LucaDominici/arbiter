import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
describe('#987 gitleaks install uses RUNNER_TEMP not /usr/local/bin', () => {
  it('rendered 01-pr-fast.yml installs gitleaks to $RUNNER_TEMP/bin', () => {
    const yml = readFileSync('.github/workflows/01-pr-fast.yml', 'utf-8')
    expect(yml).toMatch(/RUNNER_TEMP\/bin/)
    expect(yml).toMatch(/GITHUB_PATH/)
    expect(yml).not.toMatch(/-C \/usr\/local\/bin gitleaks/)
  })
  it('ejs template uses RUNNER_TEMP not /usr/local/bin', () => {
    const ejs = readFileSync('src/templates/github/workflows/01-pr-fast.yml.ejs', 'utf-8')
    expect(ejs).toMatch(/RUNNER_TEMP\/bin/)
    expect(ejs).not.toMatch(/-C \/usr\/local\/bin gitleaks/)
  })
})

// #2100: gitleaks-action downloads to a HARDCODED /tmp/gitleaks.tmp. On the self-hosted
// runner /tmp survives between jobs, so a leftover from an interrupted download makes
// every later install fail after both internal retries:
//   "Destination file path /tmp/gitleaks.tmp already exists" → "parameter 'file' is required"
// (nightly run 30781101329, job "Secret scan (full history)"). Every site that uses the
// action must clear the stale file first.
describe('#2100 gitleaks-action sites clear the stale /tmp/gitleaks.tmp first', () => {
  const SITES = [
    '.github/workflows/_nightly.yml',
    '.github/workflows/05-release.yml',
    'src/templates/github/workflows/_nightly.yml.ejs',
    'src/templates/github/workflows/05-release.yml.ejs',
    'src/templates/github/workflows/07-weekly-lite.yml.ejs',
  ]

  it.each(SITES)('%s removes /tmp/gitleaks.tmp before every gitleaks-action use', (file) => {
    const content = readFileSync(file, 'utf-8')
    const actionUses = content.match(/uses:\s*gitleaks\/gitleaks-action@/g) ?? []
    expect(actionUses.length).toBeGreaterThan(0)
    const guards = content.match(/rm -f \/tmp\/gitleaks\.tmp/g) ?? []
    expect(guards.length).toBe(actionUses.length)
  })
})
