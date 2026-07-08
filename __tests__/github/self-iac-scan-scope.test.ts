// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1685 — the arbiter self-scan checkov step must be honestly
// SCOPED to the real IaC frameworks (terraform/kubernetes/dockerfile) via
// a `--framework` flag list, not soft-fail-suppressed or `all`-scanned
// (INV-80). #1785: checkov now runs as a pip-installed CLI (no
// docker-container action, no workspace bind-mount risk) — the `--framework`
// arguments are passed directly on the command line, no word-splitting
// footgun to guard against anymore.
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
  const stepStart = jobBody.indexOf('Checkov IaC scan')
  expect(stepStart, 'Checkov IaC scan step must exist in iac-scan job').toBeGreaterThanOrEqual(0)
  // Slice from the step name to the next step dash (`\n      - `).
  const afterName = jobBody.slice(stepStart)
  const nextStep = afterName.indexOf('\n      - ', 1)
  return nextStep === -1 ? afterName : afterName.slice(0, nextStep)
}

describe('self iac-scan scope (#1685, INV-80, #1785)', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf-8')
  const checkovStep = iacCheckovStep(workflow)

  it('self checkov step is scoped via --framework flags, not `--framework all`', () => {
    expect(checkovStep).toMatch(
      /checkov --directory \. --framework terraform kubernetes dockerfile/,
    )
    expect(checkovStep).not.toMatch(/--framework all\b/)
    expect(checkovStep).not.toContain('--framework terraform,kubernetes,dockerfile')
  })

  it('self checkov step has no workspace-file config dependency (unreliable on containerized runner slots)', () => {
    expect(checkovStep).not.toContain('--config-file')
    expect(workflow).not.toContain('.checkov.yaml')
    expect(existsSync('.checkov.yaml'), 'repo-local .checkov.yaml must be gone').toBe(false)
  })

  it('self checkov step keeps hard-fail (no --soft-fail — real misconfig still blocks)', () => {
    expect(checkovStep).not.toContain('--soft-fail')
  })

  it('self checkov step does not hide findings via skip/soft-fail flags (scoped, not suppressed)', () => {
    expect(checkovStep).not.toContain('--skip-check')
    expect(checkovStep).not.toContain('--soft-fail-on')
    expect(checkovStep).not.toContain('--hard-fail-on')
  })

  it('iac-scan uses a plain pip-installed checkov CLI, not the docker-container action (#1785)', () => {
    // Bare substring not asserted here — the job's own explanatory comment
    // legitimately names bridgecrewio/checkov-action for historical context.
    // What matters is that it is never actually invoked via `uses:`.
    expect(workflow).not.toMatch(/uses:\s*bridgecrewio\/checkov-action/)
    const jobBody = iacJobBody(workflow)
    expect(jobBody).toContain('pip install checkov==')
  })

  it('iac-scan job pins runs-on to a literal GitHub-hosted runner, not the self-hosted expression', () => {
    // #1785: literal `ubuntu-latest` does NOT guarantee real GitHub-hosted
    // infra in this environment (evidenced: run 28693108584 serviced by
    // self-hosted arbiter-slot-build-3) — the real safety fix is that checkov
    // is no longer a docker-container action at all, so the runner label is
    // moot for THIS defect class. The literal pin is kept for other reasons
    // (cost/consistency), not as the safety mechanism.
    const jobBody = iacJobBody(workflow)
    expect(jobBody).toMatch(/^\s*runs-on: ubuntu-latest\s*$/m)
    expect(jobBody).not.toMatch(/^\s*runs-on: \$\{\{/m)
    expect(jobBody).not.toContain('fromJSON(vars.')
  })
})
