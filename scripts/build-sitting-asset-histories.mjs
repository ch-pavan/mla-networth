#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSittingHistoryEntry,
  findUniqueWinnerMatch,
  indexRowsByNormalizedName,
  normalizeArchiveName,
} from "./lib/archive-person-history.mjs";
import {
  createLimiter,
  parseCandidateProfileMoney,
} from "./lib/archive-generation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "public/data/sitting-mla-asset-histories.json");

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

function mapCandidateRow(record, election) {
  const assets = typeof record.assets === "number"
    ? record.assets
    : record.assetsStatus === "nil"
      ? 0
      : null;
  if (assets === null) return null;
  return {
    normalizedName: normalizeArchiveName(record.name),
    name: record.name,
    year: record.electionYear ?? election.electionYear,
    assets,
    sourceUrl: record.candidateUrl,
    state: election.state === "Lok Sabha" ? (record.state || election.state) : election.state,
    constituency: record.baseConstituency || record.constituency,
    chamber: election.state === "Lok Sabha" || record.chamber === "lok_sabha" ? "lok_sabha" : "assembly",
    electionFolder: election.electionFolder,
    candidateId: record.candidateId,
    electionState: election.state,
  };
}

function mapWinnerRow(record, chamber) {
  if (typeof record.assets !== "number") return null;
  return {
    normalizedName: normalizeArchiveName(record.name),
    name: record.name,
    year: record.electionYear,
    assets: record.assets,
    sourceUrl: record.candidateUrl,
    state: record.state,
    constituency: record.baseConstituency || record.constituency,
    chamber,
    electionFolder: record.electionFolder,
    candidateId: record.candidateId,
    electionState: chamber === "lok_sabha" ? "Lok Sabha" : record.state,
  };
}

