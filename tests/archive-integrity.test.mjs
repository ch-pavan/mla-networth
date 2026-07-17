import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataUrl = new URL("../public/data/", import.meta.url);

function assertMoney(record, field) {
  const value = record[field];
  const status = record[`${field}Status`];
  assert.ok(status === "parsed" || status === "nil", `${field} must be resolved`);
  assert.ok(Number.isSafeInteger(value) && value >= 0, `${field} must be non-negative rupees`);
  if (status === "nil") assert.equal(value, 0, `${field} nil must be zero`);
}

test("candidate shards and winners satisfy the release-wide identity and money contract", async () => {
  const [index, winners] = await Promise.all([
    readFile(new URL("candidates/index.json", dataUrl), "utf8").then(JSON.parse),
    readFile(new URL("adr-winner-archive.json", dataUrl), "utf8").then(JSON.parse),
  ]);
  const elections = index.states.flatMap((state) => state.elections);
  const shards = await Promise.all(elections.map(async (election) => {
    const shard = JSON.parse(await readFile(new URL(election.file.replace(/^\/data\//, ""), dataUrl), "utf8"));
    assert.equal(shard.meta.electionFolder, election.electionFolder);
    assert.equal(shard.meta.candidateCount, shard.records.length);
    assert.equal(shard.meta.sourceRowsComplete, true);
    assert.equal(shard.meta.profileEnrichmentComplete, true);
    assert.equal(new Set(shard.records.map((record) => record.ordinal)).size, shard.records.length);
    assert.equal(Math.max(...shard.records.map((record) => record.ordinal)), shard.records.length);
    return shard;
  }));

  const candidates = new Map();
  let candidateCount = 0;
  for (const shard of shards) {
    for (const record of shard.records) {
      const key = `${shard.meta.electionFolder.toLowerCase()}|${record.candidateId}`;
      assert.equal(candidates.has(key), false, `duplicate candidate ${key}`);
      assertMoney(record, "assets");
      assertMoney(record, "liabilities");
      if (record.electionType === "by-election") {
        assert.match(record.electionDate, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(record.electionYear, Number(record.electionDate.slice(0, 4)));
      }
      candidates.set(key, record);
      candidateCount += 1;
    }
  }
  assert.equal(candidateCount, index.meta.candidateRecords);

  let conflictRecords = 0;
  let conflictFields = 0;
  for (const winner of winners.records) {
    const key = `${winner.electionFolder.toLowerCase()}|${winner.candidateId}`;
    const candidate = candidates.get(key);
    assert.ok(candidate, `winner missing candidate ${key}`);
    assertMoney(winner, "assets");
    assertMoney(winner, "liabilities");
    assert.equal(winner.assets, candidate.assets, `${key} assets differ after reconciliation`);
    assert.equal(winner.liabilities, candidate.liabilities, `${key} liabilities differ after reconciliation`);
    if (winner.moneyConflicts) {
      conflictRecords += 1;
      for (const [field, conflict] of Object.entries(winner.moneyConflicts)) {
        conflictFields += 1;
        assert.notEqual(conflict.winnerSummary.value, conflict.candidateArchive.value);
        assert.equal(conflict.candidateArchive.value, winner[field]);
      }
    }
  }
  assert.equal(conflictRecords, winners.meta.moneyConflictRecords);
  assert.equal(conflictFields, winners.meta.moneyConflictFields);
});
