#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { writeJsonAtomic } from "./lib/archive-generation.mjs";

function moneyValue(value, status) {
  if (status === "masked" || status === "missing") return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const winners = JSON.parse(await readFile("public/data/lok-sabha-winner-archive.json", "utf8"));
const latestYear = Math.max(...winners.records.map((record) => record.electionYear));
const sitting = winners.records
  .filter((record) => record.electionYear === latestYear && record.electionType !== "by-election")
  .map((record) => ({
    record,
    assets: moneyValue(record.assets, record.assetsStatus),
  }))
  .sort((left, right) => {
    if (left.assets === null) return right.assets === null ? 0 : 1;
    if (right.assets === null) return -1;
    return right.assets - left.assets || left.record.candidateId - right.record.candidateId;
  });

const records = sitting.map((entry, index) => ({
  rank: index + 1,
  state: entry.record.state,
  electionYear: entry.record.electionYear,
  constituency: entry.record.baseConstituency || entry.record.constituency,
  name: entry.record.name,
  party: entry.record.party,
  age: null,
  gender: "",
  assets: entry.assets,
  liabilities: moneyValue(entry.record.liabilities, entry.record.liabilitiesStatus),
  criminalCases: entry.record.criminalCases,
  seriousCriminalCases: 0,
  education: entry.record.education,
  panDeclared: false,
  chamber: "lok_sabha",
  electionFolder: entry.record.electionFolder,
  candidateId: entry.record.candidateId,
  candidateUrl: entry.record.candidateUrl,
}));

const payload = {
  meta: {
    title: `Sitting Lok Sabha MPs from MyNeta winners · ${latestYear}`,
    chamber: "lok_sabha",
    publisher: "Association for Democratic Reforms / MyNeta",
    published: String(latestYear),
    sourceUrl: `https://www.myneta.info/LokSabha${latestYear}/`,
    primarySource: "Election Commission of India candidate affidavits via MyNeta winner summaries",
    extractedAt: new Date().toISOString(),
    recordCount: records.length,
    note: "Derived from Lok Sabha general-election winners in the NetaWorth winner archive. Assets and liabilities are affidavit declarations, not audited market wealth. Age, gender, PAN and serious-case fields are not present on winner summaries and remain blank.",
  },
  records,
};

await writeJsonAtomic("public/data/lok-sabha-sitting-mps.json", payload);
console.log(JSON.stringify(payload.meta, null, 2));
