#!/usr/bin/env node
// Counts successful nightly matrix jobs via the GitHub Actions API.
// Called by the 'aggregate' job after the matrix 'run' jobs complete.
// Exits 1 if fewer than MIN_PASS jobs succeeded.
//
// Required env vars (set by GitHub Actions):
//   GITHUB_TOKEN       — for API auth
//   GITHUB_REPOSITORY  — owner/repo
//   GITHUB_RUN_ID      — current run ID
//
// Optional env var:
//   MIN_PASS           — minimum passing jobs required (default: 10)
//
// Usage: node scripts/aggregate-matrix-result.mjs

const {
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_RUN_ID,
  MIN_PASS = "10",
} = process.env;

const minPass = parseInt(MIN_PASS, 10);

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) {
  console.error(
    "Missing required env vars: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID",
  );
  process.exit(1);
}

const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs?per_page=100`;

let jobs;
try {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`GitHub API error ${resp.status}: ${body}`);
    process.exit(1);
  }
  const data = await resp.json();
  if (!Array.isArray(data.jobs)) {
    console.error(
      `GitHub API response missing 'jobs' array. Got keys: ${Object.keys(data).join(", ")}`,
    );
    process.exit(1);
  }
  jobs = data.jobs;
  const linkHeader = resp.headers.get("link");
  if (linkHeader && linkHeader.includes('rel="next"')) {
    console.error(
      "WARNING: GitHub API response is paginated — job count may be incomplete. " +
        "aggregate-matrix-result.mjs needs pagination support for large matrices.",
    );
    process.exit(1);
  }
} catch (err) {
  console.error(`Failed to fetch jobs: ${err}`);
  process.exit(1);
}

// Matrix 'run' jobs are named "run (fixture, level)" by GitHub Actions
const matrixJobs = jobs.filter(
  (j) => typeof j.name === "string" && j.name.startsWith("run ("),
);

const passed = matrixJobs.filter((j) => j.conclusion === "success").length;
const total = matrixJobs.length;

console.log(`Matrix jobs: ${total} total, ${passed} successful`);
matrixJobs.forEach((j) => {
  const icon = j.conclusion === "success" ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${j.name}`);
});

if (passed < minPass) {
  console.error(
    `\nFAIL: ${passed}/${total} matrix jobs passed — need at least ${minPass}.\n`,
  );
  process.exit(1);
}

console.log(
  `\nPASS: ${passed}/${total} matrix jobs passed (≥${minPass} required).\n`,
);
