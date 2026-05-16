<!-- api-snapshot hash:3305e25364461443 -->

```typescript
export interface ArbiterPlugin { name: string apiVersion: '1' templateRoot: string detect?(config: ArbiterConfig): boolean generate(ctx: PluginContext): PluginResult verifyPlanRules?: VerifyPlanRule[] }
export interface PluginContext { config: ArbiterConfig targetDir: string renderTemplate(relPath: string, data: Record<string, unknown>): string memory?: ArbiterMemoryPlugin }
export interface PluginFile { path: string content: string action?: 'create' | 'backup-and-replace' | 'skip' }
export interface PluginResult { files: PluginFile[] }
```
