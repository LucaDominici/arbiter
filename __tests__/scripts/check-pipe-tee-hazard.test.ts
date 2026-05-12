import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve("scripts/check-pipe-tee-hazard.mjs");

function runScanner(dir: string): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("node", [SCRIPT, dir], {
    encoding: "utf-8",
    cwd: resolve("."),
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pipe-tee-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("check-pipe-tee-hazard scanner (advisory)", () => {
  it("always exits 0 even when hazard found", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "hazard.sh"),
        "#!/bin/bash\nsome_cmd | tee output.log\n",
      );
      const result = runScanner(dir);
      expect(result.status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("emits [WARN] for unguarded pipe/tee in .sh file", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "hazard.sh"),
        "#!/bin/bash\nsome_cmd | tee output.log\n",
      );
      const result = runScanner(dir);
      expect(result.stdout).toContain("[WARN]");
      expect(result.stdout).toContain("hazard.sh");
    } finally {
      cleanup();
    }
  });

  it("does not warn when set -o pipefail precedes pipe/tee", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "safe.sh"),
        "#!/bin/bash\nset -o pipefail\nsome_cmd | tee output.log\n",
      );
      const result = runScanner(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("[WARN]");
    } finally {
      cleanup();
    }
  });

  it("does not warn when PIPESTATUS check follows pipe/tee", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "safe2.sh"),
        "#!/bin/bash\nsome_cmd | tee output.log\nif [ ${PIPESTATUS[0]} -ne 0 ]; then exit 1; fi\n",
      );
      const result = runScanner(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("[WARN]");
    } finally {
      cleanup();
    }
  });

  it("emits [WARN] for unguarded pipe/tee in .sh.ejs template", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "script.sh.ejs"),
        "#!/bin/bash\ncmd | tee out.log\n",
      );
      const result = runScanner(dir);
      expect(result.stdout).toContain("[WARN]");
    } finally {
      cleanup();
    }
  });

  it("passes on a clean file with no pipe/tee", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "clean.sh"),
        "#!/bin/bash\necho 'hello'\nexit 0\n",
      );
      const result = runScanner(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("[WARN]");
    } finally {
      cleanup();
    }
  });

  it("emits [WARN] for unguarded pipe/tee in .mjs.ejs template", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "script.mjs.ejs"),
        "#!/bin/bash\ncmd | tee out.log\n",
      );
      const result = runScanner(dir);
      expect(result.stdout).toContain("[WARN]");
      expect(result.stdout).toContain("script.mjs.ejs");
    } finally {
      cleanup();
    }
  });

  it("always exits 0 for nonexistent path (C-phase: advisory never errors)", () => {
    const result = runScanner("--nonexistent-path-xyz-abc-999");
    expect(result.status).toBe(0);
  });
});
