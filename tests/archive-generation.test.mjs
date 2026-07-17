import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  applyCandidateProfileMoney,
  createLimiter,
  fetchCandidateProfileMoney,
  hasContiguousRanks,
  parseCandidateProfileMoney,
  reconcileWinnerMoney,
  summaryUrl,
} from "../scripts/lib/archive-generation.mjs";

const election = {
  folder: "ap09",
  indexUrl: "https://www.myneta.info/ap09/index.php",
};

test("builds summary URLs from the reviewed manifest URL", () => {
  assert.equal(
    summaryUrl(election, 3, { sort: "candidate", subAction: "candidates_analyzed" }),
    "https://www.myneta.info/ap09/index.php?action=summary&page=3&sort=candidate&subAction=candidates_analyzed",
  );
});

test("parses only the exact top-level candidate profile money rows", () => {
  const parsed = parseCandidateProfileMoney(`
    <table>
      <tr><td>Spouse Assets:</td><td><b>Rs 99,99,999</b></td></tr>
      <tr><td> Assets: </td><td><b>Rs&nbsp;8,07,99,785</b><br>~ 8 Crore+</td></tr>
      <tr><td>Liabilities:</td><td><b>Rs 11,40,668</b></td></tr>
    </table>
  `);
  assert.deepEqual(parsed.assets, {
    value: 80_799_785,
    status: "parsed",
    raw: "Rs 8,07,99,785 ~ 8 Crore+",
  });
  assert.deepEqual(parsed.liabilities, {
    value: 1_140_668,
    status: "parsed",
    raw: "Rs 11,40,668",
  });
});

test("profile enrichment preserves known summaries and resolves unknown fields", () => {
  const record = {
    assets: null,
    assetsStatus: "masked",
    assetsSource: "summary",
    liabilities: 0,
    liabilitiesStatus: "nil",
    liabilitiesSource: "summary",
  };
  const enriched = applyCandidateProfileMoney(record, {
    assets: { value: 35_626_923, status: "parsed", raw: "Rs 3,56,26,923" },
    liabilities: { value: 5, status: "parsed", raw: "Rs 5" },
  });
  assert.deepEqual(enriched, {
    assets: 35_626_923,
    assetsStatus: "parsed",
    assetsSource: "candidate-profile",
    liabilities: 0,
    liabilitiesStatus: "nil",
    liabilitiesSource: "summary",
  });

  assert.deepEqual(
    applyCandidateProfileMoney(record, null, false),
    {
      ...record,
      assetsSource: "unavailable",
      liabilitiesSource: "summary",
    },
  );
});

test("winner money uses the candidate archive and records definitive source conflicts", () => {
  const winner = {
    electionFolder: "ap09",
    candidateId: 138,
    assets: null,
    assetsStatus: "masked",
    assetsSource: "winner-summary",
    liabilities: 130_000,
    liabilitiesStatus: "parsed",
    liabilitiesSource: "winner-summary",
  };
  const candidate = {
    assets: 3_238_000,
    assetsStatus: "parsed",
    liabilities: 130_000,
    liabilitiesStatus: "parsed",
  };
  assert.deepEqual(reconcileWinnerMoney(winner, candidate), {
    ...winner,
    assets: 3_238_000,
    assetsStatus: "parsed",
    assetsSource: "candidate-archive",
    liabilitiesSource: "candidate-archive",
  });

  const conflict = reconcileWinnerMoney(
    { ...winner, assets: 7, assetsStatus: "parsed" },
    { ...candidate, assets: 8, assetsSource: "candidate-profile" },
  );
  assert.equal(conflict.assets, 8);
  assert.deepEqual(conflict.moneyConflicts.assets, {
    winnerSummary: { value: 7, status: "parsed" },
    candidateArchive: { value: 8, status: "parsed", source: "candidate-profile" },
  });

  const zeroConflict = reconcileWinnerMoney(
    { ...winner, assets: 0, assetsStatus: "nil" },
    { ...candidate, assets: 8 },
  );
  assert.equal(zeroConflict.moneyConflicts.assets.winnerSummary.value, 0);
  assert.throws(() => reconcileWinnerMoney(winner, null), /missing from the candidate archive/);
});

test("source ranks must be exactly one through the row count", () => {
  assert.equal(hasContiguousRanks([{ rank: 2 }, { rank: 1 }], "rank"), true);
  assert.equal(hasContiguousRanks([{ rank: 0 }, { rank: 2 }], "rank"), false);
  assert.equal(hasContiguousRanks([{ rank: 1 }, { rank: 3 }], "rank"), false);
  assert.equal(hasContiguousRanks([{ rank: 1 }, { rank: 1 }], "rank"), false);
  assert.equal(hasContiguousRanks([], "rank"), false);
});

test("candidate profile checkpoints are atomic, reusable, and retry transient failures", async () => {
  const cacheDirectory = await mkdtemp(`${tmpdir()}/netaworth-profile-cache-`);
  const cacheRoot = pathToFileURL(`${cacheDirectory}/`);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary network failure");
    return new Response(
      "<table><tr><td>Assets:</td><td>Rs 42</td></tr><tr><td>Liabilities:</td><td>NIL</td></tr></table>",
      { status: 200 },
    );
  };
  const options = {
    election,
    candidateId: 2138,
    cacheRoot,
    fetchImpl,
    sleep: async () => {},
  };
  const first = await fetchCandidateProfileMoney(options);
  assert.equal(calls, 2);
  assert.equal(first.cacheHit, false);
  assert.equal(first.money.assets.value, 42);
  assert.equal(first.money.liabilities.value, 0);

  const second = await fetchCandidateProfileMoney({
    ...options,
    fetchImpl: async () => {
      throw new Error("cache should prevent this call");
    },
  });
  assert.equal(second.cacheHit, true);
  assert.deepEqual(second.money, first.money);
});

test("request limiter never exceeds the configured concurrency", async () => {
  const limit = createLimiter(2);
  let active = 0;
  let maximum = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const work = Array.from({ length: 5 }, () => limit(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await gate;
    active -= 1;
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 2);
  release();
  await Promise.all(work);
  assert.equal(maximum, 2);
});
