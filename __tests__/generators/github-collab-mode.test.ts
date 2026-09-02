import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { makeConfig } from '../helpers.js'
import { initGit } from '../helpers.js'

// Phase A regression tests: nightly/weekly/monthly/heartbeat gating per ADR-050
// ADR-050 §54-58: nightly (T4), weekly (T5), monthly (T5b), and heartbeat (T6)
// are L3+ only. L1/L2 projects must not receive these workflows.

describe('generateGithub — heartbeat gated on L3+ (Phase A, ADR-050)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-collab-hb-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('L1: 09-heartbeat.yml NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '09-heartbeat.yml'))).toBe(false)
  })

  it('L2: 09-heartbeat.yml NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '09-heartbeat.yml'))).toBe(false)
  })

  it('L3: 09-heartbeat.yml emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '09-heartbeat.yml'))).toBe(true)
  })

  it('L4: 09-heartbeat.yml emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L4' }))
    expect(existsSync(join(dir, '.github', 'workflows', '09-heartbeat.yml'))).toBe(true)
  })
})

describe('generateGithub — nightly/weekly/monthly gated on L3+ (Phase A, ADR-050)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-collab-nightly-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('L1: 06-nightly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly.yml'))).toBe(false)
  })

  it('L2: 06-nightly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly.yml'))).toBe(false)
  })

  it('L1: 07-weekly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly.yml'))).toBe(false)
  })

  it('L2: 07-weekly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly.yml'))).toBe(false)
  })

  it('L1: 08-monthly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '08-monthly.yml'))).toBe(false)
  })

  it('L2: 08-monthly NOT emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '08-monthly.yml'))).toBe(false)
  })

  it('L3: 06-nightly emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly.yml'))).toBe(true)
  })

  it('L3: 07-weekly emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly.yml'))).toBe(true)
  })

  it('L3: 08-monthly emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '08-monthly.yml'))).toBe(true)
  })

  it('L4: 06-nightly emitted', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L4' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly.yml'))).toBe(true)
  })
})

// ── Phase B: collaborationMode → pipelineStyle resolver (micro-cycle 3) ──────

describe('generateGithub — collaborationMode resolver (Phase B, ADR-051)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-collab-resolver-'))
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // trunk-solo + L1/L2 → starter: no 05-release.yml
  it('trunk-solo + L2 → starter: 05-release NOT emitted', () => {
    const config = makeConfig(dir, {
      collaborationMode: 'trunk-solo',
      governanceLevel: 'L2',
    })
    generateGithub(config)
    expect(existsSync(join(dir, '.github', 'workflows', '05-release.yml'))).toBe(false)
  })

  // trunk-solo + L3 → standard: 05-release emitted, no industrial workflows
  it('trunk-solo + L3 → standard: 05-release emitted', () => {
    const config = makeConfig(dir, {
      collaborationMode: 'trunk-solo',
      governanceLevel: 'L3',
    })
    generateGithub(config)
    expect(existsSync(join(dir, '.github', 'workflows', '05-release.yml'))).toBe(true)
  })

  it('trunk-solo + L3 → standard: 12-mutation NOT emitted (industrial only)', () => {
    const config = makeConfig(dir, {
      collaborationMode: 'trunk-solo',
      governanceLevel: 'L3',
    })
    generateGithub(config)
    expect(existsSync(join(dir, '.github', 'workflows', '12-mutation-scheduled.yml'))).toBe(false)
  })

  // gated-review + L3 → industrial: 12-mutation emitted
  it('gated-review + L3 → industrial: 12-mutation-scheduled emitted', () => {
    const config = makeConfig(dir, {
      collaborationMode: 'gated-review',
      governanceLevel: 'L3',
    })
    generateGithub(config)
    expect(existsSync(join(dir, '.github', 'workflows', '12-mutation-scheduled.yml'))).toBe(true)
  })

  it('gated-review + L4 → industrial: 13-archunit-extended emitted', () => {
    const config = makeConfig(dir, {
      collaborationMode: 'gated-review',
      governanceLevel: 'L4',
    })
    generateGithub(config)
    expect(existsSync(join(dir, '.github', 'workflows', '13-archunit-extended.yml'))).toBe(true)
  })

  // pipelineStyle explicit override wins over collaborationMode (escape hatch)
  it('explicit pipelineStyle=industrial overrides collaborationMode=trunk-solo', () => {
    const config = makeConfig(dir, {
      collaborationMode: 'trunk-solo',
      governanceLevel: 'L2',
      pipelineStyle: 'industrial',
    })
    generateGithub(config)
    expect(existsSync(join(dir, '.github', 'workflows', '12-mutation-scheduled.yml'))).toBe(true)
  })

  it('explicit pipelineStyle=starter overrides collaborationMode=gated-review', () => {
    const config = makeConfig(dir, {
      collaborationMode: 'gated-review',
      governanceLevel: 'L3',
      pipelineStyle: 'starter',
    })
    generateGithub(config)
    expect(existsSync(join(dir, '.github', 'workflows', '05-release.yml'))).toBe(false)
  })

  // soloDevMode: true → trunk-solo alias (backward-compat)
  it('soloDevMode: true without collaborationMode → starter for L2 (trunk-solo alias)', () => {
    const config = makeConfig(dir, {
      enableSoloDevMode: true,
      governanceLevel: 'L2',
    })
    generateGithub(config)
    expect(existsSync(join(dir, '.github', 'workflows', '05-release.yml'))).toBe(false)
  })
})

