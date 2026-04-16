import type {
  Archetype,
  ArchitectureStyle,
  ContractType,
} from "../wizard/types.js";
import type { ArbiterConfig } from "../utils/config.js";
import { detectArchetypeHint } from "./framework.js";
import { detectLanguage } from "./language.js";
import { defaultContractType } from "../wizard/archetype-defaults.js";

export const ARCHETYPE_DB_SET: ReadonlySet<Archetype> = new Set<Archetype>([
  "backend-web-db",
  "data-pipeline",
]);

export interface AxisFields {
  archetype: Archetype;
  architectureStyle: ArchitectureStyle;
  isMultiTenant: boolean;
  hasDatabase: boolean;
  hasPublicApi: boolean;
  contractType: ContractType;
}

export function resolveAxisFields(
  stored: ArbiterConfig | null,
  targetDir: string,
  language: ReturnType<typeof detectLanguage>,
  framework: string | null,
): AxisFields {
  const archetype: Archetype =
    stored?.archetype ??
    detectArchetypeHint(targetDir, language, framework) ??
    "library";
  const hasPublicApi = stored?.hasPublicApi ?? archetype === "backend-web-db";
  return {
    archetype,
    architectureStyle: stored?.architectureStyle ?? "none",
    isMultiTenant: stored?.isMultiTenant ?? false,
    hasDatabase: stored?.hasDatabase ?? ARCHETYPE_DB_SET.has(archetype),
    hasPublicApi,
    contractType:
      stored?.contractType ?? defaultContractType(archetype, hasPublicApi),
  };
}
