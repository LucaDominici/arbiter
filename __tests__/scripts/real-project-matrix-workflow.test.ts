import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readWorkflow(): string {
  return readFileSync(resolve('.github/workflows/real-project-matrix.yml'), 'utf-8')
}

describe('real-project-matrix workflow regressions', () => {
  it('grants actions: read so the aggregate job can query workflow jobs', () => {
    const content = readWorkflow()
    expect(content).toContain('permissions:')
    expect(content).toContain('actions: read')
    expect(content).toContain('contents: read')
  })

  it('pins setup-gradle to a concrete Gradle version for Java fixtures', () => {
    const content = readWorkflow()
    expect(content).toContain('uses: gradle/actions/setup-gradle@')
    expect(content).toMatch(/gradle-version:\s*['"]8\.8['"]/)
  })

  it('installs all extra L2 tools that the generated gates invoke', () => {
    const content = readWorkflow()

    expect(content).toContain("if: matrix.language == 'go' && matrix.level == 'L2'")
    expect(content).toContain('name: Install Go L2 analysis tools')
    expect(content).toContain('staticcheck')
    expect(content).toContain('govulncheck')

    expect(content).toContain("if: matrix.language == 'python' && matrix.level == 'L2'")
    expect(content).toContain('name: Install Python L2 analysis tools')
    expect(content).toContain('pip install pip-audit pytest-cov')

    expect(content).toContain("if: matrix.language == 'rust' && matrix.level == 'L2'")
    expect(content).toContain('name: Install Rust L2 analysis tools')
    expect(content).toContain('cargo install cargo-audit --locked')
    expect(content).toContain('cargo-tarpaulin')

    expect(content).toContain("if: matrix.level == 'L2'")
    expect(content).toContain('name: Install gitleaks')
    expect(content).toContain('gitleaks_')
  })
})
