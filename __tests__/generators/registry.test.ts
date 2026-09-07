import { describe, it, expect } from 'vitest'
import {
  buildRegistry,
  runGeneratorsFromRegistry,
  runGeneratorsSelective,
} from '../../src/generators/registry.js'
import type { GeneratorSpec } from '../../src/generators/registry.js'
import { makeConfig } from '../helpers.js'

describe('buildRegistry — retired experimental tool generators (#2367, ADR-119)', () => {
  const RETIRED = ['cursor', 'copilot', 'gemini', 'windsurf', 'aider']

  it('builds no spec for any retired tool', () => {
    const keys = buildRegistry(makeConfig('/tmp', { tools: ['claude', 'codex'] })).map(
      (s) => s.key as string,
    )
    for (const tool of RETIRED) {
      expect(keys).not.toContain(tool)
    }
  })

  it('the claude and codex specs are still wired and gated on tools', () => {
    const both = buildRegistry(makeConfig('/tmp', { tools: ['claude', 'codex'] }))
    expect(both.find((s) => s.key === 'claude')?.enabled).toBe(true)
    expect(both.find((s) => s.key === 'codex')?.enabled).toBe(true)

    const claudeOnly = buildRegistry(makeConfig('/tmp', { tools: ['claude'] }))
    expect(claudeOnly.find((s) => s.key === 'codex')?.enabled).toBe(false)
  })

  it('both tool specs are disabled when aiRulez already manages the repo', () => {
    const specs = buildRegistry(
      makeConfig('/tmp', {
        tools: ['claude', 'codex'],
        existing: {
          agentsMd: false,
          claudeDir: false,
          agentsDir: false,
          aiRulez: true,
          settingsJson: false,
          checkAllScript: false,
          geminiDir: false,
          windsurfRules: false,
          aiderConf: false,
          tests: false,
          ciWorkflows: false,
          lintConfig: false,
        },
      }),
    )
    expect(specs.find((s) => s.key === 'claude')?.enabled).toBe(false)
    expect(specs.find((s) => s.key === 'codex')?.enabled).toBe(false)
  })
})

describe('buildRegistry', () => {
  it('check-all is always enabled regardless of useGitHub', () => {
    const withGitHub = buildRegistry(makeConfig('/tmp', { useGitHub: true }))
    const withoutGitHub = buildRegistry(makeConfig('/tmp', { useGitHub: false }))

    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key)

    expect(find(withGitHub, 'check-all')?.enabled).toBe(true)
    expect(find(withoutGitHub, 'check-all')?.enabled).toBe(true)
  })

  it('github generator is only enabled when useGitHub is true', () => {
    const withGitHub = buildRegistry(makeConfig('/tmp', { useGitHub: true }))
    const withoutGitHub = buildRegistry(makeConfig('/tmp', { useGitHub: false }))

    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key)

    expect(find(withGitHub, 'github')?.enabled).toBe(true)
    expect(find(withoutGitHub, 'github')?.enabled).toBe(false)
  })

  it('suppressions is always enabled regardless of enableSuppressions (#242)', () => {
    const withSuppression = buildRegistry(makeConfig('/tmp', { enableSuppressions: true }))
    const withoutSuppression = buildRegistry(makeConfig('/tmp', { enableSuppressions: false }))

    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key)

    expect(find(withSuppression, 'suppressions')?.enabled).toBe(true)
    expect(find(withoutSuppression, 'suppressions')?.enabled).toBe(true)
  })

  it('integration-testing is gated on hasDatabase not enableContractTesting (INV-34, #282)', () => {
    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key)

    expect(
      find(buildRegistry(makeConfig('/tmp', { hasDatabase: true })), 'integration-testing')
        ?.enabled,
    ).toBe(true)
    expect(
      find(buildRegistry(makeConfig('/tmp', { hasDatabase: false })), 'integration-testing')
        ?.enabled,
    ).toBe(false)
  })

  it('integration-testing enabled when hasDatabase=true even if enableContractTesting=false (#282)', () => {
    const specs = buildRegistry(
      makeConfig('/tmp', { hasDatabase: true, enableContractTesting: false }),
    )
    const spec = specs.find((s) => s.key === 'integration-testing')
    expect(spec?.enabled).toBe(true)
  })
})

describe('runGeneratorsFromRegistry', () => {
  it('isolates generator failures — one throw does not abort others (#303)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => [{ path: '/ok', content: 'ok', action: 'created' }],
      },
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('generator boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/also-ok', content: 'ok2', action: 'created' }],
      },
    ]
    const results = runGeneratorsFromRegistry(specs, [], { dryRun: false })
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.path)).toContain('/ok')
    expect(results.map((r) => r.path)).toContain('/also-ok')
  })

  it('disabled specs are skipped even if adjacent spec throws (#303)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: false,
        run: () => [{ path: '/skip', content: 'x', action: 'created' }],
      },
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('boom')
        },
      },
      { key: 'root', enabled: true, run: () => [{ path: '/ok', content: 'y', action: 'created' }] },
    ]
    const results = runGeneratorsFromRegistry(specs, [], { dryRun: false })
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/ok')
  })
})

