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

/** Map TopoJSON / GIS labels onto ADR sitting-MLA state strings (AC joins). */
export function toAdrStateName(geoStateName: string): string {
  const raw = String(geoStateName ?? "").trim();
  const map: Record<string, string> = {
    "Jammu and Kashmir": "Jammu Kashmir",
    "Jammu & Kashmir": "Jammu Kashmir",
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

/** Canonical state label matching `india-states.json` `st_nm` (map choropleths). */
export function toMapStateName(stateName: string): string {
  const raw = String(stateName ?? "").trim();
  const map: Record<string, string> = {
    "Jammu Kashmir": "Jammu and Kashmir",
    "Jammu & Kashmir": "Jammu and Kashmir",
    "JAMMU & KASHMIR": "Jammu and Kashmir",
    "JAMMU AND KASHMIR": "Jammu and Kashmir",
    Orissa: "Odisha",
    ORISSA: "Odisha",
    Uttarkhand: "Uttarakhand",
    "NCT of Delhi": "Delhi",
    "National Capital Territory of Delhi": "Delhi",
    "Andaman & Nicobar": "Andaman and Nicobar Islands",
    "Andaman and Nicobar": "Andaman and Nicobar Islands",
    "Dadra & Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman & Diu": "Dadra and Nagar Haveli and Daman and Diu",
    "Dadra and Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman and Diu": "Dadra and Nagar Haveli and Daman and Diu",
  };
  return map[raw] ?? raw;
}

export function constituencyMatchKey(state: string, constituency: string): string {
  return `${toAdrStateName(state)}|${normalizeConstituencyName(constituency)}`;
}

/** Lok Sabha PC match key using map-canonical state names. */
export function pcMatchKey(state: string, constituency: string): string {
  return `${toMapStateName(state)}|${normalizeConstituencyName(constituency)}`;
}

export function stateGeoSlug(state: string): string {
  return toMapStateName(state)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type HouseChamber = "assembly" | "lok_sabha" | "rajya_sabha";

export function houseLabel(chamber: HouseChamber): string {
  if (chamber === "lok_sabha") return "LS";
  if (chamber === "rajya_sabha") return "RS";
  return "MLA";
}
