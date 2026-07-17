import { decodeMynetaCell } from "./myneta-records.mjs";

const normalize = (value) => value
  .normalize("NFKD")
  .replace(/[.']/g, "")
  .replace(/[^a-zA-Z0-9]+/g, " ")
  .trim()
  .toLowerCase();

/**
 * Build constituency → state labels from a Lok Sabha MyNeta index page.
 * State names come from the dropdown buttons; seats from constituency links.
 */
export function parseLokSabhaConstituencyStates(html) {
  const map = new Map();
  const blocks = String(html ?? "").split(/handle_dropdown\('item',\s*'\d+'\)/i);
  for (const block of blocks) {
    const stateMatch = block.match(
      />\s*([A-Z][A-Z0-9 .&()'/-]+?)\s*<span class='w3-right'>/i,
    );
    if (!stateMatch) continue;
    const state = decodeMynetaCell(stateMatch[1])
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*\(NCT\)\s*$/i, "");
    if (!state || /^ALL CONSTITUENCIES$/i.test(state)) continue;

    for (const link of block.matchAll(
      /href=index\.php\?action=show_candidates&constituency_id=\d+[^>]*>([^<]+)</gi,
    )) {
      const constituency = decodeMynetaCell(link[1]);
      if (!constituency) continue;
      map.set(normalize(constituency), state);
      const base = constituency.replace(/\s*\((SC|ST|GEN)\)\s*$/i, "").trim();
      if (base && base !== constituency) map.set(normalize(base), state);
    }
  }
  return map;
}

export function resolveLokSabhaState(constituency, constituencyStateMap, fallback = "Lok Sabha") {
  if (!constituency) return fallback;
  const exact = constituencyStateMap.get(normalize(constituency));
  const raw = exact
    ?? constituencyStateMap.get(normalize(constituency.replace(/\s*\((SC|ST|GEN)\)\s*$/i, "").trim()))
    ?? fallback;
  return titleCaseState(raw);
}

function titleCaseState(value) {
  return value
    .toLowerCase()
    .split(" ")
    .map((part) => {
      if (part === "and" || part === "of") return part;
      if (part === "nct") return "NCT";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ")
    .replace(/\bAnd\b/g, "and");
}
