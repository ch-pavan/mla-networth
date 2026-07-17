#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { loadElectionManifest } from "./lib/election-manifest.mjs";
import {
  attachSnapshotMatches,
  collectPreviousElectionTasks,
  parseRecontestPage,
} from "./lib/recontest-history.mjs";

const manifest = await loadElectionManifest();
const seedElections = manifest.elections.map(({ state, year, folder }) => [state, year, folder]);

const urlFor = (folder) => `https://www.myneta.info/${folder}/index.php?action=recontestAssetsComparison`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchElection([state, currentYear, folder], attempt = 1) {
  const url = urlFor(folder);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "NetaWorth public-interest data index; source attribution included" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const parsed = parseRecontestPage({ html, state, currentYear, folder, url });
    return {
      state,
      currentYear,
      previousYear: parsed.pagePreviousYear,
      folder,
      url,
      status: response.status,
      sha256: createHash("sha256").update(html).digest("hex"),
      ...parsed.coverage,
      comparisons: parsed.comparisons,
    };
  } catch (error) {
    if (attempt >= 3) {
      throw new Error(`Failed to fetch and parse ${url} after ${attempt} attempts`, { cause: error });
    }
    await sleep(attempt * 1000);
    return fetchElection([state, currentYear, folder], attempt + 1);
  }
}

const results = [];
const queue = [...seedElections];
const scheduledFolders = new Set(seedElections.map(([, , folder]) => folder.toLowerCase()));

while (queue.length) {
  const batch = queue.splice(0, 5);
  const fetched = await Promise.all(batch.map((election) => fetchElection(election)));
  results.push(...fetched);

  for (const task of collectPreviousElectionTasks(fetched)) {
    const folderKey = task[2].toLowerCase();
    if (scheduledFolders.has(folderKey)) continue;
    scheduledFolders.add(folderKey);
    queue.push(task);
  }
}

const snapshot = JSON.parse(await readFile("public/data/adr-sitting-mlas-2025.json", "utf8"));
const comparisons = attachSnapshotMatches(
  results.flatMap((result) => result.comparisons),
  snapshot.records,
);
const matchedRanks = new Set(
  comparisons.filter((comparison) => comparison.matchedToSnapshot)
    .map((comparison) => comparison.currentSnapshotRank),
);
const profileEligibleMatchedRanks = new Set(
  comparisons.filter((comparison) => (
    comparison.matchedToSnapshot && comparison.eligibleForProfileHistory
  )).map((comparison) => comparison.currentSnapshotRank),
);
const years = comparisons.flatMap((comparison) => [comparison.previousYear, comparison.currentYear]);
const elections = results.map(({ comparisons: electionComparisons, ...result }) => ({
  ...result,
  comparisonCount: electionComparisons.length,
  previousElectionFolders: [...new Set(electionComparisons.map((comparison) => comparison.previousFolder))],
}));

const payload = {
  meta: {
    title: "MyNeta re-contesting candidate asset comparisons",
    source: "Association for Democratic Reforms / MyNeta",
    retrievedAt: new Date().toISOString(),
    parserVersion: 2,
    statesRequested: new Set(seedElections.map(([state]) => state)).size,
    manifestElectionFolders: manifest.elections.length,
    electionPagesChecked: results.length,
    electionPagesAvailable: results.filter((result) => result.comparisons.length > 0).length,
    completeElectionPages: results.filter((result) => result.complete).length,
    comparisonCount: comparisons.length,
    snapshotMatchCount: matchedRanks.size,
    profileEligibleSnapshotMatchCount: profileEligibleMatchedRanks.size,
    identityReviewRequiredCount: comparisons.filter((comparison) => (
      comparison.identityReviewStatus === "review-required"
    )).length,
    timelineReviewRequiredCount: comparisons.filter((comparison) => (
      !comparison.eligibleForProfileHistory
    )).length,
    firstYear: Math.min(...years),
    latestYear: Math.max(...years),
    note: "Each comparison is published by MyNeta from self-sworn election affidavits. Packed rows are decoded without executing source scripts. PAN-different and uncertain-year links remain in the research data but are excluded from profile histories pending review.",
  },
  elections,
  comparisons,
};

await writeFile("public/data/adr-recontest-history.json", `${JSON.stringify(payload)}\n`);
console.log(JSON.stringify(payload.meta, null, 2));
