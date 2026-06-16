// SPDX-License-Identifier: Apache-2.0
// CANON-05/11: generator for the downstream gold-audit kit (#1419).
//
// Existing Code Survey (CANON-16): grepped `export function generate.*[Gg]old` in src/ → 0 results.
// The closest existing emitter, src/generators/conformance.ts, emits the CONFORMANCE scorecard
// runner (a different axis: scorecard vs gold-audit registry engine). No gold-audit kit generator
// exists. New file justified — architecturally distinct responsibility (gold registry data + a
// thin engine runner), separate lifecycle from the conformance scorecard. Models the thin-runner +
// skipIfExists pattern on conformance.ts (W1 #1398, INV-128).
//
// Red-team scope (BLOCKING): emit a THIN runner that delegates to `npx arbiter gold-audit --check`
// — NOT the 18KB engine or gold-audit-lib (CANON-16 dup; also avoids the npm `yaml` dep). Template
// ONLY genuine consumer DATA (standards/*). NO baseline seed, NEVER --require-baseline downstream.
import { writeFile, resolvedPath } from '../utils/fs.js'
import { renderTemplate } from '../utils/render.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GoldKitResult {
  files: WriteResult[]
}

/** Per-stack registry template id keyed by language (only stacks with a shipped registry). */
const PER_STACK_REGISTRY: Partial<Record<ProjectConfig['language'], string>> = {
  typescript: 'gold-registry.typescript.yml',
  java: 'gold-registry.java.yml',
  kotlin: 'gold-registry.java.yml',
}

/** Consumer-DATA standards every governed project gets (genuine per-project artifacts). */
const STANDARDS: ReadonlyArray<{ rel: string; tpl: string }> = [
  { rel: 'gold-registry.yml', tpl: 'standards/gold-registry.yml.ejs' },
  { rel: 'thresholds.yml', tpl: 'standards/thresholds.yml.ejs' },
  { rel: 'gold-doc-set.yml', tpl: 'standards/gold-doc-set.yml.ejs' },
  { rel: 'doc-profile', tpl: 'standards/doc-profile.ejs' },
]

/**
 * #1419: emit the downstream gold-audit kit for governed target projects:
 *   scripts/gold-audit.mjs       — thin runner → `npx arbiter gold-audit --check`
 *   standards/gold-registry.yml  — project-level registry (consumer DATA)
 *   standards/gold-registry.<stack>.yml — per-stack report-metric registry (TS / Java / Kotlin)
 *   standards/thresholds.yml     — per-brownfield-class threshold SSOT
 *   standards/gold-doc-set.yml   — canonical doc-set manifest
 *   standards/doc-profile        — per-repo overlay profile (empty default)
 *
 * All files are skipIfExists (a customised registry / profile is never overwritten on re-init).
 * NO `.gold-audit-baseline.json` seed is emitted — the advisory `--check` wiring bootstraps it on
 * first run (exit 0), so a fresh consumer has no day-1 redness.
 */
export function generateGoldKit(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): GoldKitResult {
  const base = config.targetDir
  const files: WriteResult[] = []

  // Thin runner — emitted unconditionally (also wired in check-all.ts UNCONDITIONAL_EMISSIONS).
  files.push(
    writeFile(
      resolvedPath(base, 'scripts', 'gold-audit.mjs'),
      renderTemplate('scripts/gold-audit.mjs.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // Consumer-DATA standards.
  for (const { rel, tpl } of STANDARDS) {
    files.push(
      writeFile(resolvedPath(base, 'standards', rel), renderTemplate(tpl, config), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    )
  }

  // Per-stack registry (only when a registry ships for the project language).
  const stackTpl = PER_STACK_REGISTRY[config.language]
  if (stackTpl) {
    files.push(
      writeFile(
        resolvedPath(base, 'standards', stackTpl.replace(/\.ejs$/, '')),
        renderTemplate(`standards/${stackTpl}.ejs`, config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files }
}
