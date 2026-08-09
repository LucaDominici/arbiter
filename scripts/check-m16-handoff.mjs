#!/usr/bin/env node
// CATALOG: #2103 M16 handoff-contract gate — verifies a fixed corpus of dispatch-brief
// CATALOG: sources (wave-drain/drain SKILL.md, agent-orchestration-and-context-hygiene.md)
// CATALOG: carries the literal M16_HANDOFF_MARKER string ("subagents never own waits"),
// CATALOG: catching a brief that still tells a worker to wait on the gate itself.
// CATALOG: rejected fold-in into check-handoff-doc.mjs because that lints the dynamically
// CATALOG: discovered HANDOFF.template.md task-section contract (What/Where/AC/Verify/tier);
// CATALOG: this checks a fixed literal marker string across a fixed corpus — different shape.
// CATALOG: rejected fold-in into check-phantom-command-scan.mjs because that cross-checks
// CATALOG: `arbiter <cmd>` citations in prose against the CLI SSOT — an unrelated concern.
//
// check-m16-handoff.mjs (#2103) — SOFT gate: dispatch-template files must carry the
// M16 handoff-contract marker ("subagents never own waits").
//
// M16 terminal handoff — subagents never own waits: a dispatched worker ends its brief
// at commit + launch + structured handoff {SHA, worktree, PID, exit-file, log} with an
// explicit END-TURN; ALL watches belong to the coordinator (bg-run.sh + pid-watch.sh).
// Every dispatch template (ship-queue / wave-drain briefs) must carry the marker below
// so a brief that still tells the worker to "wait for the gate" is caught at the door.
//
// Corpus (repo-relative, fixed per the wave-3 plan — NOT .claude/plans/, to avoid
// self-recursion of the wave plan itself):
//   .claude/skills/wave-drain/SKILL.md
//   .claude/skills/drain/SKILL.md
//   docs/methodology/agent-orchestration-and-context-hygiene.md
// A corpus file that does not exist in this repo is SKIPPED (the skill may not be
// installed); an EXISTING file without the marker FAILS, naming the file.
//
// Usage:
//   node scripts/check-m16-handoff.mjs               # check the repo corpus (0/1)
//   node scripts/check-m16-handoff.mjs --root <dir>  # alternate repo root
//   node scripts/check-m16-handoff.mjs --self-test   # pure fixtures, no repo needed
// Exit codes (INV-53): 0 PASS, 1 FAIL, 2 invocation/IO error.
import { existsSync, readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const M16_HANDOFF_MARKER = 'M16 handoff-contract: subagents never own waits'

export const M16_CORPUS = [
  '.claude/skills/wave-drain/SKILL.md',
  '.claude/skills/drain/SKILL.md',
  'docs/methodology/agent-orchestration-and-context-hygiene.md',
]

/** Files in the corpus that EXIST but lack the marker. Empty ⇒ pass. */
export function missingMarkers(root) {
  const missing = []
  for (const rel of M16_CORPUS) {
    const p = join(root, rel)
    if (!existsSync(p)) continue
    if (!readFileSync(p, 'utf-8').includes(M16_HANDOFF_MARKER)) missing.push(rel)
  }
  return missing
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'm16-handoff-self-test-'))
  const marked = `# Wave Drain\n\n${M16_HANDOFF_MARKER}\n`
  const unmarked = '# Wave Drain\n\nBrief agents in parallel.\n'
  try {
    const ok = join(dir, '.claude', 'skills', 'wave-drain')
    const bad = join(dir, '.claude', 'skills', 'drain')
    mkdirSync(ok, { recursive: true })
    mkdirSync(bad, { recursive: true })
    writeFileSync(join(ok, 'SKILL.md'), marked)
    writeFileSync(join(bad, 'SKILL.md'), unmarked)
    const missing = missingMarkers(dir)
    if (missing.length !== 1 || !missing[0].endsWith('drain/SKILL.md')) {
      process.stderr.write(
        `check-m16-handoff self-test FAILED: expected exactly drain/SKILL.md missing, got ${JSON.stringify(missing)}\n`,
      )
      return 1
    }
    writeFileSync(join(bad, 'SKILL.md'), marked)
    if (missingMarkers(dir).length !== 0) {
      process.stderr.write('check-m16-handoff self-test FAILED: fully-marked corpus must pass\n')
      return 1
    }
    process.stdout.write(
      'check-m16-handoff self-test OK (marker-less corpus fails, marked passes)\n',
    )
    return 0
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

try {
  const args = process.argv.slice(2)
  if (args.includes('--self-test')) {
    process.exit(selfTest())
  }
  let root = process.cwd()
  const rootIdx = args.indexOf('--root')
  if (rootIdx >= 0 && args[rootIdx + 1] !== undefined) {
    root = resolve(args[rootIdx + 1])
  } else if (rootIdx >= 0) {
    process.stderr.write('check-m16-handoff: --root requires a directory argument\n')
    process.exit(2)
  }
  const missing = missingMarkers(root)
  if (missing.length > 0) {
    process.stderr.write(
      `check-m16-handoff: M16 handoff-contract marker missing from:\n  ${missing.join('\n  ')}\n` +
        `Add the line "${M16_HANDOFF_MARKER}" to each dispatch template (see docs/methodology/agent-orchestration-and-context-hygiene.md M16).\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    'check-m16-handoff: OK — every dispatch-template corpus file carries the M16 handoff-contract marker\n',
  )
} catch (err) {
  process.stderr.write(`check-m16-handoff: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
