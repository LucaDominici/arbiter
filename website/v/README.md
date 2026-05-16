# Versioned Docs — Mechanism

## Policy

| Slot               | Content                             | URL prefix         |
| ------------------ | ----------------------------------- | ------------------ |
| **next** (default) | `main` branch — current development | `/` (root of site) |
| **latest**         | Most recent tagged release — stable | `/v/latest/`       |

## Current state

`v/latest/` is a placeholder — populated on first stable tag.

Until a release tag exists, the version dropdown in the site nav shows "v0 (next)" only. The dropdown entry for v0.1 (latest) is intentionally disabled until content is populated here.

## Mechanism (copy-on-tag)

When a release tag is cut (`vX.Y.Z`):

1. CI copies the built `website/.vitepress/dist/` into `website/v/vX.Y.Z/`
2. `website/v/latest/` is updated to point at that version (symlink or copy)
3. The version dropdown in `config.ts` gains a new entry

No VitePress plugin required — the site is static and URLs are stable.

## Adding a new version entry

Edit `website/.vitepress/config.ts` nav array:

```ts
{
  text: 'v0 (next)',
  items: [
    { text: 'v0 (next)', link: '/' },
    { text: 'v0.1 (latest)', link: '/v/v0.1/' },
  ],
},
```
