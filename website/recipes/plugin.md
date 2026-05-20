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

## Scaffold

```bash
arbiter plugin add my-plugin
```

This creates:

```
my-plugin/
├── index.js        # ArbiterPlugin implementation
├── package.json
└── templates/      # EJS templates emitted by generate()
```

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
