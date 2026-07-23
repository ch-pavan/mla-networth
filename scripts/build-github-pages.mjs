import { access, readFile, readdir, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const apiDirectory = resolve(root, "app", "api");
const stagedApiDirectory = resolve(root, ".github-pages-api");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (!(await exists(apiDirectory)) && (await exists(stagedApiDirectory))) {
  await rename(stagedApiDirectory, apiDirectory);
}

if (!(await exists(apiDirectory))) {
  throw new Error("Expected app/api before building the GitHub Pages edition.");
}
if (await exists(stagedApiDirectory)) {
  throw new Error("Refusing to overwrite an existing .github-pages-api directory.");
}

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
        env: {
          ...process.env,
          GITHUB_PAGES: "true",
          NEXT_PUBLIC_BASE_PATH: "/mla-networth",
          NEXT_PUBLIC_SITE_URL: "https://ch-pavan.github.io/mla-networth",
        },
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

const outputDirectory = resolve(root, "out");
const requiredFiles = [
  "index.html",
  "404.html",
  "about/index.html",
  "person/index.html",
  "data/adr-sitting-mlas-2025.json",
  "data/adr-recontest-history.json",
  "data/sitting-mla-asset-histories.json",
  "data/adr-winner-archive.json",
  "data/lok-sabha-sitting-mps.json",
  "data/lok-sabha-winner-archive.json",
  "data/rajya-sabha-sitting-mps.json",
  "data/rajya-sabha-myneta-archive.json",
  "data/candidates/index.json",
  "data/geo/india-states.json",
  "data/geo/pc-index.json",
  "data/geo/pc-match-index.json",
  "data/geo/pc/india.json",
  "favicon.svg",
  "og.png",
];

for (const file of requiredFiles) {
  if (!(await exists(resolve(outputDirectory, file)))) {
    throw new Error(`GitHub Pages export is missing ${file}.`);
  }
}

if (await exists(resolve(outputDirectory, "api"))) {
  throw new Error("GitHub Pages export unexpectedly contains server API routes.");
}

const homeHtml = await readFile(resolve(outputDirectory, "index.html"), "utf8");
for (const expected of [
  "/mla-networth/_next/",
  "https://ch-pavan.github.io/mla-networth/og.png",
]) {
  if (!homeHtml.includes(expected)) {
    throw new Error(`GitHub Pages export is missing ${expected}.`);
  }
}

const staticFiles = await readdir(resolve(outputDirectory, "_next", "static"), {
  recursive: true,
});
let containsBasePath = false;
let containsDataUrl = false;
for (const file of staticFiles) {
  if (typeof file !== "string" || !file.endsWith(".js")) continue;
  const contents = await readFile(resolve(outputDirectory, "_next", "static", file), "utf8");
  containsBasePath ||= contents.includes("/mla-networth");
  containsDataUrl ||= contents.includes("/data/adr-sitting-mlas-2025.json");
  if (containsBasePath && containsDataUrl) break;
}

if (!containsBasePath || !containsDataUrl) {
  throw new Error("GitHub Pages client bundle is missing subpath-prefixed data URLs.");
}
