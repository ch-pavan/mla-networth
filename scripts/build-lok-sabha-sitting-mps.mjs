#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  createLimiter,
  parseCandidateProfileIdentity,
  writeJsonAtomic,
} from "./lib/archive-generation.mjs";

function moneyValue(value, status) {
  if (status === "masked" || status === "missing") return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const REVIEWED_WINNER_STATE_OVERRIDES = new Map([
  [1702, { name: "Abhay Kumar Sinha", state: "Bihar" }],
  [8177, { name: "Janardan Singh (Sigriwal)", state: "Bihar" }],
  [8760, { name: "Anurag Singh Thakur", state: "Himachal Pradesh" }],
]);

const winners = JSON.parse(await readFile("public/data/lok-sabha-winner-archive.json", "utf8"));
const candidates = JSON.parse(await readFile("public/data/candidates/loksabha2024.json", "utf8"));
const latestYear = Math.max(...winners.records.map((record) => record.electionYear));
if (latestYear !== 2024 || candidates.meta.electionYear !== latestYear || candidates.meta.complete !== true) {
  throw new Error("Expected the complete LokSabha2024 candidate shard before building the winner snapshot");
}

const candidatesById = new Map(candidates.records.map((record) => [record.candidateId, record]));
const electionWinners = winners.records
  .filter((record) => record.electionYear === latestYear && record.electionType !== "by-election")
  .map((winner) => {
    const candidate = candidatesById.get(winner.candidateId);
    if (!candidate) throw new Error(`Winner ${winner.candidateId} is absent from the complete candidate shard`);
    if (candidate.normalizedName !== winner.normalizedName) {
      throw new Error(`Winner/candidate identity mismatch for candidate ${winner.candidateId}`);
    }
    return { winner, candidate, assets: moneyValue(candidate.assets, candidate.assetsStatus) };
  })
  .sort((left, right) => {
    if (left.assets === null) return right.assets === null ? 0 : 1;
    if (right.assets === null) return -1;
    return right.assets - left.assets || left.winner.candidateId - right.winner.candidateId;
  });

const records = electionWinners.map((entry, index) => ({
  rank: index + 1,
  state: (() => {
    const reviewed = REVIEWED_WINNER_STATE_OVERRIDES.get(entry.winner.candidateId);
    if (reviewed && reviewed.name !== entry.candidate.name) {
      throw new Error(`Reviewed state override identity mismatch for candidate ${entry.winner.candidateId}`);
    }
    return reviewed?.state ?? entry.winner.state;
  })(),
  electionYear: entry.winner.electionYear,
  electionType: "general",
  recordType: "general_election_winner",
  constituency: entry.winner.baseConstituency || entry.winner.constituency,
  name: entry.candidate.name,
  party: entry.candidate.party,
  age: null,
  gender: null,
  assets: entry.assets,
  liabilities: moneyValue(entry.candidate.liabilities, entry.candidate.liabilitiesStatus),
  criminalCases: entry.candidate.criminalCases,
  seriousCriminalCases: null,
  education: entry.candidate.education,
  panDeclared: null,
  chamber: "lok_sabha",
  electionFolder: entry.winner.electionFolder,
  candidateId: entry.winner.candidateId,
  candidateUrl: entry.candidate.candidateUrl,
}));

const limit = createLimiter(8);
let enrichedAge = 0;
let enrichedGender = 0;
await Promise.all(records.map((record) => limit(async () => {
  if (!record.candidateUrl) return;
  try {
    const response = await fetch(record.candidateUrl, {
      headers: { "user-agent": "NetaWorthHistoryBuilder/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return;
    const identity = parseCandidateProfileIdentity(await response.text());
    if (identity.age != null) {
      record.age = identity.age;
      enrichedAge += 1;
    }
    if (identity.gender) {
      record.gender = identity.gender;
      enrichedGender += 1;
    }
  } catch {
    // Leave nulls; UI shows em dash.
  }
})));

const payload = {
  meta: {
    title: `Lok Sabha ${latestYear} general-election winners — affidavit snapshot`,
    chamber: "lok_sabha",
    datasetType: "general_election_winners",
    publisher: "Association for Democratic Reforms / MyNeta",
    published: String(latestYear),
    sourceUrl: `https://www.myneta.info/LokSabha${latestYear}/`,
    primarySource: "Election Commission of India candidate affidavits via MyNeta winner summaries",
    extractedAt: new Date().toISOString(),
    recordCount: records.length,
    candidateArchiveFile: "/data/candidates/loksabha2024.json",
    candidateArchiveCrossCheckComplete: true,
    agesEnrichedFromProfiles: enrichedAge,
    gendersEnrichedFromProfiles: enrichedGender,
    note: "The 543 winners declared after the 2024 Lok Sabha general election, enriched from the complete LokSabha2024 candidate-affidavit shard. Age (and gender when published) are filled from MyNeta candidate profile pages. This is an election-result snapshot, not a claim about current or sitting membership. Assets and liabilities are self-declared, not audited market wealth.",
  },
  records,
};

await writeJsonAtomic("public/data/lok-sabha-sitting-mps.json", payload);
console.log(JSON.stringify(payload.meta, null, 2));
