#!/usr/bin/env node
/**
 * Join Lok Sabha sitting MPs to DataMeet PC TopoJSON features.
 * Writes public/data/geo/pc-matches.json and pc-match-index.json.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const geoDir = path.join(root, "public/data/geo");
const snapshotPath = path.join(root, "public/data/lok-sabha-sitting-mps.json");
const pcTopoPath = path.join(geoDir, "pc/india.json");
const outPath = path.join(geoDir, "pc-matches.json");
const indexOutPath = path.join(geoDir, "pc-match-index.json");

const PC_STATE_TO_MAP = {
  "Jammu & Kashmir": "Jammu and Kashmir",
  Orissa: "Odisha",
  "Andaman & Nicobar": "Andaman and Nicobar Islands",
  "Dadra & Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "Daman & Diu": "Dadra and Nagar Haveli and Daman and Diu",
};

const LS_STATE_TO_MAP = {
  "Jammu Kashmir": "Jammu and Kashmir",
  "Jammu and Kashmir": "Jammu and Kashmir",
  Orissa: "Odisha",
  "Andaman and Nicobar Islands": "Andaman and Nicobar Islands",
  "Dadra and Nagar Haveli and Daman and Diu": "Dadra and Nagar Haveli and Daman and Diu",
};

/** Manual overrides: `${mapState}|${normalizedLs}` → normalized geo pc_name */
const ALIASES = {
  "Dadra and Nagar Haveli and Daman and Diu|DADAR NAGAR HAVELI": "DADRA AND NAGAR HAVELI",
  "Dadra and Nagar Haveli and Daman and Diu|DAMAN DIU": "DAMAN AND DIU",
  "Andhra Pradesh|ANAKAPALLE": "ANAKAPALLI",
  "Andhra Pradesh|NARSARAOPET": "NARASARAOPET",
  "Andhra Pradesh|ANANTHAPUR": "ANANTAPURAMU",
  "Andhra Pradesh|THIRUPATHI": "TIRUPATI",
  "Karnataka|DAVANAGERE": "DAVANGERE",
  "Karnataka|CHIKKBALLAPUR": "CHIKBALLAPUR",
  "Karnataka|CHIKKODI": "CHIKODI",
  "Karnataka|BELGAUM": "BELAGAVI",
  "Karnataka|HASSAN": "HAASAN",
  "Tamil Nadu|KANNIYAKUMARI": "KANYAKUMARI",
  "Tamil Nadu|THOOTHUKKUDI": "THOOTHUKUDI",
  "Tamil Nadu|TIRUVALLUR": "THIRUVALLUR",
  "Tamil Nadu|MAYILADUTHURAI": "MAYILADUTURAI",
  "Telangana|MAHBUBNAGAR": "MAHABUBNAGAR",
  "Telangana|BHONGIR": "BHUVANAGIRI",
  "Telangana|PEDDAPALLE": "PEDDAPALLI",
  "Maharashtra|HATKANANGALE": "HATKANANGLE",
  "West Bengal|BURDWAN DURGAPUR": "BARDHAMAN DURGAPUR",
  "West Bengal|BARRACKPUR": "BARRACKPORE",
  "West Bengal|ARAMBAG": "ARAMBAGH",
  "Punjab|FIROZPUR": "FIROZEPUR",
  "Uttarakhand|NAINITAL UDHAM SINGH NAGAR": "NAINITAL UDHAMSINGH NAGAR",
  "Chhattisgarh|JANJGIR CHAMPA": "JANJGIR",
  "Kerala|MAVELIKKARA": "MAVELIKARA",
  "Madhya Pradesh|MANDSOUR": "MANDSAUR",
  "Assam|GUWAHATI": "GAUHATI",
  "Assam|NAGAON": "NOWGONG",
  "Assam|SONITPUR": "TEZPUR",
  "Assam|DIPHU": "AUTONOMOUS DISTRICT",
  "Assam|KAZIRANGA": "KALIABOR",
  "Assam|DARRANG UDALGURI": "MANGALDOI",
  "Jammu and Kashmir|ANANTNAG RAJOURI": "ANANTNAG",
};

