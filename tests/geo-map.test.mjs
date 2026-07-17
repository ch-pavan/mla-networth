import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships India map geo assets and match coverage", async () => {
  const [states, index, matches, mapPage] = await Promise.all([
    readFile(new URL("../public/data/geo/india-states.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/data/geo/ac-index.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/data/geo/constituency-match-index.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/map/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.equal(states.type, "Topology");
  assert.ok(states.objects.states);
  assert.ok(Object.keys(index.states).length >= 30);
  assert.ok(matches.meta.matchRate >= 0.85);
  assert.ok(Object.keys(matches.byKey).length >= 3500);
  assert.match(mapPage, /aggregate declared assets|MAP \/ AGGREGATE WEALTH/i);
  assert.match(mapPage, /IndiaMap/);
});
