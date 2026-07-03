#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — docker-container-action / self-hosted-runner safety gate (#1756)
//
// CATALOG: No sibling check-*.mjs enforces this. check-workflow-runners.mjs is the
// CATALOG: closest analog (also reads `runs-on:` per workflow line) but it is
// CATALOG: line-based/job-uncorrelated and advisory-only (always exits 0, per
// CATALOG: INV-89/INV-13 runner-label customization). This gate needs FAIL-closed,
// CATALOG: per-JOB correlation between a specific step (`uses:`) and that job's
// CATALOG: `runs-on:`, which is a different shape of check, so folding in was
// CATALOG: rejected — a new file is justified.
//
// Incident (#1756): on arbiter's self-hosted "slot" runners (arbiter-slot-build-*),
// the runner process itself executes inside a container. A docker-container GitHub
// Action (e.g. bridgecrewio/checkov-action, which ships `runs: using: docker`)
// asks the HOST docker daemon to bind-mount `/github/workspace` — and that mount
// resolves against a HOST filesystem path, not the runner slot's OWN containerized
// checkout. The action then sees stale, missing, or simply wrong content instead of
// the PR head SHA (evidenced: a committed file was invisible to checkov-action on
// arbiter-slot-build-4). GitHub-hosted runners (ubuntu-latest et al.) do not run
// the runner itself inside a container, so this class of bug cannot occur there.
//
// Fix option (C) from #1756: policy — forbid docker-container actions on jobs whose
// `runs-on:` could resolve to a self-hosted runner. A `runs-on:` value is treated as
// "self-hosted-capable" when it is a GitHub Actions expression (`${{ ... }}`) rather
// than a literal GitHub-hosted label — expressions can be repo-variable-driven
// (e.g. `vars.RUNNER_LABELS_TEST`) and their resolved value is not staticaly knowable
// from the workflow file alone. A curated denylist covers the evidenced offender
// (bridgecrewio/checkov-action); any `uses: docker://...` reference is also always
// flagged since that syntax is unambiguously a docker-container action.
//
// Scans arbiter's own .github/workflows/ (self) AND the workflow templates arbiter
// ships (src/templates/**/workflows/*.ejs) — a template that pairs a docker-container
// action with an expression-based runner ships the same defect to every generated
// project's self-hosted runner setups.
//
// Usage: node scripts/check-docker-action-runner-safety.mjs [--dir <path>] [--help]
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  collectYamlFiles,
  collectWorkflowTemplates,
  parseHelpAndDir,
} from './lib/workflow-scan.mjs'

const args = process.argv.slice(2)
const { cwd: CWD } = parseHelpAndDir(args, {
  usage: [
    'Usage: node scripts/check-docker-action-runner-safety.mjs [options]',
    '',
    'Fails when a docker-container GitHub Action (a curated denylist, plus any',
    'bare `uses: docker://...` reference) shares a job with an expression-based',
    '(self-hosted-capable) `runs-on:` — the bind-mount-from-host-path defect (#1756).',
    '',
    'Options:',
    '  --dir <path>   Root directory to scan (default: cwd)',
    '  --help, -h     Show this help and exit',
    '',
  ].join('\n'),
})

// Curated denylist of known docker-container actions (`runs: using: docker` in
// their action.yml) with an evidenced incident in this repo. Extend this list only
// with actions CONFIRMED docker-container-typed — composite/JS actions run directly
// in the runner's own process and are not subject to this bind-mount defect.
const DOCKER_CONTAINER_ACTIONS = ['bridgecrewio/checkov-action']

