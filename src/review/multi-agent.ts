// SPDX-License-Identifier: Apache-2.0
/**
 * Multi-agent code review dispatcher (#236).
 *
 * Builds N agent-persona prompts in parallel based on the active review
 * tier, dispatches each to a Claude subagent, parses their JSON responses,
 * and aggregates findings into blocker/warning/note buckets.
 *
 * Tier → agent count map lives in `tier-constants.ts` (TIER_REVIEWER_COUNT).
 * Personas (must reflect AGENT_PERSONAS.tiers below):
 *   - bugs                   (XS, S, Standard)
 *   - type-safety            (XS, S, Standard)
 *   - silent-failure-hunter  (XS, S, Standard)
 *   - domain-consistency     (Standard only)
 *   - test-analyzer          (Standard only)
 *
 * Dispatch is injectable (DispatchFn) so tests can run without spawning
 * the real `claude` CLI. The default dispatcher (`dispatchClaudeAgent`)
 * lives in `./dispatch.ts` and shells out via `runCli` (INV-12).
 *
 * Failures are NEVER silent (#236, no-silent-failure invariant):
 *   - dispatcher exception   → blocker finding (agent marked failed)
 *   - malformed JSON output  → blocker finding (parse error surfaced)
 *   - timeout                → blocker finding
 */

import { computeSsotDigest, escapeXml } from './ssot.js'
import { TIER_REVIEWER_COUNT, type ReviewTier } from './tier-constants.js'

/** Severity of a single review finding. */
export type FindingSeverity = 'blocker' | 'warning' | 'note'

/** A single reviewer observation. */
export interface Finding {
  severity: FindingSeverity
  agent: string
  message: string
  location?: string
  evidence?: string
}

/** Parsed envelope each subagent is expected to emit. */
export interface AgentReport {
  findings: Finding[]
  passed: boolean
}

/** Single agent's outcome after dispatch. */
export interface AgentResult {
  agent: string
  findings: Finding[]
  passed: boolean
  rawStdout: string
  prompt: string
}

/** Aggregated multi-agent verdict. */
export interface AggregatedReview {
  blockers: Finding[]
  warnings: Finding[]
  notes: Finding[]
  passCount: number
  totalAgents: number
}

/** Single persona definition (registry entry). */
export interface AgentPersona {
  name: string
  description: string
  /** Tiers in which this persona is active. */
  tiers: readonly ReviewTier[]
  /** Persona-specific instructions injected into the XML prompt. */
  focus: string
}

/** Concrete prompt built for one persona. */
export interface AgentPrompt {
  name: string
  prompt: string
}

/** Injection point: how to actually invoke an agent. */
export type DispatchFn = (prompt: string, agentName: string) => Promise<AgentResult>

export interface BuildPromptsOptions {
  diff: string
  dir: string
  tier: ReviewTier
}

/**
 * Static persona registry. Adding a new persona MUST also be reflected in
 * TIER_REVIEWER_COUNT or it will not be dispatched.
 */
export const AGENT_PERSONAS: readonly AgentPersona[] = [
  {
    name: 'bugs',
    description: 'Logic, off-by-one, null-deref, race, edge-case bugs.',
    tiers: ['XS', 'S', 'Standard'],
    focus:
      'Hunt for logic bugs: off-by-one errors, null/undefined dereferences, race conditions, incorrect error handling, and edge cases the diff does not cover.',
  },
  {
    name: 'type-safety',
    description: 'Type leaks, unchecked casts, `any`/`unknown` misuse.',
    tiers: ['XS', 'S', 'Standard'],
    focus:
      'Hunt for type leaks: `any` usage, unchecked casts, missing narrowing at boundaries, and structural type drift relative to declared interfaces.',
  },
  {
    name: 'domain-consistency',
    description: 'Drift between code and AGENTS.md invariants / domain rules.',
    tiers: ['Standard'],
    focus:
      "Hunt for drift between this diff and the project's invariants (AGENTS.md). Flag terminology mismatches, broken cross-references, and rule violations.",
  },
  {
    name: 'silent-failure-hunter',
    description: 'Catches swallowed errors, empty catches, ignored rejections.',
    tiers: ['XS', 'S', 'Standard'],
    focus:
      'Hunt for silent failures: empty catch blocks, unhandled promise rejections, error returns that are discarded, and recovery paths that hide root causes.',
  },
  {
    name: 'test-analyzer',
    description: 'Coverage and assertion quality (Standard tier only).',
    tiers: ['Standard'],
    focus:
      'Analyse test coverage and assertion quality for the diffed code. Flag missing tests for new branches, weak asserts, and tests that pass without exercising the intended path.',
  },
]

