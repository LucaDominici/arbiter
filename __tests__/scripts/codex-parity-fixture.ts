// SPDX-License-Identifier: Apache-2.0
// Fixture builders for the codex-track parity contract tests (ADR-106, #1966).
//
// Every mutation here operates on an ISOLATED tmpdir bake — never the live
// worktree (design §Test plan, Q5-C correction). The bake uses the REAL
// generators (generateClaude + generateCodex) so fixtures cannot drift from
// the product's emission logic; mutations are then applied to the baked COPY.

import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateClaude } from '../../src/generators/claude.js'
import { generateCodex } from '../../src/generators/codex.js'
import { generateSecurity } from '../../src/generators/security.js'
import { generateWiki } from '../../src/generators/wiki.js'
import { generateSkills } from '../../src/generators/skills.js'
import { generateAgentsClaude } from '../../src/generators/agents-claude.js'
import { makeConfig } from '../helpers.js'
import {
  scanTrackRoots,
  readJsonIfExists,
  CANON22_HEADING,
} from '../../scripts/lib/codex-parity-lib.mjs'
import type { ProjectConfig } from '../../src/wizard/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

export const GOLDENS_DIR = join(repoRoot, '__tests__', 'fixtures', 'codex-parity', 'golden')
export const DATA_DIR = join(repoRoot, 'scripts', 'data')

/**
 * Bake BOTH tracks into a fresh unique tmpdir with the real generators.
 * security + wiki are included because they also emit .claude/hooks/ files
 * (check-no-pii.mjs, wiki-on-commit.mjs) that the generated Known Limitations
 * table discloses; skills + agents populate the .claude/skills|agents/
 * surfaces covered by the BY-DESIGN-EXCLUSIVE declarations — omitting any of
 * them would make every fixture bake self-inconsistent (stale table rows or
 * stale exclusive declarations).
 */
export function bakeBothTracks(overrides: Partial<ProjectConfig> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-parity-'))
  const config = makeConfig(dir, overrides)
  generateClaude(config)
  generateCodex(config)
  generateSkills(config, [])
  generateAgentsClaude(config)
  if (config.enableSecurityScanning) generateSecurity(config)
  if (config.governanceLevel !== 'L1') generateWiki(config)
  return dir
}

/** Remove a baked fixture tree (call from afterEach/finally). */
export function cleanupBake(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Mutation 3a (#1966 regression): strip the CANON-22 Root-Cause Discipline
 * section from the BAKED codex-side exec-protocol rule. Idempotent: if the
 * section is already absent (the live bug this wave fixes), the file is left
 * as-is — either way the resulting fixture presents a codex derivation
 * lacking CANON-22 while the claude side retains it.
 */
export function dropCanon22(bakedDir: string): void {
  const file = join(bakedDir, '.agents', 'rules', '90-exec-protocol.md')
  if (!existsSync(file)) throw new Error(`fixture bake incomplete: ${file} missing`)
  const text = readFileSync(file, 'utf-8')
  const idx = text.indexOf(CANON22_HEADING)
  if (idx === -1) return
  writeFileSync(file, text.slice(0, idx).trimEnd() + '\n')
}

export interface ParityCtxOverrides {
  manifestFiles?: string[]
  allowlist?: unknown
  exclusive?: unknown
  baseline?: unknown
  mergeBaseBaseline?: unknown
  exclusions?: string[]
}

/**
 * Build a self-consistent runParityCheck() options object for a baked fixture:
 * the manifest defaults to the actual scan (so manifest-reconcile is neutral
 * unless a test overrides it) and the data files default to the committed
 * scripts/data/ contents (empty structures while those land in GREEN).
 */
export function parityCtx(bakedDir: string, overrides: ParityCtxOverrides = {}) {
  const scan = scanTrackRoots(bakedDir, overrides.exclusions ?? [])
  const manifestFiles = overrides.manifestFiles ?? [...scan.claude, ...scan.codex]
  const allowlist = overrides.allowlist ??
    readJsonIfExists(join(DATA_DIR, 'codex-parity-allowlist.json')) ?? {
      $schemaVersion: 1,
      entries: [],
    }
  const exclusive = overrides.exclusive ??
    readJsonIfExists(join(DATA_DIR, 'codex-parity-exclusive.json')) ?? {
      $schemaVersion: 1,
      declarations: [],
      knownLimitationsInfra: [],
      scanExclusions: [],
    }
  const baseline = overrides.baseline ?? {
    $schemaVersion: 1,
    tracks: { claude: { files: scan.claude }, codex: { files: scan.codex } },
    removals: [],
  }
  return {
    bakedDir,
    manifestFiles,
    allowlist,
    exclusive,
    baseline,
    mergeBaseBaseline: overrides.mergeBaseBaseline ?? 'BOOTSTRAP',
    goldensDir: GOLDENS_DIR,
    exclusions: overrides.exclusions ?? [],
  }
}
