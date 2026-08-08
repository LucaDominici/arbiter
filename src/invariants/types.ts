// SPDX-License-Identifier: Apache-2.0
// #2035: the Invariant interface now lives in ../wizard/types.js (the dependency-
// free types hub) so ProjectConfig can carry `projectInvariants` without a
// wizard/types ⇄ invariants/types import cycle. This module re-exports it for
// its existing consumers, unchanged.
export type { Invariant, InvariantTier, InvariantPreset } from '../wizard/types.js'
