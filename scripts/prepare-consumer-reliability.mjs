#!/usr/bin/env node
// Credential-bearing preparation phase for the private consumer reliability bar (#2135).
// This process clones and scrubs repositories but never executes consumer-owned code.
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const configPath = resolve('scripts/data/consumer-reliability-bar.json')
const githubKnownHost =
  'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n'

let credentialDir = null
let exitCode = 0
try {
  const output = outputArgument(process.argv.slice(2))
  const config = readConfig(configPath)
  const credentials = validateConsumerCredentials(config.consumers)
  credentialDir = mkdtempSync(join(tmpdir(), 'arbiter-consumer-credentials-'))
  const knownHostsPath = join(credentialDir, 'known_hosts')
  writeFileSync(knownHostsPath, githubKnownHost, { mode: 0o600 })
  prepareOutput(output)
  const prepared = []
  for (const { consumer, slug, privateKey } of credentials) {
    const keyPath = join(credentialDir, `${consumer.id}.key`)
    writeFileSync(keyPath, `${privateKey.trim()}\n`, { mode: 0o600 })
    const sshCommand = [
      'ssh',
      '-i',
      keyPath,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      `UserKnownHostsFile=${knownHostsPath}`,
    ].join(' ')
    const target = join(output, consumer.id)
    runStrict(
      'git',
      ['clone', '--no-checkout', `git@github.com:${slug}.git`, target],
      process.cwd(),
      { GIT_SSH_COMMAND: sshCommand },
      `${consumer.id}: clone failed`,
    )
    unlinkSync(keyPath)
    runGit(target, ['config', 'core.hooksPath', '/dev/null'], consumer.id)
    runGit(
      target,
      [
        '-c',
        'filter.lfs.smudge=',
        '-c',
        'filter.lfs.required=false',
        'checkout',
        '--detach',
        consumer.sha,
      ],
      consumer.id,
    )
    const head = runGit(target, ['rev-parse', 'HEAD'], consumer.id).trim()
    if (head !== consumer.sha) throw new Error(`${consumer.id}: detached HEAD does not match pin`)
    const remotes = runGit(target, ['remote'], consumer.id)
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
    for (const remote of remotes) runGit(target, ['remote', 'remove', remote], consumer.id)
    scrubCredentialConfig(target, consumer.id)
    const remaining = runGit(target, ['remote'], consumer.id).trim()
    if (remaining.length > 0) throw new Error(`${consumer.id}: remote removal was incomplete`)
    const localConfig = readFileSync(join(target, '.git', 'config'), 'utf-8')
    if (localConfig.includes(privateKey) || localConfig.includes(slug)) {
      throw new Error(`${consumer.id}: credential or private slug remains in local git config`)
    }
    prepared.push({
      id: consumer.id,
      language: consumer.language,
      sha: consumer.sha,
      path: target,
      originRemoved: true,
    })
  }
  // AC-2's debt register is only a ratchet if every entry names a real, still-open issue.
  // The verification lives HERE, in the credentialed phase: the verifier runs under
  // `buildVerifierEnvironment`, a strict allow-list with no GH_TOKEN, and
  // `assertCredentialFreeEnvironment` exists to keep that boundary — so `gh` could never
  // run there. The verdict crosses into the verifier as data, not as a credential.
  const openDebtIssues = verifyDebtIssues(readGateMap())
  writeAtomic(
    join(output, 'handoff.json'),
    JSON.stringify({ $schemaVersion: 1, consumers: prepared, openDebtIssues }, null, 2) + '\n',
  )
  process.stdout.write(
    `[consumer-prepare] PASS — prepared ${prepared.length} detached origin-free consumers\n`,
  )
} catch (error) {
  process.stderr.write(
    `[consumer-prepare] ERROR — ${error instanceof Error ? error.message : String(error)}\n`,
  )
  exitCode = 2
} finally {
  if (credentialDir !== null) rmSync(credentialDir, { recursive: true, force: true })
}
process.exit(exitCode)

