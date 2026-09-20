// SPDX-License-Identifier: Apache-2.0
//
// #2490 — `init --json --dry-run` accepted `--json`, ignored it, printed the human
// banner and exited 0. A CI consumer that asked for machine-readable output got a
// success code and unparseable text — the worst of both, because a status check
// passes and the parse is what crashes.
//
// The relationship pinned here is JSON payload == human preview, never a path count:
// #2452 already pins human preview == the plan the real run executes, so a template
// added tomorrow moves both sides at once and these tests stay green.
import { describe, it, expect, afterEach } from 'vitest'
import { createTestProject, initGit, cleanupTestProject } from '../helpers.js'
import { runInit } from '../../src/commands/init.js'
import type { InitOptions } from '../../src/commands/init.js'

const created: string[] = []

function seedProject(): string {
  const dir = createTestProject('go')
  initGit(dir)
  created.push(dir)
  return dir
}

function dryRunOptions(dir: string, json: boolean): InitOptions {
  return {
    yes: true,
    tools: 'claude',
    level: 'L2',
    dir,
    dryRun: true,
    brownfield: false,
    noVerify: true,
    quiet: true,
    json,
  }
}

/** Capture stdout for one run. The dry run writes nothing to disk by contract. */
async function captureInit(dir: string, json: boolean): Promise<string> {
  const original = process.stdout.write.bind(process.stdout)
  let out = ''
  process.stdout.write = ((chunk: unknown): boolean => {
    out += String(chunk)
    return true
  }) as typeof process.stdout.write
  try {
    await runInit(dryRunOptions(dir, json))
  } finally {
    process.stdout.write = original
  }
  return out
}

/**
 * Paths the human preview names, read off the three bucket prefixes rendered by
 * `displayDryRunPreview` (`cli.init.dry_run_*_file` in src/i18n/en.json).
 */
function humanPreviewPaths(out: string): string[] {
  return out
    .split('\n')
    .map((line) => /^ {2}[+~=] (.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1] as string)
    .sort()
}

function envelopePaths(data: Record<string, unknown>): string[] {
  const files = data['files'] as Record<string, string[]>
  return [...files['created'], ...files['modified'], ...files['skipped']].sort()
}

describe('#2490 — init --json --dry-run emits the JSON envelope', () => {
  afterEach(() => {
    while (created.length > 0) cleanupTestProject(created.pop() as string)
  })

  it('AC-1/AC-2: stdout is exactly one parseable init envelope, not the human banner', async () => {
    const out = await captureInit(seedProject(), true)

    const lines = out.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)

    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>
    expect(parsed['command']).toBe('init')
    expect(parsed['status']).toBe('ok')
    expect((parsed['data'] as Record<string, unknown>)['dryRun']).toBe(true)
  }, 180_000)

  it('AC-3: the payload names the same paths the human preview reports', async () => {
    // Two dirs, not one: runInit creates .arbiter/ and takes a lock before the
    // dry-run branch, so a second run on the same tree is not a clean repeat.
    const human = humanPreviewPaths(await captureInit(seedProject(), false))
    const json = JSON.parse(await captureInit(seedProject(), true)) as Record<string, unknown>

    expect(human.length).toBeGreaterThan(0)
    expect(envelopePaths(json['data'] as Record<string, unknown>)).toEqual(human)
  }, 180_000)

  it('AC-1: the payload carries the caveat the human surface prints', async () => {
    // The doc-set skeletons cannot be previewed (#2452), and the human output says so
    // out loud. A machine consumer must not read `files` as exhaustive either.
    const json = JSON.parse(await captureInit(seedProject(), true)) as Record<string, unknown>
    const warnings = json['warnings'] as string[]

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('doc-set skeletons')
  }, 180_000)
})
