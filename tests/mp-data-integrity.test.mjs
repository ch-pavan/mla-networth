import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const json = (relative) => readFile(new URL(relative, import.meta.url), "utf8").then(JSON.parse);

test("Lok Sabha snapshot is an honest, candidate-enriched 2024 winner dataset", async () => {
  const [snapshot, candidates, winnerArchive] = await Promise.all([
    json("../public/data/lok-sabha-sitting-mps.json"),
    json("../public/data/candidates/loksabha2024.json"),
    json("../public/data/lok-sabha-winner-archive.json"),
  ]);
  const candidatesById = new Map(candidates.records.map((record) => [record.candidateId, record]));
  const expectedWinnerIds = winnerArchive.records
    .filter((record) => record.electionYear === 2024 && record.electionType !== "by-election")
    .map((record) => record.candidateId)
    .sort((left, right) => left - right);

  assert.equal(snapshot.meta.datasetType, "general_election_winners");
  assert.equal(snapshot.meta.recordCount, 543);
  assert.equal(snapshot.meta.candidateArchiveCrossCheckComplete, true);
  assert.match(snapshot.meta.note, /not a claim about current or sitting membership/i);
  assert.doesNotMatch(snapshot.meta.title, /sitting|current/i);
  assert.equal(snapshot.records.length, 543);
  assert.equal(new Set(snapshot.records.map((record) => record.candidateId)).size, 543);
  assert.deepEqual(snapshot.records.map((record) => record.candidateId).sort((left, right) => left - right), expectedWinnerIds);
  assert.deepEqual(snapshot.records.map((record) => record.rank), Array.from({ length: 543 }, (_, index) => index + 1));
  const seatKeys = snapshot.records.map((record) => `${record.state}|${record.constituency.toUpperCase().replace(/\s+/g, " ").trim()}`);
  assert.equal(new Set(seatKeys).size, 543, "every 2024 winner must occupy one unique state/PC pair");

  for (const [index, record] of snapshot.records.entries()) {
    const candidate = candidatesById.get(record.candidateId);
    assert.ok(candidate, `candidate ${record.candidateId} must exist in the complete shard`);
    assert.equal(record.electionYear, 2024);
    assert.equal(record.electionType, "general");
    assert.equal(record.recordType, "general_election_winner");
    assert.equal(record.assets, candidate.assets);
    assert.equal(record.liabilities, candidate.liabilities);
    assert.equal(record.criminalCases, candidate.criminalCases);
    assert.equal(record.education, candidate.education);
    assert.equal(record.name, candidate.name);
    assert.equal(record.party, candidate.party);
    assert.equal(record.candidateUrl, candidate.candidateUrl);
    assert.equal(record.age, null);
    assert.equal(record.gender, null);
    assert.equal(record.seriousCriminalCases, null);
    assert.equal(record.panDeclared, null);
    if (index > 0) {
      const previous = snapshot.records[index - 1];
      assert.ok(previous.assets >= record.assets || (previous.assets === record.assets && previous.candidateId < record.candidateId));
    }
  }
});

test("Rajya Sabha snapshot preserves report scope and unknown values", async () => {
  const snapshot = await json("../public/data/rajya-sabha-sitting-mps.json");
  assert.deepEqual(
    {
      asOf: snapshot.meta.asOf,
      published: snapshot.meta.published,
      sittingMps: snapshot.meta.sittingMps,
      analyzedRecords: snapshot.meta.analyzedRecords,
      recordCount: snapshot.meta.recordCount,
      vacantSeats: snapshot.meta.vacantSeats,
      affidavitsUnavailable: snapshot.meta.affidavitsUnavailable,
    },
    {
      asOf: "2026-03-17",
      published: "2026-03-19",
      sittingMps: 233,
      analyzedRecords: 229,
      recordCount: 229,
      vacantSeats: 1,
      affidavitsUnavailable: 3,
    },
  );
  assert.equal(snapshot.records.length, 229);
  assert.equal(snapshot.records.filter((record) => record.liabilities === null).length, 219);
  assert.equal(snapshot.records.filter((record) => typeof record.liabilities === "number").length, 10);
  assert.equal(snapshot.meta.liabilityMatchesFromTopTable, 10);
  assert.equal(snapshot.meta.liabilityMatchesFromTopTable, snapshot.records.filter((record) => typeof record.liabilities === "number").length);
  assert.ok(snapshot.records.filter((record) => typeof record.liabilities === "number").every((record) => record.liabilities > 0));
  assert.ok(snapshot.records.every((record) => record.criminalCases === null));
  assert.ok(snapshot.records.every((record) => record.seriousCriminalCases === null));
  assert.deepEqual(snapshot.records.map((record) => record.rank), Array.from({ length: 229 }, (_, index) => index + 1));
  assert.ok(snapshot.records.every((record, index) => index === 0 || snapshot.records[index - 1].assets >= record.assets));
  assert.ok(!snapshot.records.some((record) => ["Chattisgarh", "Jammu And Kashmir", "NCT Of Delhi"].includes(record.state)));
  assert.ok(snapshot.records.some((record) => record.state === "Chhattisgarh"));
  assert.ok(snapshot.records.some((record) => record.state === "Jammu and Kashmir"));
  assert.ok(snapshot.records.some((record) => record.state === "Delhi"));
});