function readGateMap() {
  const parsed = JSON.parse(readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'))
  if (parsed?.$schemaVersion !== 1 || typeof parsed.consumers !== 'object') {
    throw new Error('consumer gate map has an invalid shape')
  }
  return parsed
}

/** Issue refs cited by DEBT entries that `gh` confirms exist and are OPEN. */
function verifyDebtIssues(gateMap) {
  const cited = new Set()
  for (const entry of Object.values(gateMap.consumers)) {
    for (const verdict of Object.values(entry?.mapping ?? {})) {
      if (typeof verdict === 'string' && verdict.startsWith('DEBT:')) {
        cited.add(verdict.slice('DEBT:'.length))
      }
    }
  }
  const open = []
  for (const ref of [...cited].sort()) {
    if (!/^#[1-9][0-9]*$/.test(ref)) throw new Error(`debt entry cites a malformed issue: ${ref}`)
    const probe = spawnSync('gh', ['issue', 'view', ref.slice(1), '--json', 'state'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 60000,
      env: { ...process.env, GH_PAGER: 'cat' },
    })
    if (probe.status !== 0 || probe.signal) {
      throw new Error(`debt issue ${ref} could not be resolved upstream`)
    }
    // A CLOSED or missing issue is simply not added: the verifier then fails the row and
    // names it, which is the honest outcome — never a silent pass.
    if (JSON.parse(probe.stdout).state === 'OPEN') open.push(ref)
  }
  return open
}

function outputArgument(args) {
  const index = args.indexOf('--output')
  if (index === -1 || typeof args[index + 1] !== 'string') {
    throw new Error('usage: prepare-consumer-reliability.mjs --output <absolute-or-relative-dir>')
  }
  return resolve(args[index + 1])
}

function readConfig(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'))
  if (parsed?.$schemaVersion !== 1 || !Array.isArray(parsed.consumers)) {
    throw new Error('consumer reliability config has an invalid shape')
  }
  const ids = new Set()
  for (const consumer of parsed.consumers) {
    validateConsumerRow(consumer)
    if (ids.has(consumer.id)) throw new Error(`duplicate generic consumer id: ${consumer.id}`)
    ids.add(consumer.id)
  }
  if (ids.size !== 3) throw new Error('consumer reliability config must contain exactly 3 rows')
  return parsed
}

function validateConsumerRow(consumer) {
  if (!hasValidConsumerIdentity(consumer)) {
    throw new Error('consumer reliability config contains an invalid consumer identity')
  }
  if (!hasValidConsumerEnvironment(consumer)) {
    throw new Error('consumer reliability config contains invalid secret environment names')
  }
  if (typeof consumer.sha !== 'string' || !/^[0-9a-f]{40}$/.test(consumer.sha)) {
    throw new Error('consumer reliability config contains an invalid pin')
  }
}

function hasValidConsumerIdentity(consumer) {
  return (
    typeof consumer?.id === 'string' &&
    /^[a-z][a-z0-9-]*$/.test(consumer.id) &&
    typeof consumer.language === 'string'
  )
}

function hasValidConsumerEnvironment(consumer) {
  return (
    typeof consumer.repoEnv === 'string' &&
    /^ARBITER_CONSUMER_[A-Z]+_REPO$/.test(consumer.repoEnv) &&
    typeof consumer.keyEnv === 'string' &&
    /^ARBITER_CONSUMER_[A-Z]+_DEPLOY_KEY$/.test(consumer.keyEnv)
  )
}

function requiredEnvironment(key) {
  const value = process.env[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`required secret environment is missing: ${key}`)
  }
  return value.trim()
}

function validateConsumerCredentials(consumers) {
  return consumers.map((consumer) => {
    const slug = requiredEnvironment(consumer.repoEnv)
    const privateKey = requiredEnvironment(consumer.keyEnv)
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)) {
      throw new Error(`${consumer.id}: repository secret must be an owner/repository slug`)
    }
    return { consumer, slug, privateKey }
  })
}

function prepareOutput(path) {
  if (!isAbsolute(path)) throw new Error('resolved output path is not absolute')
  if (existsSync(path) && readdirSync(path).length > 0) {
    throw new Error(`output directory is not empty: ${path}`)
  }
  mkdirSync(path, { recursive: true })
}

function runGit(dir, args, id) {
  return runStrict('git', ['-C', dir, ...args], dir, {}, `${id}: git operation failed`)
}

function runStrict(command, args, cwd, extraEnvironment, failure) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    timeout: 180000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_LFS_SKIP_SMUDGE: '1',
      ...extraEnvironment,
    },
  })
  if (result.status !== 0 || result.signal) {
    throw new Error(`${failure} (status=${String(result.status)}, signal=${String(result.signal)})`)
  }
  return result.stdout ?? ''
}

function scrubCredentialConfig(dir, id) {
  const listed = spawnSync(
    'git',
    ['-C', dir, 'config', '--local', '--name-only', '--get-regexp', '^credential\\.'],
    {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    },
  )
  if (listed.status !== 0 && listed.status !== 1) {
    throw new Error(`${id}: credential-config inspection failed`)
  }
  for (const key of String(listed.stdout ?? '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)) {
    runGit(dir, ['config', '--local', '--unset-all', key], id)
  }
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, content, { mode: 0o600 })
  renameSync(temporary, path)
}
