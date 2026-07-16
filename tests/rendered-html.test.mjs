import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the NetaWorth product experience", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /NetaWorth — Follow the money\. Know your neta\./i);
  assert.match(page, /India&apos;s most ambitious public record/);
  assert.match(page, /The wealth table/);
  assert.match(page, /Declared assets over time/);
  assert.match(page, /State of wealth/);
  assert.match(page, /Signals in the declarations/);
  assert.match(page, /Public records/);
  assert.match(page, /D\. K\. Shivakumar/);
  assert.doesNotMatch(page, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships source links and appropriate data caveats", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /https:\/\/affidavit\.eci\.gov\.in\//);
  assert.match(page, /https:\/\/www\.myneta\.info\//);
  assert.match(page, /self-sworn election affidavit/);
  assert.match(page, /not independently audited market wealth/);
  assert.match(page, /It also contains 4,092 sitting MLAs/);
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
  assert.equal(history.meta.statesRequested, 31);
  assert.equal(history.meta.electionPagesChecked, 121);
  assert.equal(history.meta.electionPagesAvailable, 94);
  assert.equal(history.meta.comparisonCount, 7723);
  assert.equal(history.comparisons.length, 7723);
  assert.equal(history.meta.snapshotMatchCount, 1376);
  assert.deepEqual([history.meta.firstYear, history.meta.latestYear], [2004, 2025]);
  assert.ok(history.comparisons.every((row) => row.previousYear < row.currentYear));
  assert.ok(history.comparisons.every((row) => row.currentAssets >= 0 && row.previousAssets >= 0));
  assert.ok(history.comparisons.every((row) => row.comparisonUrl.startsWith("https://www.myneta.info/")));
});

test("ships the historical constituency-winner archive", async () => {
  const archive = JSON.parse(await readFile(new URL("../public/data/adr-winner-archive.json", import.meta.url), "utf8"));
  assert.equal(archive.meta.electionFolders, 121);
  assert.equal(archive.meta.electionsWithWinners, 121);
  assert.equal(archive.meta.winnerRecords, 13916);
  assert.equal(archive.records.length, 13916);
  assert.equal(archive.meta.states, 31);
  assert.deepEqual([archive.meta.firstYear, archive.meta.latestYear], [2004, 2025]);
  assert.equal(new Set(archive.records.map((row) => `${row.electionFolder}|${row.candidateId}`)).size, 13916);
  assert.ok(archive.records.every((row) => row.name && row.constituency && row.candidateUrl.startsWith("https://www.myneta.info/")));
});

test("ships the complete sharded candidate-affidavit archive", async () => {
  const index = JSON.parse(await readFile(new URL("../public/data/candidates/index.json", import.meta.url), "utf8"));
  const elections = index.states.flatMap((state) => state.elections);
  assert.equal(index.meta.parserVersion, 3);
  assert.equal(index.meta.electionFolders, 121);
  assert.equal(index.meta.completeElectionFolders, 121);
  assert.equal(index.meta.candidateRecords, 153470);
  assert.equal(index.meta.states, 31);
  assert.deepEqual([index.meta.firstYear, index.meta.latestYear], [2004, 2025]);
  assert.equal(elections.length, 121);
  assert.ok(elections.every((election) => election.complete && election.candidateCount === election.expectedFromOrdinals));
  assert.equal(elections.reduce((sum, election) => sum + election.candidateCount, 0), 153470);
});

test("opens people on a dedicated internal profile route", async () => {
  const [home, person] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/person/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /\/person\?type=current&rank=/);
  assert.match(home, /\/person\?type=candidate&election=/);
  assert.match(person, /CANDIDATE AFFIDAVIT PROFILE/);
  assert.match(person, /SITTING MLA PROFILE/);
  assert.match(person, /Declared assets over time/);
  assert.match(person, /Back to database/);
});
