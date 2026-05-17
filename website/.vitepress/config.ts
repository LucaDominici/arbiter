import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'arbiter',
  description: 'AI development governance framework — install once, enforce forever.',
  lastUpdated: true,
  cleanUrls: true,
  // Suppress known pre-existing dead links that point outside the VitePress build root
  ignoreDeadLinks: [/docs\/PLUGIN-API/, /docs\/INTEGRATIONS/],

  sitemap: {
    hostname: 'https://arbiter.dev',
  },

  head: [
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'arbiter — AI governance that installs itself.' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'One command installs a complete, standards-aligned governance stack into any project — AGENTS.md, hooks, gate scripts, CI workflows, and more.',
      },
    ],
    ['meta', { property: 'og:url', content: 'https://arbiter.dev' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'arbiter — AI governance that installs itself.' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'One command installs a complete, standards-aligned governance stack into any project.',
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: 'Docs', link: '/quickstart/' },
      { text: 'Comparisons', link: '/comparisons/' },
      { text: 'Recipes', link: '/recipes/' },
      { text: 'Changelog', link: '/changelog/' },
      { text: 'Community', link: '/community/' },
      { text: 'GitHub', link: 'https://github.com/LucaDominici/arbiter' },
      {
        text: 'v0 (next)',
        items: [
          { text: 'v0 (next)', link: '/' },
          { text: 'v0.1 (latest)', link: '/v/latest/' },
        ],
      },
    ],

    sidebar: [
      { text: 'Home', link: '/' },
      { text: 'Quickstart', link: '/quickstart/' },
      { text: 'Concepts', link: '/concepts/' },
      {
        text: 'Reference',
        collapsed: false,
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Hooks', link: '/reference/hooks' },
          { text: 'Stack Support', link: '/reference/stacks' },
          { text: 'Templates', link: '/reference/templates' },
          { text: 'Experimental Policy', link: '/reference/experimental-policy' },
        ],
      },
      {
        text: 'Recipes',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/recipes/' },
          { text: 'Custom invariant', link: '/recipes/custom-invariant' },
          { text: 'Custom generator', link: '/recipes/custom-generator' },
          { text: 'Write a plugin', link: '/recipes/plugin' },
          { text: 'Brownfield onboarding', link: '/recipes/brownfield' },
        ],
      },
      {
        text: 'Comparisons',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/comparisons/' },
          { text: 'vs spec-kit', link: '/comparisons/spec-kit' },
          { text: 'vs BMAD', link: '/comparisons/bmad' },
          { text: 'vs GSD2', link: '/comparisons/gsd2' },
          { text: 'vs claude-flow', link: '/comparisons/claude-flow' },
          { text: 'vs SuperClaude', link: '/comparisons/superclaude' },
        ],
      },
      { text: 'Integrations', link: '/integrations/' },
      { text: 'Community', link: '/community/' },
      {
        text: 'Changelog',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/changelog/' },
          { text: 'Stable', link: '/changelog/stable' },
          { text: 'Beta', link: '/changelog/beta' },
          { text: 'Canary', link: '/changelog/canary' },
        ],
      },
      {
        text: 'Governance',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/governance/' },
          {
            text: 'AGENTS.md',
            link: 'https://github.com/LucaDominici/arbiter/blob/main/AGENTS.md',
          },
          {
            text: 'ADR Ledger',
            link: 'https://github.com/LucaDominici/arbiter/tree/main/docs/ADR',
          },
          {
            text: 'Decisions',
            link: 'https://github.com/LucaDominici/arbiter/blob/main/docs/SYSTEM/DECISIONS.md',
          },
        ],
      },
      {
        text: 'Contribute',
        collapsed: true,
        items: [{ text: 'Translations', link: '/i18n/CONTRIBUTING' }],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/LucaDominici/arbiter' }],

    footer: {
      message: 'Released under the Apache 2.0 License.',
      copyright: 'Copyright © 2026 arbiter contributors',
    },

    editLink: {
      pattern: 'https://github.com/LucaDominici/arbiter/edit/main/website/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },
  },
})
