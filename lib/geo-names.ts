/** Normalize constituency labels for ADR ↔ geo joins. */
export function normalizeConstituencyName(name: string): string {
  return String(name ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(SC|ST|GEN|GENERAL)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map TopoJSON / GIS state labels onto ADR sitting-MLA state strings. */
export function toAdrStateName(geoStateName: string): string {
  const raw = String(geoStateName ?? "").trim();
  const map: Record<string, string> = {
    "Jammu and Kashmir": "Jammu Kashmir",
    "JAMMU & KASHMIR": "Jammu Kashmir",
    "JAMMU AND KASHMIR": "Jammu Kashmir",
    Orissa: "Odisha",
    ORISSA: "Odisha",
    Uttarkhand: "Uttarakhand",
    UTTARKHAND: "Uttarakhand",
    "NCT of Delhi": "Delhi",
    "National Capital Territory of Delhi": "Delhi",
  };
  return map[raw] ?? raw;
}

export function constituencyMatchKey(state: string, constituency: string): string {
  return `${toAdrStateName(state)}|${normalizeConstituencyName(constituency)}`;
}

export function stateGeoSlug(state: string): string {
  return toAdrStateName(state)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
