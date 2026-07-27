#!/usr/bin/env node
// Credential-free verifier for the pinned private consumer reliability bar (#2135).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  assessGateSpine,
  assertCredentialFreeEnvironment,
  buildVerifierEnvironment,
  classifyUpdateResult,
  commandOutcomeKind,
  extractCheckNames,
  redactSecrets,
  resultExitCode,
  summarizeProbeFailures,
} from './lib/consumer-reliability-bar.mjs'

const root = process.cwd()

try {
  assertCredentialFreeEnvironment(process.env)
  const options = parseArgs(process.argv.slice(2))
  mkdirSync(options.reportDir, { recursive: true })
  const config = readJson(join(root, 'scripts', 'data', 'consumer-reliability-bar.json'))
  const handoff = readJson(join(options.workspace, 'handoff.json'))
  validateInputs(config, handoff, options)

  const results = config.consumers.map((consumer) => verifyConsumer(consumer, handoff, options))
  const exitCode = resultExitCode(results)
  const hasWarnings = results.some((result) =>
    Object.values(result.checks).some((check) => check.status === 'WARN'),
  )
  const summary = {
    $schemaVersion: 1,
    result:
      exitCode === 0
        ? hasWarnings
          ? 'PASS_WITH_WARNINGS'
          : 'PASS'
        : exitCode === 1
          ? 'FAIL'
          : 'ERROR',
    consumers: results.map(({ id, language, sha, kind, checks }) => ({
      id,
      language,
      sha,
      kind,
      checks,
    })),
  }
  writeAtomic(join(options.reportDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  process.stdout.write(
    `[consumer-reliability] ${summary.result} — ${results.length} pinned consumers verified\n`,
  )
  process.exit(exitCode)
} catch (error) {
  const detail = safeDiagnostic(error instanceof Error ? error.message : String(error))
  process.stderr.write(`[consumer-reliability] ERROR — ${detail}\n`)
  process.exit(2)
}

function parseArgs(args) {
  const workspace = argument(args, '--workspace')
  const reportDir = argument(args, '--report-dir')
  const arbiterCli = argument(args, '--arbiter-cli')
  return {
    workspace: resolve(workspace),
    reportDir: resolve(reportDir),
    arbiterCli: resolve(arbiterCli),
  }
}

function argument(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || typeof args[index + 1] !== 'string' || args[index + 1].length === 0) {
    throw new Error(`required argument missing: ${name}`)
  }
  return args[index + 1]
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`required verifier input missing: ${path}`)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function validateInputs(config, handoff, options) {
  if (!existsSync(options.arbiterCli)) throw new Error('built Arbiter CLI is missing')
  for (const candidate of [config, handoff]) {
    if (candidate?.$schemaVersion !== 1 || !Array.isArray(candidate.consumers)) {
      throw new Error('consumer reliability input has an invalid shape')
    }
  }
  if (config.consumers.length !== 3 || handoff.consumers.length !== 3) {
    throw new Error('consumer reliability inputs must contain exactly 3 rows')
  }
  const handoffById = new Map(handoff.consumers.map((row) => [row?.id, row]))
  for (const consumer of config.consumers) {
    if (
      typeof consumer?.id !== 'string' ||
      !/^[a-z][a-z0-9-]*$/.test(consumer.id) ||
      typeof consumer.language !== 'string' ||
      typeof consumer.sha !== 'string' ||
      !/^[0-9a-f]{40}$/.test(consumer.sha)
    ) {
      throw new Error('consumer reliability config contains an invalid row')
    }
    const prepared = handoffById.get(consumer.id)
    const expectedPath = join(options.workspace, consumer.id)
    if (
      prepared?.language !== consumer.language ||
      prepared?.sha !== consumer.sha ||
      prepared?.originRemoved !== true ||
      resolve(String(prepared?.path ?? '')) !== expectedPath ||
      !isWithin(options.workspace, expectedPath)
    ) {
      throw new Error(`${consumer.id}: prepared handoff does not match the pinned config`)
    }
  }
}

function verifyConsumer(consumer, handoff, options) {
  const prepared = handoff.consumers.find((row) => row.id === consumer.id)
  const repo = resolve(prepared.path)
  const report = {
    $schemaVersion: 1,
    id: consumer.id,
    language: consumer.language,
    sha: consumer.sha,
    kind: 'error',
    checks: {
      originFree: { status: 'ERROR', detail: 'not evaluated' },
      pinnedHead: { status: 'ERROR', detail: 'not evaluated' },
      update: { status: 'ERROR', detail: 'not evaluated' },
      gateSpine: { status: 'ERROR', detail: 'not evaluated' },
      hookRouting: { status: 'ERROR', detail: 'not evaluated' },
      hookLiveness: { status: 'ERROR', detail: 'not evaluated' },
    },
  }

  try {
    assertRepositoryBoundary(repo, options.workspace)
    const origin = inspectOriginFree(repo)
    report.checks.originFree = outcome(origin, 'no remotes or credential config remain')
    const head = run('git', ['-C', repo, 'rev-parse', 'HEAD'], repo, 30000)
    const pinned = head.ok && head.stdout.trim() === consumer.sha
    report.checks.pinnedHead = outcome(
      pinned,
      pinned ? 'detached HEAD matches the configured pin' : 'HEAD differs from the configured pin',
    )

    const gatePath = join(repo, 'scripts', 'check-all.mjs')
    const gateExisted = existsSync(gatePath)
    const before = gateExisted ? readFileSync(gatePath, 'utf-8') : ''
    const recordedRenderHash = gateExisted
      ? (readRecordedHash(repo, 'scripts/check-all.mjs') ?? 'unknown-customized-baseline')
      : null

    const update = run(
      'node',
      [options.arbiterCli, 'update', '--dir', repo, '--force', '--json'],
      root,
      300000,
    )
    const updateResult = classifyUpdateResult(update)
    report.checks.update =
      updateResult.status === 'WARN'
        ? {
            status: 'WARN',
            detail: `${updateResult.warningCount} recoverable warning(s); downstream preservation and wiring checks remain authoritative`,
          }
        : childOutcome(update, 'current Arbiter update completed')
    if (!updateResult.acceptable) {
      report.kind = report.checks.update.status === 'ERROR' ? 'error' : 'fail'
      return report
    }

    if (!existsSync(gatePath)) throw new Error('update did not materialize the gate spine')
    const after = readFileSync(gatePath, 'utf-8')
    const gate = gateExisted
      ? assessGateSpine({ before, after, recordedRenderHash })
      : {
          ok: extractCheckNames(after).size > 0,
          detail: `absent baseline materialized with ${extractCheckNames(after).size} checks`,
        }
    report.checks.gateSpine = outcome(gate.ok, gate.detail)

    const routing = run('node', [join(repo, 'scripts', 'check-hook-routing.mjs')], repo, 120000)
    report.checks.hookRouting = childOutcome(routing, 'all emitted hooks are routed')

    const liveness = run(
      'node',
      [join(root, 'scripts', 'probe-hooks.mjs'), '--root', repo, '--language', consumer.language],
      root,
      300000,
    )
    report.checks.hookLiveness = childOutcome(
      liveness,
      'all applicable HARD hooks block and every ADVISORY hook is justified',
    )
    if (!liveness.ok) {
      report.checks.hookLiveness.detail = safeDiagnostic(summarizeProbeFailures(liveness.stdout))
    }

    const statuses = Object.values(report.checks).map((check) => check.status)
    report.kind = statuses.includes('ERROR') ? 'error' : statuses.includes('FAIL') ? 'fail' : 'pass'
  } catch (error) {
    report.kind = 'error'
    report.error = safeDiagnostic(error instanceof Error ? error.message : String(error))
  } finally {
    writeAtomic(
      join(options.reportDir, `${consumer.id}.json`),
      JSON.stringify(report, null, 2) + '\n',
    )
  }
  return report
}

function assertRepositoryBoundary(repo, workspace) {
  if (!isWithin(workspace, repo)) throw new Error('consumer path escapes the prepared workspace')
  if (!existsSync(join(repo, '.git', 'config')))
    throw new Error('prepared git repository is missing')
}

function inspectOriginFree(repo) {
  const remotes = run('git', ['-C', repo, 'remote'], repo, 30000)
  if (!remotes.ok || remotes.stdout.trim().length > 0) return false
  const credentials = spawnSync(
    'git',
    ['-C', repo, 'config', '--local', '--name-only', '--get-regexp', '^credential\\.'],
    {
      cwd: repo,
      encoding: 'utf-8',
      timeout: 30000,
      env: sanitizedEnvironment(),
    },
  )
  if (![0, 1].includes(credentials.status ?? -1) || credentials.signal) return false
  return credentials.status === 1 || credentials.stdout.trim().length === 0
}

function readRecordedHash(repo, key) {
  const path = join(repo, '.arbiter-generated-manifest.json')
  if (!existsSync(path)) return null
  const parsed = readJson(path)
  if (parsed?.$schemaVersion !== 1 || typeof parsed.files !== 'object' || parsed.files === null) {
    throw new Error('generated manifest has an invalid shape')
  }
  const value = parsed.files[key]
  return typeof value === 'string' ? value : null
}

function run(command, args, cwd, timeout) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    timeout,
    env: sanitizedEnvironment(),
  })
  return {
    ok: result.status === 0 && !result.signal,
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  }
}

function sanitizedEnvironment() {
  return buildVerifierEnvironment(process.env)
}

function childOutcome(result, success) {
  const kind = commandOutcomeKind(result)
  if (kind === 'pass') return outcome(true, success)
  return {
    status: kind === 'error' ? 'ERROR' : 'FAIL',
    detail: `command failed (status=${String(result.status)}, signal=${String(result.signal)})`,
  }
}

function outcome(ok, detail) {
  return { status: ok ? 'PASS' : 'FAIL', detail: safeDiagnostic(detail) }
}

function safeDiagnostic(value) {
  return redactSecrets(String(value), []).replaceAll(root, '[ARBITER_ROOT]')
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, content, { mode: 0o600 })
  renameSync(temporary, path)
}
