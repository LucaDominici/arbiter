import { renderTemplate } from '../utils/render.js';
import { writeFile, resolvedPath } from '../utils/fs.js';
import type { ProjectConfig } from '../wizard/types.js';
import type { WriteResult } from '../utils/fs.js';

export interface CursorGeneratorResult {
  files: WriteResult[];
}

export function generateCursor(config: ProjectConfig): CursorGeneratorResult {
  const data = config as unknown as Record<string, unknown>;
  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, '.cursorrules'),
        renderTemplate('cursor/.cursorrules.ejs', data),
        { backup: true },
      ),
    ],
  };
}