describe('runGeneratorsFromRegistry — error collection (#483)', () => {
  it('caught generator failures populate the optional errors sink', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('github boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/ok', content: 'ok', action: 'created' }],
      },
    ]
    const errors: { key: string; message: string }[] = []
    const results = runGeneratorsFromRegistry(specs, errors, { dryRun: false })
    expect(results).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0].key).toBe('github')
    expect(errors[0].message).toContain('github boom')
  })

  it('errors sink is empty when all generators succeed', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => [{ path: '/a', content: 'a', action: 'created' }],
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/b', content: 'b', action: 'created' }],
      },
    ]
    const errors: { key: string; message: string }[] = []
    runGeneratorsFromRegistry(specs, errors, { dryRun: false })
    expect(errors).toHaveLength(0)
  })

  it('errors sink is empty when no error occurs (explicit opts)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('boom')
        },
      },
    ]
    const errors: { key: string; message: string }[] = []
    expect(() => runGeneratorsFromRegistry(specs, errors, { dryRun: false })).not.toThrow()
    expect(errors).toHaveLength(1)
  })
})

describe('runGeneratorsSelective — error collection (#483)', () => {
  it('selective run collects errors from selected failing generator', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('selective boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/ok', content: 'ok', action: 'created' }],
      },
    ]
    const errors: { key: string; message: string }[] = []
    runGeneratorsSelective(specs, new Set(['github', 'root']), errors, { dryRun: false })
    expect(errors).toHaveLength(1)
    expect(errors[0].key).toBe('github')
    expect(errors[0].message).toContain('selective boom')
  })

  it('wildcard selective run propagates errors sink', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => {
          throw new Error('wildcard boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/ok', content: 'ok', action: 'created' }],
      },
    ]
    const errors: { key: string; message: string }[] = []
    runGeneratorsSelective(specs, new Set(['*']), errors, { dryRun: false })
    expect(errors).toHaveLength(1)
    expect(errors[0].key).toBe('check-all')
  })
})

describe('runGeneratorsSelective', () => {
  it('selected generator failure does not abort other selected generators (#303)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => [{ path: '/check', content: 'ok', action: 'created' }],
      },
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('github boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/root', content: 'ok', action: 'created' }],
      },
    ]
    const results = runGeneratorsSelective(specs, new Set(['check-all', 'github', 'root']), [], {
      dryRun: false,
    })
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.path)).toContain('/check')
    expect(results.map((r) => r.path)).toContain('/root')
  })

  it('wildcard selective run uses same isolation as full run (#303)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => {
          throw new Error('boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/root', content: 'ok', action: 'created' }],
      },
    ]
    const results = runGeneratorsSelective(specs, new Set(['*']), [], { dryRun: false })
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/root')
  })
})

// A1 (#1817): enableFiveLaneCi must be mutually exclusive with the standard
// 'github'/'ci-tier' generators — a fresh repo opting into the collapsed 5-lane
// doctrine must never end up with the union of both CI shapes.
describe('buildRegistry — five-lane CI mutual exclusivity (#1817)', () => {
  it('github + ci-tier are enabled, ci-five-lane is disabled by default (useGitHub true)', () => {
    const specs = buildRegistry(makeConfig('/tmp', { useGitHub: true }))
    expect(specs.find((s) => s.key === 'github')?.enabled).toBe(true)
    expect(specs.find((s) => s.key === 'ci-tier')?.enabled).toBe(true)
    expect(specs.find((s) => s.key === 'ci-five-lane')?.enabled).toBe(false)
  })

  it('github + ci-tier are disabled, ci-five-lane is enabled when enableFiveLaneCi is true', () => {
    const specs = buildRegistry(makeConfig('/tmp', { useGitHub: true, enableFiveLaneCi: true }))
    expect(specs.find((s) => s.key === 'github')?.enabled).toBe(false)
    expect(specs.find((s) => s.key === 'ci-tier')?.enabled).toBe(false)
    expect(specs.find((s) => s.key === 'ci-five-lane')?.enabled).toBe(true)
  })

  it('all three stay disabled when GitHub is off entirely', () => {
    const specs = buildRegistry(makeConfig('/tmp', { useGitHub: false, enableFiveLaneCi: true }))
    expect(specs.find((s) => s.key === 'github')?.enabled).toBe(false)
    expect(specs.find((s) => s.key === 'ci-tier')?.enabled).toBe(false)
    expect(specs.find((s) => s.key === 'ci-five-lane')?.enabled).toBe(false)
  })
})

// #1835: audit-toolchain was always-on (enabled: true) but never wired into
// check-all.mjs — a dead emission on every project. Made explicit opt-in.
describe('buildRegistry — audit-toolchain opt-in (#1835)', () => {
  it('is disabled by default', () => {
    const specs = buildRegistry(makeConfig('/tmp'))
    expect(specs.find((s) => s.key === 'audit-toolchain')?.enabled).toBe(false)
  })

  it('is enabled when enableAuditToolchain is true', () => {
    const specs = buildRegistry(makeConfig('/tmp', { enableAuditToolchain: true }))
    expect(specs.find((s) => s.key === 'audit-toolchain')?.enabled).toBe(true)
  })
})
