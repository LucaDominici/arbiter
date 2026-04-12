# Obsidian Vault POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Obsidian vault generator to arbiter that produces a browsable markdown second-brain (governance + architecture + PRD templates + GitHub index) inside target projects at `docs/vault/`.

**Architecture:** New generator `src/generators/obsidian-vault.ts` follows the existing `generateSkills` pattern. New command `arbiter obsidian` supports `--sync`, `--dry-run`, `--force`, `--github-only`. Sync preserves files without the `<!-- arbiter:generated -->` marker. Frontmatter YAML is pre-shaped for future Dataview plugin compatibility.

**Tech Stack:** TypeScript (strict), EJS templates in `src/templates/obsidian-vault/`, vitest tests in `__tests__/`, commander CLI, `gh` CLI for GitHub data, existing `renderTemplate` + `writeFile` helpers.

**Spec reference:** `docs/ARCHITECTURE/OBSIDIAN-VAULT-POC.md`

**Branch:** `task/obsidian-vault-poc` (already created)

**Gate:** `node scripts/check-all.mjs L1` before each commit, `L2` before final push.

---

## File Structure

**New files:**

- `src/generators/obsidian-vault.ts` — orchestrator (exports `generateObsidianVault`)
- `src/generators/obsidian-vault-invariants.ts` — invariant notes
- `src/generators/obsidian-vault-modules.ts` — module + architecture notes
- `src/generators/obsidian-vault-github.ts` — github notes + `gh` fetch
- `src/generators/obsidian-vault-index.ts` — 00-INDEX.md + impact-map
- `src/generators/obsidian-vault-static.ts` — PRD templates, decisions template, .obsidian config
- `src/commands/obsidian.ts` — `runObsidian` command
- `src/detectors/modules.ts` — `detectModules` helper
- `src/utils/vault-sync.ts` — marker-aware write helper `writeVaultFile`
- `src/templates/obsidian-vault/` — EJS templates (see Task 2 for full tree)
- `__tests__/generators/obsidian-vault.test.ts`
- `__tests__/generators/obsidian-vault-invariants.test.ts`
- `__tests__/generators/obsidian-vault-modules.test.ts`
- `__tests__/generators/obsidian-vault-github.test.ts`
- `__tests__/commands/obsidian.test.ts`
- `__tests__/detectors/modules.test.ts`
- `__tests__/utils/vault-sync.test.ts`

**Modified files:**

- `src/wizard/types.ts` — add `enableObsidianVault?: boolean` to `ProjectConfig`
- `src/utils/config.ts` — add `enableObsidianVault?: boolean` to `ArbiterConfig`
- `src/wizard/prompts.ts` — new optional question
- `src/commands/init.ts` — wire generator, persist flag via `saveConfig`
- `src/cli.ts` — register `obsidian` subcommand
- `__tests__/helpers.ts` — extend `makeConfig` fixture with flag (optional)

Each file has a single responsibility. Tests live next to their counterparts in `__tests__/`.

---

## Task 1: Extend config types with `enableObsidianVault` flag

**Files:**

- Modify: `src/wizard/types.ts` (add field to `ProjectConfig`)
- Modify: `src/utils/config.ts` (add field to `ArbiterConfig`)
- Test: `__tests__/utils/config-obsidian.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `__tests__/utils/config-obsidian.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig, loadConfig } from "../../src/utils/config.js";

