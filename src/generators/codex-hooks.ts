// SPDX-License-Identifier: Apache-2.0
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { formatContent } from '../utils/prettier-format.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface CodexHooksGeneratorResult {
  files: WriteResult[]
}

// #1885: the 6 guard hooks that codex/config.toml.ejs wires unconditionally through
// codex-adapter.mjs. These live under .claude/hooks/ — tool-agnostic scripts (they
// already branch on stdin-JSON vs env var via lib.mjs's resolveToolInput{Path,Command},
// #1565). Before this fix, codex-only projects (no `claude` in tools) never got these
// files: generateClaudeHooks (claude.ts) is the only emitter and only runs when `claude`
// is selected, so config.toml pointed at 6 nonexistent scripts and codex-adapter.mjs's
// execFileSync crashed on every PreToolUse/PostToolUse call, blocking all bash/apply_patch.
// Exported (not just module-local) so derived-class.ts (#1983) can build the
// `.claude/hooks/*` refresh-set from this single list rather than a hand-copied
// path array — the two can never independently drift on which hooks are
// codex-track `skipIfExists` emissions.
export const SHARED_GUARD_HOOKS = [
  'stop-dangerous.mjs',
  'enforce-read-only.mjs',
  'pre-edit-ssot-guard.mjs',
  'check-no-orphan-todo.mjs',
  'check-no-placeholders.mjs',
] as const

export function generateCodexHooks(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CodexHooksGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config
  const hooksDir = resolvedPath(base, '.claude', 'hooks')

  // Sole-emitter contract (#1578/INV-128): a path may be emitted by exactly one
  // enabled registry generator. When `claude` is ALSO selected, generateClaudeHooks
  // (claude.ts) already emits these same files — codex-hooks.ts must defer to it
  // rather than duplicate-emit, or `arbiter diff`/the generated-manifest would see
  // the same path claimed by two generators (the #1318.2 double-write class). Only
  // take ownership when codex is the ONLY AI tool selected, i.e. claude.ts will not run.
  if (!config.tools.includes('claude')) {
    // .claude/hooks/lib.mjs — shared utility module the guard hooks below import from.
    results.push(
      writeFile(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', data), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    )

    for (const hookFile of SHARED_GUARD_HOOKS) {
      const templateFile =
        hookFile === 'check-no-orphan-todo.mjs' || hookFile === 'check-no-placeholders.mjs'
          ? `${hookFile}.ejs`
          : hookFile
      results.push(
        writeFile(join(hooksDir, hookFile), renderTemplate(`claude/hooks/${templateFile}`, data), {
          skipIfExists: true,
          dryRun: opts.dryRun,
        }),
      )
    }

    // check-no-skipped-tests.mjs — same opt-out flag as generateClaudeHooks (claude.ts).
    // Secondary bug fixed alongside the crash: config.toml.ejs referenced this hook
    // unconditionally even when enableNoSkippedTests:false, leaving one dangling
    // reference for a codex-only project with the flag off.
    if (config.enableNoSkippedTests !== false) {
      results.push(
        writeFile(
          join(hooksDir, 'check-no-skipped-tests.mjs'),
          renderTemplate('claude/hooks/check-no-skipped-tests.mjs', data),
          { skipIfExists: true, dryRun: opts.dryRun },
        ),
      )
    }
  }

  // .codex/config.toml — always rewrite so hook wiring stays current; backup preserves customizations
  results.push(
    writeFile(
      resolvedPath(base, '.codex', 'config.toml'),
      renderTemplate('codex/config.toml.ejs', data),
      { backup: true, dryRun: opts.dryRun },
    ),
  )

  // .codex/codex-adapter.mjs — copied from static template; skip if exists.
  // Format the content to the target's prettier style BEFORE writing (#933 F13),
  // so the recorded render hash matches the bytes on disk (#1349 — no post-write
  // reformat that would desync the generated-manifest).
  const adapterSrc = join(__dirname, '..', 'templates', 'codex', 'codex-adapter.mjs')
  const adapterDest = join(resolvedPath(base, '.codex'), 'codex-adapter.mjs')
  const adapterContent = formatContent(readFileSync(adapterSrc, 'utf-8'), adapterDest, base)
  results.push(
    writeFile(adapterDest, adapterContent, {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )

  return { files: results }
}
