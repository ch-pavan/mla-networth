#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ARCHIVE_PARSER_VERSION,
  createLimiter,
  hasContiguousRanks,
  reconcileWinnerMoney,
  summaryUrl,
  writeJsonAtomic,
} from "./lib/archive-generation.mjs";
import { loadElectionManifest } from "./lib/election-manifest.mjs";
import { deobfuscateMynetaHtml } from "./lib/myneta-html.mjs";
import {
  countMynetaRecordStatuses,
  decodeMynetaCell,
  parseMynetaConstituencyLabel,
  parseMynetaMoneyCell,
} from "./lib/myneta-records.mjs";

const reviewedManifest = await loadElectionManifest();
const elections = reviewedManifest.elections
  .map((entry) => ({ ...entry, year: entry.year }))
  .sort((left, right) => left.state.localeCompare(right.state) || left.year - right.year);
const requestLimit = createLimiter(8);
const normalize = (value) => value
  .normalize("NFKD")
  .replace(/[.']/g, "")
  .replace(/[^a-zA-Z0-9]+/g, " ")
  .trim()
  .toLowerCase();

function winnerSummaryUrl(election, page) {
  return summaryUrl(election, page, {
    sort: "asset",
    subAction: "winner_analyzed",
  });
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function getSummaryPage(task, attempt = 1) {
  const url = winnerSummaryUrl(task, task.page);
  try {
    return await requestLimit(async () => {
      const response = await fetch(url, {
        headers: { "user-agent": "NetaWorth public-interest data index; source attribution included" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      return {
        ...task,
        url,
        status: response.status,
        html,
        sha256: createHash("sha256").update(html).digest("hex"),
      };
    });
  } catch (error) {
    if (attempt >= 3) {
      throw new Error(`Failed to fetch ${url} after ${attempt} attempts`, { cause: error });
    }
    await sleep(attempt * 1_000);
    return getSummaryPage(task, attempt + 1);
  }
}

function parsePage(page) {
  const rows = [];
  const html = deobfuscateMynetaHtml(page.html);
  for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 8 || !/^\d+$/.test(decodeMynetaCell(cells[0]))) continue;
    const candidateId = Number(cells[1].match(/candidate_id=(\d+)/i)?.[1] ?? 0);
    const name = decodeMynetaCell(cells[1]);
    if (!candidateId || !name) continue;

    const constituency = decodeMynetaCell(cells[2]);
    const constituencyDetails = parseMynetaConstituencyLabel(constituency, page.year);
    const assets = parseMynetaMoneyCell(cells[6]);
    const liabilities = parseMynetaMoneyCell(cells[7]);
    rows.push({
      state: page.state,
      electionYear: constituencyDetails.electionYear,
      electionDate: constituencyDetails.electionDate,
      electionType: constituencyDetails.electionType,
      electionFolder: page.folder,
      rankByAssets: Number(decodeMynetaCell(cells[0])),
      candidateId,
      name,
      normalizedName: normalize(name),
      constituency,
      baseConstituency: constituencyDetails.baseConstituency,
      normalizedConstituency: normalize(constituencyDetails.baseConstituency),
      party: decodeMynetaCell(cells[3]),
      criminalCases: Number((decodeMynetaCell(cells[4]).match(/\d+/) ?? [0])[0]),
      education: decodeMynetaCell(cells[5]),
      assets: assets.value,
      assetsStatus: assets.status,
      assetsSource: "winner-summary",
      liabilities: liabilities.value,
      liabilitiesStatus: liabilities.status,
      liabilitiesSource: "winner-summary",
      candidateUrl: candidateProfileUrlForRecord(page, candidateId),
    });
  }
  return rows;
}

function candidateProfileUrlForRecord(election, candidateId) {
  const url = new URL(election.indexUrl);
  url.pathname = url.pathname.replace(/index\.php$/, "candidate.php");
  url.searchParams.set("candidate_id", String(candidateId));
  return url.toString();
}

async function loadCandidateMoneyIndex() {
  const index = new Map();
  for (const election of elections) {
    const shardFile = new URL(
      `../public/data/candidates/${election.folder.toLowerCase()}.json`,
      import.meta.url,
    );
    let shard;
    try {
      shard = JSON.parse(await readFile(shardFile, "utf8"));
    } catch (error) {
      throw new Error(
        `Candidate shard ${election.folder.toLowerCase()}.json is required; run npm run data:candidates first`,
        { cause: error },
      );
    }
    if (
      shard.meta?.parserVersion !== ARCHIVE_PARSER_VERSION
      || shard.meta?.profileEnrichmentComplete !== true
      || shard.meta?.sourceRowsComplete !== true
    ) {
      throw new Error(
        `Candidate shard ${election.folder.toLowerCase()}.json is stale or incomplete; run npm run data:candidates first`,
      );
    }
    for (const record of shard.records) {
      const key = `${election.folder.toLowerCase()}|${record.candidateId}`;
      if (index.has(key)) throw new Error(`Duplicate candidate archive key ${key}`);
      index.set(key, record);
    }
  }
  return index;
}

const candidateMoneyIndex = await loadCandidateMoneyIndex();
const firstPages = await Promise.all(elections.map((election) => getSummaryPage({ ...election, page: 1 })));
const remaining = [];
for (const page of firstPages) {
  const pageCount = Number(
    page.html.match(/Showing page\s*<b>\d+<\/b>\s*of\s*<strong>(\d+)<\/strong>/i)?.[1]
      ?? (parsePage(page).length ? 1 : 0),
  );
  for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
    remaining.push({ ...page, html: undefined, sha256: undefined, page: pageNumber });
  }
}
const pages = [...firstPages, ...await Promise.all(remaining.map((task) => getSummaryPage(task)))];
const parsedRecords = [];
const seen = new Set();
for (const page of pages) {
  for (const row of parsePage(page)) {
    const key = `${row.electionFolder.toLowerCase()}|${row.candidateId}`;
    if (!seen.has(key)) {
      seen.add(key);
      parsedRecords.push(row);
    }
  }
}

const records = parsedRecords.map((winner) => reconcileWinnerMoney(
  winner,
  candidateMoneyIndex.get(`${winner.electionFolder.toLowerCase()}|${winner.candidateId}`),
));
records.sort(
  (left, right) => left.state.localeCompare(right.state)
    || left.electionYear - right.electionYear
    || left.constituency.localeCompare(right.constituency),
);

const coverage = elections.map((election) => {
  const subset = records.filter(
    (record) => record.electionFolder.toLowerCase() === election.folder.toLowerCase(),
  );
  const sourcePages = pages.filter(
    (page) => page.folder.toLowerCase() === election.folder.toLowerCase(),
  );
  const expectedFromOrdinals = Math.max(0, ...subset.map((record) => record.rankByAssets));
  const sourceRowsComplete = hasContiguousRanks(subset, "rankByAssets");
  return {
    state: election.state,
    year: election.year,
    folder: election.folder,
    manifestAvailabilityAtReview: election.availability,
    winnerCount: subset.length,
    expectedFromOrdinals,
    sourceRowsComplete,
    complete: sourceRowsComplete,
    pageCount: sourcePages.length,
    sourceSha256: createHash("sha256").update(sourcePages.map((page) => page.sha256).join("|")).digest("hex"),
    sourceUrl: winnerSummaryUrl(election, 1),
  };
});
const incomplete = coverage.filter((election) => !election.sourceRowsComplete);
if (incomplete.length) {
  throw new Error(
    `Refusing to write an incomplete winner archive: ${incomplete.map((election) => `${election.folder} (${election.winnerCount}/${election.expectedFromOrdinals})`).join(", ")}`,
  );
}

const years = records.map((record) => record.electionYear);
const payload = {
  meta: {
    title: "India state assembly winner archive",
    source: "Association for Democratic Reforms / MyNeta",
    retrievedAt: new Date().toISOString(),
    parserVersion: ARCHIVE_PARSER_VERSION,
    manifestSchemaVersion: reviewedManifest.schemaVersion,
    manifestReviewedAt: reviewedManifest.review.reviewedAt,
    electionFolders: elections.length,
    electionsWithWinners: coverage.filter((election) => election.winnerCount).length,
    completeElectionFolders: coverage.filter((election) => election.sourceRowsComplete).length,
    winnerRecords: records.length,
    byElectionRecords: records.filter((record) => record.electionType === "by-election").length,
    moneyStatusCounts: countMynetaRecordStatuses(records),
    candidateArchiveCrossCheckComplete: true,
    states: new Set(records.map((record) => record.state)).size,
    firstYear: Math.min(...years),
    latestYear: Math.max(...years),
    note: "Winner records are imported from the reviewed election manifest and MyNeta winner summaries. Money is cross-checked against the regenerated candidate archive by election folder and candidate ID; candidate values are authoritative, and conflicting definitive amounts fail generation. Unavailable values remain null rather than becoming zero.",
  },
  coverage,
  records,
};
await writeJsonAtomic("public/data/adr-winner-archive.json", payload);
console.log(JSON.stringify(payload.meta, null, 2));
