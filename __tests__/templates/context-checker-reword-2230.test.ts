import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderTemplate } from '../../src/utils/render.js';
import { makeConfig } from '../helpers.js';

describe('#2230 context-checker stops naming the un-emitted script', () => {
  it('rendered ejs twin no longer names scripts/emit-context-pack.mjs', () => {
    const rendered = renderTemplate(
      'claude/agents/context-checker.md.ejs',
      makeConfig(join(process.cwd(), 'tmp-2230')),
    );

    expect(rendered).not.toContain('scripts/emit-context-pack.mjs');
    expect(rendered).toContain('CONTEXT_PACK.md');
  });

  it('self + 3 examples stay coherent (no script name)', () => {
    const files = [
      '.claude/agents/context-checker.md',
      'examples/go-library/.claude/agents/context-checker.md',
      'examples/ts-library/.claude/agents/context-checker.md',
      'examples/python-library/.claude/agents/context-checker.md',
    ];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toContain('scripts/emit-context-pack.mjs');
    }
  });
});
