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
  assert.match(page, /nationwide snapshot contains 4,092 sitting MLAs/);
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