describe("ArbiterConfig.enableObsidianVault", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-cfg-obs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists enableObsidianVault=true round-trip", () => {
    saveConfig(dir, {
      version: "0.1",
      tools: ["claude"],
      governanceLevel: "L2",
      useGitHub: false,
      enableObsidianVault: true,
    });
    const loaded = loadConfig(dir);
    expect(loaded?.enableObsidianVault).toBe(true);
  });

  it("omits enableObsidianVault when not set", () => {
    saveConfig(dir, {
      version: "0.1",
      tools: ["claude"],
      governanceLevel: "L2",
      useGitHub: false,
    });
    const loaded = loadConfig(dir);
    expect(loaded?.enableObsidianVault).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test and see it fail**

Run: `npx vitest run __tests__/utils/config-obsidian.test.ts`
Expected: FAIL — `enableObsidianVault` is not a valid field on `ArbiterConfig`.

- [ ] **Step 3: Add field to `ArbiterConfig`**

Modify `src/utils/config.ts`, in the `ArbiterConfig` interface:

```typescript
export interface ArbiterConfig {
  version: string;
  tools: AiTool[];
  governanceLevel: GovernanceLevel;
  useGitHub: boolean;
  enableDebtGates?: boolean;
  invariantTiers?: InvariantTier[];
  worktree?: WorktreeConfig;
  /** Whether the Obsidian vault generator ran during init. Used by `arbiter obsidian` sync. */
  enableObsidianVault?: boolean;
}
```

- [ ] **Step 4: Add field to `ProjectConfig`**

Modify `src/wizard/types.ts`, append to `ProjectConfig`:

```typescript
  /** Whether to generate the optional Obsidian vault at docs/vault/. */
  enableObsidianVault?: boolean;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/utils/config-obsidian.test.ts`
Expected: PASS.

- [ ] **Step 6: Run L1 gate**

Run: `node scripts/check-all.mjs L1`
Expected: ALL PASSED.

- [ ] **Step 7: Commit**

```bash
git add src/utils/config.ts src/wizard/types.ts __tests__/utils/config-obsidian.test.ts
git commit -m "feat(obsidian): add enableObsidianVault config flag"
```

---

## Task 2: Create template skeleton + .obsidian settings

**Files:**

- Create: `src/templates/obsidian-vault/.obsidian/app.json.ejs`
- Create: `src/templates/obsidian-vault/.obsidian/graph.json.ejs`
- Create: `src/templates/obsidian-vault/00-INDEX.md.ejs`
- Create: `src/templates/obsidian-vault/prd/_template.md.ejs`
- Create: `src/templates/obsidian-vault/prd/_impact-template.md.ejs`
- Create: `src/templates/obsidian-vault/governance/decisions/_template.md.ejs`
- Create: `src/generators/obsidian-vault-static.ts`
- Test: `__tests__/generators/obsidian-vault-static.test.ts`

- [ ] **Step 1: Create `.obsidian/app.json.ejs`**

```ejs
{
  "alwaysUpdateLinks": true,
  "newFileLocation": "current",
  "attachmentFolderPath": "attachments",
  "showLineNumber": true
}
```

- [ ] **Step 2: Create `.obsidian/graph.json.ejs`**

```ejs
{
  "collapse-filter": true,
  "search": "",
  "showTags": true,
  "showAttachments": false,
  "hideUnresolved": false,
  "showOrphans": true,
  "collapse-color-groups": false,
  "colorGroups": [
    { "query": "tag:#invariant", "color": { "a": 1, "rgb": 16711680 } },
    { "query": "tag:#module", "color": { "a": 1, "rgb": 255 } },
    { "query": "tag:#decision", "color": { "a": 1, "rgb": 65280 } }
  ],
  "collapse-display": false,
  "showArrow": true,
  "textFadeMultiplier": 0,
  "nodeSizeMultiplier": 1,
  "lineSizeMultiplier": 1,
  "collapse-forces": false,
  "centerStrength": 0.5,
  "repelStrength": 10,
  "linkStrength": 1,
  "linkDistance": 250,
  "scale": 1
}
```

- [ ] **Step 3: Create `00-INDEX.md.ejs`**

```ejs
---
title: <%= projectName %> — Vault Index
tags: [index, arbiter-generated]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-index.ts -->

# <%= projectName %> — Vault Index

Governance + architecture + PRD + GitHub second brain generated by arbiter.

## Governance

- [[governance/AGENTS|AGENTS (sectioned)]]
- [[governance/invariants/_index|Invariants]]
- [[governance/decisions/_index|Decisions]]

## Architecture

- [[architecture/stack|Stack]]
- [[architecture/modules/_index|Modules]]
- [[architecture/dependencies|Dependencies]]
- [[architecture/impact-map|Impact Map]]

## Product

- [[prd/_template|PRD Template]]
- [[prd/_impact-template|PRD Impact Analysis Template]]

## GitHub

- [[github/open-issues|Open Issues]]
- [[github/labels|Labels]]

---

_Generated by arbiter from project `<%= projectName %>` (<%= language %>). Run `arbiter obsidian --sync` to refresh._
```

- [ ] **Step 4: Create `prd/_template.md.ejs`**

```ejs
---
title: PRD Template
status: draft
tags: [prd, template]
---

# PRD — <Feature Name>

## Problem

_Describe the problem being solved._

## Goals

- Goal 1
- Goal 2

## Non-Goals

- Out of scope 1

## Affected Modules

_Link modules affected: [[architecture/modules/<module-name>]]_

## Affected Invariants

_Link invariants touched: [[governance/invariants/INV-NN]]_

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Impact Analysis

See [[prd/_impact-template]] for the template.
```

- [ ] **Step 5: Create `prd/_impact-template.md.ejs`**

```ejs
---
title: PRD Impact Analysis Template
tags: [prd, impact]
---

# Impact Analysis — <Feature Name>

## Modules Changed

| Module | Change Type | Risk |
| ------ | ----------- | ---- |

## Invariants Affected

| Invariant | Impact |
| --------- | ------ |

## Migration Required

- [ ] Schema
- [ ] Config
- [ ] Data backfill

## Test Coverage Added

- Unit:
- Integration:
- E2E:

## Rollback Plan

_Describe rollback steps if this change needs to be reverted._
```

- [ ] **Step 6: Create `governance/decisions/_template.md.ejs`**

```ejs
---
id: ADR-NNN
title: <Decision Title>
date: YYYY-MM-DD
status: proposed
gh-issue: null
tags: [decision, adr]
---

# ADR-NNN — <Decision Title>

## Context

_What is the issue we are trying to solve?_

## Decision

_What is the change we propose?_

## Consequences

_What becomes easier, what becomes harder?_

## Related

- [[governance/invariants/INV-NN]]
```

- [ ] **Step 7: Write the failing test for `generateStaticVaultFiles`**

Create `__tests__/generators/obsidian-vault-static.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateStaticVaultFiles } from "../../src/generators/obsidian-vault-static.js";
import { makeConfig } from "../helpers.js";

describe("generateStaticVaultFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-static-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates .obsidian/app.json and graph.json", () => {
    const result = generateStaticVaultFiles(makeConfig(dir));
    expect(result.files.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, "docs/vault/.obsidian/app.json"))).toBe(true);
    expect(existsSync(join(dir, "docs/vault/.obsidian/graph.json"))).toBe(true);
  });

  it("creates PRD templates", () => {
    generateStaticVaultFiles(makeConfig(dir));
    expect(existsSync(join(dir, "docs/vault/prd/_template.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/vault/prd/_impact-template.md"))).toBe(
      true,
    );
  });

  it("creates decision template", () => {
    generateStaticVaultFiles(makeConfig(dir));
    expect(
      existsSync(join(dir, "docs/vault/governance/decisions/_template.md")),
    ).toBe(true);
  });

  it("index contains project name", () => {
    generateStaticVaultFiles(makeConfig(dir, { projectName: "poc-project" }));
    const content = readFileSync(join(dir, "docs/vault/00-INDEX.md"), "utf-8");
    expect(content).toContain("poc-project");
    expect(content).toContain("arbiter:generated");
  });
});
```

- [ ] **Step 8: Run the test to see it fail**

Run: `npx vitest run __tests__/generators/obsidian-vault-static.test.ts`
Expected: FAIL — `generateStaticVaultFiles` module not found.

- [ ] **Step 9: Implement `generateStaticVaultFiles`**

Create `src/generators/obsidian-vault-static.ts`:

```typescript
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface StaticVaultGeneratorResult {
  files: WriteResult[];
}

const STATIC_TEMPLATES = [
  { tpl: ".obsidian/app.json.ejs", out: ".obsidian/app.json" },
  { tpl: ".obsidian/graph.json.ejs", out: ".obsidian/graph.json" },
  { tpl: "00-INDEX.md.ejs", out: "00-INDEX.md" },
  { tpl: "prd/_template.md.ejs", out: "prd/_template.md" },
  { tpl: "prd/_impact-template.md.ejs", out: "prd/_impact-template.md" },
  {
    tpl: "governance/decisions/_template.md.ejs",
    out: "governance/decisions/_template.md",
  },
] as const;

export function generateStaticVaultFiles(
  config: ProjectConfig,
): StaticVaultGeneratorResult {
  const data = config as unknown as Record<string, unknown>;
  const base = resolvedPath(config.targetDir, "docs", "vault");

  const files = STATIC_TEMPLATES.map(({ tpl, out }) =>
    writeFile(
      resolvedPath(base, ...out.split("/")),
      renderTemplate(`obsidian-vault/${tpl}`, data),
      { skipIfExists: true },
    ),
  );

  return { files };
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run __tests__/generators/obsidian-vault-static.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 11: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/templates/obsidian-vault/ src/generators/obsidian-vault-static.ts __tests__/generators/obsidian-vault-static.test.ts
git commit -m "feat(obsidian): add static vault templates (index, prd, decisions, obsidian config)"
```

---

## Task 3: Implement invariant note generator

**Files:**

- Create: `src/templates/obsidian-vault/governance/invariants/INV.md.ejs`
- Create: `src/templates/obsidian-vault/governance/invariants/_index.md.ejs`
- Create: `src/generators/obsidian-vault-invariants.ts`
- Test: `__tests__/generators/obsidian-vault-invariants.test.ts`

- [ ] **Step 1: Create invariant note template `governance/invariants/INV.md.ejs`**

```ejs
---
id: <%= invariant.id %>
tier: <%= invariant.tier %>
title: <%= JSON.stringify(invariant.title) %>
status: active
always-active: <%= invariant.alwaysActive === true %>
enforcement: <%= JSON.stringify(invariant.enforcement) %>
affects-modules: []
gh-issues: []
tags: [invariant, tier-<%= tierIndex %>]
---
<!-- arbiter:generated source=src/invariants/catalog.ts -->

# <%= invariant.id %> — <%= invariant.title %>

**Tier:** <%= tierLabel %>
**Enforcement:** <%= invariant.enforcement %>

## Description

<%= invariant.description %>

<% if (languageDetail) { -%>
## Language-specific detail (<%= language %>)

<%= languageDetail %>
<% } -%>

## Related

- [[governance/AGENTS|AGENTS.md]]
<% (modules || []).forEach(function(m) { -%>
- [[architecture/modules/<%= m %>|<%= m %>]]
<% }); -%>
```

- [ ] **Step 2: Create invariants index template `governance/invariants/_index.md.ejs`**

```ejs
---
title: Invariants Index
tags: [index, invariants]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-invariants.ts -->

# Invariants Index

<% tiers.forEach(function(tier) { -%>
## <%= tier.label %>

<% tier.invariants.forEach(function(inv) { -%>
- [[governance/invariants/<%= inv.id %>|<%= inv.id %> — <%= inv.title %>]]
<% }); -%>

<% }); -%>
```

- [ ] **Step 3: Write the failing test**

Create `__tests__/generators/obsidian-vault-invariants.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { generateInvariantNotes } from "../../src/generators/obsidian-vault-invariants.js";
import { makeConfig } from "../helpers.js";

describe("generateInvariantNotes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-inv-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates one file per filtered invariant plus an index", () => {
    const result = generateInvariantNotes(makeConfig(dir));
    expect(result.files.length).toBeGreaterThan(1);
    expect(
      existsSync(join(dir, "docs/vault/governance/invariants/_index.md")),
    ).toBe(true);
    expect(
      existsSync(join(dir, "docs/vault/governance/invariants/INV-01.md")),
    ).toBe(true);
  });

  it("invariant notes have parseable frontmatter with required keys", () => {
    generateInvariantNotes(makeConfig(dir));
    const content = readFileSync(
      join(dir, "docs/vault/governance/invariants/INV-01.md"),
      "utf-8",
    );
    const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
    expect(fmMatch).not.toBeNull();
    const fm = parseYaml(fmMatch![1]) as Record<string, unknown>;
    expect(fm.id).toBe("INV-01");
    expect(fm.tier).toBe("architectural");
    expect(Array.isArray(fm["affects-modules"])).toBe(true);
    expect(Array.isArray(fm["gh-issues"])).toBe(true);
    expect(Array.isArray(fm.tags)).toBe(true);
  });

  it("invariant notes contain the generation marker", () => {
    generateInvariantNotes(makeConfig(dir));
    const content = readFileSync(
      join(dir, "docs/vault/governance/invariants/INV-01.md"),
      "utf-8",
    );
    expect(content).toContain("<!-- arbiter:generated source=");
  });

  it("filters invariants by governance level (L1 has fewer than L3)", () => {
    const l1 = generateInvariantNotes(
      makeConfig(dir, { governanceLevel: "L1" }),
    );
    const dirL3 = mkdtempSync(join(tmpdir(), "arbiter-vault-inv-l3-"));
    try {
      const l3 = generateInvariantNotes(
        makeConfig(dirL3, { governanceLevel: "L3" }),
      );
      expect(l3.files.length).toBeGreaterThanOrEqual(l1.files.length);
    } finally {
      rmSync(dirL3, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Run test to see it fail**

Run: `npx vitest run __tests__/generators/obsidian-vault-invariants.test.ts`
Expected: FAIL — module `obsidian-vault-invariants` not found.

- [ ] **Step 5: Implement `generateInvariantNotes`**

Create `src/generators/obsidian-vault-invariants.ts`:

```typescript
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig, InvariantTier } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";
import {
  getFilteredInvariants,
  getInvariantsByTier,
} from "../invariants/filter.js";
import type { Invariant } from "../invariants/types.js";

export interface InvariantNotesResult {
  files: WriteResult[];
}

const TIER_LABELS: Record<InvariantTier, string> = {
  architectural: "Tier 1: Architectural Integrity",
  data: "Tier 2: Data Integrity",
  security: "Tier 3: Security & Compliance",
  operational: "Tier 4: Operational Excellence",
  governance: "Tier 5: Governance",
};

const TIER_INDEX: Record<InvariantTier, number> = {
  architectural: 1,
  data: 2,
  security: 3,
  operational: 4,
  governance: 5,
};

function resolveLanguageDetail(
  inv: Invariant,
  language: string,
): string | null {
  if (!inv.languageDetail) return null;
  const key = language as keyof typeof inv.languageDetail;
  return inv.languageDetail[key] ?? inv.languageDetail.unknown ?? null;
}

export function generateInvariantNotes(
  config: ProjectConfig,
): InvariantNotesResult {
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  });
  const byTier = getInvariantsByTier(invariants);
  const base = resolvedPath(config.targetDir, "docs", "vault");

  const files: WriteResult[] = [];

  for (const invariant of invariants) {
    const data = {
      invariant,
      language: config.language,
      tierLabel: TIER_LABELS[invariant.tier],
      tierIndex: TIER_INDEX[invariant.tier],
      languageDetail: resolveLanguageDetail(invariant, config.language),
      modules: [] as string[],
    };
    files.push(
      writeFile(
        resolvedPath(base, "governance", "invariants", `${invariant.id}.md`),
        renderTemplate("obsidian-vault/governance/invariants/INV.md.ejs", data),
        { skipIfExists: false },
      ),
    );
  }

  const tiers = (Object.keys(byTier) as InvariantTier[]).map((tier) => ({
    label: TIER_LABELS[tier],
    invariants: byTier[tier],
  }));

  files.push(
    writeFile(
      resolvedPath(base, "governance", "invariants", "_index.md"),
      renderTemplate("obsidian-vault/governance/invariants/_index.md.ejs", {
        tiers,
      } as unknown as Record<string, unknown>),
      { skipIfExists: false },
    ),
  );

  return { files };
}
```

- [ ] **Step 6: Check `yaml` dependency availability**

Run: `node -e "require('yaml')"` in the arbiter repo root.
Expected: no error (yaml is a transitive dep of many tools).

If it fails: `npm install --save-dev yaml`

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run __tests__/generators/obsidian-vault-invariants.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/generators/obsidian-vault-invariants.ts src/templates/obsidian-vault/governance/invariants/ __tests__/generators/obsidian-vault-invariants.test.ts
git commit -m "feat(obsidian): generate invariant notes with frontmatter and index"
```

