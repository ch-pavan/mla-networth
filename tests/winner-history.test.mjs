import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const helperSource = await readFile(new URL("../lib/winner-history.ts", import.meta.url), "utf8");
const helperModule = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(helperSource)).toString("base64")}`);
const { buildDisplayableSeatHistories, compareWinnerElections, hasAmbiguousSeatLineage } = helperModule;

const winner = (overrides = {}) => ({
  state: "Bihar",
  normalizedConstituency: "pipra",
  electionFolder: "bihar2020",
  electionYear: 2020,
  ...overrides,
});

test("quarantines a same-label group with two winners in one source election", () => {
  const records = [winner(), winner({candidateId: 2})];

  assert.equal(hasAmbiguousSeatLineage(records), true);
  assert.deepEqual(buildDisplayableSeatHistories(records), []);
});

test("quarantines duplicate election dates even when folder labels differ", () => {
  const records = [
    winner({electionFolder: "bihar2020", electionDate: "2020-11-10"}),
    winner({electionFolder: "bihbye2020", electionDate: "2020-11-10"}),
  ];

  assert.equal(hasAmbiguousSeatLineage(records), true);
});

test("keeps distinct dated elections in one folder and sorts by record-level date and year", () => {
  const records = [
    winner({electionFolder: "karnataka2023", electionYear: 2026, electionDate: "2026-02-10"}),
    winner({electionFolder: "karnataka2023", electionYear: 2023, electionDate: "2023-05-13"}),
    winner({electionFolder: "karnataka2018", electionYear: 2018}),
  ];

  assert.equal(hasAmbiguousSeatLineage(records), false);
  assert.deepEqual(
    buildDisplayableSeatHistories(records)[0].map((record) => record.electionYear),
    [2018, 2023, 2026],
  );
  assert.ok(compareWinnerElections(records[1], records[0]) < 0);
});

test("keeps independent state and constituency-label groups separate", () => {
  const records = [
    winner(),
    winner({state: "Gujarat", electionFolder: "gujarat2022"}),
    winner({normalizedConstituency: "pipra sc", electionFolder: "bihar2015", electionYear: 2015}),
  ];

  assert.equal(buildDisplayableSeatHistories(records).length, 3);
});
