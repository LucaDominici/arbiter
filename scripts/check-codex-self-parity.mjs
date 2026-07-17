#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: ADR-106 addendum / #1966 self-track enforcement — arbiter's OWN materialized
// CATALOG:   .agents/** + .codex/** must be normalized-equivalent to what its own generator
// CATALOG:   emits today for its own resolved config; every difference is either pinned
// CATALOG:   (dated rationale + diffHash in codex-self-parity-divergences.json) or a declared
// CATALOG:   repo-runtime artifact. Closes the hole `skipIfExists` leaves open: `arbiter
// CATALOG:   update` never refreshes an existing rule file, so the self-config rots
// CATALOG:   invisibly to every other gate (the live CANON-22 loss was exactly this).
// CATALOG: Rejected fold-in into check-self-dogfood.mjs — that gate proves raw-EJS-render
// CATALOG:   identity against .claude-family destinations, and its dead-entry sweep never
// CATALOG:   visits the codex roots: a .agents/.codex entry in its ledger is flagged dead
// CATALOG:   (green sibling turns RED). Different render axis, disjoint ledger semantics.
// CATALOG: Rejected fold-in into check-codex-parity.mjs — that gate bakes a FRESH fixture
// CATALOG:   into an empty dir, where skipIfExists never suppresses a write; by construction
// CATALOG:   a fresh bake can never see materialized-tree rot in THIS repo.
//
// Usage:
//   node scripts/check-codex-self-parity.mjs                    # full run (emit + classify)
//   node scripts/check-codex-self-parity.mjs --repo-root <dir>  # test-only: classify another
//                                                               #   materialized tree (fixtures)
//   node scripts/check-codex-self-parity.mjs --help
//
// Exit codes (INV-53): 0=PASS, 1=FAIL (self-parity violation), 2=ERROR (config/environment,
// fail-closed — e.g. missing dist build, missing arbiter.json, invalid ledger).
//
// Runbook: docs/internal/METHOD/CODEX_PARITY_RUNBOOK.md (self-track parity section)
// Operator entry: website/problems/codex-parity.md

import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { scanTrackRoots, normalizeContent, readJsonIfExists } from './lib/codex-parity-lib.mjs'
import {
  stripLeadingFrontMatter,
  validateSelfDivergences,
  validateRuntimeArtifacts,
  classifySelfParity,
} from './lib/codex-self-parity-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// dist is ALWAYS this script's own repo build — --repo-root only moves the
// tree being resolved and scanned, never the generator that emits the truth.
const scriptRepoRoot = join(__dirname, '..')

const HELP = `Usage: node scripts/check-codex-self-parity.mjs [options]

Codex SELF-parity gate (ADR-106 addendum, #1966 self-track).

Options:
  --repo-root <dir>   Classify another materialized tree instead of this repo (tests only)
  --help, -h          Show this help and exit

Exit codes: 0=PASS, 1=FAIL, 2=ERROR (fail-closed).
`

function parseArgs(argv) {
  const args = { repoRoot: undefined, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--repo-root') {
      args.repoRoot = argv[++i]
      if (args.repoRoot === undefined) {
        process.stderr.write(`check-codex-self-parity: --repo-root requires a value\n${HELP}`)
        process.exit(2)
      }
    } else {
      process.stderr.write(`check-codex-self-parity: unknown argument ${a}\n${HELP}`)
      process.exit(2)
    }
  }
  return args
}

