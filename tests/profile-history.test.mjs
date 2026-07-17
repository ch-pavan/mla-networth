import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const helperSource = await readFile(new URL("../lib/profile-history.ts", import.meta.url), "utf8");
const helperModule = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(helperSource)).toString("base64")}`);
const { buildVerifiedAssetHistory, normalizePersonName } = helperModule;

const comparison = (overrides = {}) => ({
  state: "Karnataka",
  currentYear: 2024,
  previousYear: 2019,
  name: "D. K. Shivakumar",
  normalizedName: "d k shivakumar",
  currentAssets: 300,
  previousAssets: 200,
  comparisonUrl: "https://www.myneta.info/newer-comparison",
  ...overrides,
});

const anchor = {
  state: "Karnataka",
  electionYear: 2024,
  name: "D. K. Shivakumar",
  assets: 300,
  sourceUrl: "https://adrindia.org/report.pdf",
};

test("normalizes filed names consistently", () => {
  assert.equal(normalizePersonName("  D. K.  Shivakumár's  "), "d k shivakumars");
});

test("builds only an exact-asset contiguous history anchored to the current record", () => {
  const history = buildVerifiedAssetHistory(anchor, [
    comparison({currentYear:2019,previousYear:2014,currentAssets:200,previousAssets:100,comparisonUrl:"https://www.myneta.info/older-comparison"}),
    comparison({currentAssets:301,previousAssets:1}),
    comparison({state:"Tamil Nadu"}),
    comparison(),
  ]);

  assert.deepEqual(history.map((point) => [point.year, point.assets]), [[2014,100],[2019,200],[2024,300]]);
  assert.equal(history.at(-1).sourceUrl, "https://www.myneta.info/newer-comparison");
});

test("stops when the next comparison does not continue the exact asset value", () => {
  const history = buildVerifiedAssetHistory(anchor, [
    comparison(),
    comparison({currentYear:2019,previousYear:2014,currentAssets:201,previousAssets:100}),
  ]);

  assert.deepEqual(history.map((point) => [point.year, point.assets]), [[2019,200],[2024,300]]);
});

test("refuses to guess when an exact comparison link is ambiguous", () => {
  const history = buildVerifiedAssetHistory(anchor, [
    comparison(),
    comparison({comparisonUrl:"https://www.myneta.info/duplicate"}),
  ]);

  assert.deepEqual(history, [{year:2024,assets:300,sourceUrl:"https://adrindia.org/report.pdf"}]);
});