async function enrichMaskedLokSabhaWinners(winnerRecords, neededNames) {
  const limit = createLimiter(6);
  let enriched = 0;
  const tasks = winnerRecords
    .filter((record) => (
      neededNames.has(normalizeArchiveName(record.name))
      && record.assetsStatus === "masked"
      && record.candidateUrl
    ))
    .map((record) => limit(async () => {
      try {
        const response = await fetch(record.candidateUrl, {
          headers: { "user-agent": "NetaWorthHistoryBuilder/1.0" },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) return;
        const html = await response.text();
        const money = parseCandidateProfileMoney(html);
        if (money.assets.status === "parsed" && typeof money.assets.value === "number") {
          record.assets = money.assets.value;
          record.assetsStatus = "parsed";
          record.assetsSource = "candidate-profile";
          enriched += 1;
        }
      } catch {
        // Keep masked; trail simply omits that year.
      }
    }));
  await Promise.all(tasks);
  return enriched;
}

function buildChamberHistories({
  snapshotRecords,
  winnerRecords,
  byName,
  chamber,
  fallbackSourceUrl,
}) {
  const out = {};
  let multiYear = 0;
  let singleYear = 0;
  let skippedUnsafe = 0;
  let skippedNoWinner = 0;

  for (const record of snapshotRecords) {
    if (typeof record.assets !== "number" || !Number.isFinite(record.electionYear)) continue;
    const winnerMatch = findUniqueWinnerMatch(record, winnerRecords);
    if (!winnerMatch && !(record.electionFolder && record.candidateId)) {
      skippedNoWinner += 1;
      continue;
    }
    const entry = buildSittingHistoryEntry({
      snapshotRecord: record,
      winnerMatch: winnerMatch || {
        electionFolder: record.electionFolder,
        candidateId: record.candidateId,
        candidateUrl: record.candidateUrl,
      },
      candidacyRows: byName.get(normalizeArchiveName(record.name)) ?? [],
      chamber,
      fallbackSourceUrl,
    });
    if (!entry) {
      skippedUnsafe += 1;
      continue;
    }
    out[String(record.rank)] = entry;
    if (entry.points.length > 1) multiYear += 1;
    else singleYear += 1;
  }

  return { out, multiYear, singleYear, skippedUnsafe, skippedNoWinner };
}

async function main() {
  const [snapshot, mpSnapshot, assemblyWinners, lokSabhaWinners, candidateIndex] = await Promise.all([
    readJson("public/data/adr-sitting-mlas-2025.json"),
    readJson("public/data/lok-sabha-sitting-mps.json"),
    readJson("public/data/adr-winner-archive.json"),
    readJson("public/data/lok-sabha-winner-archive.json"),
    readJson("public/data/candidates/index.json"),
  ]);

  const lsNames = new Set(
    (mpSnapshot.records ?? [])
      .filter((record) => typeof record.assets === "number")
      .map((record) => normalizeArchiveName(record.name)),
  );
  const enrichedMasked = await enrichMaskedLokSabhaWinners(lokSabhaWinners.records ?? [], lsNames);
  console.log(`Enriched masked Lok Sabha winner assets from profiles: ${enrichedMasked}`);

  const candidacyRows = [];
  for (const state of candidateIndex.states) {
    for (const election of state.elections) {
      const file = String(election.file || "").replace(/^\//, "");
      const shard = await readJson(file.startsWith("public/") ? file : `public/${file}`);
      for (const record of shard.records ?? []) {
        const mapped = mapCandidateRow(record, election);
        if (mapped) candidacyRows.push(mapped);
      }
    }
  }

  for (const record of assemblyWinners.records ?? []) {
    const mapped = mapWinnerRow(record, "assembly");
    if (mapped) candidacyRows.push(mapped);
  }
  for (const record of lokSabhaWinners.records ?? []) {
    const mapped = mapWinnerRow(record, "lok_sabha");
    if (mapped) candidacyRows.push(mapped);
  }

  const byName = indexRowsByNormalizedName(candidacyRows, (row) => row);

  const assembly = buildChamberHistories({
    snapshotRecords: snapshot.records ?? [],
    winnerRecords: assemblyWinners.records ?? [],
    byName,
    chamber: "assembly",
    fallbackSourceUrl: "https://adrindia.org/sites/default/files/All_India_Sitting_MLAs_Report_2025_English.pdf",
  });

  const lokSabha = buildChamberHistories({
    snapshotRecords: mpSnapshot.records ?? [],
    winnerRecords: lokSabhaWinners.records ?? [],
    byName,
    chamber: "lok_sabha",
    fallbackSourceUrl: "https://www.myneta.info/LokSabha2024/index.php",
  });

  const payload = {
    meta: {
      title: "Sitting MLA and Lok Sabha affidavit trails from imported MyNeta archives",
      source: "MyNeta candidate + winner archives, anchored to ADR/sitting snapshots",
      generatedAt: new Date().toISOString(),
      assemblyRecords: Object.keys(assembly.out).length,
      assemblyMultiYearRecords: assembly.multiYear,
      assemblySingleYearRecords: assembly.singleYear,
      assemblySkippedNoWinner: assembly.skippedNoWinner,
      assemblySkippedUnsafe: assembly.skippedUnsafe,
      lokSabhaRecords: Object.keys(lokSabha.out).length,
      lokSabhaMultiYearRecords: lokSabha.multiYear,
      lokSabhaSingleYearRecords: lokSabha.singleYear,
      lokSabhaSkippedNoWinner: lokSabha.skippedNoWinner,
      lokSabhaSkippedUnsafe: lokSabha.skippedUnsafe,
      lokSabhaMaskedProfilesEnriched: enrichedMasked,
      note: "Trails merge imported candidacies/winners for a normalized name (order-insensitive; Chandra Babu→Chandrababu). Same-year dual seats prefer the current constituency, then current assets; otherwise that year is omitted without dropping the whole trail. Masked Lok Sabha winner amounts are filled from candidate profiles when available.",
    },
    assembly: assembly.out,
    lok_sabha: lokSabha.out,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload)}\n`);
  console.log(`Wrote ${outPath}`);
  console.log(payload.meta);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