// The ledgers describe the tree they govern, so they resolve from the target
// root (identical to scriptRepoRoot on the real gate path; fixtures under
// --repo-root carry their own). Absence is exit 2 — a self gate without its
// ledger is unverifiable, not vacuously green.
function loadDataFile(root, name) {
  const data = readJsonIfExists(join(root, 'scripts', 'data', name))
  if (data === undefined) {
    throw new Error(`missing data file scripts/data/${name} (repo root: ${root})`)
  }
  return data
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    return 0
  }
  const root = args.repoRoot ?? scriptRepoRoot

  let divergences
  let runtimeArtifacts
  try {
    divergences = validateSelfDivergences(loadDataFile(root, 'codex-self-parity-divergences.json'))
    runtimeArtifacts = validateRuntimeArtifacts(
      loadDataFile(root, 'codex-self-parity-runtime-artifacts.json'),
    ).runtimeArtifacts
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    process.stderr.write(`check-codex-self-parity: ERROR — ${detail}\n`)
    return 2
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-codex-self-parity-'))
  try {
    // Emission — direct generator invocation via the COMPILED dist, the exact
    // precedent check-self-dogfood.mjs R-02 uses (scripts/ cannot import .ts
    // directly, #1267). Emitting into an empty temp dir means skipIfExists
    // never suppresses a write: the emission is the full, current truth.
    try {
      const distUrl = (p) => pathToFileURL(join(scriptRepoRoot, 'dist', p)).href
      const { loadConfig } = await import(distUrl('utils/config.js'))
      const { resolveProjectConfig } = await import(distUrl('config/resolve-project-config.js'))
      const { generateCodex } = await import(distUrl('generators/codex.js'))
      const stored = loadConfig(root)
      if (!stored) {
        process.stderr.write(
          `check-codex-self-parity: ERROR — no arbiter.json found at ${root}; ` +
            'without the stored config there is no resolved emission to compare against\n',
        )
        return 2
      }
      const { config } = resolveProjectConfig(root, 'arbiter', stored)
      generateCodex({ ...config, targetDir: tmpDir }, { dryRun: false })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const importShaped =
        err?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find (module|package)/.test(detail)
      process.stderr.write(
        `check-codex-self-parity: ERROR — emission failed: ${detail}${
          importShaped
            ? '. Run "npm run build" first — scripts/ cannot import .ts directly (#1267)'
            : ''
        }\n`,
      )
      return 2
    }

    // Independent denominator: filesystem scan of the codex track roots
    // (.agents/** + .codex/**) on both sides. The .claude half of
    // scanTrackRoots is discarded — generateCodexHooks also emits into
    // .claude/hooks/, outside this gate's scan roots by design (§3.1).
    const emittedFiles = scanTrackRoots(tmpDir, []).codex
    const repoFiles = scanTrackRoots(root, []).codex

    // Repo-side-only frontmatter strip (design §3.1 step 3 / M1): the repo doc
    // convention adds a YAML metadata block the codex templates never emit.
    // Markdown additionally goes through Prettier on BOTH sides before compare
    // (the check-self-dogfood normalizeLines precedent): the repo formatting
    // gate prettier-formats materialized .md, the generator emits unformatted --
    // formatting must be invisible to parity, exactly like frontmatter.
    const prettierMd = async (content) => {
      try {
        const prettier = await import('prettier')
        return await prettier.format(content, {
          parser: 'markdown',
          printWidth: 80,
          tabWidth: 2,
          useTabs: false,
          singleQuote: false,
          trailingComma: 'all',
          semi: true,
        })
      } catch {
        return content // prettier unavailable or parse error -- raw (dogfood precedent)
      }
    }
    const loadSide = async (files, read, stripFm) => {
      const map = new Map()
      for (const rel of files) {
        let content = read(rel)
        if (stripFm) content = stripLeadingFrontMatter(content)
        if (rel.endsWith('.md')) content = await prettierMd(content)
        map.set(rel, content)
      }
      return map
    }
    const emittedByPath = await loadSide(
      emittedFiles,
      (rel) => readFileSync(join(tmpDir, rel), 'utf-8'),
      false,
    )
    const repoByPath = await loadSide(
      repoFiles,
      (rel) => readFileSync(join(root, rel), 'utf-8'),
      true,
    )

    const { findings, surface } = classifySelfParity({
      emittedFiles,
      repoFiles,
      divergences,
      runtimeArtifacts,
      readEmitted: (rel) => emittedByPath.get(rel),
      readRepo: (rel) => repoByPath.get(rel),
      normalize: (content) => normalizeContent(content),
    })

    for (const f of findings) {
      process.stdout.write(
        `check-codex-self-parity: ${f.clazz.toUpperCase()} ${f.path} — ${f.detail}\n`,
      )
    }
    process.stdout.write(
      `check-codex-self-parity: parity-surface: ${surface.classified}/${surface.total}\n`,
    )
    process.stdout.write(
      findings.length === 0
        ? 'check-codex-self-parity: OK\n'
        : `check-codex-self-parity: FAIL — ${findings.length} finding(s); see ` +
            'docs/internal/METHOD/CODEX_PARITY_RUNBOOK.md (self-track parity section)\n',
    )
    return findings.length === 0 ? 0 : 1
  } finally {
    // NOT inside main's exit paths via process.exit: process.exit() skips
    // finally blocks, so main returns a code and the caller exits after
    // cleanup has actually run.
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

process.exit(await main())
