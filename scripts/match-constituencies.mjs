#!/usr/bin/env node
/**
 * Join ADR sitting-MLA constituencies to DataMeet AC TopoJSON features.
 * Writes public/data/geo/constituency-matches.json and prints coverage.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const geoDir = path.join(root, "public/data/geo");
const snapshotPath = path.join(root, "public/data/adr-sitting-mlas-2025.json");
const indexPath = path.join(geoDir, "ac-index.json");
const outPath = path.join(geoDir, "constituency-matches.json");

const STATE_GEO_NAME = {
  "Jammu and Kashmir": "Jammu Kashmir",
  "ORISSA": "Odisha",
  Orissa: "Odisha",
};

/** Manual overrides: `${state}|${normalizedAdr}` → normalized geo name */
const ALIASES = {
  "Delhi|NEW DELHI": "NEW DELHI",
  "Maharashtra|GHATKOPAR EAST": "GHATKOPAR EAST",
  "Odisha|BIJEPUR": "BIJEPUR",
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

function loadTopoNames(fileRel) {
  const topo = JSON.parse(fs.readFileSync(path.join(geoDir, fileRel), "utf8"));
  const layer = topo.objects.constituencies ?? topo.objects[Object.keys(topo.objects)[0]];
  const byNorm = new Map();
  for (const g of layer.geometries) {
    const raw = g.properties.name ?? g.properties.AC_NAME ?? "";
    const norm = normalizeConstituency(raw);
    if (!norm) continue;
    if (!byNorm.has(norm)) byNorm.set(norm, []);
    byNorm.get(norm).push({ name: raw, acNo: g.properties.acNo ?? g.properties.AC_NO ?? null });
  }
  return byNorm;
}

function scoreTokenOverlap(a, b) {
  const at = new Set(a.split(" ").filter(Boolean));
  const bt = new Set(b.split(" ").filter(Boolean));
  if (!at.size || !bt.size) return 0;
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter += 1;
  return inter / Math.max(at.size, bt.size);
}

function matchOne(adrNorm, geoByNorm) {
  if (geoByNorm.has(adrNorm)) {
    const hits = geoByNorm.get(adrNorm);
    return hits.length === 1 ? { kind: "exact", geo: hits[0] } : { kind: "ambiguous", geo: null, candidates: hits };
  }
  let best = null;
  let bestScore = 0;
  let ties = 0;
  for (const [geoNorm, hits] of geoByNorm) {
    if (hits.length !== 1) continue;
    const score = scoreTokenOverlap(adrNorm, geoNorm);
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
  return { kind: "unmatched", geo: null };
}

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const geoCache = new Map();

function geoForState(state) {
  if (geoCache.has(state)) return geoCache.get(state);
  const entry = index.states[state];
  if (!entry) {
    geoCache.set(state, null);
    return null;
  }
  const map = loadTopoNames(entry.file);
  geoCache.set(state, map);
  return map;
}

const matches = {};
const coverage = {};

for (const record of snapshot.records) {
  const state = STATE_GEO_NAME[record.state] ?? record.state;
  const adrNorm = normalizeConstituency(record.constituency);
  const key = `${state}|${adrNorm}`;
  if (!coverage[state]) coverage[state] = { total: 0, matched: 0, unmatched: 0, ambiguous: 0 };
  coverage[state].total += 1;

  if (matches[key]) {
    if (matches[key].status === "matched") coverage[state].matched += 1;
    else if (matches[key].status === "ambiguous") coverage[state].ambiguous += 1;
    else coverage[state].unmatched += 1;
    continue;
  }

  const aliasKey = `${state}|${adrNorm}`;
  if (ALIASES[aliasKey]) {
    const geoByNorm = geoForState(state);
    const aliasNorm = normalizeConstituency(ALIASES[aliasKey]);
    const hits = geoByNorm?.get(aliasNorm);
    if (hits?.length === 1) {
      matches[key] = { status: "matched", method: "alias", geoName: hits[0].name, acNo: hits[0].acNo, adrConstituency: record.constituency };
      coverage[state].matched += 1;
      continue;
    }
  }

  const geoByNorm = geoForState(state);
  if (!geoByNorm) {
    matches[key] = { status: "unmatched", method: "no-geo", adrConstituency: record.constituency };
    coverage[state].unmatched += 1;
    continue;
  }

  const result = matchOne(adrNorm, geoByNorm);
  if (result.kind === "exact" || result.kind === "fuzzy") {
    matches[key] = {
      status: "matched",
      method: result.kind,
      geoName: result.geo.name,
      acNo: result.geo.acNo,
      adrConstituency: record.constituency,
      ...(result.score != null ? { score: result.score } : {}),
    };
    coverage[state].matched += 1;
  } else if (result.kind === "ambiguous") {
    matches[key] = { status: "ambiguous", method: "exact-dup", adrConstituency: record.constituency };
    coverage[state].ambiguous += 1;
  } else {
    matches[key] = { status: "unmatched", method: "none", adrConstituency: record.constituency };
    coverage[state].unmatched += 1;
  }
}

const summary = Object.fromEntries(
  Object.entries(coverage)
    .map(([state, c]) => [state, { ...c, rate: c.total ? +(c.matched / c.total).toFixed(3) : 0 }])
    .sort((a, b) => a[0].localeCompare(b[0])),
);

const total = Object.values(coverage).reduce((a, c) => a + c.total, 0);
const matched = Object.values(coverage).reduce((a, c) => a + c.matched, 0);

const meta = {
  generatedAt: new Date().toISOString(),
  snapshot: "adr-sitting-mlas-2025.json",
  total,
  matched,
  matchRate: total ? +(matched / total).toFixed(3) : 0,
  normalize: "uppercase, strip punctuation/reservation suffixes, token fuzzy ≥0.8",
};

fs.writeFileSync(outPath, JSON.stringify({ meta, coverage: summary, matches }, null, 2));

const byKey = {};
for (const [key, value] of Object.entries(matches)) {
  if (value.status === "matched" && value.geoName) byKey[key] = value.geoName;
}
const slimPath = path.join(geoDir, "constituency-match-index.json");
fs.writeFileSync(slimPath, JSON.stringify({ meta, coverage: summary, byKey }));

console.log(`Matched ${matched}/${total} (${total ? ((matched / total) * 100).toFixed(1) : 0}%)`);
for (const [state, c] of Object.entries(summary).sort((a, b) => a[1].rate - b[1].rate)) {
  console.log(`${c.rate.toFixed(3)}  ${state}  ${c.matched}/${c.total} unmatched=${c.unmatched}`);
}
console.log(`Wrote ${outPath}`);
console.log(`Wrote ${slimPath}`);
