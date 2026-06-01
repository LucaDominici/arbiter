import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { makeConfig } from '../helpers.js'

describe('generateGithub', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates CI workflow, PR template, issue templates, dependabot, and issue-state', () => {
    const result = generateGithub(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.includes('01-pr-fast.yml'))).toBe(true)
    expect(paths.some((p) => p.includes('PULL_REQUEST_TEMPLATE.md'))).toBe(true)
    expect(paths.some((p) => p.includes('dependabot.yml'))).toBe(true)
    expect(paths.some((p) => p.includes('bug-report.yml'))).toBe(true)
    expect(paths.some((p) => p.includes('issue-state.yml'))).toBe(true)
  })

  it('issue-state.yml contains state transition steps', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'workflows', 'issue-state.yml'), 'utf-8')
    expect(content).toContain('Extract linked issue number')
    expect(content).toContain('→ In Review')
    expect(content).toContain('→ Done')
  })

  it('CI workflow contains TypeScript-specific steps', () => {
    generateGithub(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    // #1131: setup-node + `npm ci` is now the setup-node-pnpm composite (the
    // install runs inside the action, not inline in the workflow).
    expect(content).toContain('./.github/actions/setup-node-pnpm')
    expect(content).toContain('test:unit')
  })

  it('CI workflow contains Java-specific steps', () => {
    generateGithub(makeConfig(dir, { language: 'java', buildTool: 'gradle' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).toContain('gradlew')
    expect(content).toContain('setup-java')
  })

  it('creates all expected issue template files', () => {
    generateGithub(makeConfig(dir))
    const templateDir = join(dir, '.github', 'ISSUE_TEMPLATE')
    expect(existsSync(join(templateDir, 'bug-report.yml'))).toBe(true)
    expect(existsSync(join(templateDir, 'feature-request.yml'))).toBe(true)
    expect(existsSync(join(templateDir, 'task-brief.yml'))).toBe(true)
    expect(existsSync(join(templateDir, 'config.yml'))).toBe(true)
  })

  it('dependabot.yml contains npm ecosystem for TypeScript', () => {
    generateGithub(makeConfig(dir, { language: 'typescript', buildTool: 'npm' }))
    const content = readFileSync(join(dir, '.github', 'dependabot.yml'), 'utf-8')
    expect(content).toContain('npm')
    expect(content).toContain('github-actions')
  })
})

describe('task-brief governance gating', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-taskbrief-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('L1 task-brief omits Engineering Invariants and Forbidden Patterns', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    const content = readFileSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'task-brief.yml'), 'utf-8')
    expect(content).not.toContain('Engineering Invariants')
    expect(content).not.toContain('Forbidden Patterns')
  })

  it('L2 task-brief includes Engineering Invariants and Forbidden Patterns', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'task-brief.yml'), 'utf-8')
    expect(content).toContain('Engineering Invariants')
    expect(content).toContain('Forbidden Patterns')
  })

  it('L3 task-brief includes Engineering Invariants and Forbidden Patterns', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    const content = readFileSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'task-brief.yml'), 'utf-8')
    expect(content).toContain('Engineering Invariants')
    expect(content).toContain('Forbidden Patterns')
  })

  it('all governance levels include core sections', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const levelDir = mkdtempSync(join(tmpdir(), 'arbiter-github-taskbrief-level-'))
      try {
        generateGithub(makeConfig(levelDir, { governanceLevel: level }))
        const content = readFileSync(
          join(levelDir, '.github', 'ISSUE_TEMPLATE', 'task-brief.yml'),
          'utf-8',
        )
        expect(content, `${level} missing Context`).toContain('Context & Rationale')
        expect(content, `${level} missing Technical Scope`).toContain('Technical Scope')
        expect(content, `${level} missing Definition of Done`).toContain('Definition of Done')
        expect(content, `${level} missing Acceptance Criteria`).toContain('Acceptance Criteria')
        expect(content, `${level} missing Test Plan`).toContain('Test Plan')
      } finally {
        rmSync(levelDir, { recursive: true, force: true })
      }
    }
  })
})

describe('bug-report template content', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-bugreport-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('bug-report contains Severity dropdown', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'bug-report.yml'), 'utf-8')
    expect(content).toContain('Severity')
  })

  it('bug-report contains Steps to Reproduce section', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'bug-report.yml'), 'utf-8')
    expect(content).toContain('Steps to Reproduce')
  })

  it('bug-report contains Acceptance Criteria checkboxes', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'bug-report.yml'), 'utf-8')
    expect(content).toContain('Acceptance Criteria')
  })
})

