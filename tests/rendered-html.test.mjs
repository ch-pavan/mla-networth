import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./archive-generation.test.mjs";
import "./archive-integrity.test.mjs";
import "./data-parsers.test.mjs";
import "./election-manifest.test.mjs";
import "./format-money.test.mjs";
import "./geo-map.test.mjs";
import "./import-affidavits.test.mjs";
import "./mp-data-integrity.test.mjs";
import "./profile-history.test.mjs";
import "./winner-history.test.mjs";

test("ships the NetaWorth product experience", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Declared assets of India/i);
  assert.match(layout, /application\/ld\+json/);
  assert.match(layout, /schema\.org/);
  assert.match(page, /India&apos;s most ambitious public record/);
  assert.match(page, /switchChamber\("all"\)/);
  assert.match(page, /All India/);
  assert.match(page, /The wealth table/);
  assert.match(page, /Declared assets over time/);
  assert.match(page, /State of wealth/);
  assert.match(page, /Signals in the declarations/);
  assert.match(page, /Public records/);
  assert.match(page, /selectAssetHistory/);
  assert.match(page, /Load more representatives/);
  assert.match(page, /IntersectionObserver/);
  assert.doesNotMatch(page, /const mlaData/);
  assert.doesNotMatch(page, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships source links and appropriate data caveats", async () => {
  const [page, about] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/about/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /https:\/\/affidavit\.eci\.gov\.in\//);
  assert.match(page, /https:\/\/www\.myneta\.info\//);
  assert.match(about, /self-sworn election affidavit/);
  assert.match(about, /not an independently audited estimate of market wealth/);
  assert.match(page, /snapshot\?\.meta\.recordCount\?\?4092/);
  assert.match(page, /archive\?\.meta\.winnerRecords\?\?17785/);
  assert.match(page, /MyNeta-analyzed records imported from discovered election folders/);
  assert.match(page, /ambiguous same-label winner groups are omitted/);
  assert.doesNotMatch(page, /COMPLETE DATABASE|Every candidate affidavit|ELECTIONS COMPLETE|One seat\. Every election|every source page decoded/i);
});

test("ships the complete ADR 2025 sitting-MLA appendix", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../public/data/adr-sitting-mlas-2025.json", import.meta.url), "utf8"));
  assert.equal(snapshot.meta.recordCount, 4092);
  assert.equal(snapshot.records.length, 4092);
  assert.equal(new Set(snapshot.records.map((row) => row.rank)).size, 4092);
  assert.deepEqual([snapshot.records[0].rank, snapshot.records.at(-1).rank], [1, 4092]);
  assert.equal(new Set(snapshot.records.map((row) => row.state)).size, 31);
  assert.ok(snapshot.records.every((row) => row.name && row.constituency && row.state && row.assets >= 0));
});

test("ships national two-election wealth comparisons", async () => {
  const history = JSON.parse(await readFile(new URL("../public/data/adr-recontest-history.json", import.meta.url), "utf8"));
  assert.equal(history.meta.parserVersion, 2);
  assert.equal(history.meta.statesRequested, 31);
  assert.equal(history.meta.manifestElectionFolders, 135);
  assert.equal(history.meta.electionPagesChecked, 146);
  assert.equal(history.meta.electionPagesAvailable, 99);
  assert.equal(history.meta.completeElectionPages, 146);
  assert.equal(history.meta.comparisonCount, 10243);
  assert.equal(history.comparisons.length, 10243);
  assert.equal(history.meta.snapshotMatchCount, 1604);
  assert.equal(history.meta.profileEligibleSnapshotMatchCount, 1521);
  assert.deepEqual([history.meta.firstYear, history.meta.latestYear], [2004, 2025]);
  assert.ok(history.elections.every((election) => election.complete));
  assert.ok(history.elections.every((election) => election.parsedComparisonCount === election.expectedFromRanks));
  assert.ok(history.elections.every((election) => election.unresolvedPackedScriptCount === 0));
  assert.ok(history.comparisons.every((row) => row.previousYear < row.currentYear));
  assert.ok(history.comparisons.every((row) => row.currentAssets >= 0 && row.previousAssets >= 0));
  assert.ok(history.comparisons.every((row) => row.assetChange === row.currentAssets - row.previousAssets));
  assert.ok(history.comparisons.every((row) => row.percentChangeStatus === "parsed" || row.percentChangeStatus === "missing"));
  assert.ok(history.comparisons.filter((row) => row.identityReviewReason === "pan-different").every((row) => !row.eligibleForProfileHistory));
  assert.ok(history.comparisons.every((row) => row.comparisonUrl.startsWith("https://www.myneta.info/")));
});

