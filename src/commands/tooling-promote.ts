// SPDX-License-Identifier: Apache-2.0
import type { ProposalStatus } from '../kit/tooling-discovery.js'

export type { ProposalStatus }

const ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  proposed: ['accepted'],
  accepted: ['promotable'],
  promotable: ['promoted'],
  promoted: ['demoted'],
  demoted: [],
}

export function advanceProposalStatus(from: ProposalStatus, to: ProposalStatus): ProposalStatus {
  const allowed = ALLOWED_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid status transition: ${from} → ${to}. Allowed from ${from}: [${allowed.join(', ') || 'none'}]`,
    )
  }
  return to
}
