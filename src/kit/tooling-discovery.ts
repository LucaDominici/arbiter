// SPDX-License-Identifier: Apache-2.0

export type ProposalStatus = 'proposed' | 'accepted' | 'promotable' | 'promoted' | 'demoted'

export interface ToolingProposalInput {
  stack: string
  toolchain: {
    linter: string
    formatter: string
    testRunner: string
    coverage: string
    security: string
  }
  evidence: {
    urls: string[]
    rationale: string
  }
}

export interface ToolingProposal {
  stack: string
  generatedAt: string
  status: ProposalStatus
  toolchain: ToolingProposalInput['toolchain']
  evidence: ToolingProposalInput['evidence']
}

export function buildToolingProposal(input: ToolingProposalInput): ToolingProposal {
  if (!input.stack) throw new Error('stack must not be empty')
  return {
    stack: input.stack,
    generatedAt: new Date().toISOString().slice(0, 10),
    status: 'proposed',
    toolchain: { ...input.toolchain },
    evidence: { ...input.evidence, urls: [...input.evidence.urls] },
  }
}