// ── #1131: exactly-one-nightly — trunk-solo gets nightly-lite INSTEAD of full ──
// Bug: trunk-solo L3/L4 (pipelineStyle 'standard') previously satisfied BOTH the
// full-nightly guard (style !== 'starter' && isL3Plus) and the trunk-solo lite
// guard, emitting 06-nightly.yml AND 06-nightly-lite.yml. trunk-solo is the
// lightweight profile (ADR-053): lite nightly only, no full nightly/weekly/monthly.

describe('generateGithub — exactly-one-nightly for trunk-solo (#1131)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-collab-1nightly-'))
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const wf = (name: string) => join(dir, '.github', 'workflows', name)

  // trunk-solo L2: lite only (already correct pre-fix — characterization)
  it('trunk-solo + L2: 06-nightly-lite emitted, 06-nightly NOT', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L2' }))
    expect(existsSync(wf('06-nightly-lite.yml'))).toBe(true)
    expect(existsSync(wf('06-nightly.yml'))).toBe(false)
  })

  // trunk-solo L3: lite only — NOT full nightly/weekly/monthly (the bug)
  it('trunk-solo + L3: 06-nightly-lite emitted, 06-nightly NOT (no double-emit)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }))
    expect(existsSync(wf('06-nightly-lite.yml'))).toBe(true)
    expect(existsSync(wf('06-nightly.yml'))).toBe(false)
  })

  it('trunk-solo + L3: 07-weekly + 08-monthly NOT emitted (lightweight profile)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }))
    expect(existsSync(wf('07-weekly.yml'))).toBe(false)
    expect(existsSync(wf('08-monthly.yml'))).toBe(false)
  })

  // trunk-solo L4: same lightweight profile
  it('trunk-solo + L4: 06-nightly-lite emitted, 06-nightly/07-weekly/08-monthly NOT', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L4' }))
    expect(existsSync(wf('06-nightly-lite.yml'))).toBe(true)
    expect(existsSync(wf('06-nightly.yml'))).toBe(false)
    expect(existsSync(wf('07-weekly.yml'))).toBe(false)
    expect(existsSync(wf('08-monthly.yml'))).toBe(false)
  })

  // enableSoloDevMode alias (ADR-051): resolves to trunk-solo — must follow the same rule
  it('enableSoloDevMode:true + L3 (trunk-solo alias): lite only, no full nightly', () => {
    generateGithub(makeConfig(dir, { enableSoloDevMode: true, governanceLevel: 'L3' }))
    expect(existsSync(wf('06-nightly-lite.yml'))).toBe(true)
    expect(existsSync(wf('06-nightly.yml'))).toBe(false)
    expect(existsSync(wf('07-weekly.yml'))).toBe(false)
  })

  // Regression: non-trunk-solo modes still get the FULL nightly suite at L3/L4
  it('peer-review + L3: 06-nightly emitted, 06-nightly-lite NOT', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'peer-review', governanceLevel: 'L3' }))
    expect(existsSync(wf('06-nightly.yml'))).toBe(true)
    expect(existsSync(wf('06-nightly-lite.yml'))).toBe(false)
  })

  it('gated-review + L4: 06-nightly + 07-weekly + 08-monthly emitted', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'gated-review', governanceLevel: 'L4' }))
    expect(existsSync(wf('06-nightly.yml'))).toBe(true)
    expect(existsSync(wf('07-weekly.yml'))).toBe(true)
    expect(existsSync(wf('08-monthly.yml'))).toBe(true)
  })
})