/** Reviewed corrections for known source-label defects, keyed by state and PC number. */
const REVIEWED_PC_LABELS = {
  "Maharashtra|30": "Mumbai South Central",
  "Maharashtra|31": "Mumbai South",
};

/** 2019 source predates Ladakh's separate UT label; PC 4 is the Ladakh seat. */
const REVIEWED_PC_STATES = {
  "Jammu & Kashmir|4": "Ladakh",
};

function normalizeConstituency(name) {
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

function toMapState(name, table) {
  const raw = String(name ?? "").trim();
  return table[raw] ?? raw;
}

function scoreTokenOverlap(a, b) {
  const at = new Set(a.split(" ").filter(Boolean));
  const bt = new Set(b.split(" ").filter(Boolean));
  if (!at.size || !bt.size) return 0;
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter += 1;
  return inter / Math.max(at.size, bt.size);
}

function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function uniqueHits(hits) {
  const seen = new Set();
  return hits.filter((hit) => {
    const id = `${hit.name}|${hit.pcNo ?? ""}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function matchOne(lsNorm, geoByNorm) {
  if (geoByNorm.has(lsNorm)) {
    const hits = uniqueHits(geoByNorm.get(lsNorm));
    if (hits.length === 1) return { kind: "exact", geo: hits[0] };
    return { kind: "ambiguous", geo: null, candidates: hits };
  }
  let best = null;
  let bestScore = 0;
  let ties = 0;
  for (const [geoNorm, hits] of geoByNorm) {
    if (hits.length !== 1) continue;
    const score = scoreTokenOverlap(lsNorm, geoNorm);
    if (score < 0.8) continue;
    if (score > bestScore) {
      bestScore = score;
      best = hits[0];
      ties = 1;
    } else if (score === bestScore) {
      ties += 1;
    }
  }
  if (best && ties === 1) return { kind: "fuzzy", geo: best, score: bestScore };

  // Close single-string spellings (Anakapalle/Anakapalli, Hassan/Haasan).
  let editBest = null;
  let editDist = Infinity;
  let editTies = 0;
  for (const [geoNorm, hits] of geoByNorm) {
    if (hits.length !== 1) continue;
    const maxLen = Math.max(lsNorm.length, geoNorm.length);
    if (!maxLen || maxLen > 40) continue;
    const dist = editDistance(lsNorm.replace(/ /g, ""), geoNorm.replace(/ /g, ""));
    const allowed = maxLen <= 8 ? 1 : maxLen <= 14 ? 2 : 3;
    if (dist > allowed) continue;
    if (dist < editDist) {
      editDist = dist;
      editBest = hits[0];
      editTies = 1;
    } else if (dist === editDist) {
      editTies += 1;
    }
  }
  if (editBest && editTies === 1) return { kind: "fuzzy", geo: editBest, score: 1 - editDist / 10 };
  return { kind: "unmatched", geo: null };
}

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const topo = JSON.parse(fs.readFileSync(pcTopoPath, "utf8"));
const layerKey = Object.keys(topo.objects)[0];
const layer = topo.objects[layerKey];

/** Map-state → Map(normalized pc_name → [{name, pcNo, stName}]) */
const byState = new Map();
for (const g of layer.geometries) {
  const props = g.properties ?? {};
  const reviewedState = REVIEWED_PC_STATES[`${props.st_name}|${props.pc_no}`];
  if (reviewedState) props.st_name = reviewedState;
  const mapState = toMapState(props.st_name, PC_STATE_TO_MAP);
  const reviewedLabel = REVIEWED_PC_LABELS[`${mapState}|${props.pc_no}`];
  if (reviewedLabel) props.pc_name = reviewedLabel;
  const raw = props.pc_name ?? "";
  const norm = normalizeConstituency(raw);
  if (!norm) continue;
  if (!byState.has(mapState)) byState.set(mapState, new Map());
  const geoByNorm = byState.get(mapState);
  if (!geoByNorm.has(norm)) geoByNorm.set(norm, []);
  const entry = { name: raw, pcNo: props.pc_no ?? null, stName: props.st_name };
  // Deduplicate identical feature identifiers only; distinct PC numbers remain reviewable.
  if (!geoByNorm.get(norm).some((hit) => hit.name === entry.name && hit.pcNo === entry.pcNo)) {
    geoByNorm.get(norm).push(entry);
  }
}

// Also index all PCs nationally for Ladakh / odd state mismatches
const national = new Map();
for (const [, geoByNorm] of byState) {
  for (const [norm, hits] of geoByNorm) {
    if (!national.has(norm)) national.set(norm, []);
    national.get(norm).push(...hits);
  }
}

const matches = {};
const coverage = { total: 0, matched: 0, unmatched: 0, ambiguous: 0 };
const byKey = {};

for (const record of snapshot.records) {
  const mapState = toMapState(record.state, LS_STATE_TO_MAP);
  const lsNorm = normalizeConstituency(record.constituency);
  const key = `${mapState}|${lsNorm}`;
  coverage.total += 1;

  if (matches[key]) {
    if (matches[key].status === "matched") coverage.matched += 1;
    else if (matches[key].status === "ambiguous") coverage.ambiguous += 1;
    else coverage.unmatched += 1;
    continue;
  }

  const aliasGeo = ALIASES[key];
  let result;
  if (aliasGeo) {
    const geoByNorm = byState.get(mapState) ?? national;
    const hits = geoByNorm.get(aliasGeo) ?? national.get(aliasGeo);
    result = hits?.length === 1
      ? { kind: "alias", geo: hits[0] }
      : hits?.length
        ? { kind: "ambiguous", geo: null, candidates: hits }
        : { kind: "unmatched", geo: null };
  } else {
    const geoByNorm = byState.get(mapState);
    result = geoByNorm ? matchOne(lsNorm, geoByNorm) : matchOne(lsNorm, national);
    if (result.kind === "unmatched" && geoByNorm) {
      result = matchOne(lsNorm, national);
    }
  }

  if (result.kind === "exact" || result.kind === "fuzzy" || result.kind === "alias") {
    matches[key] = {
      status: "matched",
      method: result.kind,
      score: result.score ?? 1,
      lsConstituency: record.constituency,
      state: mapState,
      geoName: result.geo.name,
      pcNo: result.geo.pcNo,
    };
    byKey[key] = result.geo.name;
    coverage.matched += 1;
  } else if (result.kind === "ambiguous") {
    matches[key] = {
      status: "ambiguous",
      lsConstituency: record.constituency,
      state: mapState,
      candidates: (result.candidates ?? []).map((c) => c.name),
    };
    coverage.ambiguous += 1;
  } else {
    matches[key] = {
      status: "unmatched",
      lsConstituency: record.constituency,
      state: mapState,
    };
    coverage.unmatched += 1;
  }
}

const matchRate = coverage.total ? coverage.matched / coverage.total : 0;
const payload = {
  meta: {
    source: "Lok Sabha 2024 general-election winners × DataMeet india_pc_2019_simplified",
    pcLayer: layerKey,
    generatedAt: new Date().toISOString(),
    ...coverage,
    matchRate,
  },
  matches,
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
fs.writeFileSync(
  indexOutPath,
  `${JSON.stringify({ meta: payload.meta, byKey }, null, 2)}\n`,
);

const pcIndex = {
  meta: {
    source: "DataMeet parliamentary-constituencies / india_pc_2019_simplified (CC0)",
    file: "pc/india.json",
    objectName: layerKey,
    featureCount: layer.geometries.length,
    nameProperty: "pc_name",
    stateProperty: "st_name",
  },
};
fs.writeFileSync(path.join(geoDir, "pc-index.json"), `${JSON.stringify(pcIndex, null, 2)}\n`);
fs.writeFileSync(pcTopoPath, `${JSON.stringify(topo)}\n`);

console.log(JSON.stringify(payload.meta, null, 2));
const unmatched = Object.values(matches).filter((m) => m.status !== "matched").slice(0, 25);
if (unmatched.length) {
  console.log("sample unmatched/ambiguous:", unmatched);
}
