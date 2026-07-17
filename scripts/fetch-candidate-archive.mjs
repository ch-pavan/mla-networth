#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import {
  ARCHIVE_PARSER_VERSION,
  applyCandidateProfileMoney,
  createLimiter,
  fetchCandidateProfileMoney,
  hasContiguousRanks,
  needsCandidateProfile,
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
  sumMynetaRecordStatusCounts,
} from "./lib/myneta-records.mjs";

const reviewedManifest = await loadElectionManifest();
const elections = reviewedManifest.elections
  .map((entry) => ({ ...entry, year: entry.year }))
  .sort((left, right) => left.state.localeCompare(right.state) || left.year - right.year);
const outputDir = "public/data/candidates";
const profileCacheRoot = new URL("../work/myneta-profile-cache/", import.meta.url);
const requestLimit = createLimiter(8);
await mkdir(outputDir, { recursive: true });

const normalize = (value) => value
  .normalize("NFKD")
  .replace(/[.']/g, "")
  .replace(/[^a-zA-Z0-9]+/g, " ")
  .trim()
  .toLowerCase();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function candidateSummaryUrl(election, page) {
  return summaryUrl(election, page, {
    sort: "candidate",
    subAction: "candidates_analyzed",
  });
}

async function getSummaryPage(task, attempt = 1) {
  const url = candidateSummaryUrl(task, task.page);
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

async function getSummaryPages(tasks) {
  return Promise.all(tasks.map((task) => getSummaryPage(task)));
}

function parsePage(page) {
  const rows = [];
  const html = deobfuscateMynetaHtml(page.html);
  for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 8 || !/^\d+$/.test(decodeMynetaCell(cells[0]))) continue;

    const candidateId = Number(cells[1].match(/candidate_id=(\d+)/i)?.[1] ?? 0);
    const name = decodeMynetaCell(cells[1]);
    const constituency = decodeMynetaCell(cells[2]);
    if (!candidateId || !name || !constituency) continue;

    const constituencyDetails = parseMynetaConstituencyLabel(constituency, page.year);
    const assets = parseMynetaMoneyCell(cells[6]);
    const liabilities = parseMynetaMoneyCell(cells[7]);
    rows.push({
      ordinal: Number(decodeMynetaCell(cells[0])),
      candidateId,
      name,
      normalizedName: normalize(name),
      electionYear: constituencyDetails.electionYear,
      electionDate: constituencyDetails.electionDate,
      electionType: constituencyDetails.electionType,
      constituency,
      baseConstituency: constituencyDetails.baseConstituency,
      normalizedConstituency: normalize(constituencyDetails.baseConstituency),
      party: decodeMynetaCell(cells[3]),
      criminalCases: Number((decodeMynetaCell(cells[4]).match(/\d+/) ?? [0])[0]),
      education: decodeMynetaCell(cells[5]),
      assets: assets.value,
      assetsStatus: assets.status,
      assetsSource: "summary",
      liabilities: liabilities.value,
      liabilitiesStatus: liabilities.status,
      liabilitiesSource: "summary",
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

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function enrichRecord(record, election) {
  if (!needsCandidateProfile(record)) return record;
  const profile = await requestLimit(() => fetchCandidateProfileMoney({
    election,
    candidateId: record.candidateId,
    cacheRoot: profileCacheRoot,
  }));
  return applyCandidateProfileMoney(record, profile.money, profile.available);
}

async function processElection(election, position) {
  const file = `${outputDir}/${election.folder.toLowerCase()}.json`;
  if (await exists(file)) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8"));
      if (
        cached.meta.parserVersion === ARCHIVE_PARSER_VERSION
        && cached.meta.profileEnrichmentComplete === true
        && cached.meta.sourceRowsComplete === true
      ) {
        console.log(
          `[${position + 1}/${elections.length}] cached ${election.state} ${election.year}: ${cached.meta.candidateCount}`,
        );
        return cached.meta;
      }
    } catch {
      // A stale/interrupted shard is regenerated; atomic writes prevent future partial checkpoints.
    }
  }

  const first = await getSummaryPage({ ...election, page: 1 });
  const pageCount = Number(
    first.html.match(/Showing page\s*<b>\d+<\/b>\s*of\s*<strong>(\d+)<\/strong>/i)?.[1]
      ?? (parsePage(first).length ? 1 : 0),
  );
  const remainingTasks = Array.from(
    { length: Math.max(0, pageCount - 1) },
    (_, index) => ({ ...election, page: index + 2 }),
  );
  const pages = [first, ...await getSummaryPages(remainingTasks)];
  const parsedRecords = [];
  const seen = new Set();
  for (const page of pages) {
    for (const row of parsePage(page)) {
      if (!seen.has(row.candidateId)) {
        seen.add(row.candidateId);
        parsedRecords.push(row);
      }
    }
  }

  const enrichmentTargets = parsedRecords.filter(needsCandidateProfile).length;
  const records = await Promise.all(parsedRecords.map((record) => enrichRecord(record, election)));
  records.sort((left, right) => left.constituency.localeCompare(right.constituency) || left.name.localeCompare(right.name));

  const expectedFromOrdinals = Math.max(0, ...records.map((record) => record.ordinal));
  const sourceRowsComplete = hasContiguousRanks(records, "ordinal");
  if (!sourceRowsComplete) {
    throw new Error(
      `Refusing to write incomplete candidate shard ${election.folder}: ${records.length} rows, expected ranks 1-${expectedFromOrdinals}`,
    );
  }

  const years = records.map((record) => record.electionYear);
  const meta = {
    parserVersion: ARCHIVE_PARSER_VERSION,
    state: election.state,
    electionYear: election.year,
    electionFolder: election.folder,
    manifestAvailabilityAtReview: election.availability,
    candidateCount: records.length,
    expectedFromOrdinals,
    sourceRowsComplete,
    complete: sourceRowsComplete,
    profileEnrichmentTargets: enrichmentTargets,
    profileEnrichmentComplete: true,
    constituencyCount: new Set(records.map((record) => record.normalizedConstituency)).size,
    byElectionRecords: records.filter((record) => record.electionType === "by-election").length,
    moneyStatusCounts: countMynetaRecordStatuses(records),
    firstRecordYear: Math.min(...years),
    latestRecordYear: Math.max(...years),
    pageCount,
    sourceUrl: candidateSummaryUrl(election, 1),
    sourceSha256: createHash("sha256").update(pages.map((page) => page.sha256).join("|")).digest("hex"),
    retrievedAt: new Date().toISOString(),
    file: `/data/candidates/${election.folder.toLowerCase()}.json`,
  };
  await writeJsonAtomic(file, { meta, records });
  console.log(
    `[${position + 1}/${elections.length}] fetched ${election.state} ${election.year}: ${records.length} candidates / ${pageCount} pages / ${enrichmentTargets} profile checks`,
  );
  return meta;
}

let next = 0;
const archiveManifest = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (true) {
    const position = next;
    next += 1;
    if (position >= elections.length) return;
    archiveManifest.push(await processElection(elections[position], position));
  }
}));

