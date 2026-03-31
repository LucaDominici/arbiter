import { renderTemplate } from '../utils/render.js';
import { writeFile, resolvedPath } from '../utils/fs.js';
import type { ProjectConfig } from '../wizard/types.js';
import type { WriteResult } from '../utils/fs.js';

export function generateAgentsMd(config: ProjectConfig): WriteResult {
  const content = renderTemplate('agents-md/AGENTS.md.ejs', config as unknown as Record<string, unknown>);
  return writeFile(resolvedPath(config.targetDir, 'AGENTS.md'), content, { backup: true });
}