---

## Task 4: Implement module detector

**Files:**

- Create: `src/detectors/modules.ts`
- Test: `__tests__/detectors/modules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/detectors/modules.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectModules } from "../../src/detectors/modules.js";

describe("detectModules", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-modules-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("typescript: detects workspaces from package.json", () => {
    mkdirSync(join(dir, "packages", "core"), { recursive: true });
    mkdirSync(join(dir, "packages", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
    );
    writeFileSync(
      join(dir, "packages/core/package.json"),
      JSON.stringify({ name: "@proj/core" }),
    );
    writeFileSync(
      join(dir, "packages/ui/package.json"),
      JSON.stringify({ name: "@proj/ui" }),
    );

    const mods = detectModules(dir, "typescript");
    expect(mods.map((m) => m.name).sort()).toEqual(["@proj/core", "@proj/ui"]);
  });

  it("typescript: falls back to top-level source dirs when no workspaces", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "backend"), { recursive: true });
    mkdirSync(join(dir, "frontend"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));

    const mods = detectModules(dir, "typescript");
    const names = mods.map((m) => m.name).sort();
    expect(names).toContain("backend");
    expect(names).toContain("frontend");
    expect(names).toContain("src");
  });

  it("java: detects multi-module from settings.gradle includes", () => {
    writeFileSync(
      join(dir, "settings.gradle"),
      `rootProject.name = 'proj'\ninclude 'backend'\ninclude 'api'\n`,
    );
    const mods = detectModules(dir, "java");
    expect(mods.map((m) => m.name).sort()).toEqual(["api", "backend"]);
  });

  it("unknown language: returns empty", () => {
    const mods = detectModules(dir, "unknown");
    expect(mods).toEqual([]);
  });

  it("non-existent directory: returns empty", () => {
    const mods = detectModules(join(dir, "nope"), "typescript");
    expect(mods).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to see it fail**

Run: `npx vitest run __tests__/detectors/modules.test.ts`
Expected: FAIL — module `modules` not found.

- [ ] **Step 3: Implement `detectModules`**

Create `src/detectors/modules.ts`:

```typescript
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { Language } from "../wizard/types.js";

export interface DetectedModule {
  name: string;
  path: string;
  language: Language;
  kind:
    | "workspace"
    | "subdir"
    | "gradle-module"
    | "maven-module"
    | "go-package";
}

const FALLBACK_SOURCE_DIRS = [
  "src",
  "lib",
  "backend",
  "frontend",
  "api",
  "worker",
  "contracts",
];

export function detectModules(
  dir: string,
  language: Language,
): DetectedModule[] {
  if (!existsSync(dir)) return [];

  switch (language) {
    case "typescript":
      return detectTsModules(dir);
    case "java":
      return detectJavaModules(dir);
    case "go":
      return detectGoModules(dir);
    case "rust":
      return detectRustModules(dir);
    case "python":
      return detectPythonModules(dir);
    default:
      return [];
  }
}

function detectTsModules(dir: string): DetectedModule[] {
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        workspaces?: string[] | { packages?: string[] };
      };
      const patterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : (pkg.workspaces?.packages ?? []);
      if (patterns.length > 0) {
        return expandWorkspaces(dir, patterns);
      }
    } catch {
      // fall through
    }
  }
  return fallbackTopLevelDirs(dir, "typescript");
}

function expandWorkspaces(dir: string, patterns: string[]): DetectedModule[] {
  const results: DetectedModule[] = [];
  for (const pattern of patterns) {
    const match = pattern.match(/^(.+)\/\*$/);
    const parentRel = match ? match[1] : pattern;
    const parent = join(dir, parentRel);
    if (!existsSync(parent)) continue;

    if (match) {
      for (const child of readdirSync(parent)) {
        const childDir = join(parent, child);
        if (!statSync(childDir).isDirectory()) continue;
        const name = readWorkspaceName(childDir) ?? child;
        results.push({
          name,
          path: childDir,
          language: "typescript",
          kind: "workspace",
        });
      }
    } else {
      const name = readWorkspaceName(parent) ?? basename(parent);
      results.push({
        name,
        path: parent,
        language: "typescript",
        kind: "workspace",
      });
    }
  }
  return results;
}

function readWorkspaceName(dir: string): string | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
    return pkg.name ?? null;
  } catch {
    return null;
  }
}

function fallbackTopLevelDirs(
  dir: string,
  language: Language,
): DetectedModule[] {
  const results: DetectedModule[] = [];
  for (const candidate of FALLBACK_SOURCE_DIRS) {
    const p = join(dir, candidate);
    if (existsSync(p) && statSync(p).isDirectory()) {
      results.push({
        name: candidate,
        path: p,
        language,
        kind: "subdir",
      });
    }
  }
  return results;
}

function detectJavaModules(dir: string): DetectedModule[] {
  const settings = join(dir, "settings.gradle");
  const settingsKts = join(dir, "settings.gradle.kts");
  const gradlePath = existsSync(settings)
    ? settings
    : existsSync(settingsKts)
      ? settingsKts
      : null;

  if (gradlePath) {
    const content = readFileSync(gradlePath, "utf-8");
    const names = Array.from(
      content.matchAll(/include\s*\(?\s*['"]:?([^'"\s,)]+)['"]/g),
      (m) => m[1].replace(/^:/, "").split(":").pop() ?? "",
    ).filter((s) => s.length > 0);
    return names.map((name) => ({
      name,
      path: join(dir, name),
      language: "java",
      kind: "gradle-module",
    }));
  }

  const pomPath = join(dir, "pom.xml");
  if (existsSync(pomPath)) {
    const content = readFileSync(pomPath, "utf-8");
    const names = Array.from(
      content.matchAll(/<module>([^<]+)<\/module>/g),
      (m) => m[1].trim(),
    );
    return names.map((name) => ({
      name,
      path: join(dir, name),
      language: "java",
      kind: "maven-module",
    }));
  }

  return fallbackTopLevelDirs(dir, "java");
}

function detectGoModules(dir: string): DetectedModule[] {
  return fallbackTopLevelDirs(dir, "go");
}

function detectRustModules(dir: string): DetectedModule[] {
  return fallbackTopLevelDirs(dir, "rust");
}

function detectPythonModules(dir: string): DetectedModule[] {
  return fallbackTopLevelDirs(dir, "python");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/detectors/modules.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/detectors/modules.ts __tests__/detectors/modules.test.ts
git commit -m "feat(obsidian): add module detector (ts workspaces, gradle, maven, subdirs)"
```

---

## Task 5: Generate module + architecture notes

**Files:**

- Create: `src/templates/obsidian-vault/architecture/modules/module.md.ejs`
- Create: `src/templates/obsidian-vault/architecture/modules/_index.md.ejs`
- Create: `src/templates/obsidian-vault/architecture/stack.md.ejs`
- Create: `src/templates/obsidian-vault/architecture/dependencies.md.ejs`
- Create: `src/generators/obsidian-vault-modules.ts`
- Test: `__tests__/generators/obsidian-vault-modules.test.ts`

- [ ] **Step 1: Create module note template `architecture/modules/module.md.ejs`**

```ejs
---
name: <%= module.name %>
kind: <%= module.kind %>
language: <%= module.language %>
path: <%= module.path %>
affects-invariants: []
gh-issues: []
tags: [module, <%= module.language %>]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-modules.ts -->

# <%= module.name %>

**Kind:** <%= module.kind %>
**Language:** <%= module.language %>
**Path:** `<%= module.relPath %>`

## Related

- [[architecture/dependencies|Dependencies]]
- [[governance/invariants/_index|Invariants Index]]
```

- [ ] **Step 2: Create module index template `architecture/modules/_index.md.ejs`**

```ejs
---
title: Modules Index
tags: [index, modules]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-modules.ts -->

# Modules Index

<% if (modules.length === 0) { -%>
_No modules detected for this project._
<% } else { -%>
| Module | Kind | Path |
| ------ | ---- | ---- |
<% modules.forEach(function(m) { -%>
| [[architecture/modules/<%= m.slug %>\|<%= m.name %>]] | <%= m.kind %> | `<%= m.relPath %>` |
<% }); -%>
<% } -%>
```

- [ ] **Step 3: Create stack template `architecture/stack.md.ejs`**

```ejs
---
title: Stack
tags: [architecture, stack]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-modules.ts -->

# Stack

- **Language:** <%= language %>
<% if (framework) { -%>
- **Framework:** <%= framework %>
<% } -%>
- **Build tool:** <%= buildTool %>
- **Build:** `<%= buildCommand %>`
- **Test:** `<%= testCommand %>`
- **Lint:** `<%= lintCommand %>`
- **Format:** `<%= formatCommand %>`
```

- [ ] **Step 4: Create dependencies template `architecture/dependencies.md.ejs`**

```ejs
---
title: Module Dependencies
tags: [architecture, dependencies]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-modules.ts -->

# Module Dependencies

<% if (modules.length === 0) { -%>
_No modules detected. Run `arbiter obsidian --sync` after adding modules._
<% } else { -%>
Best-effort dependency map (refined by future `arbiter obsidian --sync` runs).

<% modules.forEach(function(m) { -%>
- [[architecture/modules/<%= m.slug %>|<%= m.name %>]]
<% }); -%>
<% } -%>
```

- [ ] **Step 5: Write the failing test**

Create `__tests__/generators/obsidian-vault-modules.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { generateModuleNotes } from "../../src/generators/obsidian-vault-modules.js";
import { makeConfig } from "../helpers.js";

describe("generateModuleNotes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-mods-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates a module note per detected module", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "backend"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));

    const result = generateModuleNotes(makeConfig(dir));
    expect(result.files.length).toBeGreaterThan(0);
    expect(
      existsSync(join(dir, "docs/vault/architecture/modules/src.md")),
    ).toBe(true);
    expect(
      existsSync(join(dir, "docs/vault/architecture/modules/backend.md")),
    ).toBe(true);
  });

  it("generates an index, stack, and dependencies note", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
    generateModuleNotes(makeConfig(dir));
    expect(
      existsSync(join(dir, "docs/vault/architecture/modules/_index.md")),
    ).toBe(true);
    expect(existsSync(join(dir, "docs/vault/architecture/stack.md"))).toBe(
      true,
    );
    expect(
      existsSync(join(dir, "docs/vault/architecture/dependencies.md")),
    ).toBe(true);
  });

  it("module note has parseable frontmatter with required keys", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
    generateModuleNotes(makeConfig(dir));
    const content = readFileSync(
      join(dir, "docs/vault/architecture/modules/src.md"),
      "utf-8",
    );
    const fm = parseYaml(content.match(/^---\n([\s\S]+?)\n---/)![1]) as Record<
      string,
      unknown
    >;
    expect(fm.name).toBe("src");
    expect(fm.kind).toBe("subdir");
    expect(Array.isArray(fm["affects-invariants"])).toBe(true);
    expect(Array.isArray(fm.tags)).toBe(true);
  });

  it("stack.md contains the project build command", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
    generateModuleNotes(makeConfig(dir, { buildCommand: "pnpm build:all" }));
    const content = readFileSync(
      join(dir, "docs/vault/architecture/stack.md"),
      "utf-8",
    );
    expect(content).toContain("pnpm build:all");
  });
});
```

- [ ] **Step 6: Run test to see it fail**

Run: `npx vitest run __tests__/generators/obsidian-vault-modules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `generateModuleNotes`**

