// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

const PluginPackageSchema = z.object({
  name: z
    .string()
    .regex(/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, 'Invalid npm package name'),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Must follow semver (MAJOR.MINOR.PATCH)'),
  keywords: z.array(z.string()).refine((kw) => kw.includes('arbiter-plugin'), {
    message: 'keywords must include "arbiter-plugin"',
  }),
  main: z.string().optional(),
  module: z.string().optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
})

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

export function validatePluginPackageJson(raw: unknown): ValidationResult {
  const result = PluginPackageSchema.safeParse(raw)
  if (result.success) return { ok: true, errors: [] }
  const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  return { ok: false, errors }
}
