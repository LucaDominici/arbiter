// SPDX-License-Identifier: Apache-2.0
/**
 * Generator: Contract Integrity 5-Gate Suite (#716)
 *
 * Consumer pain removed: API contracts drift silently between services
 * because there is no continuous gate enforcing spec ↔ implementation
 * alignment. This generator emits up to five independent gate scripts
 * under scripts/contract-integrity/ — only the sub-flags the team
 * explicitly opts into are emitted, so adoption is incremental.
 *
 * Distinct from Pact / M28 contract testing (consumer-driven CDC);
 * this suite gates the provider side (OpenAPI snapshot, DTO parity, etc.).
 */
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ContractIntegrityResult {
  files: WriteResult[]
}

const GATE_SPECS = [
  {
    flag: 'openapiSnapshot' as const,
    template: 'scripts/contract-integrity/openapi-snapshot.mjs.ejs',
    filename: 'openapi-snapshot.mjs',
  },
  {
    flag: 'dtoParity' as const,
    template: 'scripts/contract-integrity/dto-parity.mjs.ejs',
    filename: 'dto-parity.mjs',
  },
  {
    flag: 'operationSmoke' as const,
    template: 'scripts/contract-integrity/operation-smoke.mjs.ejs',
    filename: 'operation-smoke.mjs',
  },
  {
    flag: 'deadCode' as const,
    template: 'scripts/contract-integrity/dead-code.mjs.ejs',
    filename: 'dead-code.mjs',
  },
  {
    flag: 'testHygiene' as const,
    template: 'scripts/contract-integrity/test-hygiene.mjs.ejs',
    filename: 'test-hygiene.mjs',
  },
] as const

export function generateContractIntegrity(config: ProjectConfig): ContractIntegrityResult {
  const gates = config.contractIntegrity?.gates
  if (!gates) {
    return { files: [] }
  }

  const files: WriteResult[] = []
  const outDir = resolvedPath(config.targetDir, 'scripts', 'contract-integrity')

  for (const spec of GATE_SPECS) {
    if (gates[spec.flag]) {
      files.push(
        writeFile(resolvedPath(outDir, spec.filename), renderTemplate(spec.template, config), {
          skipIfExists: true,
        }),
      )
    }
  }

  return { files }
}