const JOB_HEADER_RE = /^ {2}([A-Za-z0-9_-]+):\s*$/
const RUNS_ON_RE = /^\s*runs-on:\s+(.+)$/
const USES_RE = /^\s*(?:-\s+)?uses:\s+["']?([^\s"']+)["']?/
// Workflow TEMPLATES gate job headers/steps behind inline EJS control tags, e.g.
// `<% if (governanceLevel !== 'L1' || _multiLane) { %>  iac-scan:` — strip any
// leading `<% ... %>` run(s) so the YAML-shape regexes below see plain YAML text
// starting at its real indent column, regardless of the EJS wrapping.
const EJS_PREFIX_RE = /^(?:<%[^%]*%>)+/
const stripEjsPrefix = (line) => line.replace(EJS_PREFIX_RE, '')

/**
 * Split a workflow file's content into per-job text blocks, keyed by job id.
 * Mirrors the `jobSection` helper used across the render tests: a job starts at
 * a 2-space-indented `<id>:` line and ends at the next 2-space-indented line
 * (or end of file). Lines before the first job header are ignored.
 */
function splitJobs(content) {
  const lines = content.split('\n')
  /** @type {Map<string, string[]>} */
  const jobs = new Map()
  let currentJob = null
  for (const raw of lines) {
    const line = stripEjsPrefix(raw)
    const header = JOB_HEADER_RE.exec(line)
    if (header) {
      currentJob = header[1]
      jobs.set(currentJob, [])
      continue
    }
    if (currentJob && line.startsWith('  ') && !line.startsWith('   ')) {
      // dedent back to top-level (non-job-header 2-space line, e.g. a bare `on:`
      // sibling key) — stop attributing lines to the current job.
      currentJob = null
      continue
    }
    if (currentJob) jobs.get(currentJob).push(line)
  }
  return jobs
}

function isSelfHostedCapable(runsOnValue) {
  const trimmed = runsOnValue.trim()
  return trimmed.startsWith('${{')
}

function findDockerContainerUse(line) {
  const m = USES_RE.exec(line)
  if (!m) return null
  const ref = m[1]
  if (ref.startsWith('docker://')) return ref
  const [owner] = ref.split('@')
  if (DOCKER_CONTAINER_ACTIONS.includes(owner)) return ref
  return null
}

function scanFile(file, cwd) {
  const relPath = relative(cwd, file)
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    return []
  }
  const violations = []
  const jobs = splitJobs(content)
  for (const [jobId, jobLines] of jobs) {
    const runsOnLine = jobLines.find((l) => RUNS_ON_RE.test(l))
    if (!runsOnLine) continue
    const runsOnValue = RUNS_ON_RE.exec(runsOnLine)[1]
    if (!isSelfHostedCapable(runsOnValue)) continue
    for (const line of jobLines) {
      const dockerRef = findDockerContainerUse(line)
      if (dockerRef) {
        violations.push({ file: relPath, job: jobId, ref: dockerRef, runsOn: runsOnValue.trim() })
      }
    }
  }
  return violations
}

const yamlFiles = collectYamlFiles(join(CWD, '.github', 'workflows'))
const templateFiles = collectWorkflowTemplates(join(CWD, 'src', 'templates'))

const allViolations = [...yamlFiles, ...templateFiles].flatMap((file) => scanFile(file, CWD))

if (allViolations.length > 0) {
  for (const v of allViolations) {
    process.stderr.write(
      `[FAIL] ${v.file}: job "${v.job}" uses docker-container action "${v.ref}" under ` +
        `expression-based runs-on "${v.runsOn}" — self-hosted runner slots bind-mount the ` +
        `workspace from the DOCKER HOST, not the slot's own checkout (#1756)\n`,
    )
  }
  process.stdout.write(
    `check-docker-action-runner-safety: FAIL — ${allViolations.length} docker-container ` +
      `action(s) paired with a self-hosted-capable runner (#1756)\n`,
  )
  process.exit(1)
}

process.stdout.write(
  `check-docker-action-runner-safety: OK — no docker-container action shares a job with a ` +
    `self-hosted-capable runner (${yamlFiles.length + templateFiles.length} files scanned, #1756)\n`,
)
process.exit(0)
