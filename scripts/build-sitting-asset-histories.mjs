#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSittingHistoryEntry,
  collectCandidacyRowsForName,
  findRajyaSabhaArchiveMatch,
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

function mapRajyaSabhaArchiveRow(record) {
  if (typeof record.assets !== "number" || !Number.isFinite(record.year)) return null;
  return {
    normalizedName: normalizeArchiveName(record.name),
    name: record.name,
    year: record.year,
    assets: record.assets,
    sourceUrl: record.candidateUrl,
    state: record.state,
    constituency: "Rajya Sabha",
    chamber: "rajya_sabha",
    electionFolder: record.electionFolder || "rajsab09aff",
    candidateId: record.candidateId,
    electionState: record.state,
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

function statesAlign(left, right) {
  if (!left || !right) return true;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function buildChamberHistories({
  snapshotRecords,
  resolveAnchor,
  nameIndex,
  chamber,
  fallbackSourceUrl,
  sameStateOnly = false,
}) {
  const out = {};
  let multiYear = 0;
  let singleYear = 0;
  let skippedUnsafe = 0;
  let skippedNoWinner = 0;

  for (const record of snapshotRecords) {
    if (typeof record.assets !== "number" || !Number.isFinite(record.electionYear)) continue;
    const winnerMatch = resolveAnchor(record);
    if (!winnerMatch) {
      skippedNoWinner += 1;
      continue;
    }
    let candidacyRows = collectCandidacyRowsForName(nameIndex, record.name);
    if (chamber === "rajya_sabha") {
      candidacyRows = candidacyRows.filter((row) => row.chamber === "rajya_sabha");
    }
    if (sameStateOnly) {
      candidacyRows = candidacyRows.filter((row) => statesAlign(row.state, record.state));
    }
    const entry = buildSittingHistoryEntry({
      snapshotRecord: record,
      winnerMatch,
      candidacyRows,
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
  const [
    snapshot,
    mpSnapshot,
    rsSnapshot,
    assemblyWinners,
    lokSabhaWinners,
    candidateIndex,
    rajyaSabhaArchive,
  ] = await Promise.all([
    readJson("public/data/adr-sitting-mlas-2025.json"),
    readJson("public/data/lok-sabha-sitting-mps.json"),
    readJson("public/data/rajya-sabha-sitting-mps.json"),
    readJson("public/data/adr-winner-archive.json"),
    readJson("public/data/lok-sabha-winner-archive.json"),
    readJson("public/data/candidates/index.json"),
    readJson("public/data/rajya-sabha-myneta-archive.json").catch(() => ({ records: [] })),
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

  const rsArchiveRecords = rajyaSabhaArchive.records ?? [];
  for (const record of rsArchiveRecords) {
    const mapped = mapRajyaSabhaArchiveRow(record);
    if (mapped) candidacyRows.push(mapped);
  }

  const nameIndex = indexRowsByNormalizedName(candidacyRows, (row) => row);

  const assembly = buildChamberHistories({
    snapshotRecords: snapshot.records ?? [],
    resolveAnchor: (record) => {
      const winnerMatch = findUniqueWinnerMatch(record, assemblyWinners.records ?? []);
      if (winnerMatch) return winnerMatch;
      if (record.electionFolder && record.candidateId) {
        return {
          electionFolder: record.electionFolder,
          candidateId: record.candidateId,
          candidateUrl: record.candidateUrl,
        };
      }
      return null;
    },
    nameIndex,
    chamber: "assembly",
    fallbackSourceUrl: "https://adrindia.org/sites/default/files/All_India_Sitting_MLAs_Report_2025_English.pdf",
  });

  const lokSabha = buildChamberHistories({
    snapshotRecords: mpSnapshot.records ?? [],
    resolveAnchor: (record) => {
      const winnerMatch = findUniqueWinnerMatch(record, lokSabhaWinners.records ?? []);
      if (winnerMatch) return winnerMatch;
      if (record.electionFolder && record.candidateId) {
        return {
          electionFolder: record.electionFolder,
          candidateId: record.candidateId,
          candidateUrl: record.candidateUrl,
        };
      }
      return null;
    },
    nameIndex,
    chamber: "lok_sabha",
    fallbackSourceUrl: "https://www.myneta.info/LokSabha2024/index.php",
  });

  const rajyaSabha = buildChamberHistories({
    snapshotRecords: rsSnapshot.records ?? [],
    resolveAnchor: (record) => {
      const match = findRajyaSabhaArchiveMatch(record, rsArchiveRecords);
      if (match) {
        return {
          electionFolder: match.electionFolder || "rajsab09aff",
          candidateId: match.candidateId,
          candidateUrl: match.candidateUrl,
        };
      }
      // Still emit a single-point ADR trail when MyNeta has no match.
      return {
        electionFolder: "rajsab09aff",
        candidateUrl: "https://www.myneta.info/rajsab09aff/",
      };
    },
    nameIndex,
    chamber: "rajya_sabha",
    fallbackSourceUrl: rsSnapshot.meta?.sourceUrl || "https://www.myneta.info/rajsab09aff/",
  });

  const payload = {
    meta: {
      title: "Sitting MLA, Lok Sabha and Rajya Sabha affidavit trails from imported MyNeta archives",
      source: "MyNeta candidate + winner + rajsab09aff archives, anchored to ADR/sitting snapshots",
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
      rajyaSabhaRecords: Object.keys(rajyaSabha.out).length,
      rajyaSabhaMultiYearRecords: rajyaSabha.multiYear,
      rajyaSabhaSingleYearRecords: rajyaSabha.singleYear,
      rajyaSabhaSkippedNoWinner: rajyaSabha.skippedNoWinner,
      rajyaSabhaSkippedUnsafe: rajyaSabha.skippedUnsafe,
      rajyaSabhaArchiveRecords: rsArchiveRecords.length,
      note: "Trails merge imported candidacies/winners for a normalized name (order-insensitive; Chandra Babu→Chandrababu; abbreviated given names like Ch./Chamakura when surname tokens match). Rajya Sabha trails use MyNeta rajsab09aff term-start years. Same-year dual seats prefer the current constituency, then current assets; otherwise that year is omitted without dropping the whole trail. Masked Lok Sabha / RS amounts are filled from candidate profiles when available.",
    },
    assembly: assembly.out,
    lok_sabha: lokSabha.out,
    rajya_sabha: rajyaSabha.out,
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
