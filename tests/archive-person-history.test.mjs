import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSafeAssetTrail,
  buildSittingHistoryEntry,
  findUniqueWinnerMatch,
  normalizeArchiveName,
} from "../scripts/lib/archive-person-history.mjs";

test("normalizes archive names like profile history", () => {
  assert.equal(normalizeArchiveName("  Anumula  Revanth  Reddy "), "anumula reddy revanth");
  assert.equal(
    normalizeArchiveName("Chandrababu Naidu Nara"),
    normalizeArchiveName("Nara Chandra Babu Naidu"),
  );
  assert.equal(
    normalizeArchiveName("Nara Chandrababu Naidu"),
    normalizeArchiveName("Chandrababu Naidu Nara"),
  );
});

test("builds a trail when dual candidacies share assets in one year", () => {
  const trail = buildSafeAssetTrail([
    { year: 2023, assets: 100, sourceUrl: "a", constituency: "KAMAREDDY", state: "Telangana" },
    { year: 2023, assets: 100, sourceUrl: "b", constituency: "KODANGAL", state: "Telangana" },
    { year: 2018, assets: 80, sourceUrl: "c", constituency: "KODANGAL", state: "Telangana" },
  ], { year: 2023, constituency: "KODANGAL" });

  assert.deepEqual(trail.map((point) => [point.year, point.assets, point.constituency]), [
    [2018, 80, "KODANGAL"],
    [2023, 100, "KODANGAL"],
  ]);
  assert.equal(trail.at(-1).sourceUrl, "b");
});

test("refuses nothing whole-trail when an older year conflicts without a preferred seat", () => {
  assert.equal(buildSafeAssetTrail([
    { year: 2023, assets: 100, sourceUrl: "a", constituency: "A" },
    { year: 2023, assets: 200, sourceUrl: "b", constituency: "B" },
  ]), null);
});

test("omits only the conflicted year when preference cannot resolve it", () => {
  const trail = buildSafeAssetTrail([
    { year: 2014, assets: 100, sourceUrl: "x", constituency: "OTHER A" },
    { year: 2014, assets: 200, sourceUrl: "y", constituency: "OTHER B" },
    { year: 2019, assets: 250, sourceUrl: "z", constituency: "HOME" },
    { year: 2024, assets: 300, sourceUrl: "now", constituency: "HOME" },
  ], { year: 2024, constituency: "HOME", assets: 300 });
  assert.deepEqual(trail.map((point) => point.year), [2019, 2024]);
});

test("resolves same-year dual candidacies by preferred constituency for any person", () => {
  const trail = buildSafeAssetTrail([
    { year: 2014, assets: 100, sourceUrl: "seat-a", constituency: "SEAT A", chamber: "lok_sabha" },
    { year: 2014, assets: 200, sourceUrl: "seat-b", constituency: "SEAT B", chamber: "lok_sabha" },
    { year: 2024, assets: 300, sourceUrl: "now", constituency: "SEAT B", chamber: "lok_sabha" },
  ], { year: 2024, constituency: "SEAT B", assets: 300 });
  assert.deepEqual(trail.map((point) => [point.year, point.assets, point.constituency]), [
    [2014, 200, "SEAT B"],
    [2024, 300, "SEAT B"],
  ]);
});

test("bridges Telangana sitting records across Andhra Pradesh and Lok Sabha rows", () => {
  const winner = {
    state: "Telangana",
    electionYear: 2023,
    assets: 300498852,
    name: "Anumula Revanth Reddy",
    electionFolder: "Telangana2023",
    candidateId: 141,
    candidateUrl: "https://www.myneta.info/Telangana2023/candidate.php?candidate_id=141",
  };
  const entry = buildSittingHistoryEntry({
    snapshotRecord: {
      rank: 448,
      name: "Anumula Revanth Reddy",
      state: "Telangana",
      electionYear: 2023,
      constituency: "KODANGAL",
      assets: 300498852,
    },
    winnerMatch: winner,
    candidacyRows: [
      { normalizedName: normalizeArchiveName("Anumula Revanth Reddy"), year: 2009, assets: 36383123, sourceUrl: "ap", state: "Andhra Pradesh", electionState: "Andhra Pradesh", constituency: "KODANGAL", chamber: "assembly" },
      { normalizedName: normalizeArchiveName("Anumula Revanth Reddy"), year: 2014, assets: 131278897, sourceUrl: "t14", state: "Telangana", electionState: "Telangana", constituency: "KODANGAL", chamber: "assembly" },
      { normalizedName: normalizeArchiveName("Anumula Revanth Reddy"), year: 2018, assets: 213982320, sourceUrl: "t18", state: "Telangana", electionState: "Telangana", constituency: "KODANGAL", chamber: "assembly" },
      { normalizedName: normalizeArchiveName("Anumula Revanth Reddy"), year: 2019, assets: 245357182, sourceUrl: "ls", state: "Telangana", electionState: "Lok Sabha", constituency: "MALKAJGIRI", chamber: "lok_sabha" },
      { normalizedName: normalizeArchiveName("Anumula Revanth Reddy"), year: 2023, assets: 300498852, sourceUrl: "kam", state: "Telangana", electionState: "Telangana", constituency: "KAMAREDDY", chamber: "assembly" },
      { normalizedName: normalizeArchiveName("Anumula Revanth Reddy"), year: 2023, assets: 300498852, sourceUrl: "kod", state: "Telangana", electionState: "Telangana", constituency: "KODANGAL", chamber: "assembly" },
    ],
  });

  assert.deepEqual(entry.points.map((point) => point.year), [2009, 2014, 2018, 2019, 2023]);
  assert.equal(entry.points.at(-1).constituency, "KODANGAL");
  assert.equal(findUniqueWinnerMatch({
    name: "Anumula Revanth Reddy",
    state: "Telangana",
    electionYear: 2023,
    assets: 300498852,
  }, [winner])?.candidateId, 141);
});