test("reviewed Mumbai parliamentary overrides do not conflate south-central seats", async () => {
  const [matches, matchIndex, topo] = await Promise.all([
    json("../public/data/geo/pc-matches.json"),
    json("../public/data/geo/pc-match-index.json"),
    json("../public/data/geo/pc/india.json"),
  ]);
  const southCentral = matches.matches["Maharashtra|MUMBAI SOUTH CENTRAL"];
  const south = matches.matches["Maharashtra|MUMBAI SOUTH"];
  assert.deepEqual([southCentral.geoName, southCentral.pcNo], ["Mumbai South Central", 30]);
  assert.deepEqual([south.geoName, south.pcNo], ["Mumbai South", 31]);
  assert.equal(matchIndex.byKey["Maharashtra|MUMBAI SOUTH CENTRAL"], "Mumbai South Central");
  assert.equal(matchIndex.byKey["Maharashtra|MUMBAI SOUTH"], "Mumbai South");
  assert.notEqual(matchIndex.byKey["Maharashtra|MUMBAI SOUTH CENTRAL"], matchIndex.byKey["Maharashtra|MUMBAI NORTH CENTRAL"]);

  const layer = topo.objects[Object.keys(topo.objects)[0]];
  const maharashtra = layer.geometries.filter((geometry) => geometry.properties?.st_name === "Maharashtra");
  assert.equal(maharashtra.find((geometry) => geometry.properties?.pc_no === 30)?.properties?.pc_name, "Mumbai South Central");
  assert.equal(maharashtra.find((geometry) => geometry.properties?.pc_no === 31)?.properties?.pc_name, "Mumbai South");
});

test("Lok Sabha winner state totals align with all 543 parliamentary boundaries", async () => {
  const [snapshot, topo] = await Promise.all([
    json("../public/data/lok-sabha-sitting-mps.json"),
    json("../public/data/geo/pc/india.json"),
  ]);
  const canonicalState = (state) => ({
    "Jammu & Kashmir": "Jammu and Kashmir",
    Orissa: "Odisha",
    "Andaman & Nicobar": "Andaman and Nicobar Islands",
    "Dadra & Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman & Diu": "Dadra and Nagar Haveli and Daman and Diu",
  })[state] ?? state;
  const countByState = (values) => values.reduce((counts, state) => {
    const canonical = canonicalState(state);
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    return counts;
  }, new Map());
  const winnerCounts = countByState(snapshot.records.map((record) => record.state));
  const layer = topo.objects[Object.keys(topo.objects)[0]];
  const boundaryCounts = countByState(layer.geometries.map((geometry) =>
    String(geometry.properties?.pc_name).toUpperCase() === "LADAKH"
      ? "Ladakh"
      : geometry.properties?.st_name,
  ));
  assert.equal(snapshot.records.length, 543);
  assert.equal(layer.geometries.length, 543);
  assert.deepEqual([...winnerCounts].sort(), [...boundaryCounts].sort());
  assert.equal(winnerCounts.get("Maharashtra"), 48);
  assert.equal(winnerCounts.get("Bihar"), 40);
  assert.equal(winnerCounts.get("Himachal Pradesh"), 4);
});

test("runtime state canonicalization covers the aliases present in the ADR Rajya Sabha source", async () => {
  const source = await readFile(new URL("../lib/geo-names.ts", import.meta.url), "utf8");
  const geoNames = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
  assert.equal(geoNames.toMapStateName("Chattisgarh"), "Chhattisgarh");
  assert.equal(geoNames.toMapStateName("Jammu And Kashmir"), "Jammu and Kashmir");
  assert.equal(geoNames.toMapStateName("NCT Of Delhi"), "Delhi");
  assert.equal(geoNames.toAdrStateName("Chattisgarh"), "Chhattisgarh");
  assert.equal(geoNames.toAdrStateName("Jammu And Kashmir"), "Jammu Kashmir");
  assert.equal(geoNames.toAdrStateName("NCT Of Delhi"), "Delhi");
});
