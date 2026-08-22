#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// #2328 RED BASELINE — this file currently reproduces the PRE-#2328 binding on
// purpose: head_sha + branch + a boolean tree-clean snapshot, and nothing else.
// The policy constants below already describe the target schema, so the failing
// test output enumerates exactly which identity axes are unguarded today.
import { execFileSync } from 'node:child_process'

export const GATE_EVIDENCE_SCHEMA = 'arbiter-gate-pass-v2'
export const GATE_EVIDENCE_DEFAULT_TTL_MIN = 240
export const GATE_EVIDENCE_LEVEL_RANK = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3 })
export const GATE_EVIDENCE_STRING_FIELDS = Object.freeze([
  'schema',
  'head_sha',
  'branch',
  'task_id',
  'timestamp',
  'level',
  'node_version',
  'tree_hash',
  'checkout_root',
  'toolchain_fingerprint',
])
export const GATE_EVIDENCE_TOOLCHAIN_INPUTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'node_modules/.package-lock.json',
  '.nvmrc',
])

function gitLine(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

export function buildGateEvidence({ root, level, taskId }) {
  const headSha = gitLine(root, ['rev-parse', 'HEAD'])
  if (headSha === null) return null
  return {
    head_sha: headSha,
    branch: gitLine(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown',
    task_id: taskId,
    timestamp: new Date().toISOString(),
    level,
    node_version: process.version,
    git_user: gitLine(root, ['config', 'user.name']) ?? 'unknown',
    tree_was_clean_at_run_time: true,
  }
}

export function verifyGateEvidence(marker, opts = {}) {
  const root = opts.root ?? process.cwd()
  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) {
    return { ok: false, reason: 'gate-pass marker must be a JSON object' }
  }
  if (marker.head_sha !== gitLine(root, ['rev-parse', 'HEAD'])) {
    return { ok: false, reason: 'gate-pass marker head_sha mismatch' }
  }
  if (marker.branch !== gitLine(root, ['rev-parse', '--abbrev-ref', 'HEAD'])) {
    return { ok: false, reason: 'gate-pass marker branch mismatch' }
  }
  if (marker.tree_was_clean_at_run_time !== true) {
    return { ok: false, reason: 'gate-pass marker tree_was_clean_at_run_time must be true' }
  }
  return { ok: true }
}