describe('epic template', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-epic-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('epic.yml is generated', () => {
    generateGithub(makeConfig(dir))
    expect(existsSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'epic.yml'))).toBe(true)
  })

  it('epic.yml contains Goal and Sub-tasks sections', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'epic.yml'), 'utf-8')
    expect(content).toContain('Goal')
    expect(content).toContain('Sub-tasks')
  })
})

describe('docs-check governance gating', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-docs-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('L1 does not include docs-check job', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).not.toContain('docs-check:')
  })

  it('L2 includes docs-check job', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).toContain('docs-check:')
  })

  it('L3 includes docs-check job', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).toContain('docs-check:')
  })

  it('L1 ci-required does not depend on docs-check', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    const lines = content.split('\n')
    const ciRequiredIdx = lines.findIndex((l) => l.includes('ci-required:'))
    const needsLine = lines.slice(ciRequiredIdx).find((l) => l.includes('needs:'))
    expect(needsLine).toBeDefined()
    expect(needsLine).not.toContain('docs-check')
  })

  it('L2 ci-required depends on docs-check', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    const lines = content.split('\n')
    const ciRequiredIdx = lines.findIndex((l) => l.includes('ci-required:'))
    const needsLine = lines.slice(ciRequiredIdx).find((l) => l.includes('needs:'))
    expect(needsLine).toBeDefined()
    expect(needsLine).toContain('docs-check')
  })

  it('docs-check job only runs on pull_request events', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).toContain("if: github.event_name == 'pull_request'")
  })
})

describe('security-early-fail CI job', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-security-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('security-early-fail job present when enableSecurityScanning: true', () => {
    generateGithub(makeConfig(dir, { enableSecurityScanning: true }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).toContain('security-early-fail:')
  })

  it('security-early-fail contains gitleaks detect step', () => {
    generateGithub(makeConfig(dir, { enableSecurityScanning: true }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).toContain('gitleaks detect')
  })

  it('security-early-fail contains PII scan step', () => {
    generateGithub(makeConfig(dir, { enableSecurityScanning: true }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).toContain('pii-scan.mjs')
  })

  it('security-early-fail absent when enableSecurityScanning: false', () => {
    generateGithub(makeConfig(dir, { enableSecurityScanning: false }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).not.toContain('security-early-fail:')
  })

  it('ci-required needs security-early-fail when enableSecurityScanning: true', () => {
    generateGithub(makeConfig(dir, { enableSecurityScanning: true }))
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    const lines = content.split('\n')
    const ciRequiredIdx = lines.findIndex((l) => l.includes('ci-required:'))
    const needsLine = lines.slice(ciRequiredIdx).find((l) => l.includes('needs:'))
    expect(needsLine).toBeDefined()
    expect(needsLine).toContain('security-early-fail')
  })
})

describe('generateGithub — PR template Pipeline Artifacts (#198)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-pr-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('PULL_REQUEST_TEMPLATE.md contains Pipeline Artifacts section', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf-8')
    expect(content).toContain('Pipeline Artifacts')
  })
})

describe('generateGithub — compliance-item.yml issue template (#199)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-compliance-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('compliance-item.yml present at L2', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'compliance-item.yml'))).toBe(true)
  })

  it('compliance-item.yml present at L3', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'compliance-item.yml'))).toBe(true)
  })

  it('compliance-item.yml absent at L1', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'compliance-item.yml'))).toBe(false)
  })
})

describe('generateGithub — dependabot groups (#200)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-dependabot-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('dependabot.yml has groups for TypeScript', () => {
    generateGithub(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, '.github', 'dependabot.yml'), 'utf-8')
    expect(content).toContain('groups:')
    expect(content).toContain('dev-dependencies')
  })

  it('dependabot.yml has no groups for Go', () => {
    generateGithub(makeConfig(dir, { language: 'go', buildTool: 'go' }))
    const content = readFileSync(join(dir, '.github', 'dependabot.yml'), 'utf-8')
    expect(content).not.toContain('groups:')
  })
})

