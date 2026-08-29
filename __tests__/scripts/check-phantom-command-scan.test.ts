// SPDX-License-Identifier: Apache-2.0
// F2 (#1838, item 4 — extends INV-111): every `arbiter <cmd>` cited in
// current-state prose docs (PRIVACY.md, docs/ minus internal/, website/ minus
// changelog/) must name a command that actually exists in src/cli.ts. This is
// the class of bug fixed once already in F1 (#1837: PRIVACY.md cited the
// nonexistent `arbiter check` / `arbiter generate`) — this suite proves the
// gate catches a synthetic phantom command, and doesn't false-positive on
// aliases, `help`, or historical/roadmap prose.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  extractCitedCommands,
  extractBareWordCommandCitations,
  extractSpawnedCommands,
  extractFencedCitations,
  findPhantomCommands,
} from '../../scripts/check-phantom-command-scan.mjs'

const SCRIPT = resolve('scripts/check-phantom-command-scan.mjs')

// ─── extractCitedCommands ──────────────────────────────────────────────────────

describe('extractCitedCommands', () => {
  it('extracts a backtick-wrapped command citation', () => {
    expect(extractCitedCommands('Run `arbiter init` to get started.')).toEqual(new Set(['init']))
  })

  it('extracts multiple distinct citations', () => {
    const md = 'Use `arbiter validate` then `arbiter doctor`.'
    expect(extractCitedCommands(md)).toEqual(new Set(['validate', 'doctor']))
  })

  it('does not match bare prose without backticks', () => {
    expect(extractCitedCommands('arbiter checks your commits automatically.')).toEqual(new Set())
  })

  it('does not match global flags (arbiter --version)', () => {
    expect(extractCitedCommands('Run `arbiter --version` to check.')).toEqual(new Set())
  })

  it('filters known prose stopwords styled in backticks (e.g. "arbiter governs itself")', () => {
    expect(extractCitedCommands('This is `arbiter governs itself` as a design principle.')).toEqual(
      new Set(),
    )
  })

  it('captures a phantom command the same way as a real one (extraction is neutral)', () => {
    expect(extractCitedCommands('Run `arbiter frobnicate` now.')).toEqual(new Set(['frobnicate']))
  })
})

// ─── extractBareWordCommandCitations (AC-2243.1, #2243) ──────────────────────

describe('extractBareWordCommandCitations', () => {
  it('extracts bare-word citations from an "(e.g. ...)" list gated on a nearby "commands" mention (arc42.md:706 class)', () => {
    const md =
      'Only 11 CLI commands are public; the remaining ~65 registrations are hidden ' +
      'but fully functional (e.g. `graph`, `kit`, `frobnicate`).'
    expect(extractBareWordCommandCitations(md)).toEqual(new Set(['graph', 'kit', 'frobnicate']))
  })

  it('does NOT flag an "(e.g. ...)" list with no "command(s)" mention nearby (false-positive guard)', () => {
    const md = 'Supported deploy environments (e.g. `staging`, `production`).'
    expect(extractBareWordCommandCitations(md)).toEqual(new Set())
  })

  it('does NOT flag a plain backtick word outside an "(e.g. ...)" list', () => {
    const md = 'The `graph` subsystem backs several commands.'
    expect(extractBareWordCommandCitations(md)).toEqual(new Set())
  })
})

describe('check-phantom-command-scan.mjs — bare-word phantom fails closed (AC-2243.1)', () => {
  it('exits 1 when an "(e.g. ...)" command list cites a phantom bare word', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-bareword-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('graph').description('Graph')\n",
      )
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'arc42.md'),
        'Many hidden commands remain functional (e.g. `graph`, `frobnicate`).\n',
      )
      const r = spawnSync('node', [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'docs')}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('frobnicate')
      expect(r.stdout).not.toContain('`graph`')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when the "(e.g. ...)" list has no "command(s)" context (false-positive corpus)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-bareword-fp-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n",
      )
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'deploy.md'),
        'Supported deploy environments (e.g. `staging`, `production`).\n',
      )
      const r = spawnSync('node', [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'docs')}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
      // Note: the tool's OWN name ("check-phantom-command-scan") contains the
      // substring "phantom" — the violation-line marker is "phantom:" (colon),
      // matching the house convention used by the real-repo test below.
      expect(r.stdout).not.toContain('phantom:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── findPhantomCommands ────────────────────────────────────────────────────────

describe('findPhantomCommands', () => {
  it('returns empty when every citation is real', () => {
    const real = new Set(['init', 'doctor'])
    expect(findPhantomCommands(new Set(['init', 'doctor']), real)).toEqual([])
  })

  it('DETECTS a synthetic phantom command citation', () => {
    const real = new Set(['init', 'doctor'])
    expect(findPhantomCommands(new Set(['init', 'frobnicate']), real)).toEqual(['frobnicate'])
  })

  it('recognizes an alias as real when included in realCommandNames', () => {
    const real = new Set(['worktree', 'wt'])
    expect(findPhantomCommands(new Set(['wt']), real)).toEqual([])
  })
})

// ─── end-to-end: real repo must be phantom-free ───────────────────────────────

describe('check-phantom-command-scan.mjs — real repo (INV-111 extension)', () => {
  it('exits 0 against PRIVACY.md + docs/ + website/ (excluding internal/ and changelog/)', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.stdout).not.toContain('phantom:')
    expect(r.status).toBe(0)
  })

  it('does not flag `arbiter verify` (real alias of validate) or `arbiter wt` (real alias of worktree)', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.stdout).not.toContain('`arbiter verify`')
    expect(r.stdout).not.toContain('`arbiter wt`')
  })
})

