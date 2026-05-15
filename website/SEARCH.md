# Docs Search

## Current: VitePress local search

Local search is enabled out of the box — no account or API key required. The search index is built at deploy time from all `.md` files.

Configuration in `website/.vitepress/config.ts`:

```ts
themeConfig: {
  search: {
    provider: 'local',
  },
}
```

## Planned: Algolia DocSearch

Algolia DocSearch is free for open-source projects. An application has been submitted (tracked on [issue #522](https://github.com/LucaDominici/arbiter/issues/522)). Once approved, swap the search provider:

```ts
themeConfig: {
  search: {
    provider: 'algolia',
    options: {
      appId: '<APP_ID>',
      apiKey: '<SEARCH_ONLY_KEY>',
      indexName: 'arbiter',
    },
  },
}
```

The `apiKey` here is the **search-only** public key — safe to commit. The admin key must never enter the repo.

## Sitemap + indexability

VitePress emits `sitemap.xml` at build time. The sitemap URL is declared in `robots.txt` at the root of the deployed site. Search engines and Algolia's crawler both discover content via the sitemap.
