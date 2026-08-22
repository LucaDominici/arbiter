// SPDX-License-Identifier: Apache-2.0
// #2328 RED BASELINE — the engine-side mirror of scripts/lib/gate-evidence.mjs.
// `arbiter task advance` must not delegate its verdict to a script that lives
// inside the tree it is gating, so the policy is carried here too; the parity
// test in __tests__/evidence/gate-evidence-binding.test.ts pins the two copies
// together. This baseline reproduces the pre-#2328 binding on purpose.

export const GATE_PASS_POLICY = {
  schema: 'arbiter-gate-pass-v2',
  defaultTtlMinutes: 240,
  levelRank: { L0: 0, L1: 1, L2: 2, L3: 3 } as Readonly<Record<string, number>>,
  stringFields: [
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
  ] as readonly string[],
  toolchainInputs: [
    'package.json',
    'package-lock.json',
    'node_modules/.package-lock.json',
    '.nvmrc',
  ] as readonly string[],
} as const