// ─── extractSpawnedCommands (T5b′ spawn-array matcher) ───────────────────────

describe('extractSpawnedCommands', () => {
  it('extracts the command token from a thin-runner spawn array', () => {
    const src = "spawnSync('npx', ['--no-install', 'arbiter', 'doc-set', ...args], {})"
    expect(extractSpawnedCommands(src)).toEqual(new Set(['doc-set']))
  })

  it('extracts multiple distinct spawn citations', () => {
    const src =
      "spawnSync('npx', ['--no-install', 'arbiter', 'doc-set', ...args], {})\n" +
      "spawnSync('npx', ['--no-install', 'arbiter', 'gold-audit', ...args], {})"
    expect(extractSpawnedCommands(src)).toEqual(new Set(['doc-set', 'gold-audit']))
  })

  it('does not match bare prose without the array-literal shape', () => {
    expect(extractSpawnedCommands('Run arbiter init to get started.')).toEqual(new Set())
  })

  it('is unaffected by a flag token immediately after the command', () => {
    // check-doc-freshness.mjs.ejs shape: ['--no-install', 'arbiter', 'doc-set', '--freshness', ...]
    const src =
      "spawnSync('npx', ['--no-install', 'arbiter', 'doc-set', '--freshness', ...args], {})"
    expect(extractSpawnedCommands(src)).toEqual(new Set(['doc-set']))
  })
})

