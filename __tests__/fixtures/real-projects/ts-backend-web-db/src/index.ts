export function buildRoute(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`
}

export function parseQueryParam(value: string | undefined, fallback: string): string {
  return value ?? fallback
}
