import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'arbiter',
  description: 'AI development governance framework — install once, enforce forever.',
  lastUpdated: true,
  cleanUrls: true,

  sitemap: {
    hostname: 'https://arbiter.dev',
  },

  themeConfig: {
    nav: [
      { text: 'Docs', link: '/quickstart/' },
      { text: 'Comparisons', link: '/comparisons/' },
      { text: 'Recipes', link: '/recipes/' },
      { text: 'Community', link: '/community/' },
      { text: 'GitHub', link: 'https://github.com/LucaDominici/arbiter' },
      {
        text: 'v0 (next)',
        items: [
          { text: 'v0 (next)', link: '/' },
          { text: 'v0.1 (latest)', link: '/v/latest/', activeMatch: '^/v/latest/' },
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
