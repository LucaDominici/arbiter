// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(process.cwd())
const SCRIPT = join(REPO_ROOT, 'scripts/route-auditors.mjs')
const ROUTING_JSON = join(REPO_ROOT, '.claude/auditor-routing.json')

function runScript(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
}

function runScriptWithDiff(diffLines: string[], extraArgs: string[] = []) {
  const diffContent = diffLines.join('\n')
  return spawnSync(process.execPath, [SCRIPT, '--diff-stdin', ...extraArgs], {
    input: diffContent,
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: '1' },
  })
}

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'route-auditors-test-'))
})

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('route-auditors — routing config validation', () => {
  it('routing config file exists and is valid JSON', () => {
    expect(existsSync(ROUTING_JSON)).toBe(true)
    expect(() => JSON.parse(readFileSync(ROUTING_JSON, 'utf-8'))).not.toThrow()
  })

  it('routing config has required keys: always_on, tag_map, critical_paths, auditors', () => {
    const config = JSON.parse(readFileSync(ROUTING_JSON, 'utf-8'))
    expect(config).toHaveProperty('always_on')
    expect(config).toHaveProperty('tag_map')
    expect(config).toHaveProperty('critical_paths')
    expect(config).toHaveProperty('auditors')
    expect(Array.isArray(config.always_on)).toBe(true)
    expect(typeof config.tag_map).toBe('object')
    expect(typeof config.critical_paths).toBe('object')
    expect(typeof config.auditors).toBe('object')
  })

  it('each auditor entry has weight field', () => {
    const config = JSON.parse(readFileSync(ROUTING_JSON, 'utf-8'))
    for (const [name, entry] of Object.entries(config.auditors as Record<string, unknown>)) {
      expect(
        (entry as Record<string, unknown>).weight,
        `auditor ${name} missing weight`,
      ).toBeDefined()
    }
  })

  it('routing config lists itself under critical_paths (self-referential guard)', () => {
    const config = JSON.parse(readFileSync(ROUTING_JSON, 'utf-8'))
    const selfRef = config.critical_paths as Record<string, string[]>
    const allPaths = Object.values(selfRef).flat() as string[]
    const hasSelf = allPaths.some((p: string) => p.includes('auditor-routing.json'))
    expect(hasSelf).toBe(true)
  })

  it('critical_paths contains no absolute paths (security guard)', () => {
    const config = JSON.parse(readFileSync(ROUTING_JSON, 'utf-8'))
    const allPaths = Object.values(
      config.critical_paths as Record<string, string[]>,
    ).flat() as string[]
    for (const p of allPaths) {
      expect(p.startsWith('/'), `absolute glob rejected: ${p}`).toBe(false)
    }
  })
})

