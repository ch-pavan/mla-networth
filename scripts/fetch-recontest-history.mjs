#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  attachSnapshotMatches,
  collectPreviousElectionTasks,
  parseRecontestPage,
} from "./lib/recontest-history.mjs";

const seedElections = [
  ["Andhra Pradesh",2024,"AndhraPradesh2024"],["Arunachal Pradesh",2024,"ArunachalPradesh2024"],["Assam",2021,"Assam2021"],
  ["Bihar",2020,"Bihar2020"],["Chhattisgarh",2023,"Chhattisgarh2023"],["Delhi",2025,"Delhi2025"],["Goa",2022,"Goa2022"],
  ["Gujarat",2022,"Gujarat2022"],["Haryana",2024,"Haryana2024"],["Himachal Pradesh",2022,"HimachalPradesh2022"],
  ["Jammu Kashmir",2024,"JammuKashmir2024"],["Jharkhand",2024,"Jharkhand2024"],["Karnataka",2023,"Karnataka2023"],
  ["Kerala",2021,"Kerala2021"],["Madhya Pradesh",2023,"MadhyaPradesh2023"],["Maharashtra",2024,"Maharashtra2024"],
  ["Manipur",2022,"Manipur2022"],["Meghalaya",2023,"Meghalaya2023"],["Mizoram",2023,"Mizoram2023"],
  ["Nagaland",2023,"Nagaland2023"],["Odisha",2024,"Odisha2024"],["Puducherry",2021,"Puducherry2021"],
  ["Punjab",2022,"Punjab2022"],["Rajasthan",2023,"Rajasthan2023"],["Sikkim",2024,"Sikkim2024"],
  ["Tamil Nadu",2021,"TamilNadu2021"],["Telangana",2023,"Telangana2023"],["Tripura",2023,"Tripura2023"],
  ["Uttar Pradesh",2022,"UttarPradesh2022"],["Uttarakhand",2022,"Uttarakhand2022"],["West Bengal",2021,"WestBengal2021"],
];

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
    statesRequested: seedElections.length,
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