function selectPersonas(tier: ReviewTier): AgentPersona[] {
  const target = TIER_REVIEWER_COUNT[tier]
  const eligible = AGENT_PERSONAS.filter((p) => p.tiers.includes(tier))
  // Defensive: registry must produce exactly TIER_REVIEWER_COUNT[tier]
  // active personas. If it does not, dispatch the first N alphabetically
  // for determinism — but this is a programmer error, not a silent skip,
  // so we throw to make it loud.
  if (eligible.length !== target) {
    throw new Error(
      `multi-agent: TIER_REVIEWER_COUNT[${tier}]=${target} but ${eligible.length} personas declare tier "${tier}". Update AGENT_PERSONAS or TIER_REVIEWER_COUNT.`,
    )
  }
  return eligible
}

/** Build N XML prompts (one per persona for this tier). */
export function buildAgentPrompts(opts: BuildPromptsOptions): AgentPrompt[] {
  const personas = selectPersonas(opts.tier)
  const digest = computeSsotDigest(opts.dir)
  const safeDiff = escapeXml(opts.diff)

  return personas.map((persona) => ({
    name: persona.name,
    prompt: [
      `<reviewAgent version="1">`,
      `  <agent>${persona.name}</agent>`,
      `  <tier>${opts.tier}</tier>`,
      `  <ssotDigest>${digest}</ssotDigest>`,
      `  <description>${escapeXml(persona.description)}</description>`,
      `  <focus>${escapeXml(persona.focus)}</focus>`,
      `  <instructions>`,
      `    Review the diff below. Emit ONLY a single JSON object on stdout`,
      `    with shape: { "findings": Finding[], "passed": boolean }.`,
      `    Each Finding: { "severity": "blocker"|"warning"|"note",`,
      `      "agent": "${persona.name}", "message": string,`,
      `      "location"?: string, "evidence"?: string }.`,
      `    "passed" MUST be true iff findings.length === 0.`,
      `  </instructions>`,
      `  <diff>`,
      safeDiff,
      `  </diff>`,
      `</reviewAgent>`,
    ].join('\n'),
  }))
}

/**
 * Dispatch all prompts in parallel via `Promise.all`. Per-agent failures
 * are converted into blocker findings so the aggregate never silently
 * loses an agent (no-silent-failure invariant).
 */
export async function dispatchAgents(
  prompts: AgentPrompt[],
  deps?: { dispatch?: DispatchFn },
): Promise<AgentResult[]> {
  const dispatch = deps?.dispatch ?? defaultDispatch
  const settled = await Promise.allSettled(prompts.map((p) => dispatch(p.prompt, p.name)))
  return settled.map((s, i) => {
    const promptEntry = prompts[i]
    if (promptEntry === undefined) {
      // Should be impossible — Promise.allSettled preserves index alignment.
      // Surface as blocker rather than swallow.
      return {
        agent: 'unknown',
        findings: [
          {
            severity: 'blocker',
            agent: 'unknown',
            message: 'internal: prompt index out of range',
          },
        ],
        passed: false,
        rawStdout: '',
        prompt: '',
      }
    }
    if (s.status === 'fulfilled') {
      return s.value
    }
    const err = s.reason instanceof Error ? s.reason.message : String(s.reason)
    return {
      agent: promptEntry.name,
      findings: [
        {
          severity: 'blocker',
          agent: promptEntry.name,
          message: `agent dispatch failed: ${err}`,
        },
      ],
      passed: false,
      rawStdout: '',
      prompt: promptEntry.prompt,
    }
  })
}

/** Fallback dispatcher — must be overridden by the caller via deps.dispatch. */
const defaultDispatch: DispatchFn = (_prompt, agentName) =>
  Promise.reject(
    new Error(
      `multi-agent: no dispatcher provided for agent "${agentName}". Inject deps.dispatch (e.g. dispatchClaudeAgent from ./dispatch.js).`,
    ),
  )

/** Aggregate findings across all agents into severity buckets. */
export function aggregateFindings(results: AgentResult[]): AggregatedReview {
  const blockers: Finding[] = []
  const warnings: Finding[] = []
  const notes: Finding[] = []
  let passCount = 0

  for (const r of results) {
    if (r.passed && r.findings.length === 0) {
      passCount++
    }
    for (const f of r.findings) {
      if (f.severity === 'blocker') blockers.push(f)
      else if (f.severity === 'warning') warnings.push(f)
      else notes.push(f)
    }
  }

  return {
    blockers,
    warnings,
    notes,
    passCount,
    totalAgents: results.length,
  }
}
