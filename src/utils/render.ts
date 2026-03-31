import ejs from 'ejs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/**
 * Render an EJS template file relative to the templates/ directory.
 */
export function renderTemplate(templatePath: string, data: Record<string, unknown>): string {
  const fullPath = join(TEMPLATES_DIR, templatePath);
  const source = readFileSync(fullPath, 'utf-8');
  return ejs.render(source, data, { filename: fullPath });
}

/**
 * Render an EJS template string directly.
 */
export function renderString(template: string, data: Record<string, unknown>): string {
  return ejs.render(template, data);
}