describe('check-phantom-command-scan.mjs — synthetic phantom command fails closed', () => {
  it('exits 1 when a doc cites a command absent from cli.ts (regression: #1837)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-scan-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n",
      )
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'PRIVACY.md'),
        'Run `arbiter frobnicate` to purge telemetry (this command does not exist).\n',
      )
      const r = spawnSync('node', [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'docs')}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('frobnicate')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips docs/audit/ — an audit report quoting a phantom command as evidence is not a live promise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-scan-audit-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n",
      )
      const docsDir = join(dir, 'docs')
      mkdirSync(join(docsDir, 'audit'), { recursive: true })
      writeFileSync(
        join(docsDir, 'audit', 'release-readiness-verdict.md'),
        '- `arbiter frobnicate` — cited in ship.md.ejs; this command does not exist.\n',
      )
      const r = spawnSync('node', [SCRIPT, `--cli=${cliPath}`, `--roots=${docsDir}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('phantom:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when the cited command is a real alias, not registered as its own .command()', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-scan-alias-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('worktree').alias('wt').description('Worktree mgmt')\n",
      )
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'PRIVACY.md'), 'Run `arbiter wt` to manage worktrees.\n')
      const r = spawnSync('node', [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'docs')}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── T5b′: emitted-template spawn-array scan (#1944) ───────────────────────

describe('check-phantom-command-scan.mjs — T5b′ template spawn-array scan', () => {
  it('fails when a .mjs.ejs thin-runner spawns an unregistered command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-scan-spawn-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n",
      )
      const tmplDir = join(dir, 'templates', 'scripts')
      mkdirSync(tmplDir, { recursive: true })
      writeFileSync(
        join(tmplDir, 'check-thing.mjs.ejs'),
        "const result = spawnSync('npx', ['--no-install', 'arbiter', 'frobnicate', ...args], {})\n",
      )
      const r = spawnSync(
        'node',
        [
          SCRIPT,
          `--cli=${cliPath}`,
          `--roots=${join(dir, 'templates')}`,
          `--ledger=${join(dir, 'none.yml')}`,
        ],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('frobnicate')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes when a .mjs.ejs thin-runner spawns a real command (with a matching ledger row)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-scan-spawn-ok-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n",
      )
      const tmplDir = join(dir, 'templates', 'scripts')
      mkdirSync(tmplDir, { recursive: true })
      writeFileSync(
        join(tmplDir, 'check-thing.mjs.ejs'),
        "const result = spawnSync('npx', ['--no-install', 'arbiter', 'init', ...args], {})\n",
      )
      const ledgerPath = join(dir, 'ledger.yml')
      writeFileSync(ledgerPath, 'commands:\n  - command: init\n')
      const r = spawnSync(
        'node',
        [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'templates')}`, `--ledger=${ledgerPath}`],
        {
          encoding: 'utf-8',
        },
      )
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── T5b″: emitted-surface ledger cross-check (#1944) ───────────────────────

describe('check-phantom-command-scan.mjs — T5b″ ledger cross-check', () => {
  it('fails when the ledger is missing while template sources are scanned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-missing-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n",
      )
      const tmplDir = join(dir, 'templates', 'scripts')
      mkdirSync(tmplDir, { recursive: true })
      writeFileSync(
        join(tmplDir, 'check-thing.mjs.ejs'),
        "const result = spawnSync('npx', ['--no-install', 'arbiter', 'init', ...args], {})\n",
      )
      const r = spawnSync(
        'node',
        [
          SCRIPT,
          `--cli=${cliPath}`,
          `--roots=${join(dir, 'templates')}`,
          `--ledger=${join(dir, 'absent.yml')}`,
        ],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('not found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when a template-cited command has no ledger row (completeness)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-incomplete-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n" +
          "program.command('doctor').description('Doctor')\n",
      )
      const tmplDir = join(dir, 'templates', 'scripts')
      mkdirSync(tmplDir, { recursive: true })
      writeFileSync(
        join(tmplDir, 'a.mjs.ejs'),
        "spawnSync('npx', ['--no-install', 'arbiter', 'init', ...args], {})\n" +
          "spawnSync('npx', ['--no-install', 'arbiter', 'doctor', ...args], {})\n",
      )
      const ledgerPath = join(dir, 'ledger.yml')
      // ledger has `init` but NOT `doctor` — completeness gap
      writeFileSync(ledgerPath, 'commands:\n  - command: init\n')
      const r = spawnSync(
        'node',
        [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'templates')}`, `--ledger=${ledgerPath}`],
        {
          encoding: 'utf-8',
        },
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('`doctor`')
      expect(r.stdout).toContain('completeness')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when the ledger records a command not registered in cli.ts (existence)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-phantom-cmd-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n",
      )
      const tmplDir = join(dir, 'templates', 'scripts')
      mkdirSync(tmplDir, { recursive: true })
      writeFileSync(
        join(tmplDir, 'a.mjs.ejs'),
        "spawnSync('npx', ['--no-install', 'arbiter', 'init', ...args], {})\n",
      )
      const ledgerPath = join(dir, 'ledger.yml')
      writeFileSync(ledgerPath, 'commands:\n  - command: init\n  - command: ghostcmd\n')
      const r = spawnSync(
        'node',
        [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'templates')}`, `--ledger=${ledgerPath}`],
        {
          encoding: 'utf-8',
        },
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('`ghostcmd`')
      expect(r.stdout).toContain('not a registered command')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when a ledger flag is not a real .option() — the doc-set --check incident class', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-phantom-flag-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('doc-set [repo]', { hidden: true })\n" +
          ".option('--check', 'Advisory audit', false)\n" +
          ".description('Doc-set audit')\n",
      )
      const tmplDir = join(dir, 'templates', 'scripts')
      mkdirSync(tmplDir, { recursive: true })
      writeFileSync(
        join(tmplDir, 'check-doc-set.mjs.ejs'),
        "spawnSync('npx', ['--no-install', 'arbiter', 'doc-set', ...args], {})\n",
      )
      const ledgerPath = join(dir, 'ledger.yml')
      // --check exists; --bogus-flag does not — flag-surface drift
      writeFileSync(
        ledgerPath,
        'commands:\n  - command: doc-set\n    flags:\n      - --check\n      - --bogus-flag\n',
      )
      const r = spawnSync(
        'node',
        [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'templates')}`, `--ledger=${ledgerPath}`],
        {
          encoding: 'utf-8',
        },
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('`--bogus-flag`')
      expect(r.stdout).toContain('flag-surface')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes when the ledger is complete and every flag matches a real .option()', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-ok-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('doc-set [repo]', { hidden: true })\n" +
          ".option('--check', 'Advisory audit', false)\n" +
          ".option('--freshness', 'Freshness audit', false)\n" +
          ".description('Doc-set audit')\n" +
          "program.command('init').description('Init')\n",
      )
      const tmplDir = join(dir, 'templates', 'scripts')
      mkdirSync(tmplDir, { recursive: true })
      writeFileSync(
        join(tmplDir, 'check-doc-set.mjs.ejs'),
        "spawnSync('npx', ['--no-install', 'arbiter', 'doc-set', '--freshness', ...args], {})\n" +
          "spawnSync('npx', ['--no-install', 'arbiter', 'init', ...args], {})\n",
      )
      const ledgerPath = join(dir, 'ledger.yml')
      writeFileSync(
        ledgerPath,
        'commands:\n  - command: doc-set\n    flags:\n      - --check\n      - --freshness\n  - command: init\n',
      )
      const r = spawnSync(
        'node',
        [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'templates')}`, `--ledger=${ledgerPath}`],
        {
          encoding: 'utf-8',
        },
      )
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── AC-2231.5: subcommand-token validation (#2231, wave-3 Group E) ──────────

describe('check-phantom-command-scan.mjs — subcommand-token validation (AC-2231.5)', () => {
  // Mirrors the real cli.ts registration shapes: const-bound chains
  // (`const review = program.command('review')` + `review\n  .command('diff')`),
  // alias chains (`const verify = program\n  .command('validate').alias('verify')`),
  // and plain top-level registrations.
  const CLI_WITH_SUBCOMMANDS =
    "import { Command } from 'commander'\nconst program = new Command()\n" +
    "const review = program.command('review').description('Semantic diff between graph snapshots')\n" +
    "review\n  .command('diff')\n  .description('Semantic diff between two graph snapshots')\n" +
    "const verify = program\n  .command('validate')\n  .alias('verify')\n  .description('Validate')\n" +
    "verify\n  .command('tdd <task-id>')\n  .description('Verify TDD red-phase evidence')\n" +
    "program.command('ship [id]').description('Orchestrate an issue')\n" +
    "program.command('init').description('Init')\n" +
    "program.command('update').description('Update')\n"

  function runInTemp(dir, cliSrc, docPath, docBody) {
    const cliPath = join(dir, 'cli.ts')
    writeFileSync(cliPath, cliSrc)
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, docPath), docBody)
    return spawnSync('node', [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'docs')}`], {
      encoding: 'utf-8',
    })
  }

  it('FLAGS `arbiter review code` — code is not a registered subcommand of review (phantom multi-pass dispatch, #1817)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-sub-'))
    try {
      const r = runInTemp(
        dir,
        CLI_WITH_SUBCOMMANDS,
        'docs/review-code.md',
        'Run `arbiter review code --diff origin/main --tier S` before merging.\n',
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('`arbiter review code`')
      expect(r.stdout).toContain('not a registered subcommand')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does NOT flag non-subcommand second tokens: `ship #NNN`, `init --recipe`, `update --governance`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-sub-ok-'))
    try {
      const r = runInTemp(
        dir,
        CLI_WITH_SUBCOMMANDS,
        'docs/usage.md',
        'Run `arbiter ship #NNN --advance`, `arbiter init --recipe <url>` and `arbiter update --governance`.\n',
      )
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('phantom:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("accepts `arbiter verify tdd '#NNN'` — tdd IS a real subcommand, reached through the validate alias", () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-sub-alias-'))
    try {
      const r = runInTemp(
        dir,
        CLI_WITH_SUBCOMMANDS,
        'docs/tdd.md',
        "Run `arbiter verify tdd '#NNN' --json` to replay the audit.\n",
      )
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('phantom:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts a real subcommand pair in chain form (`arbiter review diff`)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-sub-real-'))
    try {
      const r = runInTemp(
        dir,
        CLI_WITH_SUBCOMMANDS,
        'docs/ref.md',
        'Run `arbiter review diff origin/main HEAD`.\n',
      )
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('phantom:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── #2408: fenced code blocks ────────────────────────────────────────────────
// COMMAND_MENTION_RE anchors on a literal backtick, so every command inside a
// fenced block — where install instructions actually live — was invisible.

const CLI_MINIMAL =
  "import { Command } from 'commander'\nconst program = new Command()\n" +
  "program.command('init').description('Init')\n"

describe('extractFencedCitations (#2408)', () => {
  it('extracts an `arbiter <cmd>` invocation from a ```bash fence', () => {
    const md = '```bash\narbiter frobnicate --json\n```\n'
    expect(extractFencedCitations(md).commands).toEqual(new Set(['frobnicate']))
  })

  it('treats a `$ ` prompt and leading whitespace as noise', () => {
    const md = '```console\n  $ arbiter frobnicate\n```\n'
    expect(extractFencedCitations(md).commands).toEqual(new Set(['frobnicate']))
  })

  it('captures a subcommand token as a pair', () => {
    const md = '```sh\narbiter plugin add my-plugin\n```\n'
    expect(extractFencedCitations(md).pairs.get('plugin')).toEqual(new Set(['add']))
  })

  it('scans an unlabeled fence', () => {
    const md = '```\narbiter frobnicate\n```\n'
    expect(extractFencedCitations(md).commands).toEqual(new Set(['frobnicate']))
  })

  it('ignores a non-shell fence (```js) — code samples are not invocations', () => {
    const md = '```js\narbiter frobnicate\n```\n'
    expect(extractFencedCitations(md).commands).toEqual(new Set())
  })

  it('ignores prose outside any fence', () => {
    expect(extractFencedCitations('arbiter frobnicate is not a fence.\n').commands).toEqual(
      new Set(),
    )
  })

  it('extracts a `node scripts/<x>.mjs` citation', () => {
    const md = '```bash\nnode scripts/check-thing.mjs --write\n```\n'
    expect(extractFencedCitations(md).scripts).toEqual(new Set(['scripts/check-thing.mjs']))
  })
})

describe('check-phantom-command-scan.mjs — fenced blocks end-to-end (#2408)', () => {
  function runFixture(dir: string, docPath: string, body: string, extra: string[] = []) {
    const cliPath = join(dir, 'cli.ts')
    writeFileSync(cliPath, CLI_MINIMAL)
    mkdirSync(join(dir, docPath, '..'), { recursive: true })
    writeFileSync(join(dir, docPath), body)
    return spawnSync(
      'node',
      [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, docPath.split('/')[0])}`, ...extra],
      { encoding: 'utf-8', cwd: dir },
    )
  }

  it('POSITIVE: exits 1 for a phantom cited only inside a ```bash fence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-fence-'))
    try {
      const r = runFixture(dir, 'docs/install.md', '```bash\narbiter frobnicate\n```\n')
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('frobnicate')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('NEGATIVE: exits 0 for a real command in a fence and a phantom in a ```js fence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-fence-ok-'))
    try {
      const r = runFixture(
        dir,
        'docs/install.md',
        '```bash\n$ arbiter init --yes\n```\n\n```js\narbiter frobnicate\n```\n',
      )
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('phantom')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 1 when a fence cites a `node scripts/<x>.mjs` that does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-script-'))
    try {
      const r = runFixture(dir, 'docs/run.md', '```bash\nnode scripts/does-not-exist.mjs\n```\n')
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('scripts/does-not-exist.mjs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when the cited script exists in the scanned tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-script-ok-'))
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'real.mjs'), '// real\n')
      const r = runFixture(dir, 'docs/run.md', '```bash\nnode scripts/real.mjs\n```\n')
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('suppresses a fenced phantom for an allowlisted file and reports the count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-allow-'))
    try {
      const allowlist = join(dir, 'allowlist.json')
      writeFileSync(
        allowlist,
        JSON.stringify({
          $schemaVersion: 1,
          description: 'test',
          entries: [
            {
              path: 'docs/install.md',
              rule: 'phantom-command',
              reason: 'command decision owned by a sibling batch issue',
              issue: '#2416',
              expires: '2099-01-01',
            },
          ],
        }),
      )
      const r = runFixture(dir, 'docs/install.md', '```bash\narbiter frobnicate\n```\n', [
        `--allowlist=${allowlist}`,
      ])
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/1 file\(s\) allowlisted/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 1 when an allowlist entry has expired', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-allow-expired-'))
    try {
      const allowlist = join(dir, 'allowlist.json')
      writeFileSync(
        allowlist,
        JSON.stringify({
          $schemaVersion: 1,
          description: 'test',
          entries: [
            {
              path: 'docs/install.md',
              rule: 'phantom-command',
              reason: 'command decision owned by a sibling batch issue',
              issue: '#2416',
              expires: '2020-01-01',
            },
          ],
        }),
      )
      const r = runFixture(dir, 'docs/install.md', '```bash\narbiter init\n```\n', [
        `--allowlist=${allowlist}`,
      ])
      expect(r.status).toBe(1)
      expect(r.stdout).toMatch(/expired/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