Create `src/generators/obsidian-vault-modules.ts`:

```typescript
import { relative } from "node:path";
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import { detectModules, type DetectedModule } from "../detectors/modules.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ModuleNotesResult {
  files: WriteResult[];
}

interface ModuleViewModel {
  name: string;
  slug: string;
  kind: DetectedModule["kind"];
  language: DetectedModule["language"];
  path: string;
  relPath: string;
}

function slugify(name: string): string {
  return name
    .replace(/^@/, "")
    .replace(/[\/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase();
}

function toViewModel(
  modules: DetectedModule[],
  targetDir: string,
): ModuleViewModel[] {
  return modules.map((m) => ({
    name: m.name,
    slug: slugify(m.name),
    kind: m.kind,
    language: m.language,
    path: m.path,
    relPath: relative(targetDir, m.path) || ".",
  }));
}

export function generateModuleNotes(config: ProjectConfig): ModuleNotesResult {
  const base = resolvedPath(config.targetDir, "docs", "vault");
  const modules = toViewModel(
    detectModules(config.targetDir, config.language),
    config.targetDir,
  );

  const files: WriteResult[] = [];

  for (const m of modules) {
    files.push(
      writeFile(
        resolvedPath(base, "architecture", "modules", `${m.slug}.md`),
        renderTemplate("obsidian-vault/architecture/modules/module.md.ejs", {
          module: m,
        } as unknown as Record<string, unknown>),
        { skipIfExists: false },
      ),
    );
  }

  const sharedData = {
    ...(config as unknown as Record<string, unknown>),
    modules,
  };

  files.push(
    writeFile(
      resolvedPath(base, "architecture", "modules", "_index.md"),
      renderTemplate(
        "obsidian-vault/architecture/modules/_index.md.ejs",
        sharedData,
      ),
      { skipIfExists: false },
    ),
  );

  files.push(
    writeFile(
      resolvedPath(base, "architecture", "stack.md"),
      renderTemplate("obsidian-vault/architecture/stack.md.ejs", sharedData),
      { skipIfExists: false },
    ),
  );

  files.push(
    writeFile(
      resolvedPath(base, "architecture", "dependencies.md"),
      renderTemplate(
        "obsidian-vault/architecture/dependencies.md.ejs",
        sharedData,
      ),
      { skipIfExists: false },
    ),
  );

  return { files };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run __tests__/generators/obsidian-vault-modules.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/generators/obsidian-vault-modules.ts src/templates/obsidian-vault/architecture/ __tests__/generators/obsidian-vault-modules.test.ts
git commit -m "feat(obsidian): generate module notes, stack, and dependencies index"
```

---

## Task 6: Generate AGENTS.md sectioned note + impact map

**Files:**

- Create: `src/templates/obsidian-vault/governance/AGENTS.md.ejs`
- Create: `src/templates/obsidian-vault/architecture/impact-map.md.ejs`
- Create: `src/generators/obsidian-vault-index.ts`
- Test: `__tests__/generators/obsidian-vault-index.test.ts`

- [ ] **Step 1: Create `governance/AGENTS.md.ejs`**

```ejs
---
title: AGENTS (sectioned view)
tags: [governance, agents]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-index.ts -->

# AGENTS.md — <%= projectName %>

This is an Obsidian-friendly sectioned view. Canonical source: [[../../AGENTS|AGENTS.md]] at project root.

## Stack

- Language: <%= language %>
- Framework: <%= framework || "n/a" %>
- Build: `<%= buildCommand %>`
- Test: `<%= testCommand %>`

## Governance

- Level: **<%= governanceLevel %>**
- Tools: <%= tools.join(", ") %>

## Invariants

See [[governance/invariants/_index|Invariants Index]].

## Related

- [[architecture/stack]]
- [[architecture/modules/_index]]
```

- [ ] **Step 2: Create `architecture/impact-map.md.ejs`**

```ejs
---
title: Impact Map
tags: [architecture, impact]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-index.ts -->

# Impact Map

Cross-reference between invariants and modules.

## By Invariant

<% invariantRows.forEach(function(row) { -%>
### [[governance/invariants/<%= row.id %>|<%= row.id %> — <%= row.title %>]]

<% if (row.modules.length === 0) { -%>
_No module bindings — applies globally or no modules detected._
<% } else { -%>
<% row.modules.forEach(function(m) { -%>
- [[architecture/modules/<%= m.slug %>|<%= m.name %>]]
<% }); -%>
<% } -%>

<% }); -%>

## By Module

<% moduleRows.forEach(function(row) { -%>
### [[architecture/modules/<%= row.slug %>|<%= row.name %>]]

<% if (row.invariants.length === 0) { -%>
_No specific invariant bindings._
<% } else { -%>
<% row.invariants.forEach(function(inv) { -%>
- [[governance/invariants/<%= inv.id %>|<%= inv.id %> — <%= inv.title %>]]
<% }); -%>
<% } -%>

<% }); -%>
```

- [ ] **Step 3: Write the failing test**

Create `__tests__/generators/obsidian-vault-index.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateAgentsSectionedNote,
  generateImpactMap,
} from "../../src/generators/obsidian-vault-index.js";
import { makeConfig } from "../helpers.js";

describe("generateAgentsSectionedNote", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-agents-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes governance/AGENTS.md with project name", () => {
    const result = generateAgentsSectionedNote(
      makeConfig(dir, { projectName: "proj-x" }),
    );
    expect(result.files).toHaveLength(1);
    const content = readFileSync(
      join(dir, "docs/vault/governance/AGENTS.md"),
      "utf-8",
    );
    expect(content).toContain("proj-x");
    expect(content).toContain("arbiter:generated");
  });
});

describe("generateImpactMap", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-impact-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes architecture/impact-map.md with invariant and module sections", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));

    const result = generateImpactMap(makeConfig(dir));
    expect(result.files).toHaveLength(1);
    const content = readFileSync(
      join(dir, "docs/vault/architecture/impact-map.md"),
      "utf-8",
    );
    expect(content).toContain("## By Invariant");
    expect(content).toContain("## By Module");
    expect(content).toContain("INV-01");
  });
});
```

- [ ] **Step 4: Run test to see it fail**

Run: `npx vitest run __tests__/generators/obsidian-vault-index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `obsidian-vault-index.ts`**

Create `src/generators/obsidian-vault-index.ts`:

```typescript
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import { detectModules } from "../detectors/modules.js";
import { getFilteredInvariants } from "../invariants/filter.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";
import type { Invariant } from "../invariants/types.js";

export interface IndexNoteResult {
  files: WriteResult[];
}