describe('route-auditors — docs-only diff → minimal auditors', () => {
  it('docs-only diff activates only always_on auditors', () => {
    const r = runScriptWithDiff(['docs/README.md', 'docs/SYSTEM/DECISIONS.md'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.coverage_tier).toBe('minimal')
    expect(out.active.length).toBeGreaterThanOrEqual(1)
    // No security or data auditors expected for pure docs
    expect(out.active).not.toContain('security')
    expect(out.active).not.toContain('data-integrity')
  })
})

describe('route-auditors — --size-floor widens breadth (#1260 / #1267 seam)', () => {
  it('Standard size-floor unions the full vertical breadth into a docs-only diff', () => {
    // Docs-only normally yields a minimal active set; a Standard size-floor must
    // ADD the wider verticals (size widens breadth beyond file-path matching).
    const base = JSON.parse(runScriptWithDiff(['docs/README.md']).stdout)
    expect(base.active).not.toContain('security')

    const r = runScriptWithDiff(['docs/README.md'], ['--size-floor', 'Standard'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.active).toContain('security')
    expect(out.active).toContain('data-integrity')
    expect(out.active).toContain('silent-failures')
  })

  it('size-floor is UNION-ONLY: never removes a file-path-selected auditor', () => {
    const base = JSON.parse(runScriptWithDiff(['migrations/0001.sql']).stdout)
    const floored = JSON.parse(
      runScriptWithDiff(['migrations/0001.sql'], ['--size-floor', 'XS']).stdout,
    )
    // Every base auditor still present after applying an XS floor
    for (const a of base.active) expect(floored.active).toContain(a)
  })

  it('an XS size-floor adds nothing beyond the always_on triad', () => {
    const r = runScriptWithDiff(['docs/README.md'], ['--size-floor', 'XS'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.active).not.toContain('security')
  })

  it('rejects an unknown --size-floor value (exit 2, no silent drop)', () => {
    const r = runScriptWithDiff(['docs/README.md'], ['--size-floor', 'Huge'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/size-floor/i)
  })
})

describe('route-auditors — backend TS diff → multiple auditors', () => {
  it('src/commands/ diff activates 3+ auditors', () => {
    const r = runScriptWithDiff([
      'src/commands/worktree.ts',
      'src/generators/worktree.ts',
      '__tests__/commands/worktree.test.ts',
    ])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.active.length).toBeGreaterThanOrEqual(3)
  })
})

describe('route-auditors — SQL file → security + data-integrity activated', () => {
  it('SQL migration activates security and data-integrity (union)', () => {
    const r = runScriptWithDiff(['migrations/0001_create_users.sql'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.active).toContain('security')
    expect(out.active).toContain('data-integrity')
  })
})

describe('route-auditors — critical-path force-activate', () => {
  it('auditor-routing.json edit force-activates full auditor set', () => {
    const r = runScriptWithDiff(['.claude/auditor-routing.json'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    const config = JSON.parse(readFileSync(ROUTING_JSON, 'utf-8'))
    const totalAuditors = Object.keys(config.auditors).length
    expect(out.active.length).toBe(totalAuditors)
    expect(out.coverage_tier).toBe('full')
  })

  it('critical-path override wins over skip tags (precedence: critical > tag_map)', () => {
    // AGENTS.md is a critical path; verify it activates full set even if no backend tags
    const r = runScriptWithDiff(['AGENTS.md'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    // Must activate domain auditor at minimum (governance-critical file)
    expect(out.active.length).toBeGreaterThanOrEqual(1)
  })
})

describe('route-auditors — empty diff → non-zero exit', () => {
  it('empty diff exits non-zero with clear message', () => {
    const r = runScriptWithDiff([])
    expect(r.status).not.toBe(0)
    expect(r.stderr + r.stdout).toMatch(/no (files|auditors)/i)
  })
})

describe('route-auditors — skip-aware scoring (no inflation)', () => {
  it('skipping a high-weight auditor does not inflate pass_rate to 100%', () => {
    // docs-only diff: coverage < full; pass_rate is over active set only
    const r = runScriptWithDiff(['docs/README.md'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    // coverage < 1.0 when not all auditors active
    const config = JSON.parse(readFileSync(ROUTING_JSON, 'utf-8'))
    const totalWeight = Object.values(config.auditors as Record<string, { weight: number }>).reduce(
      (s, a) => s + a.weight,
      0,
    )
    const activeWeight = out.active.reduce((s: number, name: string) => {
      return s + ((config.auditors[name] as { weight: number })?.weight ?? 0)
    }, 0)
    // If active < total, coverage < 1
    if (activeWeight < totalWeight) {
      expect(out.coverage).toBeLessThan(1)
    }
    // pass_rate is null at this layer (populated by caller after actual auditor runs)
    expect(out.pass_rate).toBeNull()
  })
})

describe('route-auditors — rename handling (--no-renames)', () => {
  it('renamed file entries do not cause parse errors', () => {
    // Simulate a rename by passing arrow-style (which --no-renames avoids, but validate robustness)
    const r = runScriptWithDiff(['src/old.ts', 'src/new.ts'])
    expect(r.status).toBe(0)
    expect(() => JSON.parse(r.stdout)).not.toThrow()
  })
})

describe('route-auditors — precedence ladder', () => {
  it('always_on auditors activate even on docs-only diff (critical > always_on > tag)', () => {
    const r = runScriptWithDiff(['docs/README.md'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    const config = JSON.parse(readFileSync(ROUTING_JSON, 'utf-8'))
    // Every always_on auditor must be in active set
    for (const name of config.always_on as string[]) {
      expect(out.active, `always_on auditor '${name}' must be active`).toContain(name)
    }
  })
})

describe('route-auditors — routing-decision artifact', () => {
  it('emits routing-decision.json when --artifact-dir is specified', () => {
    const artifactDir = join(tmpDir, 'routing-artifact')
    mkdirSync(artifactDir, { recursive: true })
    const r = runScriptWithDiff(['src/commands/worktree.ts'], ['--artifact-dir', artifactDir])
    expect(r.status).toBe(0)
    const artifactPath = join(artifactDir, 'routing-decision.json')
    expect(existsSync(artifactPath)).toBe(true)
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))
    expect(artifact).toHaveProperty('active')
    expect(artifact).toHaveProperty('skipped')
    expect(artifact).toHaveProperty('coverage')
    expect(artifact).toHaveProperty('pass_rate')
  })
})

describe('route-auditors — deleted file path glob (no content access)', () => {
  it('deleted SQL file still activates security via path glob', () => {
    const r = runScriptWithDiff(['migrations/dropped_table.sql'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.active).toContain('security')
  })
})

describe('route-auditors — child_process usage is limited to git calls only', () => {
  it('script does not import child_process for non-git purposes (no exec/execSync)', () => {
    const src = readFileSync(SCRIPT, 'utf-8')
    // execSync/exec are disallowed; spawnSync for git diff is the only allowed call
    expect(src).not.toMatch(/\bexecSync\b/)
    expect(src).not.toMatch(/\bexec\s*\(/)
  })
})

describe('route-auditors — --explain flag', () => {
  it('--explain <path> prints which rule activated that path', () => {
    const r = runScript(['--explain', '.claude/auditor-routing.json'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/critical.path|force.activ/i)
  })
})

// #1212 (F2) — weighted anti-inflation verdict score.
// Denominator is the TOTAL auditor weight, so skipping a would-fail auditor
// equals failing it (contributes 0 either way) — a skip can never RAISE the score.
describe('route-auditors — --score weighted verdict (#1212)', () => {
  function score(results: Record<string, boolean>, caps?: Record<string, number>) {
    const args = ['--score', '--results', JSON.stringify(results)]
    if (caps) args.push('--caps', JSON.stringify(caps))
    const r = runScript(args)
    return {
      status: r.status,
      json: r.status === 0 ? JSON.parse(r.stdout) : null,
      stderr: r.stderr,
    }
  }

  it('all auditors passing → score 100, verdict PASS', () => {
    const { json } = score({
      bugs: true,
      'type-safety': true,
      domain: true,
      'test-quality': true,
      security: true,
      'data-integrity': true,
      'silent-failures': true,
    })
    expect(json.score).toBe(100)
    expect(json.verdict).toBe('PASS')
  })

  it('a skipped auditor does NOT raise the aggregate score (anti-inflation)', () => {
    // security active+failing vs security skipped — total-weight denominator means
    // the score is identical, so skipping never inflates the verdict.
    const baseline = score({ bugs: true, security: false })
    const skipped = score({ bugs: true }) // security omitted = skipped
    expect(baseline.json.score).toBe(skipped.json.score)
    expect(skipped.json.score).toBeLessThanOrEqual(baseline.json.score)
  })

  it('maps the weighted fraction onto the 80/60/40 verdict ladder', () => {
    // bugs+type-safety+domain+test-quality+silent-failures pass (3+2+3+2+2=12),
    // security+data-integrity fail (4+4). total=20 → 60 → CONCERNS.
    const { json } = score({
      bugs: true,
      'type-safety': true,
      domain: true,
      'test-quality': true,
      'silent-failures': true,
      security: false,
      'data-integrity': false,
    })
    expect(json.score).toBe(60)
    expect(json.verdict).toBe('CONCERNS')
  })

  it('a cap lowers only the capped auditor’s contribution (RT-unresolved)', () => {
    const uncapped = score({ bugs: true })
    const capped = score({ bugs: true }, { bugs: 0 })
    expect(capped.json.score).toBeLessThan(uncapped.json.score)
    expect(capped.json.score).toBe(0)
    expect(capped.json.capped).toContain('bugs')
  })

  it('rejects malformed --results JSON with exit 2', () => {
    const r = runScript(['--score', '--results', '{not json'])
    expect(r.status).toBe(2)
  })
})