// ── Phase B: branchingStrategy → develop branch gating (micro-cycle 5) ───────

describe('generateGithub — develop branch gating (Phase B, ADR-051)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-collab-develop-'))
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('github-flow-with-develop: 01-pr-fast.yml contains develop trigger', () => {
    const config = makeConfig(dir, {
      branchingStrategy: 'github-flow-with-develop',
    })
    generateGithub(config)
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).toContain('develop')
  })

  it('trunk-direct: 01-pr-fast.yml does NOT contain develop trigger', () => {
    const config = makeConfig(dir, {
      branchingStrategy: 'trunk-direct',
    })
    generateGithub(config)
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).not.toContain('develop')
  })

  it('github-flow: 01-pr-fast.yml does NOT contain develop trigger', () => {
    const config = makeConfig(dir, {
      branchingStrategy: 'github-flow',
    })
    generateGithub(config)
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).not.toContain('develop')
  })

  // #2476: 02-pr-extended.yml no longer enumerates its base branches at all — the
  // `branches:` filter is gone, because on a pull_request event it filters the BASE
  // branch and any enumeration is an allowlist by omission (a stacked task/train base
  // matched nothing, so no run was created and the PR showed no checks). The ADR-051
  // Phase B intent — a develop-based pull request runs extended CI — is now satisfied
  // by construction rather than by naming `develop`, and it holds under EVERY
  // branching strategy. Assert the property, not the literal it used to be spelled with.
  it('github-flow-with-develop: 02-pr-extended.yml does not exclude a develop base', () => {
    const config = makeConfig(dir, {
      branchingStrategy: 'github-flow-with-develop',
    })
    generateGithub(config)
    const content = readFileSync(join(dir, '.github', 'workflows', '02-pr-extended.yml'), 'utf-8')
    const onBlock = content.split('\non:')[1]?.split('\nconcurrency:')[0] ?? ''
    expect(onBlock).toContain('pull_request:')
    expect(onBlock).not.toMatch(/^\s{4}branches(-ignore)?:/m)
  })

  it('trunk-direct: 02-pr-extended.yml does NOT contain develop trigger', () => {
    const config = makeConfig(dir, {
      branchingStrategy: 'trunk-direct',
    })
    generateGithub(config)
    const content = readFileSync(join(dir, '.github', 'workflows', '02-pr-extended.yml'), 'utf-8')
    expect(content).not.toContain('develop')
  })

  it('default (no branchingStrategy): 01-pr-fast.yml does NOT contain develop', () => {
    const config = makeConfig(dir, {})
    generateGithub(config)
    const content = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(content).not.toContain('develop')
  })
})
