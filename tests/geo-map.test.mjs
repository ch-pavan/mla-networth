import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function toMapStateName(stateName) {
  const raw = String(stateName ?? "").trim();
  const map = {
    "Jammu Kashmir": "Jammu and Kashmir",
    "Jammu & Kashmir": "Jammu and Kashmir",
    Orissa: "Odisha",
    "Dadra & Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman & Diu": "Dadra and Nagar Haveli and Daman and Diu",
  };
  return map[raw] ?? raw;
}

test("ships India map geo assets and match coverage", async () => {
  const [states, index, matches, pcIndex, pcMatches, mapPage] = await Promise.all([
    readFile(new URL("../public/data/geo/india-states.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/data/geo/ac-index.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/data/geo/constituency-match-index.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/data/geo/pc-index.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/data/geo/pc-match-index.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/map/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.equal(states.type, "Topology");
  assert.ok(states.objects.states);
  assert.ok(Object.keys(index.states).length >= 30);
  assert.ok(matches.meta.matchRate >= 0.85);
  assert.ok(Object.keys(matches.byKey).length >= 3500);
  assert.equal(pcIndex.meta.featureCount, 543);
  assert.ok(pcMatches.meta.matchRate >= 0.95);
  assert.ok(Object.keys(pcMatches.byKey).length >= 500);
  assert.match(mapPage, /aggregate declared assets|MAP \/ AGGREGATE WEALTH/i);
  assert.match(mapPage, /IndiaMap/);
  assert.match(mapPage, /setMapView\("aggregate"\)/);
  assert.match(mapPage, /setMapView\("lok_sabha"\)/);
  assert.match(mapPage, /setMapView\("rajya_sabha"\)/);
});

test("normalizes map state labels across houses", () => {
  assert.equal(toMapStateName("Jammu Kashmir"), "Jammu and Kashmir");
  assert.equal(toMapStateName("Jammu & Kashmir"), "Jammu and Kashmir");
  assert.equal(toMapStateName("Orissa"), "Odisha");
  assert.equal(toMapStateName("Dadra & Nagar Haveli"), "Dadra and Nagar Haveli and Daman and Diu");
});

test("aggregate sitting snapshots sum without person dedup", async () => {
  const [mla, ls, rs] = await Promise.all([
    readFile(new URL("../public/data/adr-sitting-mlas-2025.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/data/lok-sabha-sitting-mps.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/data/rajya-sabha-sitting-mps.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const total = mla.meta.recordCount + ls.meta.recordCount + rs.meta.recordCount;
  assert.equal(total, 4092 + 543 + 229);
  const byState = new Map();
  for (const record of [...mla.records, ...ls.records, ...rs.records]) {
    const state = toMapStateName(record.state);
    byState.set(state, (byState.get(state) ?? 0) + (record.assets ?? 0));
  }
  assert.ok(byState.size >= 30);
  assert.ok([...byState.values()].every((value) => value >= 0));
});