test("ships archive-stitched sitting MLA asset histories", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../public/data/adr-sitting-mlas-2025.json", import.meta.url), "utf8"));
  const histories = JSON.parse(await readFile(new URL("../public/data/sitting-mla-asset-histories.json", import.meta.url), "utf8"));
  assert.ok(histories.meta.assemblyRecords >= 3500);
  assert.ok(histories.meta.assemblyMultiYearRecords >= 1900);
  assert.ok(histories.meta.lokSabhaRecords >= 400);
  const revanth = snapshot.records.find((row) => /anumula revanth reddy/i.test(row.name));
  assert.ok(revanth);
  const trail = histories.assembly[String(revanth.rank)];
  assert.deepEqual(trail.points.map((point) => point.year), [2009, 2014, 2018, 2019, 2023]);
  assert.equal(trail.points.at(-1).assets, revanth.assets);

  const naidu = snapshot.records.find((row) => /chandrababu naidu nara/i.test(row.name));
  assert.ok(naidu);
  assert.deepEqual(
    histories.assembly[String(naidu.rank)].points.map((point) => point.year),
    [2014, 2019, 2024],
  );

  const ls = JSON.parse(await readFile(new URL("../public/data/lok-sabha-sitting-mps.json", import.meta.url), "utf8"));
  const modi = ls.records.find((row) => /narendra modi/i.test(row.name));
  assert.ok(modi);
  assert.deepEqual(
    histories.lok_sabha[String(modi.rank)].points.map((point) => point.year),
    [2012, 2014, 2019, 2024],
  );
});

test("ships the historical constituency-winner archive", async () => {
  const archive = JSON.parse(await readFile(new URL("../public/data/adr-winner-archive.json", import.meta.url), "utf8"));
  assert.equal(archive.meta.electionFolders, 135);
  assert.equal(archive.meta.electionsWithWinners, 135);
  assert.equal(archive.meta.parserVersion, 5);
  assert.equal(archive.meta.completeElectionFolders, 135);
  assert.equal(archive.meta.winnerRecords, 17785);
  assert.equal(archive.records.length, archive.meta.winnerRecords);
  assert.equal(archive.meta.states, 31);
  assert.deepEqual([archive.meta.firstYear, archive.meta.latestYear], [2004, 2026]);
  assert.equal(archive.meta.byElectionRecords, 29);
  assert.equal(archive.meta.moneyConflictRecords, 152);
  assert.equal(archive.meta.moneyConflictFields, 152);
  assert.equal(new Set(archive.records.map((row) => `${row.electionFolder}|${row.candidateId}`)).size, archive.meta.winnerRecords);
  assert.ok(archive.coverage.every((election) => election.complete && election.winnerCount === election.expectedFromOrdinals));
  assert.ok(archive.records.every((row) => row.name && row.constituency && row.candidateUrl.startsWith("https://www.myneta.info/")));
});

test("ships the complete sharded candidate-affidavit archive", async () => {
  const index = JSON.parse(await readFile(new URL("../public/data/candidates/index.json", import.meta.url), "utf8"));
  const elections = index.states.flatMap((state) => state.elections);
  assert.equal(index.meta.parserVersion, 5);
  assert.equal(index.meta.electionFolders, 136);
  assert.equal(index.meta.completeElectionFolders, 136);
  assert.equal(index.meta.candidateRecords, 181307);
  assert.equal(index.meta.states, 32);
  assert.deepEqual([index.meta.firstYear, index.meta.latestYear], [2004, 2026]);
  assert.equal(index.meta.byElectionRecords, 186);
  assert.equal(index.meta.profileEnrichmentTargets, 20082);
  assert.equal(index.meta.profileEnrichmentComplete, true);
  assert.equal(elections.length, 136);
  assert.ok(elections.every((election) => election.sourceRowsComplete && election.profileEnrichmentComplete && election.candidateCount === election.expectedFromOrdinals));
  assert.equal(elections.reduce((sum, election) => sum + election.candidateCount, 0), 181307);
  assert.ok(index.states.some((state) => state.state === "Lok Sabha"));
});

test("opens people on a dedicated internal profile route", async () => {
  const [home, person] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/person/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /\/person\?type=current&chamber=assembly&rank=/);
  assert.match(home, /\/person\?type=candidate&election=/);
  assert.match(person, /CANDIDATE AFFIDAVIT PROFILE/);
  assert.match(person, /SITTING MLA PROFILE/);
  assert.match(person, /Declared assets over time/);
  assert.match(person, /Return to NetaWorth|Database/);
  assert.match(person, /selectAssetHistory/);
  assert.match(person, /Only the selected candidate affidavit is shown/);
  assert.doesNotMatch(person, /Promise\.all\(elections\.map/);
});
