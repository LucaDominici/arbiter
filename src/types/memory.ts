/**
 * ArbiterMemoryPlugin — interface for pluggable memory backends.
 *
 * @beta API is public but not stable. Breaking changes possible before v1.0.
 *
 * This interface is plugin-only: core arbiter modules must not import it.
 * Implement this interface in a plugin package and inject it via PluginContext.
 */
export interface ArbiterMemoryPlugin {
  /** Persist a value under the given key. */
  store(key: string, value: unknown): Promise<void>
  /** Retrieve a previously stored value, or undefined if not found. */
  retrieve(key: string): Promise<unknown>
  /** Search stored entries by a string query; returns matching key/value pairs. */
  search(query: string): Promise<Array<{ key: string; value: unknown }>>
}
