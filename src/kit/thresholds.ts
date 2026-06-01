// SPDX-License-Identifier: Apache-2.0

/**
 * Brownfield class: characterizes how mature a repository is.
 * Determines which column of the threshold matrix to apply for existing code.
 * New code always uses the `new_code` column (gold-grade), regardless of class.
 *
 * Classification heuristics (from brownfield-detect.ts):
 *   gold   → greenfield or already-mature repo (< 50 source files)
 *   light  → 50–500 source files, coverage > 30 %
 *   medium → 500–2 000 source files, coverage 5–30 %
 *   heavy  → 2 000+ source files, coverage < 5 %
 */
export type BrownfieldClass = 'gold' | 'light' | 'medium' | 'heavy'
