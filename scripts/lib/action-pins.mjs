// SPDX-License-Identifier: Apache-2.0
// action-pins.mjs — shared pin-policy data for the workflow/action gate scripts.
//
// Extracted from check-action-pins.mjs (#1666) so sync-action-pins.mjs (#2298)
// and the INV-76 gate agree on the ONE allowlist of declared cross-major splits
// and the ONE major-bucketing rule. A second copy of either would let the sync
// clobber a declared split or the gate miss one — drift between the two is the
// exact failure class #2298 is eliminating.

// #1666 — DECLARED cross-major splits: `action -> { effectiveMajor -> exact 40-hex sha }`.
// The ONLY allowlistable divergence. Each sha is gh-api-verified to resolve to a tag in
// that major. A within-major duplicate is NEVER allowlistable (it is always a bug); this
// table excuses only an intentional split across DIFFERENT majors. For 0ver actions the
// effective major is `0.<minor>` (semver-0 treats the minor as the breaking axis).
export const CROSS_MAJOR_ALLOWLIST = {
  'actions/download-artifact': {
    4: 'd3f86a106a0bac45b974a628896c90dbdf5c8093', // v4.3.0
    8: '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', // v8.0.1
  },
  'actions/github-script': {
    7: 'f28e40c7f34bde8b3046d885e986cb6290c5673b', // v7.1.0
    9: '3a2844b7e9c422d3c10d287c895573f7108da1b3', // v9.0.0
  },
  'actions/setup-node': {
    4: '39370e3970a6d050c480ffad4ff0ed4d3fdee5af', // v4.1.0
    7: '820762786026740c76f36085b0efc47a31fe5020', // v7.0.0
  },
  'actions/upload-artifact': {
    4: 'ea165f8d65b6e75b540449e92b4886f43607fa02', // v4.6.2
    7: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', // v7.0.1
  },
  'gradle/actions/setup-gradle': {
    3: 'd9c87d481d55275bb5441eef3fe0e46805f9ef70', // v3
    4: 'ed408507eac070d1f99cc633dbcf757c94c7933a', // v4
    6: '9c971963bec38e04b3d30dcc455b5382be2fdbfb', // v6.3.0
  },
  'anchore/sbom-action': {
    0.9: 'f6c3d0fe42c3cf876e3462574e4c9416b5e0f07a', // v0.9.0
    0.24: 'e22c389904149dbc22b58101806040fa8d37a610', // v0.24.0
  },
}

// Effective MAJOR bucket from a version label: `vN[.M…]` → "N", except `v0.M…` → "0.M"
// (0ver). Returns null for a non-version label (e.g. `stable`, `master`).
export const effectiveMajor = (label) => {
  const m = /^v(\d+)(?:\.(\d+))?/.exec(label)
  if (!m) return null
  if (m[1] === '0') return m[2] !== undefined ? `0.${m[2]}` : '0'
  return m[1]
}