// T7-T8 — ciTierMode workflow subset selection (#880)
describe('generateGithub — ciTierMode workflow subset', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-citiermode-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('baseline mode emits only the 3 core workflows (01/02/03) at L2', () => {
    // ADR-050: heartbeat (09) and nightly/weekly/monthly (06/07/08) are L3+ only.
    // baseline/starter style at L2 must not emit them.
    generateGithub(makeConfig(dir, { ciTierMode: 'baseline', governanceLevel: 'L2' }))
    const wfDir = join(dir, '.github', 'workflows')
    const required = ['01-pr-fast.yml', '02-pr-extended.yml', '03-human-approval.yml']
    const excluded = [
      '05-release.yml',
      '06-nightly.yml',
      '07-weekly.yml',
      '08-monthly.yml',
      '09-heartbeat.yml',
    ]
    for (const wf of required) {
      expect(existsSync(join(wfDir, wf)), `${wf} must exist in baseline mode`).toBe(true)
    }
    for (const wf of excluded) {
      expect(existsSync(join(wfDir, wf)), `${wf} must NOT exist in baseline mode at L2`).toBe(false)
    }
  })

  it('full mode at L3 emits all 8 standard workflows', () => {
    // ADR-050: 06/07/08/09 require L3+; use L3 to test full emission.
    generateGithub(makeConfig(dir, { ciTierMode: 'full', governanceLevel: 'L3' }))
    const wfDir = join(dir, '.github', 'workflows')
    const allWorkflows = [
      '01-pr-fast.yml',
      '02-pr-extended.yml',
      '03-human-approval.yml',
      '05-release.yml',
      '06-nightly.yml',
      '07-weekly.yml',
      '08-monthly.yml',
      '09-heartbeat.yml',
    ]
    for (const wf of allWorkflows) {
      expect(existsSync(join(wfDir, wf)), `${wf} must exist in full mode at L3`).toBe(true)
    }
  })

  it('undefined ciTierMode defaults to standard; L3 emits release and nightly', () => {
    // ADR-050: standard style at L3 emits 05-release and 06-nightly.
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '05-release.yml'))).toBe(true)
    expect(existsSync(join(wfDir, '06-nightly.yml'))).toBe(true)
  })
})

// ─── CANON-05: enableDeployWorkflows flag tests ───────────────────────────────

describe('generateGithub — enableDeployWorkflows flag (CANON-05, #899)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-deploy-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('deploy workflows NOT emitted by default (enableDeployWorkflows unset)', () => {
    generateGithub(makeConfig(dir))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '04-deploy-test.yml'))).toBe(false)
    expect(existsSync(join(wfDir, '10-deploy-prod.yml'))).toBe(false)
  })

  it('enableDeployWorkflows=false does not emit deploy workflows', () => {
    generateGithub(makeConfig(dir, { enableDeployWorkflows: false }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '04-deploy-test.yml'))).toBe(false)
    expect(existsSync(join(wfDir, '10-deploy-prod.yml'))).toBe(false)
  })

  it('enableDeployWorkflows=true emits 04-deploy-test.yml', () => {
    generateGithub(makeConfig(dir, { enableDeployWorkflows: true }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '04-deploy-test.yml'))).toBe(true)
  })

  it('enableDeployWorkflows=true emits 10-deploy-prod.yml', () => {
    generateGithub(makeConfig(dir, { enableDeployWorkflows: true }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '10-deploy-prod.yml'))).toBe(true)
  })

  it('04-deploy-test.yml contains "Deploy Test" name', () => {
    generateGithub(makeConfig(dir, { enableDeployWorkflows: true }))
    const content = readFileSync(join(dir, '.github', 'workflows', '04-deploy-test.yml'), 'utf-8')
    expect(content).toContain('name: Deploy Test')
  })

  it('10-deploy-prod.yml contains "Deploy Prod" name', () => {
    generateGithub(makeConfig(dir, { enableDeployWorkflows: true }))
    const content = readFileSync(join(dir, '.github', 'workflows', '10-deploy-prod.yml'), 'utf-8')
    expect(content).toContain('name: Deploy Prod')
  })

  it('deploy workflows appear in result.files when enabled', () => {
    const result = generateGithub(makeConfig(dir, { enableDeployWorkflows: true }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.includes('04-deploy-test.yml'))).toBe(true)
    expect(paths.some((p) => p.includes('10-deploy-prod.yml'))).toBe(true)
  })

  // ─── Supply-chain templates (INV-92, #885) ─────────────────────────────────

  it('emits _sigstore-retry-sign.yml when ciTierMode is not baseline', () => {
    generateGithub(makeConfig(dir, { ciTierMode: 'full' }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '_sigstore-retry-sign.yml'))).toBe(true)
  })

  it('does NOT emit _sigstore-retry-sign.yml in baseline mode', () => {
    generateGithub(makeConfig(dir, { ciTierMode: 'baseline' }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '_sigstore-retry-sign.yml'))).toBe(false)
  })

  it('_sigstore-retry-sign.yml contains workflow_call trigger', () => {
    generateGithub(makeConfig(dir, { ciTierMode: 'full' }))
    const content = readFileSync(
      join(dir, '.github', 'workflows', '_sigstore-retry-sign.yml'),
      'utf-8',
    )
    expect(content).toContain('workflow_call')
  })

  it('sign-and-attest/action.yml contains SBOM attestation step', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(
      join(dir, '.github', 'actions', 'sign-and-attest', 'action.yml'),
      'utf-8',
    )
    expect(content).toMatch(/sbom|attest.*predicate|predicate.*sbom/i)
  })

  it('supply-chain files appear in result.files', () => {
    const result = generateGithub(makeConfig(dir, { ciTierMode: 'full' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.includes('_sigstore-retry-sign.yml'))).toBe(true)
    expect(paths.some((p) => p.includes('sign-and-attest'))).toBe(true)
  })
})

