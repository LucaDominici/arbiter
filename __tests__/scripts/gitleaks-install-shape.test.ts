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
