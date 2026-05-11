import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ApiMiddlewareGeneratorResult {
  files: WriteResult[];
}

export function generateApiMiddleware(
  config: ProjectConfig,
): ApiMiddlewareGeneratorResult {
  if (!config.hasPublicApi) return { files: [] };

  const results: WriteResult[] = [];
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  if (config.language === "typescript") {
    results.push(
      writeFile(
        resolvedPath(base, "src", "middleware", "deprecation.ts"),
        renderTemplate("middleware/deprecation.ts.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "src", "middleware", "410-gone-handler.ts"),
        renderTemplate("middleware/410-gone-handler.ts.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "src", "middleware", "error-handler.ts"),
        renderTemplate("middleware/error-handler.ts.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "src", "middleware", "correlation-id.ts"),
        renderTemplate("middleware/correlation-id.ts.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "src", "middleware", "payload-size-limit.ts"),
        renderTemplate("middleware/payload-size-limit.ts.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(
          base,
          "__tests__",
          "contract",
          "error-shape.contract.test.ts",
        ),
        renderTemplate(
          "__tests__/contract/error-shape.contract.test.ts.ejs",
          data,
        ),
        { skipIfExists: true },
      ),
    );
  }

  if (config.language === "java" && config.basePackage) {
    const pkgPath = config.basePackage.replace(/\./g, "/");
    results.push(
      writeFile(
        resolvedPath(
          base,
          "src",
          "main",
          "java",
          pkgPath,
          "web",
          "interceptor",
          "DeprecationInterceptor.java",
        ),
        renderTemplate("java/DeprecationInterceptor.java.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  return { files: results };
}