// W8 — AI-PR gate workflows (#884, INV-91)
describe('generateGithub — AI-PR gate workflows (#884)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-github-aipr-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates _label-on-approve.yml', () => {
    generateGithub(makeConfig(dir))
    expect(existsSync(join(dir, '.github', 'workflows', '_label-on-approve.yml'))).toBe(true)
  })

  it('generates _ai-draft-check.yml', () => {
    generateGithub(makeConfig(dir))
    expect(existsSync(join(dir, '.github', 'workflows', '_ai-draft-check.yml'))).toBe(true)
  })

  it('generates _pr-staleness.yml', () => {
    generateGithub(makeConfig(dir))
    expect(existsSync(join(dir, '.github', 'workflows', '_pr-staleness.yml'))).toBe(true)
  })

  it('_ai-draft-check.yml contains bot author detection', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'workflows', '_ai-draft-check.yml'), 'utf-8')
    expect(content).toContain('user.type')
    expect(content).toContain('approved-by-human')
  })

  it('_label-on-approve.yml contains human reviewer guards', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(
      join(dir, '.github', 'workflows', '_label-on-approve.yml'),
      'utf-8',
    )
    expect(content).toContain('pull_request_review')
    expect(content).toContain('approved-by-human')
    expect(content).toContain('user.type')
    expect(content).toContain('user.login')
  })

  it('_pr-staleness.yml contains no-stale exemption', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'workflows', '_pr-staleness.yml'), 'utf-8')
    expect(content).toContain('no-stale')
    expect(content).toContain('stale')
    expect(content).toContain('cron:')
  })

  it('AI-PR gate workflows generated across all governance levels', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const levelDir = mkdtempSync(join(tmpdir(), `arbiter-github-aipr-${level}-`))
      try {
        generateGithub(makeConfig(levelDir, { governanceLevel: level }))
        const wfDir = join(levelDir, '.github', 'workflows')
        expect(
          existsSync(join(wfDir, '_ai-draft-check.yml')),
          `${level}: _ai-draft-check.yml must exist`,
        ).toBe(true)
        expect(
          existsSync(join(wfDir, '_label-on-approve.yml')),
          `${level}: _label-on-approve.yml must exist`,
        ).toBe(true)
        expect(
          existsSync(join(wfDir, '_pr-staleness.yml')),
          `${level}: _pr-staleness.yml must exist`,
        ).toBe(true)
      } finally {
        rmSync(levelDir, { recursive: true, force: true })
      }
    }
  })

  it('PULL_REQUEST_TEMPLATE.md rendered via EJS template', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf-8')
    expect(content).toContain('Pipeline Artifacts')
    expect(content).toContain('Gate Checklist')
  })

  it('L2 PULL_REQUEST_TEMPLATE includes AI-PR Gate section', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf-8')
    expect(content).toContain('approved-by-human')
    expect(content).toContain('INV-91')
  })

  it('L1 PULL_REQUEST_TEMPLATE omits AI-PR Gate section', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    const content = readFileSync(join(dir, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf-8')
    expect(content).not.toContain('INV-91')
  })
})
