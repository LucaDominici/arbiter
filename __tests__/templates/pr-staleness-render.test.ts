// SPDX-License-Identifier: Apache-2.0
/**
 * Execution test for the emitted `_pr-staleness.yml` step (#1588).
 *
 * A structural YAML lint cannot catch the two runtime-dead defects this guards:
 *   1. `gh pr list | python3 - <<'EOF'` collided the pipe with the heredoc on
 *      stdin, so the PR JSON was discarded and `json.load(sys.stdin)` crashed
 *      (JSONDecodeError). Fixed by redirecting `gh pr list` to a file the script
 *      reads, leaving stdin free for the heredoc program.
 *   2. NOW/STALE_CUTOFF/CLOSE_CUTOFF were plain (unexported) shell vars, so the
 *      child python's `os.environ[...]` raised KeyError. Fixed by `export`-ing
 *      them.
 *
 * Either defect alone exits non-zero, so the scheduled run was permanently RED
 * and never marked or closed a single PR. This test renders the workflow, parses
 * the real step script via js-yaml, and EXECUTES it under python3 with a stubbed
 * `gh` and a fixture PR list — the only way to prove the step actually runs.
 *
 * Existing Code Survey (CANON-16): test-only file; no new production source.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderStalenessStep(): string {
  const data = makeConfig('/tmp/arbiter-pr-staleness', {}) as unknown as Record<string, unknown>
  const rendered = renderTemplate('github/workflows/_pr-staleness.yml.ejs', data)
  const doc = yaml.load(rendered) as {
    jobs: { stale: { steps: Array<{ run?: string }> } }
  }
  const step = doc.jobs.stale.steps.find(
    (s) => typeof s.run === 'string' && s.run.includes('gh pr'),
  )
  if (!step?.run) throw new Error('staleness step with a run: script not found')
  return step.run
}

/** ISO-8601 UTC timestamp `daysAgo` days before now, matching the script's parse format. */
function isoDaysAgo(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400 * 1000)
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

describe('_pr-staleness.yml — runtime execution (#1588)', () => {
  it('the rendered script is valid YAML and contains a runnable step', () => {
    expect(() => renderStalenessStep()).not.toThrow()
  })

  it('executes under python3 without JSONDecodeError/KeyError and branches on the cutoffs', () => {
    const script = renderStalenessStep()
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-staleness-'))
    try {
      // Fixture: one to close (40d, untagged), one to mark stale (20d, untagged),
      // one exempt (40d but no-stale), one fresh (1d). Timestamps sit far from the
      // 14/28-day cutoff boundaries so the script's mktime/strptime tz offset
      // (pre-existing, out of scope) cannot flip the branch.
      const prs = [
        { number: 101, updatedAt: isoDaysAgo(40), labels: [] },
        { number: 102, updatedAt: isoDaysAgo(20), labels: [] },
        { number: 103, updatedAt: isoDaysAgo(40), labels: [{ name: 'no-stale' }] },
        { number: 104, updatedAt: isoDaysAgo(1), labels: [] },
      ]
      // Stub `gh`: emit the fixture JSON for `pr list`, no-op (exit 0) otherwise.
      const ghStub = join(dir, 'gh')
      writeFileSync(
        ghStub,
        `#!/usr/bin/env bash\nif [[ "$1" == "pr" && "$2" == "list" ]]; then\n  cat <<'JSON'\n${JSON.stringify(prs)}\nJSON\nfi\nexit 0\n`,
      )
      chmodSync(ghStub, 0o755)

      const res = spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH ?? ''}`,
          GH_TOKEN: 'stub-token',
          GH_REPO: 'owner/repo',
        },
      })

      expect(res.stderr ?? '').not.toMatch(/JSONDecodeError|KeyError/)
      expect(res.status, `script exited non-zero. stderr:\n${res.stderr}`).toBe(0)
      // Defect-2 proof: cutoffs resolved and branched.
      expect(res.stdout).toContain('Closed stale PR #101')
      expect(res.stdout).toContain('Marked PR #102 as stale')
      // Exempt + fresh PRs produce no action.
      expect(res.stdout).not.toContain('#103')
      expect(res.stdout).not.toContain('#104')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
