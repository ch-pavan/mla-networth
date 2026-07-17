import { deobfuscateMynetaHtml } from "./myneta-html.mjs";

const PACKED_ROW_SCRIPT = /<script(?:\s[^>]*)?>[\s\S]*?eval\s*\(\s*function\s*\(\s*h\s*,\s*u\s*,\s*n\s*,\s*t\s*,\s*e\s*,\s*r\s*\)[\s\S]*?<\/script>/gi;
const FOUR_DIGIT_YEAR = /(?:19|20)\d{2}/g;
const TWO_DIGIT_FOLDER_YEAR = /(?:^|\D)(\d{2})$/;
const PAN_DIFFERENT = /\bPAN\s+is\s+Different\b/i;

export function decodeMynetaText(value) {
  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&#039;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMynetaName(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[.']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseCandidatePartyLabel(label) {
  const partyStart = label.lastIndexOf(" (");
  if (partyStart <= 0 || !label.endsWith(")")) return null;

  const name = label.slice(0, partyStart).trim();
  const party = label.slice(partyStart + 2, -1).trim();
  return name && party ? { name, party } : null;
}

export function inferYearFromElectionFolder(folder) {
  if (!folder) return null;
  let decodedFolder;
  try {
    decodedFolder = decodeURIComponent(folder);
  } catch {
    decodedFolder = folder;
  }

  const fourDigitYears = [...decodedFolder.matchAll(FOUR_DIGIT_YEAR)]
    .map((match) => Number(match[0]));
  if (fourDigitYears.length) return fourDigitYears.at(-1);

  const shortYear = decodedFolder.match(TWO_DIGIT_FOLDER_YEAR)?.[1];
  if (!shortYear) return null;
  const year = 2000 + Number(shortYear);
  return year >= 2004 ? year : null;
}

export function inferComparisonPreviousYear({
  previousFolder,
  currentFolder,
  currentYear,
  pagePreviousYear,
}) {
  const folderYear = inferYearFromElectionFolder(previousFolder);
  const isDifferentFolder = previousFolder
    && previousFolder.toLowerCase() !== currentFolder.toLowerCase();

  if (isDifferentFolder && folderYear && folderYear < currentYear) {
    return { previousYear: folderYear, previousYearSource: "folder" };
  }
  if (pagePreviousYear && pagePreviousYear < currentYear) {
    return { previousYear: pagePreviousYear, previousYearSource: "page-header" };
  }
  return { previousYear: null, previousYearSource: "unresolved" };
}

export function classifyIdentityReview(remarks) {
  if (PAN_DIFFERENT.test(remarks)) {
    return {
      identityReviewStatus: "review-required",
      identityReviewReason: "pan-different",
    };
  }
  return {
    identityReviewStatus: "source-linked",
    identityReviewReason: null,
  };
}

function parseMoneyCell(cell, context) {
  const plain = decodeMynetaText(cell);
  const match = plain.match(/(?:Rs\s*)?([0-9][0-9,]*)/i);
  if (!match) throw new Error(`${context}: monetary value is missing or masked`);
  const value = Number(match[1].replaceAll(",", ""));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context}: invalid monetary value ${match[1]}`);
  }
  return value;
}

function parsePercentCell(cell, context) {
  const match = decodeMynetaText(cell).match(/-?[0-9.]+/);
  if (!match) return { value: null, status: "missing" };
  const value = Number(match[0]);
  if (!Number.isFinite(value)) throw new Error(`${context}: invalid percentage`);
  return { value, status: "parsed" };
}

function assertContiguousRanks(rows, context) {
  if (!rows.length) return 0;
  const ranks = rows.map((row) => row.rank);
  const expected = Math.max(...ranks);
  const uniqueRanks = new Set(ranks);
  if (uniqueRanks.size !== rows.length || expected !== rows.length) {
    const missing = [];
    for (let rank = 1; rank <= expected; rank += 1) {
      if (!uniqueRanks.has(rank)) missing.push(rank);
    }
    throw new Error(
      `${context}: incomplete comparison ranks (${rows.length}/${expected}; missing ${missing.slice(0, 10).join(", ") || "duplicate ranks"})`,
    );
  }
  return expected;
}

export function parseRecontestPage({ html, state, currentYear, folder, url }) {
  const packedScriptCount = (html.match(PACKED_ROW_SCRIPT) ?? []).length;
  const decodedHtml = deobfuscateMynetaHtml(html);
  const unresolvedPackedScriptCount = (decodedHtml.match(PACKED_ROW_SCRIPT) ?? []).length;
  const context = `${folder} ${currentYear}`;
  if (unresolvedPackedScriptCount) {
    throw new Error(`${context}: ${unresolvedPackedScriptCount} packed row scripts could not be decoded`);
  }

  const headerYears = [...decodedHtml.matchAll(/Total Assets in [^<]*?\b(20\d{2})\b/gi)]
    .map((match) => Number(match[1]));
  const pagePreviousYear = headerYears.find((year) => year !== currentYear) ?? null;
  const comparisons = [];

  for (const rowMatch of decodedHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => match[1]);
    const rankText = decodeMynetaText(cells[0] ?? "");
    if (!/^\d+$/.test(rankText)) continue;

    const rank = Number(rankText);
    const rowContext = `${context} rank ${rank}`;
    if (cells.length < 6) throw new Error(`${rowContext}: expected at least 6 cells`);

    const label = decodeMynetaText(cells[1]);
    const identity = parseCandidatePartyLabel(label);
    if (!identity) throw new Error(`${rowContext}: could not parse candidate and party from ${label}`);

    const rawHref = cells[1].match(/href\s*=\s*(?:["']?)([^\s"'>]+)/i)?.[1];
    if (!rawHref) throw new Error(`${rowContext}: comparison URL is missing`);
    const comparisonUrl = new URL(rawHref.replaceAll("&amp;", "&"), url).href;
    const previousFolder = new URL(comparisonUrl).searchParams.get("myneta_folder2");
    if (!previousFolder) throw new Error(`${rowContext}: previous election folder is missing`);

    const year = inferComparisonPreviousYear({
      previousFolder,
      currentFolder: folder,
      currentYear,
      pagePreviousYear,
    });
    if (!year.previousYear) throw new Error(`${rowContext}: previous election year is unresolved`);

    const remarks = decodeMynetaText(cells[6] ?? "");
    const review = classifyIdentityReview(remarks);
    const eligibleForProfileHistory = review.identityReviewStatus === "source-linked"
      && year.previousYearSource === "folder";
    const currentAssets = parseMoneyCell(cells[2], rowContext);
    const previousAssets = parseMoneyCell(cells[3], rowContext);
    const percentChange = parsePercentCell(cells[5], rowContext);

    comparisons.push({
      state,
      currentYear,
      previousYear: year.previousYear,
      previousYearSource: year.previousYearSource,
      rank,
      name: identity.name,
      normalizedName: normalizeMynetaName(identity.name),
      party: identity.party,
      currentAssets,
      previousAssets,
      assetChange: currentAssets - previousAssets,
      percentChange: percentChange.value,
      percentChangeStatus: percentChange.status,
      remarks,
      comparisonUrl,
      previousFolder,
      ...review,
      eligibleForProfileHistory,
    });
  }

  const expectedFromRanks = assertContiguousRanks(comparisons, context);
  return {
    comparisons,
    pagePreviousYear,
    coverage: {
      complete: true,
      expectedFromRanks,
      parsedComparisonCount: comparisons.length,
      packedScriptCount,
      unresolvedPackedScriptCount,
    },
  };
}

export function collectPreviousElectionTasks(results, processedFolders = new Set()) {
  const tasks = new Map();
  for (const result of results) {
    for (const comparison of result.comparisons) {
      const folder = comparison.previousFolder;
      const key = folder?.toLowerCase();
      if (!folder || !key || key === result.folder.toLowerCase()) continue;
      if (processedFolders.has(key) || comparison.previousYear < 2004) continue;

      const existing = tasks.get(key);
      const task = [comparison.state, comparison.previousYear, folder];
      if (existing && (existing[0] !== task[0] || existing[1] !== task[1])) {
        throw new Error(`Conflicting election metadata inferred for ${folder}`);
      }
      tasks.set(key, task);
    }
  }
  return [...tasks.values()];
}

export function attachSnapshotMatches(comparisons, snapshotRecords) {
  const currentByName = new Map();
  for (const record of snapshotRecords) {
    const key = `${record.state}|${normalizeMynetaName(record.name)}`;
    currentByName.set(key, [...(currentByName.get(key) ?? []), record]);
  }

  return comparisons.map((comparison) => {
    const candidates = currentByName.get(`${comparison.state}|${comparison.normalizedName}`) ?? [];
    const exact = candidates.filter((candidate) => (
      candidate.electionYear === comparison.currentYear
      && candidate.assets === comparison.currentAssets
    ));
    const match = exact.length === 1 ? exact[0] : null;
    return {
      ...comparison,
      currentSnapshotRank: match?.rank ?? null,
      currentConstituency: match?.constituency ?? null,
      matchedToSnapshot: Boolean(match),
      snapshotMatchStatus: match ? "matched" : exact.length > 1 ? "ambiguous" : "unmatched",
    };
  });
}
