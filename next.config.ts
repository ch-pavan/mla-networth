import type { NextConfig } from "next";

const githubPages = process.env.GITHUB_PAGES === "true";
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

const nextConfig: NextConfig = {
  ...(githubPages ? {
    output: "export" as const,
    basePath,
    trailingSlash: true,
    images: { unoptimized: true },
  } : {}),
};

export default nextConfig;
