// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1685 — the arbiter self-scan checkov step must be honestly
// SCOPED to the real IaC frameworks (terraform/kubernetes/dockerfile) via an
// inline space-separated `framework` list, not soft-fail-suppressed or
// `all`-scanned (INV-80). The list is INLINE (no `.checkov.yaml` config_file):
// docker-container actions on the containerized runner slots bind-mount the
// workspace path from the DOCKER HOST, so a repo-local config file is not
// reliably visible inside the action container (ENOENT on CI, green locally).
// Reads the REAL materialized workflow (not a render) so it catches drift
// between the committed self workflow and the intended self-only scope.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'

const WORKFLOW_PATH = '.github/workflows/01-pr-fast.yml'

function iacJobBody(workflow: string): string {
  return (workflow.split('  iac-scan:')[1] ?? '').split(/\n {2}(?=\S)/)[0]
}

function iacCheckovStep(workflow: string): string {
  const jobBody = iacJobBody(workflow)
  const stepStart = jobBody.indexOf('bridgecrewio/checkov-action')
  expect(stepStart, 'checkov-action step must exist in iac-scan job').toBeGreaterThanOrEqual(0)
  // Slice from the `uses:` line to the next step dash (`\n      - `).
  const afterUses = jobBody.slice(stepStart)
  const nextStep = afterUses.indexOf('\n      - ', 1)
  return nextStep === -1 ? afterUses : afterUses.slice(0, nextStep)
}

describe('self iac-scan scope (#1685, INV-80)', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf-8')
  const checkovStep = iacCheckovStep(workflow)

  it('self checkov step is scoped via a space-separated framework list, not `framework: all`', () => {
    // Space-separated: the action entrypoint expands `--framework $INPUT_FRAMEWORK`
    // UNQUOTED and checkov's `--framework` is nargs='+', so the list word-splits
    // into real multi-value scoping. A comma-join crashes checkov ("invalid
    // choice"); `all` over-scopes (github_actions/secrets noise on zero-IaC repo).
    expect(checkovStep).toMatch(/^\s*framework: terraform kubernetes dockerfile\s*$/m)
    expect(checkovStep).not.toMatch(/^\s*framework: all\s*$/m)
    expect(checkovStep).not.toContain('framework: terraform,kubernetes,dockerfile')
  })

  it('self checkov step has no workspace-file config dependency (config_file unreliable on containerized runner slots)', () => {
    expect(checkovStep).not.toContain('config_file:')
    expect(workflow).not.toContain('.checkov.yaml')
    expect(existsSync('.checkov.yaml'), 'repo-local .checkov.yaml must be gone').toBe(false)
  })

  it('self checkov step keeps soft_fail: false (real misconfig still blocks)', () => {
    expect(checkovStep).toContain('soft_fail: false')
  })

  it('self checkov step does not hide findings via skip/soft-fail knobs (scoped, not suppressed)', () => {
    expect(checkovStep).not.toContain('skip_check')
    expect(checkovStep).not.toContain('soft_fail_on')
    expect(checkovStep).not.toContain('hard_fail_on')
  })

  it('iac-scan job pins runs-on to a literal GitHub-hosted runner, not the self-hosted expression (#1756)', () => {
    // #1756: checkov-action is a docker-container action. On the containerized
    // self-hosted "arbiter-slot-build-*" runner slots, docker-container
    // actions bind-mount /github/workspace from the DOCKER HOST path, not the
    // slot's own checkout — the step sees stale/wrong/missing files. Pin this
    // job's runs-on to a literal GitHub-hosted runner so it never lands on
    // that self-hosted pool, regardless of vars.RUNNER_LABELS_TEST.
    const jobBody = iacJobBody(workflow)
    expect(jobBody).toMatch(/^\s*runs-on: ubuntu-latest\s*$/m)
    expect(jobBody).not.toMatch(/^\s*runs-on: \$\{\{/m)
    expect(jobBody).not.toContain('fromJSON(vars.')
  })
})
