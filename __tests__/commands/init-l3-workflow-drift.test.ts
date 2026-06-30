// SPDX-License-Identifier: Apache-2.0
// #1678: drift-detection for deriveWorkflowCapabilities. The gate mirrors the github.ts
// + EJS workflow emission predicates; this test runs the REAL github generator (which
// makes the file-emission decisions AND renders the EJS) for sample configs, parses the
// generated workflow YAML, and asserts the actually-emitted (non-disabled) jobs' tools
// match what deriveWorkflowCapabilities claims. Independent of the gate's TS attribution
// — it observes the rendered YAML's job content, not the mirror's assumptions.
//
// Accuracy notes: a dim is "emitted" only by a job that is NOT `if: false` (a disabled job
// like `dast-full` for a non-service repo is rendered but does not run) AND whose content
// (steps' uses/run) contains the dim's tool. This avoids two false-match classes that
// naive text-grep hits: (a) tool names in YAML comments, (b) disabled (`if: false`) jobs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateGithub } from '../../src/generators/github.js'
import { deriveWorkflowCapabilities } from '../../src/commands/init.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

// A dim's tool signature matched against a job's content (steps' uses/run/name via
// JSON.stringify). Chosen to match the actual tool/action invocation, not job names, so
// they survive job renames and catch step-level emission (e.g. 04-deploy-test's Trivy runs
// inside `build-and-sign`, not a `container-scan` job).
const DIM_TO_TOOL: Record<string, RegExp> = {
  secret_scan: /gitleaks/i,
  license_scan: /license-scan|license-audit/i,
  container_scan: /trivy/i,
  sbom: /"sbom"|syft|cyclonedx/i,
  binary_signing: /cosign sign/i, // sign (not cosign verify = provenance consume)
  provenance: /slsa-provenance|attest-build-provenance|slsa-github/i,
  fuzz: /\bfuzz\b|fast-check|jqwik|go-fuzz|atheris|cargo-fuzz/i,
  dast: /dast-full|dast-baseline|\bzap\b/i,
}

/** Jobs in a rendered workflow file that are NOT disabled (`if: false`). */
function activeJobs(text: string): { name: string; content: string }[] {
  let doc: Record<string, unknown> | undefined
  try {
    doc = parseYaml(text) as Record<string, unknown> | undefined
  } catch {
    return []
  }
  const jobs = (doc?.jobs ?? {}) as Record<string, { if?: unknown }>
  return Object.entries(jobs)
    .filter(([, job]) => job?.if !== false && job?.if !== 'false')
    .map(([name, job]) => ({ name, content: JSON.stringify(job) }))
}

/** The set of workflow dims the generator actually emitted (active job with the tool). */
function emittedDims(config: ProjectConfig): Set<string> {
  const wdir = join(config.targetDir, '.github', 'workflows')
  const files = readdirSync(wdir).filter((f) => f.endsWith('.yml'))
  const jobs = files.flatMap((f) => activeJobs(readFileSync(join(wdir, f), 'utf8')))
  const out = new Set<string>()
  for (const { content } of jobs) {
    for (const [dim, tool] of Object.entries(DIM_TO_TOOL)) {
      if (tool.test(content)) out.add(dim)
    }
  }
  return out
}

function runGithub(overrides: Partial<ProjectConfig>): { config: ProjectConfig; dims: Set<string> } {
  const dir = mkdtempSync(join(tmpdir(), 'l3-drift-'))
  const config = makeConfig(dir, {
    governanceLevel: 'L3',
    language: 'typescript',
    archetype: 'backend-web-db',
    useGitHub: true,
    pipelineStyle: 'standard',
    collaborationMode: 'peer-review',
    enableSecurityScanning: true,
    ...overrides,
  })
  generateGithub(config, { dryRun: false })
  return { config, dims: emittedDims(config) }
}

describe('deriveWorkflowCapabilities — drift vs the real github generator (#1678)', () => {
  let dirs: string[] = []
  beforeEach(() => {
    dirs = []
  })
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

  function gateDims(config: ProjectConfig): Set<string> {
    return new Set(deriveWorkflowCapabilities(config).map((c) => c.feature))
  }

  // The gate's claimed dims must match the generator's actually-emitted (active) dims for
  // the sampled configs — no false-block (gate claims a dim the generator doesn't emit) and
  // no false-pass (generator emits a dim the gate doesn't claim). typescript has matrix
  // cells for all 8 dims, so the gate doesn't skip any (the comparison is exact).
  function assertMatch(label: string, overrides: Partial<ProjectConfig>): void {
    const { config, dims } = runGithub(overrides)
    dirs.push(config.targetDir)
    const gate = gateDims(config)
    for (const d of gate) {
      expect(dims, `${label}: gate claims ${d} but generator did not emit it (false-block)`).toContain(d)
    }
    for (const d of dims) {
      expect(gate, `${label}: generator emits ${d} but gate does not claim it (false-pass)`).toContain(d)
    }
  }

  it('typescript service standard L3: gate dims match the generated active jobs', () => {
    assertMatch('ts-service-standard', {})
  })

  it('non-service lib standard L3 (no deploy): no container_scan/dast (no false-block)', () => {
    assertMatch('ts-lib-no-deploy', { archetype: 'library', deployTarget: undefined })
  })

  it('non-service lib WITH deploy: container_scan + dast emitted via 04-deploy (no false-pass)', () => {
    assertMatch('ts-lib-deploy', { archetype: 'library', deployTarget: 'gcp-cloud-run' })
  })

  it('trunk-solo L3: no fuzz (scheduled suite skipped)', () => {
    assertMatch('ts-service-trunk-solo', { collaborationMode: 'trunk-solo' })
  })

  it('starter L3 peer-review: no sbom/binary_signing/provenance (05 skipped)', () => {
    assertMatch('ts-starter', { pipelineStyle: 'starter', deployTarget: undefined })
  })

  it('residual blind spots are documented (honesty): per-language/kotlin/multi guards + renamed jobs are NOT caught', () => {
    // The drift test catches predicate + job-level guard drift for the SAMPLED configs
    // (typescript, service/lib, standard/starter, peer-review/trunk-solo, deploy/no-deploy).
    // It does NOT catch: per-language guards for unsampled languages (java/go/rust/python),
    // kotlin/multi matrix gaps (filed as follow-ups), or a renamed job (both the gate +
    // DIM_TO_TOOL would need updating). This test documents that limitation explicitly.
    expect(DIM_TO_TOOL).toBeDefined()
  })
})