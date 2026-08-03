import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir as tmpdir_ } from 'node:os'
import { spawnSync } from 'node:child_process'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

/**
 * CANON-04: every .ejs template under src/templates/ must be asserted by at
 * least one test in __tests__/templates/ that renders the template and checks
 * concrete output strings.
 *
 * Covers: githooks/pre-commit.ejs, githooks/pre-push.ejs,
 *         githooks/commit-msg.ejs, githooks/setup-hooks.sh.ejs
 */

function tsConfig(): Record<string, unknown> {
  return makeConfig('/tmp/test-githooks', {
    language: 'typescript',
    buildTool: 'npm',
    projectName: 'test-project',
  }) as unknown as Record<string, unknown>
}

function rustConfig(): Record<string, unknown> {
  return makeConfig('/tmp/test-githooks', {
    language: 'rust',
    buildTool: 'cargo',
    projectName: 'test-project',
  }) as unknown as Record<string, unknown>
}

// ─── githooks/pre-commit.ejs ─────────────────────────────────────────────────

describe('githooks/pre-commit.ejs', () => {
  it('renders without EJS tag leaks for typescript', () => {
    const out = renderTemplate('githooks/pre-commit.ejs', tsConfig())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('renders without EJS tag leaks for rust', () => {
    const out = renderTemplate('githooks/pre-commit.ejs', rustConfig())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('typescript: invokes L1 gate', () => {
    const out = renderTemplate('githooks/pre-commit.ejs', tsConfig())
    expect(out).toContain('node scripts/check-all.mjs L1')
  })

  it('typescript: includes rsync workaround for # in path', () => {
    const out = renderTemplate('githooks/pre-commit.ejs', tsConfig())
    expect(out).toContain('rsync -a')
    expect(out).toContain('#"*')
  })

  it('typescript: includes mktemp for tmp dir creation', () => {
    const out = renderTemplate('githooks/pre-commit.ejs', tsConfig())
    expect(out).toContain('mktemp')
  })

  it('typescript: guards on node_modules presence', () => {
    const out = renderTemplate('githooks/pre-commit.ejs', tsConfig())
    expect(out).toContain('node_modules')
  })

  it('rust: invokes L1 gate', () => {
    const out = renderTemplate('githooks/pre-commit.ejs', rustConfig())
    expect(out).toContain('node scripts/check-all.mjs L1')
  })

  it('rust: does NOT include rsync block', () => {
    const out = renderTemplate('githooks/pre-commit.ejs', rustConfig())
    expect(out).not.toContain('rsync')
    expect(out).not.toContain('mktemp')
  })

  it('rust: guards on node command availability', () => {
    const out = renderTemplate('githooks/pre-commit.ejs', rustConfig())
    expect(out).toContain('command -v node')
  })

  it('both stacks: include phase guard blocking preflight and plan', () => {
    for (const cfg of [tsConfig(), rustConfig()]) {
      const out = renderTemplate('githooks/pre-commit.ejs', cfg)
      expect(out).toContain('preflight|plan')
    }
  })

  it('both stacks: phase guard instructs arbiter task advance', () => {
    for (const cfg of [tsConfig(), rustConfig()]) {
      const out = renderTemplate('githooks/pre-commit.ejs', cfg)
      expect(out).toContain('arbiter task advance --to red')
    }
  })
})

// ─── githooks/pre-push.ejs ───────────────────────────────────────────────────

describe('githooks/pre-push.ejs', () => {
  it('renders without EJS tag leaks for typescript', () => {
    const out = renderTemplate('githooks/pre-push.ejs', tsConfig())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('renders without EJS tag leaks for rust', () => {
    const out = renderTemplate('githooks/pre-push.ejs', rustConfig())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('typescript: invokes gate subcommand', () => {
    const out = renderTemplate('githooks/pre-push.ejs', tsConfig())
    expect(out).toContain('node scripts/check-all.mjs gate')
  })

  it('typescript: includes rsync workaround for # in path', () => {
    const out = renderTemplate('githooks/pre-push.ejs', tsConfig())
    expect(out).toContain('rsync -a')
    expect(out).toContain('mktemp')
  })

  it('both stacks: checks for clean working tree before push', () => {
    for (const cfg of [tsConfig(), rustConfig()]) {
      const out = renderTemplate('githooks/pre-push.ejs', cfg)
      expect(out).toContain('git status --porcelain')
    }
  })

  it('rust: invokes gate subcommand', () => {
    const out = renderTemplate('githooks/pre-push.ejs', rustConfig())
    expect(out).toContain('node scripts/check-all.mjs gate')
  })

  it('rust: does NOT include rsync block', () => {
    const out = renderTemplate('githooks/pre-push.ejs', rustConfig())
    expect(out).not.toContain('rsync')
    expect(out).not.toContain('mktemp')
  })
})

// ─── githooks/commit-msg.ejs ─────────────────────────────────────────────────

describe('githooks/commit-msg.ejs', () => {
  it('renders without EJS tag leaks for typescript', () => {
    const out = renderTemplate('githooks/commit-msg.ejs', tsConfig())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('renders without EJS tag leaks for rust', () => {
    const out = renderTemplate('githooks/commit-msg.ejs', rustConfig())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('typescript: uses a local commitlint binary only', () => {
    const out = renderTemplate('githooks/commit-msg.ejs', tsConfig())
    expect(out).toContain('node_modules/.bin/commitlint --edit "$1"')
    expect(out).not.toContain('npx commitlint')
  })

  it('typescript: guards on a commitlint configuration', () => {
    const out = renderTemplate('githooks/commit-msg.ejs', tsConfig())
    expect(out).toContain('COMMITLINT_CONFIG_FOUND=false')
    expect(out).toContain('commitlint config missing')
  })

  it('rust: mentions commitlint', () => {
    const out = renderTemplate('githooks/commit-msg.ejs', rustConfig())
    expect(out).toContain('commitlint')
  })

  it('rust: guards on a local commitlint install', () => {
    const out = renderTemplate('githooks/commit-msg.ejs', rustConfig())
    expect(out).toContain('[ ! -x node_modules/.bin/commitlint ]')
  })

  it('emits conventional-commits regex check that runs without Node (#355)', () => {
    for (const cfg of [tsConfig(), rustConfig()]) {
      const out = renderTemplate('githooks/commit-msg.ejs', cfg)
      // All 11 commitlint-conventional types + arbiter's 'cluster' must appear
      expect(out).toMatch(
        /build\|chore\|ci\|cluster\|docs\|feat\|fix\|perf\|refactor\|revert\|style\|test/,
      )
    }
  })

  it('emits Merge/Revert bypass before regex enforcement (#355)', () => {
    for (const cfg of [tsConfig(), rustConfig()]) {
      const out = renderTemplate('githooks/commit-msg.ejs', cfg)
      expect(out).toMatch(/Merge\|Revert/)
    }
  })

  it('rejects malformed messages with exit 1 (#355)', () => {
    for (const cfg of [tsConfig(), rustConfig()]) {
      const out = renderTemplate('githooks/commit-msg.ejs', cfg)
      expect(out).toContain('exit 1')
    }
  })

  describe('behavioral verification of generated bash hook (#355)', () => {
    // Renders the template, writes to a tmpfile, invokes bash with a fake
    // $1 argument and asserts the hook's exit code for representative inputs.
    const runHook = (rendered: string, msg: string): number => {
      const tmpdir = mkdtempSync(join(tmpdir_(), 'commit-msg-'))
      const hookPath = join(tmpdir, 'commit-msg')
      const msgPath = join(tmpdir, 'msg')
      writeFileSync(hookPath, rendered)
      writeFileSync(msgPath, msg + '\n')
      // Run outside the project so Layer 2 is skipped for its missing config; this
      // isolates the Layer 1 behavior under test.
      const emptyPathDir = mkdtempSync(join(tmpdir_(), 'empty-path-'))
      const result = spawnSync('/usr/bin/bash', ['--noprofile', '--norc', hookPath, msgPath], {
        cwd: tmpdir,
        encoding: 'utf-8',
        env: { PATH: emptyPathDir },
      })
      if (result.error) throw result.error
      return result.status ?? -1
    }

    it.each([
      ['feat: add foo', 0],
      ['fix(#262): correct bug', 0],
      ['cluster(W3A): #333 #334 — probe + CANON', 0],
      ['chore(deps-dev): bump zod', 0],
      ['style: apply prettier formatting', 0],
      ['Merge branch main into feature', 0],
      ['Revert "feat: bad commit"', 0],
      ['random commit message', 1],
      ['FEAT: uppercase type', 1],
      ['feat add space after type', 1],
    ] as const)('exit code for %s = %s', (msg, expected) => {
      const out = renderTemplate('githooks/commit-msg.ejs', rustConfig())
      expect(runHook(out, msg)).toBe(expected)
    })
  })
})

// ─── githooks/setup-hooks.sh.ejs ─────────────────────────────────────────────

describe('githooks/setup-hooks.sh.ejs', () => {
  it('renders without EJS tag leaks', () => {
    const out = renderTemplate('githooks/setup-hooks.sh.ejs', rustConfig())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('sets core.hooksPath to .githooks', () => {
    const out = renderTemplate('githooks/setup-hooks.sh.ejs', rustConfig())
    expect(out).toContain('git config core.hooksPath .githooks')
  })

  it('makes hooks executable', () => {
    const out = renderTemplate('githooks/setup-hooks.sh.ejs', rustConfig())
    expect(out).toContain('chmod +x .githooks')
  })

  it('renders identically regardless of language (no interpolation)', () => {
    const tsOut = renderTemplate('githooks/setup-hooks.sh.ejs', tsConfig())
    const rustOut = renderTemplate('githooks/setup-hooks.sh.ejs', rustConfig())
    expect(tsOut).toBe(rustOut)
  })
})
