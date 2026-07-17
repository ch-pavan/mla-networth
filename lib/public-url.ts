const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

/** Prefixes root-relative public files and browser navigations for subpath hosts. */
export function publicUrl(path: string): string {
  if (!path.startsWith("/")) return path;
  return `${basePath}${path}`;
}
