---
generated: true
source: 'docs/PLUGIN-API.md'
source_sha: '2280df21d9d8f60b617f11803f67032808360a5c'
last_updated: '2026-06-15'
---

# Plugin API Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PLUGIN-API.md](../docs/PLUGIN-API.md)

# Plugin API Reference

**Issue:** #603 (R1.K6)
**Current `apiVersion`:** `"1"`

The arbiter plugin API lets third parties register generators that emit files into the target project alongside arbiter's own templates. This document is the **stability contract** between arbiter and plugin authors.

---

## Bump policy

`apiVersion` is bumped **only on breaking interface changes** to `ArbiterPlugin`, `PluginContext`, `PluginFile`, or `PluginResult` in `src/types/plugin.ts`.

A breaking change is:

- removing a field from an interface
- changing the type of an existing field
- making an optional field required
- changing a method signature (parameter count/type, return type)

Adding a new optional field is **non-breaking** and does not bump `apiVersion`.

When `apiVersion` does bump (`"1"` → `"2"`):

1. The previous version stays loadable for **at least one major arbiter release** (overlap window).
2. A migration tool ships in the same PR that bumps the version (or in a sibling PR landing the same week).
3. The deprecation timeline is documented in CHANGELOG and surfaced as a runtime warning on `arbiter plugin add` for plugins still on the old version.

The CI gate `scripts/check-plugin-api-stability.mjs` enforces this: any change to `src/types/plugin.ts` requires `apiVersion` to be bumped in the same commit, or the gate fails.

---

## Stability table

Markers:

- **stable** — frozen contract; cannot change without `apiVersion` bump.
- **beta** — shape may change in minor releases until v1.0; bump required for breaking changes.
- **experimental** — may change without notice; do not rely on in production plugins.

### `ArbiterPlugin`

| Field             | Type                                   | Stability    | Notes                                                           |
| ----------------- | -------------------------------------- | ------------ | --------------------------------------------------------------- |
| `name`            | `string`                               | stable       | Plugin display name; must be unique across loaded plugins.      |
| `apiVersion`      | `"1"`                                  | stable       | Pinned literal; bumped per the policy above.                    |
| `templateRoot`    | `string`                               | stable       | Filesystem path to the plugin's EJS templates root.             |
| `detect`          | `(config: ArbiterConfig) => boolean`   | beta         | Optional auto-activation predicate.                             |
| `generate`        | `(ctx: PluginContext) => PluginResult` | stable       | Required entrypoint; called once per `arbiter init` / `update`. |
| `verifyPlanRules` | `VerifyPlanRule[]`                     | experimental | Verify-plan rule contributions; rule contract still in flux.    |

### `PluginContext`

| Field            | Type                                                         | Stability    | Notes                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`         | `ArbiterConfig`                                              | stable       | Resolved + migrated project config.                                                                                                                                                                                                         |
| `targetDir`      | `string`                                                     | stable       | Absolute path to the project root being generated into.                                                                                                                                                                                     |
| `renderTemplate` | `(relPath: string, data: Record<string, unknown>) => string` | stable       | Render an EJS template under `templateRoot` with the supplied data. `basePackage` is always made a defined key (value `undefined` when unset) so templates may reference it bare without an `EJS basePackage is not defined` crash (#1348). |
| `memory`         | `ArbiterMemoryPlugin?`                                       | experimental | Optional memory backend; injected by the host when a memory plugin loaded.                                                                                                                                                                  |

### `PluginFile`

| Field     | Type                                         | Stability | Notes                                 |
| --------- | -------------------------------------------- | --------- | ------------------------------------- |
| `path`    | `string`                                     | stable    | Path relative to `targetDir`.         |
| `content` | `string`                                     | stable    | File contents to write.               |
| `action`  | `'create' \| 'backup-and-replace' \| 'skip'` | beta      | Write policy; defaults to `'create'`. |

### `PluginResult`

| Field   | Type           | Stability | Notes                                     |
| ------- | -------------- | --------- | ----------------------------------------- |
| `files` | `PluginFile[]` | stable    | Files produced by this plugin invocation. |

---

## Authoring recipe (B10)

A minimal plugin:

```ts
import type { ArbiterPlugin } from 'arbiter/types/plugin'

const plugin: ArbiterPlugin = {
  name: 'my-plugin',
  apiVersion: '1',
  templateRoot: new URL('./templates', import.meta.url).pathname,
  generate(ctx) {
    return {
      files: [
        {
          path: '.my-plugin/README.md',
          content: ctx.renderTemplate('readme.md.ejs', { project: ctx.config.version }),
          action: 'create',
        },
      ],
    }
  },
}

export default plugin
```

See `src/templates/plugin-init/` for the scaffold emitted by `arbiter plugin init`.

---

## Naming and discovery convention

Plugins published to npm must follow this convention to appear in `arbiter integrations list --recommended` and in the [plugin registry](https://arbiter.dev/plugins):

| Requirement     | Value                                                     |
| --------------- | --------------------------------------------------------- |
| npm keyword     | `arbiter-plugin`                                          |
| Package name    | `arbiter-plugin-<name>` or `@scope/arbiter-plugin-<name>` |
| Peer dependency | `"@arbiter/cli": "*"`                                     |

`arbiter plugin list --validate` checks installed plugin `package.json` files against this schema (schema-only; no plugin code is executed).

---

## Versioning history

| `apiVersion` | Shipped in arbiter | Notes                                |
| ------------ | ------------------ | ------------------------------------ |
| `"1"`        | v0.1               | Initial public plugin API (`@beta`). |
