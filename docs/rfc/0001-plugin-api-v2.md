---
rfc: 0001
title: 'Plugin API v2 surface'
status: accepted
created: 2026-05-16
authors:
  - ulfwerenar
doc_version: '1.0.0'
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# RFC 0001: Plugin API v2 surface

## Motivation

The current plugin API (`apiVersion: '1'`) has shipped. Before the public v1 launch we need to document the planned v2 surface so plugin authors can design for it without breaking changes.

The v1 surface is deliberately minimal (`detect`, `generate`, `verifyPlanRules`, `templateRoot`). v2 should add:

- **Lifecycle hooks** (`beforeGenerate`, `afterGenerate`) so plugins can run pre/post actions.
- **Explicit capability declaration** so `arbiter init` can show users what a plugin does before installing.
- **Memory integration** — formal type for `ArbiterMemoryPlugin` (currently informal).

## Detailed Design

### New fields on `ArbiterPlugin` (additive, all optional for v1 compat)

```typescript
export interface ArbiterPlugin {
  // Existing (unchanged)
  name: string
  apiVersion: '1' | '2'
  templateRoot: string
  detect?(config: ArbiterConfig): boolean
  generate(ctx: PluginContext): PluginResult
  verifyPlanRules?: VerifyPlanRule[]

  // New in v2
  capabilities?: PluginCapability[]
  beforeGenerate?(ctx: PluginContext): Promise<void> | void
  afterGenerate?(ctx: PluginContext, result: PluginResult): Promise<void> | void
  memory?: ArbiterMemoryPlugin
}

export type PluginCapability =
  | 'templates' // generates files from templates
  | 'verify-rules' // contributes plan-verify rules
  | 'lifecycle-hooks' // runs beforeGenerate / afterGenerate

export interface ArbiterMemoryPlugin {
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
}
```

### Versioning rule

Plugins declaring `apiVersion: '2'` MUST be valid v1 plugins (all v1 required fields present). The arbiter host ignores unknown v2 fields when running in v1 compatibility mode, and invokes lifecycle hooks only when `apiVersion` is `'2'`.

### Migration

v1 plugins: no change needed. v2 adds `apiVersion: '2'` and any of the new optional fields.

## Drawbacks

- `beforeGenerate` / `afterGenerate` run in the host process — a misbehaving plugin can block generation. Mitigation: apply a 30s timeout on lifecycle hooks (enforced by the host).
- `capabilities` is advisory only — arbiter does not validate that a plugin's declared capabilities match what it actually does.

## Alternatives

- **Separate lifecycle-hooks plugin type** — considered, rejected because it would require plugin authors to publish two packages.
- **Capability enforcement** — rejected for v2; adds complexity. Revisit in v3.

## Unresolved Questions

- Should `memory` be injected by the host at call time (dependency injection), or declared on the plugin object and wired at load time? Current design: declared on the object; host wires it during `loadPlugin`.
- Is 30s the right lifecycle-hook timeout? Open for community feedback.
