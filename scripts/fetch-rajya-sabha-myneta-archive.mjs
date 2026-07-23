#!/usr/bin/env node
/**
 * Import MyNeta Rajya Sabha affidavits (rajsab09aff) for multi-term asset trails.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deobfuscateMynetaHtml } from "./lib/myneta-html.mjs";
import {
  decodeMynetaCell,
  parseMynetaMoneyCell,
  parseRajyaSabhaTermLabel,
  canonicalizeRajyaSabhaState,
} from "./lib/myneta-records.mjs";
import {
  createLimiter,
  parseCandidateProfileMoney,
} from "./lib/archive-generation.mjs";
import { normalizeArchiveName } from "./lib/archive-person-history.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "public/data/rajya-sabha-myneta-archive.json");
const BASE = "https://www.myneta.info/rajsab09aff";
const UA = { "user-agent": "NetaWorthHistoryBuilder/1.0" };

async function fetchHtml(url) {
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return deobfuscateMynetaHtml(await response.text());
}

function candidateUrl(candidateId) {
  return `${BASE}/candidate.php?candidate_id=${candidateId}`;
}

function parseSummaryRows(html) {
  const rows = [...html.matchAll(/<tr[^>]*>\s*<td>\d+<\/td>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  return rows.flatMap((row) => {
    const candidateId = Number((row.match(/candidate_id=(\d+)/) || [])[1]);
    if (!Number.isSafeInteger(candidateId) || candidateId <= 0) return [];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 7) return [];
    const name = decodeMynetaCell(cells[1]);
    const constituency = decodeMynetaCell(cells[2]);
    const party = decodeMynetaCell(cells[3]);
    const assets = parseMynetaMoneyCell(cells[6]);
    const liabilities = parseMynetaMoneyCell(cells[7] ?? "");
    const term = parseRajyaSabhaTermLabel(constituency);
    return [{
      candidateId,
      name,
      normalizedName: normalizeArchiveName(name),
      constituency,
      party,
      assets: assets.value,
      assetsStatus: assets.status,
      liabilities: liabilities.value,
      liabilitiesStatus: liabilities.status,
      termFrom: term.termFrom,
      termTo: term.termTo,
      stateHint: term.stateHint,
      electionYear: term.termFrom,
      candidateUrl: candidateUrl(candidateId),
      electionFolder: "rajsab09aff",
      chamber: "rajya_sabha",
    }];
  });
}

function parseProfileMeta(html) {
  const h5 = decodeMynetaCell((html.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i) || [])[1] || "");
  const term = parseRajyaSabhaTermLabel(h5);
  const money = parseCandidateProfileMoney(html);
  return { term, money, heading: h5 };
}

async function main() {
  const firstHtml = await fetchHtml(`${BASE}/index.php?action=summary&page=1&sort=candidate&subAction=candidates_analyzed`);
  const pageNumbers = [...firstHtml.matchAll(/[?&]page=(\d+)/g)].map((match) => Number(match[1]));
  const lastPage = Math.max(1, ...pageNumbers, 1);
  console.log(`Fetching Rajya Sabha candidates_analyzed pages 1–${lastPage}`);

  const byId = new Map();
  for (const record of parseSummaryRows(firstHtml)) byId.set(record.candidateId, record);

  for (let page = 2; page <= lastPage; page += 1) {
    const html = await fetchHtml(`${BASE}/index.php?action=summary&page=${page}&sort=candidate&subAction=candidates_analyzed`);
    for (const record of parseSummaryRows(html)) byId.set(record.candidateId, record);
    if (page % 10 === 0 || page === lastPage) console.log(`  page ${page}/${lastPage} · ${byId.size} ids`);
  }

  const needsEnrichment = [...byId.values()].filter((record) => (
    !record.electionYear
    || record.assetsStatus === "masked"
    || record.assetsStatus === "missing"
    || !record.stateHint
  ));
  console.log(`Enriching ${needsEnrichment.length} profiles for year/assets/state`);

  const limit = createLimiter(6);
  let enriched = 0;
  await Promise.all(needsEnrichment.map((record) => limit(async () => {
    try {
      const html = await fetchHtml(record.candidateUrl);
      const { term, money } = parseProfileMeta(html);
      if (!record.electionYear && term.termFrom) {
        record.electionYear = term.termFrom;
        record.termFrom = term.termFrom;
        record.termTo = term.termTo;
      }
      if (!record.stateHint && term.stateHint) record.stateHint = term.stateHint;
      if ((record.assetsStatus === "masked" || record.assetsStatus === "missing")
        && money.assets.status === "parsed"
        && typeof money.assets.value === "number") {
        record.assets = money.assets.value;
        record.assetsStatus = "parsed";
        record.assetsSource = "candidate-profile";
      }
      if ((record.liabilitiesStatus === "masked" || record.liabilitiesStatus === "missing")
        && money.liabilities.status === "parsed"
        && typeof money.liabilities.value === "number") {
        record.liabilities = money.liabilities.value;
        record.liabilitiesStatus = "parsed";
      }
      enriched += 1;
    } catch (error) {
      console.warn(`  profile enrich failed ${record.candidateId}: ${error.message}`);
    }
  })));

  const records = [...byId.values()]
    .map((record) => ({
      ...record,
      state: canonicalizeRajyaSabhaState(record.stateHint) || record.stateHint || null,
      year: record.electionYear,
    }))
    .filter((record) => Number.isFinite(record.year) && typeof record.assets === "number")
    .sort((left, right) => left.year - right.year || left.candidateId - right.candidateId);

  const payload = {
    meta: {
      title: "MyNeta Rajya Sabha affidavit archive",
      chamber: "rajya_sabha",
      electionFolder: "rajsab09aff",
      sourceUrl: `${BASE}/`,
      retrievedAt: new Date().toISOString(),
      summaryPages: lastPage,
      candidateIds: byId.size,
      recordCount: records.length,
      profilesEnriched: enriched,
      note: "Affidavit points from MyNeta rajsab09aff candidates_analyzed (+ profile enrichment for masked assets / missing term years). Year is the term-start year from labels like UP (2024-2030).",
    },
    records,
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