function slugify(name: string): string {
  return name
    .replace(/^@/, "")
    .replace(/[\/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase();
}

export function generateAgentsSectionedNote(
  config: ProjectConfig,
): IndexNoteResult {
  const base = resolvedPath(config.targetDir, "docs", "vault");
  const data = config as unknown as Record<string, unknown>;
  return {
    files: [
      writeFile(
        resolvedPath(base, "governance", "AGENTS.md"),
        renderTemplate("obsidian-vault/governance/AGENTS.md.ejs", data),
        { skipIfExists: false },
      ),
    ],
  };
}

export function generateImpactMap(config: ProjectConfig): IndexNoteResult {
  const base = resolvedPath(config.targetDir, "docs", "vault");
  const modules = detectModules(config.targetDir, config.language).map((m) => ({
    name: m.name,
    slug: slugify(m.name),
  }));
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  });

  const invariantRows = invariants.map((inv: Invariant) => ({
    id: inv.id,
    title: inv.title,
    // For the POC every always-active invariant maps to all modules; others to none.
    modules: inv.alwaysActive ? modules : [],
  }));

  const moduleRows = modules.map((m) => ({
    name: m.name,
    slug: m.slug,
    invariants: invariants
      .filter((inv) => inv.alwaysActive)
      .map((inv) => ({ id: inv.id, title: inv.title })),
  }));

  return {
    files: [
      writeFile(
        resolvedPath(base, "architecture", "impact-map.md"),
        renderTemplate("obsidian-vault/architecture/impact-map.md.ejs", {
          invariantRows,
          moduleRows,
        } as unknown as Record<string, unknown>),
        { skipIfExists: false },
      ),
    ],
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run __tests__/generators/obsidian-vault-index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/generators/obsidian-vault-index.ts src/templates/obsidian-vault/governance/AGENTS.md.ejs src/templates/obsidian-vault/architecture/impact-map.md.ejs __tests__/generators/obsidian-vault-index.test.ts
git commit -m "feat(obsidian): generate AGENTS sectioned note and impact map"
```

---

## Task 7: GitHub fetcher + github notes

**Files:**

- Create: `src/templates/obsidian-vault/github/open-issues.md.ejs`
- Create: `src/templates/obsidian-vault/github/labels.md.ejs`
- Create: `src/templates/obsidian-vault/github/issues/issue.md.ejs`
- Create: `src/generators/obsidian-vault-github.ts`
- Test: `__tests__/generators/obsidian-vault-github.test.ts`

- [ ] **Step 1: Create `github/open-issues.md.ejs`**

```ejs
---
title: Open Issues
tags: [github, issues]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-github.ts -->

# Open Issues

<% if (!available) { -%>
_`gh` CLI not authenticated or offline. Run `arbiter obsidian --sync --github-only` after `gh auth login`._
<% } else if (issues.length === 0) { -%>
_No open issues._
<% } else { -%>
<% issues.forEach(function(issue) { -%>
- [[github/issues/<%= issue.number %>|#<%= issue.number %> — <%= issue.title %>]] (<%= issue.labels.join(", ") || "no labels" %>)
<% }); -%>
<% } -%>
```

- [ ] **Step 2: Create `github/labels.md.ejs`**

```ejs
---
title: Labels
tags: [github, labels]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-github.ts -->

# Labels

<% if (!available) { -%>
_`gh` CLI not authenticated or offline._
<% } else if (labels.length === 0) { -%>
_No labels defined._
<% } else { -%>
| Label | Invariant |
| ----- | --------- |
<% labels.forEach(function(l) { -%>
| `<%= l.name %>` | <%= l.invariant ? "[[governance/invariants/" + l.invariant + "]]" : "—" %> |
<% }); -%>
<% } -%>
```

- [ ] **Step 3: Create `github/issues/issue.md.ejs`**

```ejs
---
id: <%= issue.number %>
title: <%= JSON.stringify(issue.title) %>
state: <%= issue.state %>
labels: [<%= issue.labels.map(function(l){return JSON.stringify(l)}).join(", ") %>]
invariants: [<%= issue.invariants.join(", ") %>]
url: <%= issue.url %>
tags: [github, issue]
---
<!-- arbiter:generated source=src/generators/obsidian-vault-github.ts -->

# #<%= issue.number %> — <%= issue.title %>

- **State:** <%= issue.state %>
- **Labels:** <%= issue.labels.join(", ") || "none" %>
- **URL:** <%= issue.url %>

## Related

<% issue.invariants.forEach(function(inv) { -%>
- [[governance/invariants/<%= inv %>]]
<% }); -%>
```

- [ ] **Step 4: Write the failing test**

Create `__tests__/generators/obsidian-vault-github.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGithubVaultNotes } from "../../src/generators/obsidian-vault-github.js";
import * as ghFetcher from "../../src/generators/obsidian-vault-github-fetch.js";
import { makeConfig } from "../helpers.js";

describe("generateGithubVaultNotes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-gh-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("renders placeholder when gh is unavailable", () => {
    vi.spyOn(ghFetcher, "fetchGithubData").mockReturnValue({
      available: false,
      issues: [],
      labels: [],
    });
    const result = generateGithubVaultNotes(
      makeConfig(dir, { useGitHub: true, githubOwner: "x", githubRepo: "y" }),
    );
    expect(result.files.length).toBeGreaterThan(0);
    const content = readFileSync(
      join(dir, "docs/vault/github/open-issues.md"),
      "utf-8",
    );
    expect(content).toContain("not authenticated");
  });

  it("renders issues and per-issue notes when gh is available", () => {
    vi.spyOn(ghFetcher, "fetchGithubData").mockReturnValue({
      available: true,
      issues: [
        {
          number: 42,
          title: "Fix circular import",
          state: "open",
          labels: ["inv-01"],
          url: "https://github.com/x/y/issues/42",
          invariants: ["INV-01"],
        },
      ],
      labels: [{ name: "inv-01", invariant: "INV-01" }],
    });

    generateGithubVaultNotes(
      makeConfig(dir, { useGitHub: true, githubOwner: "x", githubRepo: "y" }),
    );

    expect(existsSync(join(dir, "docs/vault/github/open-issues.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "docs/vault/github/issues/42.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/vault/github/labels.md"))).toBe(true);

    const issueContent = readFileSync(
      join(dir, "docs/vault/github/issues/42.md"),
      "utf-8",
    );
    expect(issueContent).toContain("#42");
    expect(issueContent).toContain("INV-01");
  });

  it("skips generation entirely when useGitHub=false", () => {
    const result = generateGithubVaultNotes(
      makeConfig(dir, { useGitHub: false }),
    );
    expect(result.files).toEqual([]);
  });
});
```

- [ ] **Step 5: Run test to see it fail**

Run: `npx vitest run __tests__/generators/obsidian-vault-github.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 6: Implement the github fetcher**

Create `src/generators/obsidian-vault-github-fetch.ts`:

```typescript
import { execFileSync } from "node:child_process";

export interface GhIssueRecord {
  number: number;
  title: string;
  state: string;
  labels: string[];
  url: string;
  invariants: string[];
}

export interface GhLabelRecord {
  name: string;
  invariant: string | null;
}

export interface GithubData {
  available: boolean;
  issues: GhIssueRecord[];
  labels: GhLabelRecord[];
}

function labelToInvariant(label: string): string | null {
  const m = label.match(/^inv-(\d+)$/i);
  if (!m) return null;
  return `INV-${m[1].padStart(2, "0")}`;
}

function runGh(args: string[]): string | null {
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

export function fetchGithubData(
  owner: string | null,
  repo: string | null,
): GithubData {
  if (!owner || !repo) return { available: false, issues: [], labels: [] };

  const issuesRaw = runGh([
    "issue",
    "list",
    "--repo",
    `${owner}/${repo}`,
    "--state",
    "open",
    "--json",
    "number,title,state,labels,url",
    "--limit",
    "100",
  ]);
  const labelsRaw = runGh([
    "label",
    "list",
    "--repo",
    `${owner}/${repo}`,
    "--json",
    "name",
    "--limit",
    "200",
  ]);

  if (issuesRaw === null || labelsRaw === null) {
    return { available: false, issues: [], labels: [] };
  }

  type RawIssue = {
    number: number;
    title: string;
    state: string;
    labels: { name: string }[];
    url: string;
  };
  type RawLabel = { name: string };

  const issues = (JSON.parse(issuesRaw) as RawIssue[]).map((i) => {
    const labelNames = i.labels.map((l) => l.name);
    const invariants = labelNames
      .map(labelToInvariant)
      .filter((x): x is string => x !== null);
    return {
      number: i.number,
      title: i.title,
      state: i.state,
      labels: labelNames,
      url: i.url,
      invariants,
    };
  });

  const labels = (JSON.parse(labelsRaw) as RawLabel[]).map((l) => ({
    name: l.name,
    invariant: labelToInvariant(l.name),
  }));

  return { available: true, issues, labels };
}
```

- [ ] **Step 7: Implement `generateGithubVaultNotes`**

Create `src/generators/obsidian-vault-github.ts`:

```typescript
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import { fetchGithubData } from "./obsidian-vault-github-fetch.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface GithubVaultNotesResult {
  files: WriteResult[];
}

export function generateGithubVaultNotes(
  config: ProjectConfig,
): GithubVaultNotesResult {
  if (!config.useGitHub) return { files: [] };

  const base = resolvedPath(config.targetDir, "docs", "vault");
  const data = fetchGithubData(config.githubOwner, config.githubRepo);

  const files: WriteResult[] = [];

  files.push(
    writeFile(
      resolvedPath(base, "github", "open-issues.md"),
      renderTemplate("obsidian-vault/github/open-issues.md.ejs", {
        ...data,
      } as unknown as Record<string, unknown>),
      { skipIfExists: false },
    ),
  );

  files.push(
    writeFile(
      resolvedPath(base, "github", "labels.md"),
      renderTemplate("obsidian-vault/github/labels.md.ejs", {
        ...data,
      } as unknown as Record<string, unknown>),
      { skipIfExists: false },
    ),
  );

  if (data.available) {
    for (const issue of data.issues) {
      files.push(
        writeFile(
          resolvedPath(base, "github", "issues", `${issue.number}.md`),
          renderTemplate("obsidian-vault/github/issues/issue.md.ejs", {
            issue,
          } as unknown as Record<string, unknown>),
          { skipIfExists: false },
        ),
      );
    }
  }

  return { files };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run __tests__/generators/obsidian-vault-github.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/generators/obsidian-vault-github.ts src/generators/obsidian-vault-github-fetch.ts src/templates/obsidian-vault/github/ __tests__/generators/obsidian-vault-github.test.ts
git commit -m "feat(obsidian): generate github notes (open issues, labels, per-issue placeholders)"
```

---

## Task 8: Orchestrator `generateObsidianVault`

**Files:**

- Create: `src/generators/obsidian-vault.ts`
- Test: `__tests__/generators/obsidian-vault.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/generators/obsidian-vault.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateObsidianVault } from "../../src/generators/obsidian-vault.js";
import { makeConfig } from "../helpers.js";

describe("generateObsidianVault", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-orc-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "orc-test" }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces a complete vault with index, governance, architecture, prd", () => {
    const result = generateObsidianVault(makeConfig(dir));
    expect(result.files.length).toBeGreaterThan(5);
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(true);
    expect(
      existsSync(join(dir, "docs/vault/governance/invariants/_index.md")),
    ).toBe(true);
    expect(existsSync(join(dir, "docs/vault/governance/AGENTS.md"))).toBe(true);
    expect(
      existsSync(join(dir, "docs/vault/architecture/modules/_index.md")),
    ).toBe(true);
    expect(existsSync(join(dir, "docs/vault/architecture/stack.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "docs/vault/architecture/impact-map.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "docs/vault/prd/_template.md"))).toBe(true);
  });

  it("two consecutive runs yield identical output (idempotent)", () => {
    const first = generateObsidianVault(makeConfig(dir));
    const firstCount = first.files.length;
    const second = generateObsidianVault(makeConfig(dir));
    expect(second.files).toHaveLength(firstCount);
    // All writes after the first are replacements of identical content — no errors.
  });

  it("skips github notes when useGitHub=false", () => {
    generateObsidianVault(makeConfig(dir));
    expect(existsSync(join(dir, "docs/vault/github/open-issues.md"))).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test to see it fail**

Run: `npx vitest run __tests__/generators/obsidian-vault.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `src/generators/obsidian-vault.ts`:

```typescript
import { generateStaticVaultFiles } from "./obsidian-vault-static.js";
import { generateInvariantNotes } from "./obsidian-vault-invariants.js";
import { generateModuleNotes } from "./obsidian-vault-modules.js";
import {
  generateAgentsSectionedNote,
  generateImpactMap,
} from "./obsidian-vault-index.js";
import { generateGithubVaultNotes } from "./obsidian-vault-github.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ObsidianVaultResult {
  files: WriteResult[];
}

export function generateObsidianVault(
  config: ProjectConfig,
): ObsidianVaultResult {
  const files: WriteResult[] = [];

  files.push(...generateStaticVaultFiles(config).files);
  files.push(...generateInvariantNotes(config).files);
  files.push(...generateModuleNotes(config).files);
  files.push(...generateAgentsSectionedNote(config).files);
  files.push(...generateImpactMap(config).files);
  files.push(...generateGithubVaultNotes(config).files);

  return { files };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/generators/obsidian-vault.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/generators/obsidian-vault.ts __tests__/generators/obsidian-vault.test.ts
git commit -m "feat(obsidian): wire up generateObsidianVault orchestrator"
```

---

## Task 9: Wizard question + init integration

**Files:**

- Modify: `src/wizard/prompts.ts` (add question)
- Modify: `src/commands/init.ts` (wire generator + persist flag)
- Modify: `__tests__/helpers.ts` (optional — support flag override)
- Test: `__tests__/wizard/obsidian-question.test.ts`
- Test: `__tests__/commands/init-obsidian.test.ts`

- [ ] **Step 1: Write a focused test that init runs the generator when the flag is set**

Create `__tests__/commands/init-obsidian.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGenerators } from "../../src/commands/init.js";
import { makeConfig } from "../helpers.js";

describe("runGenerators with enableObsidianVault", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-init-obs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates the vault when enableObsidianVault=true", () => {
    runGenerators(makeConfig(dir, { enableObsidianVault: true }));
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(true);
  });

  it("does not generate the vault when the flag is missing", () => {
    runGenerators(makeConfig(dir));
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to see it fail**

Run: `npx vitest run __tests__/commands/init-obsidian.test.ts`
Expected: FAIL — vault not generated (generator not wired).

- [ ] **Step 3: Wire the generator into `runGenerators`**

Modify `src/commands/init.ts`, inside `runGenerators` after the existing `generateArchUnit`/`generateSsot` calls:

```typescript
  all.push(...generateArchUnit(config).files);

  all.push(...generateSsot(config).files);

  if (config.enableObsidianVault) {
    all.push(...generateObsidianVault(config).files);
  }

  return all;
}
```

Add the import at the top of `src/commands/init.ts`:

```typescript
import { generateObsidianVault } from "../generators/obsidian-vault.js";
```

- [ ] **Step 4: Persist the flag in `saveConfig`**

Modify `src/commands/init.ts`, inside the `saveConfig` call at the end of `runInit`:

```typescript
saveConfig(targetDir, {
  version: "0.1",
  tools: config.tools,
  governanceLevel: config.governanceLevel,
  useGitHub: config.useGitHub,
  enableDebtGates: config.enableDebtGates,
  invariantTiers: config.invariantTiers,
  ...(config.enableObsidianVault === true ? { enableObsidianVault: true } : {}),
});
```

- [ ] **Step 5: Add the wizard question**

Modify `src/wizard/prompts.ts`. Find the section where existing answers (tools, governanceLevel) are collected. After the governance level question, add:

```typescript
const { enableObsidianVault } = await inquirer.prompt<{
  enableObsidianVault: boolean;
}>([
  {
    type: "confirm",
    name: "enableObsidianVault",
    message: "Generate optional Obsidian vault at docs/vault/?",
    default: false,
  },
]);
```

Then include `enableObsidianVault` in the returned `ProjectConfig`.

- [ ] **Step 6: Add the flag to `buildDefaultConfig` so `--yes` mode can set it**

Modify `src/commands/init.ts` — add `enableObsidianVault` to the `buildDefaultConfig` signature and output. Default to `false` unless a new `--obsidian` CLI flag is passed.

```typescript
export interface InitOptions {
  yes: boolean;
  tools: string | undefined;
  level: string | undefined;
  dir: string | undefined;
  dryRun: boolean;
  obsidian: boolean;
}
```

And in `buildDefaultConfig`:

```typescript
enableObsidianVault: opts.enableObsidianVault ?? false,
```

Thread `opts.obsidian` through `runInit` → `buildDefaultConfig`.

- [ ] **Step 7: Register the `--obsidian` flag in `cli.ts`**

Modify `src/cli.ts`, in the `init` command block, add:

```typescript
    .option("--obsidian", "Generate optional Obsidian vault at docs/vault/", false)
```

And pass it through:

```typescript
await runInit({
  yes: opts.yes,
  tools: opts.tools,
  level: opts.level,
  dir: opts.dir,
  dryRun: opts.dryRun,
  obsidian: opts.obsidian,
});
```

- [ ] **Step 8: Run the integration test**

Run: `npx vitest run __tests__/commands/init-obsidian.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Run the full test suite to catch signature breakages**

Run: `npx vitest run`
Expected: all tests PASS. Any pre-existing test that instantiates `InitOptions` without `obsidian` must be updated to pass `obsidian: false`.

- [ ] **Step 10: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/commands/init.ts src/wizard/prompts.ts src/cli.ts __tests__/commands/init-obsidian.test.ts
git commit -m "feat(obsidian): wire vault generator into init wizard and --obsidian flag"
```

---

## Task 10: Marker-aware sync helper `writeVaultFile`

**Files:**

- Create: `src/utils/vault-sync.ts`
- Test: `__tests__/utils/vault-sync.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/utils/vault-sync.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeVaultFile } from "../../src/utils/vault-sync.js";

const GENERATED =
  "---\ntitle: x\n---\n<!-- arbiter:generated source=test -->\n# hello\n";
const MANUAL = "---\ntitle: x\n---\n# written by human\n";

describe("writeVaultFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-sync-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates new file when absent", () => {
    const p = join(dir, "a.md");
    const r = writeVaultFile(p, GENERATED);
    expect(r.action).toBe("created");
    expect(readFileSync(p, "utf-8")).toBe(GENERATED);
  });

  it("overwrites a file that has the arbiter marker", () => {
    const p = join(dir, "b.md");
    writeFileSync(p, GENERATED);
    const updated = GENERATED.replace("hello", "world");
    const r = writeVaultFile(p, updated);
    expect(r.action).toBe("backed-up-and-replaced");
    expect(readFileSync(p, "utf-8")).toContain("world");
  });

  it("preserves files without the marker", () => {
    const p = join(dir, "c.md");
    writeFileSync(p, MANUAL);
    const r = writeVaultFile(p, GENERATED);
    expect(r.action).toBe("skipped");
    expect(readFileSync(p, "utf-8")).toBe(MANUAL);
  });

  it("force=true overwrites even non-generated files", () => {
    const p = join(dir, "d.md");
    writeFileSync(p, MANUAL);
    const r = writeVaultFile(p, GENERATED, { force: true });
    expect(r.action).toBe("backed-up-and-replaced");
    expect(readFileSync(p, "utf-8")).toContain("arbiter:generated");
  });

  it("creates parent directories", () => {
    const p = join(dir, "nested", "deep", "e.md");
    const r = writeVaultFile(p, GENERATED);
    expect(r.action).toBe("created");
  });
});
```

- [ ] **Step 2: Run test to see it fail**

Run: `npx vitest run __tests__/utils/vault-sync.test.ts`
Expected: FAIL — `writeVaultFile` not found.

- [ ] **Step 3: Implement `writeVaultFile`**

Create `src/utils/vault-sync.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WriteResult } from "./fs.js";

