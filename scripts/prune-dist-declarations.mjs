#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Build step (#2660): keeps in dist/ only the .d.ts files a consumer can reach from the
// CATALOG: package.json `exports` entry points, as resolved by tsc itself (--listFiles on a probe
// CATALOG: importing every entry). Everything else is arbiter-internal typing and is deleted before
// CATALOG: packing, so `files` can stay a plain whitelist (`dist`) with no negation entries and no
// CATALOG: hand-maintained list. Verified by __tests__/scripts/pack-surface-2660.test.ts.
//
// Usage: node scripts/prune-dist-declarations.mjs [--root <dir>] [--dry-run]
// Exit codes (INV-53): 0 pruned (or nothing to prune); 2 tsc probe failed or no closure found.
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isMainModule } from './lib/run-helpers.mjs'

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** The .d.ts files tsc loads when a consumer imports every `exports` entry of the package at root. */
export function declarationClosure(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
  const entries = Object.values(pkg.exports ?? {})
    .map((e) => (typeof e === 'string' ? e : e?.import))
    .filter(Boolean)
    .map((p) => resolve(root, p))
  if (entries.length === 0) throw new Error('package.json exports has no import entry points')
  const probeDir = mkdtempSync(join(tmpdir(), 'arbiter-dts-closure-'))
  try {
    const probe = join(probeDir, 'probe.ts')
    writeFileSync(
      probe,
      entries.map((p, i) => `import * as m${i} from '${p}'`).join('\n') +
        `\nexport const all = [${entries.map((_, i) => `m${i}`).join(', ')}]\n`,
    )
    const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
    const out = execFileSync(
      process.execPath,
      [
        tsc,
        '--ignoreConfig',
        '--noEmit',
        '--listFiles',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--target',
        'es2022',
        '--types',
        'node',
        '--skipLibCheck',
        probe,
      ],
      { cwd: root, encoding: 'utf-8' },
    )
    const distPrefix = join(root, 'dist') + '/'
    return new Set(out.split('\n').filter((l) => l.startsWith(distPrefix) && l.endsWith('.d.ts')))
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

export function pruneDistDeclarations(root, { dryRun = false } = {}) {
  const keep = declarationClosure(root)
  if (keep.size === 0) throw new Error('tsc resolved no dist/*.d.ts from the exports entry points')
  const all = walk(join(root, 'dist'))
  const pruned = all.filter((f) => !keep.has(f))
  if (!dryRun) for (const f of pruned) unlinkSync(f)
  return { kept: all.length - pruned.length, pruned: pruned.length }
}

if (isMainModule(import.meta.url)) {
  try {
    const argv = process.argv.slice(2)
    const rootIdx = argv.indexOf('--root')
    const root = resolve(rootIdx === -1 ? process.cwd() : argv[rootIdx + 1])
    const { kept, pruned } = pruneDistDeclarations(root, { dryRun: argv.includes('--dry-run') })
    process.stderr.write(
      `prune-dist-declarations: kept ${kept} reachable .d.ts, pruned ${pruned}\n`,
    )
  } catch (err) {
    process.stderr.write(
      `prune-dist-declarations: ERROR — ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
}