archiveManifest.sort((left, right) => left.state.localeCompare(right.state) || left.electionYear - right.electionYear);
const total = archiveManifest.reduce((sum, election) => sum + election.candidateCount, 0);
const states = [...new Set(archiveManifest.map((election) => election.state))].sort();
const index = {
  meta: {
    title: "India state assembly candidate-affidavit archive",
    source: "Association for Democratic Reforms / MyNeta",
    retrievedAt: new Date().toISOString(),
    parserVersion: ARCHIVE_PARSER_VERSION,
    manifestSchemaVersion: reviewedManifest.schemaVersion,
    manifestReviewedAt: reviewedManifest.review.reviewedAt,
    electionFolders: archiveManifest.length,
    completeElectionFolders: archiveManifest.filter((election) => election.sourceRowsComplete).length,
    candidateRecords: total,
    byElectionRecords: archiveManifest.reduce((sum, election) => sum + election.byElectionRecords, 0),
    moneyStatusCounts: sumMynetaRecordStatusCounts(archiveManifest.map((election) => election.moneyStatusCounts)),
    profileEnrichmentTargets: archiveManifest.reduce((sum, election) => sum + election.profileEnrichmentTargets, 0),
    profileEnrichmentComplete: archiveManifest.every((election) => election.profileEnrichmentComplete),
    states: states.length,
    firstYear: Math.min(...archiveManifest.map((election) => election.firstRecordYear)),
    latestYear: Math.max(...archiveManifest.map((election) => election.latestRecordYear)),
    note: "Records are imported from the reviewed election manifest and MyNeta candidate summaries. JavaScript-obfuscated rows are decoded without executing source scripts. Masked or missing summary amounts are checked against the candidate's published Assets and Liabilities rows; definitive source unavailability remains null rather than becoming zero. Election shards load on demand.",
  },
  states: states.map((state) => ({
    state,
    elections: archiveManifest
      .filter((election) => election.state === state)
      .sort((left, right) => right.electionYear - left.electionYear),
  })),
};
await writeJsonAtomic(`${outputDir}/index.json`, index);
console.log(JSON.stringify(index.meta, null, 2));
