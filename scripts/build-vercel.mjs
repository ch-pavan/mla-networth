import { access, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const apiDirectory = resolve(root, "app", "api");
const stagedApiDirectory = resolve(root, ".vercel-api");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeSiteUrl(value, source) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${source} must be a valid HTTP(S) URL or hostname.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${source} must use HTTP or HTTPS.`);
  }

  return url.toString().replace(/\/$/, "");
}

if (!(await exists(apiDirectory)) && (await exists(stagedApiDirectory))) {
  await rename(stagedApiDirectory, apiDirectory);
}

if (!(await exists(apiDirectory))) {
  throw new Error("Expected app/api before building the Vercel edition.");
}
if (await exists(stagedApiDirectory)) {
  throw new Error("Refusing to overwrite an existing .vercel-api directory.");
}

const explicitSiteUrl = normalizeSiteUrl(
  process.env.NEXT_PUBLIC_SITE_URL,
  "NEXT_PUBLIC_SITE_URL",
);
const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
const vercelSiteUrl = explicitSiteUrl
  ?? normalizeSiteUrl(
    productionDomain || process.env.VERCEL_URL,
    productionDomain
      ? "VERCEL_PROJECT_PRODUCTION_URL"
      : "VERCEL_URL",
  );

const buildEnvironment = {
  ...process.env,
  GITHUB_PAGES: "false",
  NEXT_PUBLIC_BASE_PATH: "",
};
if (vercelSiteUrl) buildEnvironment.NEXT_PUBLIC_SITE_URL = vercelSiteUrl;

await rm(resolve(root, ".next"), { recursive: true, force: true });
await rename(apiDirectory, stagedApiDirectory);

let exitCode = 1;
try {
  exitCode = await new Promise((resolveExit, reject) => {
    const next = spawn(
      process.execPath,
      [resolve(root, "node_modules", "next", "dist", "bin", "next"), "build"],
      {
        cwd: root,
        env: buildEnvironment,
        stdio: "inherit",
      },
    );
    next.once("error", reject);
    next.once("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  await rename(stagedApiDirectory, apiDirectory);
}

if (exitCode !== 0) process.exit(exitCode);