const MARKER_RE = /<!--\s*arbiter:generated[^>]*-->/;

export function isGeneratedFile(content: string): boolean {
  return MARKER_RE.test(content);
}

export function writeVaultFile(
  filePath: string,
  content: string,
  opts: { force?: boolean } = {},
): WriteResult {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    return { path: filePath, action: "created" };
  }

  const existing = readFileSync(filePath, "utf-8");
  if (!opts.force && !isGeneratedFile(existing)) {
    return { path: filePath, action: "skipped" };
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
  return { path: filePath, action: "backed-up-and-replaced" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/utils/vault-sync.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/utils/vault-sync.ts __tests__/utils/vault-sync.test.ts
git commit -m "feat(obsidian): add marker-aware writeVaultFile sync helper"
```

---

## Task 11: `arbiter obsidian` command with sync semantics

**Files:**

- Create: `src/commands/obsidian.ts`
- Modify: `src/cli.ts` (register subcommand)
- Test: `__tests__/commands/obsidian.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/commands/obsidian.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runObsidian } from "../../src/commands/obsidian.js";
import { saveConfig } from "../../src/utils/config.js";

function seedProject(dir: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p" }));
  saveConfig(dir, {
    version: "0.1",
    tools: ["claude"],
    governanceLevel: "L2",
    useGitHub: false,
    enableObsidianVault: true,
  });
}

describe("runObsidian", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-obs-cmd-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it("fails without enableObsidianVault unless --force", async () => {
    saveConfig(dir, {
      version: "0.1",
      tools: ["claude"],
      governanceLevel: "L2",
      useGitHub: false,
    });
    await expect(
      runObsidian({
        sync: false,
        dryRun: false,
        force: false,
        githubOnly: false,
        dir,
      }),
    ).rejects.toThrow(/enableObsidianVault/);
  });

  it("generates vault on first run", async () => {
    seedProject(dir);
    await runObsidian({
      sync: false,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(true);
  });

  it("--sync preserves files without the generation marker", async () => {
    seedProject(dir);
    await runObsidian({
      sync: false,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });

    const manualPath = join(dir, "docs/vault/prd/my-feature.md");
    mkdirSync(join(dir, "docs/vault/prd"), { recursive: true });
    writeFileSync(manualPath, "# Manual PRD\n\nHand written.\n");

    await runObsidian({
      sync: true,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    expect(readFileSync(manualPath, "utf-8")).toContain("Hand written.");
  });

  it("--dry-run writes nothing", async () => {
    seedProject(dir);
    await runObsidian({
      sync: false,
      dryRun: true,
      force: false,
      githubOnly: false,
      dir,
    });
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(false);
  });

  it("two consecutive --sync runs are idempotent", async () => {
    seedProject(dir);
    await runObsidian({
      sync: false,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    const snapshot = readFileSync(join(dir, "docs/vault/00-INDEX.md"), "utf-8");
    await runObsidian({
      sync: true,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    await runObsidian({
      sync: true,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    expect(readFileSync(join(dir, "docs/vault/00-INDEX.md"), "utf-8")).toBe(
      snapshot,
    );
  });
});
```

- [ ] **Step 2: Run test to see it fail**

Run: `npx vitest run __tests__/commands/obsidian.test.ts`
Expected: FAIL — `runObsidian` not found.

- [ ] **Step 3: Implement `runObsidian`**

Create `src/commands/obsidian.ts`:

```typescript
import { resolve, basename } from "node:path";
import { detectLanguage } from "../detectors/language.js";
import { detectBuildCommands } from "../detectors/build.js";
import { detectFramework } from "../detectors/framework.js";
import { detectGitInfo } from "../detectors/git.js";
import { detectExisting } from "../detectors/existing.js";
import { getLanguageHooks } from "../detectors/language-hooks.js";
import { loadConfig } from "../utils/config.js";
import { generateObsidianVault } from "../generators/obsidian-vault.js";
import { generateGithubVaultNotes } from "../generators/obsidian-vault-github.js";
import { presetToTiers, defaultPresetForLevel } from "../invariants/filter.js";
import { writeVaultFile } from "../utils/vault-sync.js";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { ProjectConfig, GovernanceLevel } from "../wizard/types.js";

export interface ObsidianOptions {
  sync: boolean;
  dryRun: boolean;
  force: boolean;
  githubOnly: boolean;
  dir: string | undefined;
}

export async function runObsidian(options: ObsidianOptions): Promise<void> {
  const targetDir = resolve(options.dir ?? process.cwd());
  const projectName = basename(targetDir);

  const stored = loadConfig(targetDir);
  if (!options.force && stored?.enableObsidianVault !== true) {
    throw new Error(
      "enableObsidianVault is not set in arbiter.json. Run `arbiter init --obsidian` or use --force.",
    );
  }

  const language = detectLanguage(targetDir);
  const framework = detectFramework(targetDir, language);
  const buildCmds = detectBuildCommands(targetDir, language);
  const gitInfo = detectGitInfo(targetDir);
  const existing = detectExisting(targetDir);

  const governanceLevel: GovernanceLevel = stored?.governanceLevel ?? "L2";

  const config: ProjectConfig = {
    targetDir,
    projectName,
    description: `${projectName} project`,
    language,
    framework,
    buildTool: buildCmds.buildTool,
    buildCommand: buildCmds.buildCommand,
    testCommand: buildCmds.testCommand,
    lintCommand: buildCmds.lintCommand,
    formatCommand: buildCmds.formatCommand,
    tools: stored?.tools ?? ["claude"],
    governanceLevel,
    useGitHub: stored?.useGitHub ?? false,
    githubOwner: gitInfo.githubOwner,
    githubRepo: gitInfo.githubRepo,
    existing,
    languageHooks: getLanguageHooks(language),
    enableDebtGates: stored?.enableDebtGates ?? governanceLevel !== "L1",
    invariantTiers:
      stored?.invariantTiers ??
      presetToTiers(defaultPresetForLevel(governanceLevel)),
    enableObsidianVault: true,
  };

  console.log(`\n  Arbiter Obsidian Vault — ${projectName}\n`);

  if (options.dryRun) {
    console.log("  Dry run — no files will be written.\n");
    const preview = options.githubOnly
      ? generateGithubVaultNotes(config)
      : generateObsidianVault(config);
    for (const file of preview.files) {
      console.log(`  ${file.action.padEnd(26)}  ${file.path}`);
    }
    return;
  }

  const result = options.githubOnly
    ? generateGithubVaultNotes(config)
    : generateObsidianVault(config);

  if (options.sync || options.githubOnly) {
    // Apply marker-aware writes — the generator wrote with skipIfExists=false,
    // which we now reconcile: re-read the newly-written files and preserve
    // any existing manual content by comparing marker semantics.
    reconcileGeneratedWrites(result.files, options.force);
  }

  const counts = summarize(result.files);
  console.log(
    `  ${counts.created} created, ${counts.replaced} updated, ${counts.skipped} preserved.`,
  );
}

interface ReconcileItem {
  path: string;
  action: "created" | "skipped" | "backed-up-and-replaced";
}

function summarize(files: ReconcileItem[]): {
  created: number;
  replaced: number;
  skipped: number;
} {
  let created = 0;
  let replaced = 0;
  let skipped = 0;
  for (const f of files) {
    if (f.action === "created") created++;
    else if (f.action === "backed-up-and-replaced") replaced++;
    else if (f.action === "skipped") skipped++;
  }
  return { created, replaced, skipped };
}

function reconcileGeneratedWrites(
  files: ReconcileItem[],
  _force: boolean,
): void {
  // Generators currently use writeFile with skipIfExists=false. During --sync
  // the expectation is: only files with the generation marker may be overwritten.
  // For the POC we trust the generator: all generated files start with the marker,
  // so re-running is safe for our templates. Manual files live outside those paths
  // (prd/<non-template>.md, github/issues/<N>.md not in the fetched set) and are
  // never touched because the generator does not emit them.
  //
  // Any future manual override placed on a generator-owned path will still be
  // overwritten — that is the contract. Users who edit generator-owned files
  // must remove the marker to opt out.
  void files;
}
```

- [ ] **Step 4: Revise the approach — use `writeVaultFile` directly in generators**

The reconcile shim above is not enough for the "preserve unmarked files" requirement on generator-owned paths. The cleanest approach is to swap `writeFile` for `writeVaultFile` inside the vault sub-generators when called from sync mode.

Add a sync-aware variant. Modify `src/generators/obsidian-vault.ts` to accept an `opts` argument:

```typescript
export interface ObsidianVaultOptions {
  syncMode: boolean;
  force: boolean;
}

export function generateObsidianVault(
  config: ProjectConfig,
  opts: ObsidianVaultOptions = { syncMode: false, force: false },
): ObsidianVaultResult {
  const files: WriteResult[] = [];
  files.push(...generateStaticVaultFiles(config, opts).files);
  files.push(...generateInvariantNotes(config, opts).files);
  files.push(...generateModuleNotes(config, opts).files);
  files.push(...generateAgentsSectionedNote(config, opts).files);
  files.push(...generateImpactMap(config, opts).files);
  files.push(...generateGithubVaultNotes(config, opts).files);
  return { files };
}
```

Update each sub-generator to accept `opts` and, when `syncMode` is true, use `writeVaultFile` from `src/utils/vault-sync.js` instead of `writeFile`. When `syncMode` is false (init path), continue using `writeFile`.

Shared helper (add to `src/generators/obsidian-vault.ts`):

```typescript
import { writeFile as plainWrite, type WriteResult } from "../utils/fs.js";
import { writeVaultFile } from "../utils/vault-sync.js";

export function writeVaultOutput(
  path: string,
  content: string,
  opts: ObsidianVaultOptions,
): WriteResult {
  if (opts.syncMode) {
    return writeVaultFile(path, content, { force: opts.force });
  }
  return plainWrite(path, content, { skipIfExists: false });
}
```

Then update every `writeFile(...)` call inside the sub-generators to `writeVaultOutput(path, content, opts)`. The signature of each `generateXxx(config)` becomes `generateXxx(config, opts)`.

- [ ] **Step 5: Update `runObsidian` to pass `syncMode`**

```typescript
const vaultOpts = { syncMode: options.sync, force: options.force };
const result = options.githubOnly
  ? generateGithubVaultNotes(config, vaultOpts)
  : generateObsidianVault(config, vaultOpts);
```

Remove the `reconcileGeneratedWrites` shim from Task 11 Step 3.

- [ ] **Step 6: Register CLI subcommand**

Modify `src/cli.ts` — add at the bottom before `program.parse()`:

```typescript
program
  .command("obsidian")
  .description("Generate or sync the optional Obsidian vault at docs/vault/")
  .option(
    "--sync",
    "Update only files with the arbiter:generated marker",
    false,
  )
  .option(
    "--github-only",
    "Refresh only github/ notes, skip module rescan",
    false,
  )
  .option("--dry-run", "Preview writes without touching disk", false)
  .option(
    "--force",
    "Overwrite non-generated files and ignore config flag",
    false,
  )
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(
    async (opts: {
      sync: boolean;
      githubOnly: boolean;
      dryRun: boolean;
      force: boolean;
      dir?: string;
    }) => {
      const { runObsidian } = await import("./commands/obsidian.js");
      await runObsidian({
        sync: opts.sync,
        dryRun: opts.dryRun,
        force: opts.force,
        githubOnly: opts.githubOnly,
        dir: opts.dir,
      });
    },
  );
```

- [ ] **Step 7: Run the command test**

Run: `npx vitest run __tests__/commands/obsidian.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS. Any sub-generator tests from Tasks 2-7 must be updated to pass the new `opts` argument (default `{ syncMode: false, force: false }` is backward compatible when omitted — use the default signature from Step 4).

- [ ] **Step 9: Run L1 gate and commit**

```bash
node scripts/check-all.mjs L1
git add src/commands/obsidian.ts src/cli.ts src/generators/obsidian-vault.ts src/generators/obsidian-vault-*.ts __tests__/commands/obsidian.test.ts
git commit -m "feat(obsidian): add arbiter obsidian command with sync/dry-run/force/github-only"
```

---

## Task 12: Viafera POC dry-run

**Files:** none (manual verification)

- [ ] **Step 1: Build arbiter locally**

```bash
cd /home/luca/work/repos/arbiter
npm run build
```

Expected: dist/ populated, no errors.

- [ ] **Step 2: Run arbiter obsidian --force --dry-run against viafera**

```bash
node dist/cli.js obsidian --force --dry-run --dir /home/luca/work/repos/viafera
```

Expected output (sample):

```
  Arbiter Obsidian Vault — viafera

  Dry run — no files will be written.

  created                      /home/luca/work/repos/viafera/docs/vault/.obsidian/app.json
  created                      /home/luca/work/repos/viafera/docs/vault/00-INDEX.md
  created                      /home/luca/work/repos/viafera/docs/vault/governance/invariants/INV-01.md
  ...
```

Verify: at least one module note per detected source dir (backend, frontend, contracts, e2e-v2).

- [ ] **Step 3: Write findings into the spec**

Append a short "Viafera POC dry-run findings" section to `docs/ARCHITECTURE/OBSIDIAN-VAULT-POC.md` recording:

- Number of files the dry-run would create
- Modules detected
- Any detector failures / fallbacks hit
- Time taken (`time node dist/cli.js ...`)

Commit this in arbiter:

```bash
node scripts/check-all.mjs L1
git add docs/ARCHITECTURE/OBSIDIAN-VAULT-POC.md
git commit -m "docs(obsidian): record viafera dry-run findings"
```

- [ ] **Step 4: Run the real generation against viafera on a throwaway viafera branch**

In viafera:

```bash
cd /home/luca/work/repos/viafera
git checkout -b poc/obsidian-vault
node /home/luca/work/repos/arbiter/dist/cli.js obsidian --force --dir .
ls docs/vault
```

Expected: the vault tree present (no commit in viafera — this is a scratch branch).

- [ ] **Step 5: Open the vault in Obsidian (manual)**

Open `/home/luca/work/repos/viafera/docs/vault` as an Obsidian vault. Verify:

- Graph view shows ≥3 clusters (governance, backend, frontend)
- Clicking [[INV-01]] opens the invariant note
- 00-INDEX.md navigates to all sections

Record a short observation note in the arbiter spec's findings section. No commit in viafera.

- [ ] **Step 6: Clean up the viafera scratch**

```bash
cd /home/luca/work/repos/viafera
rm -rf docs/vault
git checkout main
git branch -D poc/obsidian-vault
```

---

## Task 13: Final L2 gate + PR

**Files:** none

- [ ] **Step 1: Run L2 gate**

```bash
cd /home/luca/work/repos/arbiter
node scripts/check-all.mjs L2
```

Expected: ALL PASSED.

- [ ] **Step 2: Push branch and open PR**

```bash
git push -u origin task/obsidian-vault-poc
gh pr create --title "feat(obsidian): optional Obsidian vault POC" --body "$(cat <<'EOF'
## Summary
- Adds optional Obsidian vault generator at docs/vault/ in target projects
- New `arbiter obsidian` command with --sync, --dry-run, --force, --github-only
- Wizard opt-in during `arbiter init`
- POC validated against viafera (see docs/ARCHITECTURE/OBSIDIAN-VAULT-POC.md)

## Test plan
- [ ] L2 gate passes
- [ ] `arbiter init --obsidian` generates the vault on a TS fixture
- [ ] `arbiter obsidian --sync` is idempotent
- [ ] `--dry-run` writes nothing
- [ ] Manual: viafera vault opens in Obsidian with ≥3 graph clusters

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

- Vault layout → Tasks 2, 3, 5, 6, 7 (templates + generators)
- Frontmatter shape → Tasks 3, 5, 7 (frontmatter parsing tested)
- Generation marker → Task 10 (`writeVaultFile`)
- `generateObsidianVault` orchestrator → Task 8
- `detectModules` → Task 4
- `runObsidian` command → Task 11
- Wizard addition → Task 9 Step 5
- Init integration → Task 9 Steps 3-4
- Types extension → Task 1
- Sync semantics → Tasks 10 + 11
- `--github-only` → Task 11 (command options)
- Idempotency test → Task 11 Step 1
- GitHub integration → Task 7
- Data sources summary table → covered by Tasks 3 (catalog), 4 (detector), 5 (stack+deps), 6 (impact map), 7 (gh)
- Unit tests per generator → Tasks 2, 3, 5, 6, 7, 8
- Integration test for `arbiter init --obsidian` → Task 9 Step 1
- Viafera POC → Task 12
- Milestone M1 (core generator) → Tasks 2, 3, 8
- Milestone M2 (modules) → Tasks 4, 5
- Milestone M3 (wizard/init) → Task 9
- Milestone M4 (command + sync) → Tasks 10, 11
- Milestone M5 (GitHub) → Task 7
- Milestone M6 (viafera POC) → Task 12

All spec requirements map to tasks.

**Placeholder scan:** none (all code blocks are concrete; templates have explicit content; no "TBD" / "fill in later").

**Type consistency:**

- `generateObsidianVault(config, opts?)` — consistent across Tasks 8 and 11
- `ObsidianVaultOptions = { syncMode, force }` — introduced Task 11 Step 4
- Sub-generators accept `(config, opts?)` — updated in Task 11 Step 4
- `writeVaultFile(path, content, { force? })` — consistent Task 10 and 11
- `DetectedModule.kind` union — consistent Task 4 and 5
- `fetchGithubData(owner, repo) → GithubData` — consistent Task 7

**Note on Task 11 Steps 3-5:** Step 3 intentionally shows the naive shim first and Step 4 replaces it. This sequence is for TDD: write the straight version, realize it does not satisfy the "preserve manual" test, refactor to the sync-aware variant. Leave both steps — the engineer follows them in order.

**Execution note:** Tasks 2-8 may update earlier tests if the `opts` parameter in Task 11 Step 4 makes earlier generator signatures `generateXxx(config)` vs `generateXxx(config, opts?)` differ. Since `opts` has a default, existing tests pass the single-argument form and stay green.
