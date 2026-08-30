---
title: 'Recipe: Write an arbiter Plugin'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Recipe: Write an arbiter Plugin

Plugins extend arbiter for a specific project without modifying arbiter itself. A plugin can emit template files, add verify-plan rules, or both.

## Layout

`arbiter plugin add` does not scaffold a plugin project — it resolves, installs, and
registers one that already exists. Hand-author the package first:

```
my-plugin/
├── index.js        # ArbiterPlugin implementation
├── package.json    # keywords must include "arbiter-plugin"
└── templates/      # EJS templates emitted by generate()
```

Then register it:

```bash
arbiter plugin add ./my-plugin
```

`add` validates the plugin loads (via the same loader `arbiter update` uses) before
writing it to `arbiter.json`'s `plugins` array — a plugin that fails to load never
gets persisted. Passing an npm package name instead of a local path (e.g.
`arbiter plugin add arbiter-plugin-spring-boot`) installs it as a devDependency
first (`--no-install` skips that step). `arbiter plugin list` shows every
configured plugin with its current load status.

## The ArbiterPlugin contract

```ts
interface ArbiterPlugin {
  name: string // unique, used in error messages
  apiVersion: '1' // must be the string '1'
  templateRoot: string // absolute path to templates/

  detect?(config: ArbiterConfig): boolean // optional: auto-activate when true
  generate(ctx: PluginContext): PluginResult // required: return files to emit
  verifyPlanRules?: VerifyPlanRule[] // optional: custom governance rules
}
```

The `@beta` tag on the API means the contract is stable for internal use but breaking changes are possible before v1.0.

## Minimal working plugin

```js
// my-plugin/index.js
const { join } = require('node:path')

/** @type {import("@arbiter/cli/plugin").ArbiterPlugin} */
module.exports = {
  name: 'my-plugin',
  apiVersion: '1',
  templateRoot: join(__dirname, 'templates'),

  generate(ctx) {
    const content = ctx.renderTemplate('my-config.json.ejs', {
      projectName: ctx.config.tools?.join(',') ?? 'project',
    })
    return {
      files: [
        {
          path: join(ctx.targetDir, '.my-tool', 'config.json'),
          content,
          action: 'create', // 'create' | 'backup-and-replace' | 'skip'
        },
      ],
    }
  },
}
```

## PluginContext fields

| Field            | Type                   | Purpose                                    |
| ---------------- | ---------------------- | ------------------------------------------ |
| `config`         | `ArbiterConfig`        | Detected language, archetype, level, tools |
| `targetDir`      | `string`               | Absolute path to the target project        |
| `renderTemplate` | `fn`                   | Render an EJS template from `templateRoot` |
| `memory`         | `ArbiterMemoryPlugin?` | Optional memory backend if configured      |

## Register in arbiter config

`arbiter plugin add ./my-plugin` writes this for you (see Layout above). The result is
the same as hand-editing `arbiter.json`:

```json
{
  "plugins": ["./my-plugin"]
}
```

Run `arbiter init` (or `arbiter update`) to emit the plugin's files.

## Example: plugin-spring-boot

See `examples/plugin-spring-boot/` for a real example — it detects `archetype === 'backend-web-db'` and emits a Spring Boot `Application.java` scaffold.

## Reference

- Contract types: `src/types/plugin.ts`
- Example: `examples/plugin-spring-boot/index.js`
