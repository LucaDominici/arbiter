// SPDX-License-Identifier: Apache-2.0

export const VALID_TML = ['L1', 'L2', 'L3'] as const
export type TML = (typeof VALID_TML)[number]

export const VALID_GATES = ['BLOCKING', 'ADVISORY', 'REFERENCE'] as const
export type Gate = (typeof VALID_GATES)[number]

export const VALID_STACKS = ['java', 'typescript', 'python', 'go', 'rust'] as const
export type Stack = (typeof VALID_STACKS)[number]

export const VALID_DISPOSITIONS = [
  'adopt-self',
  'adopt-framework',
  'stack-adapter',
  'done',
] as const
export type Disposition = (typeof VALID_DISPOSITIONS)[number]

// Accepted implementing_wave values for disposition-exemption in INV-86 rule 3.
// F-prefixed waves and null are rejected.
export const ACCEPTED_FUTURE_WAVES = [
  'W3',
  'W4',
  'W5',
  'W6',
  'W7',
  'W8',
  'W9',
  'W10',
  'W11',
] as const
export type AcceptedFutureWave = (typeof ACCEPTED_FUTURE_WAVES)[number]
