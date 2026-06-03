// SPDX-License-Identifier: Apache-2.0
import type { Archetype, ContractType } from './types.js'

/**
 * Derive the default contract testing strategy from archetype + hasPublicApi.
 * See ADR-028 (ML) and the contractType default map.
 */
export function defaultContractType(
  archetype: Archetype | undefined,
  hasPublicApi: boolean,
): ContractType {
  if (!hasPublicApi) return 'none'
  switch (archetype) {
    case 'backend-web-db':
      return 'rest-owned'
    case 'frontend-spa':
      return 'rest-public'
    case 'data-pipeline':
      return 'message-queue'
    default:
      return 'none'
  }
}

/**
 * Whether the wizard should show the contractType question.
 * Only asked when hasPublicApi === true. The wizard's imperative guard
 * delegates to this helper so the show/hide rule can be unit-tested
 * independently of the prompt-collection layer.
 */
export function shouldAskContractType(answers: { hasPublicApi?: boolean }): boolean {
  return answers.hasPublicApi === true
}
