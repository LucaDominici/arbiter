<!-- api-snapshot hash:d5c130f0f02718ed -->

```typescript
export interface ArbiterPlugin { name: string apiVersion: '1' templateRoot: string detect?(config: ArbiterConfig): boolean | Promise<boolean> generate(ctx: PluginContext): PluginResult | Promise<PluginResult> verifyPlanRules?: VerifyPlanRule[] invariants?: Invariant[] }
export interface PluginContext { config: ArbiterConfig targetDir: string renderTemplate(relPath: string, data: Record<string, unknown>): string memory?: ArbiterMemoryPlugin }
export interface PluginFile { path: string content: string action?: 'create' | 'backup-and-replace' | 'skip' }
export interface PluginResult { files: PluginFile[] }
```
