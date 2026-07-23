/**
 * Build multi-election affidavit trails from imported MyNeta archives.
 *
 * Same-year dual candidacies are resolved for every person the same way:
 * 1. same assets in both seats → keep one point
 * 2. different assets → keep the seat matching the current constituency
 * 3. else if the conflict year is the current declaration → keep current assets
 * 4. else omit that year only (do not discard the rest of the trail)
 */

export function archiveNameTokens(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[.'']/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\bchandra babu\b/g, "chandrababu")
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeArchiveName(name) {
  return archiveNameTokens(name).sort().join(" ");
}

/** Last two name tokens in source order — used to group “X Malla Reddy” variants. */
export function archiveSurnameKey(name) {
  const tokens = archiveNameTokens(name);
  if (tokens.length < 2) return null;
  return `${tokens.at(-2)} ${tokens.at(-1)}`;
}

function tokenPairCompatible(left, right) {
  if (left === right) return true;
  if (left.length >= 1 && left.length <= 3 && right.length > left.length && right.startsWith(left)) return true;
  if (right.length >= 1 && right.length <= 3 && left.length > right.length && left.startsWith(right)) return true;
  return false;
}

function givenNamesCompatible(left, right) {
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length === 0) return long.length === 0;
  const used = new Set();
  for (const token of short) {
    const index = long.findIndex((candidate, i) => !used.has(i) && tokenPairCompatible(token, candidate));
    if (index < 0) return false;
    used.add(index);
  }
  return true;
}

/**
 * Exact sorted-token match, or same final two tokens with abbreviated given names
 * (e.g. "Chamakura Malla Reddy" ↔ "Ch. Malla Reddy").
 */
export function archiveNamesMatch(left, right) {
  if (normalizeArchiveName(left) === normalizeArchiveName(right)) return true;
  const leftTokens = archiveNameTokens(left);
  const rightTokens = archiveNameTokens(right);
  if (leftTokens.length < 3 || rightTokens.length < 3) return false;
  if (leftTokens.at(-1) !== rightTokens.at(-1) || leftTokens.at(-2) !== rightTokens.at(-2)) return false;
  return givenNamesCompatible(leftTokens.slice(0, -2), rightTokens.slice(0, -2));
}

export function normalizeConstituencyLabel(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * @param {Array<{year:number,assets:number,sourceUrl:string,state?:string,constituency?:string,chamber?:string,electionFolder?:string,candidateId?:number}>} rows
 * @param {{year?:number,constituency?:string,assets?:number}|null} prefer
 */
export function buildSafeAssetTrail(rows, prefer = null) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const byYear = new Map();
  for (const row of rows) {
    if (!Number.isFinite(row?.year) || !Number.isFinite(row?.assets)) continue;
    if (!byYear.has(row.year)) byYear.set(row.year, new Map());
    const assetsMap = byYear.get(row.year);
    if (!assetsMap.has(row.assets)) assetsMap.set(row.assets, []);
    assetsMap.get(row.assets).push(row);
  }

  if (byYear.size === 0) return null;

  const preferConstituency = normalizeConstituencyLabel(prefer?.constituency ?? "");
  const preferYear = Number.isFinite(prefer?.year) ? prefer.year : null;
  const preferAssets = Number.isFinite(prefer?.assets) ? prefer.assets : null;

  for (const [year, assetsMap] of [...byYear.entries()]) {
    if (assetsMap.size <= 1) continue;

    let keep = null;
    if (preferConstituency) {
      const matching = [...assetsMap.entries()].filter(([, yearRows]) => (
        yearRows.some((row) => normalizeConstituencyLabel(row.constituency) === preferConstituency)
      ));
      if (matching.length === 1) keep = matching[0][0];
    }
    if (keep === null && preferYear === year && preferAssets !== null && assetsMap.has(preferAssets)) {
      keep = preferAssets;
    }
    if (keep === null) {
      // Unresolvable dual candidacy / namesake clash: skip the year, keep the trail.
      byYear.delete(year);
      continue;
    }
    for (const assets of [...assetsMap.keys()]) {
      if (assets !== keep) assetsMap.delete(assets);
    }
  }

  if (byYear.size === 0) return null;

  const points = [];
  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const assetsMap = byYear.get(year);
    const assets = [...assetsMap.keys()][0];
    const candidates = assetsMap.get(assets);
    let sample = candidates[0];
    if (preferConstituency) {
      sample = candidates.find((row) => normalizeConstituencyLabel(row.constituency) === preferConstituency) ?? sample;
    }
    points.push({
      year,
      assets,
      sourceUrl: sample.sourceUrl,
      state: sample.state ?? null,
      constituency: sample.constituency ?? null,
      chamber: sample.chamber ?? null,
      electionFolder: sample.electionFolder ?? null,
      candidateId: sample.candidateId ?? null,
    });
  }

  return points;
}

/**
 * Index candidacy-like rows by normalized name.
 * @param {Iterable<object>} rows
 * @param {(row:object)=>object|null} mapRow
 */
export function indexRowsByNormalizedName(rows, mapRow) {
  const byName = new Map();
  const bySurname = new Map();
  for (const raw of rows) {
    const row = mapRow(raw);
    if (!row) continue;
    const key = row.normalizedName;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
    const surname = archiveSurnameKey(row.name);
    if (!surname) continue;
    if (!bySurname.has(surname)) bySurname.set(surname, new Set());
    bySurname.get(surname).add(key);
  }
  return { byName, bySurname };
}

/** Exact name bucket plus abbreviated given-name variants sharing the same surname key. */
export function collectCandidacyRowsForName(index, name) {
  const { byName, bySurname } = index;
  const exact = normalizeArchiveName(name);
  const collected = [...(byName.get(exact) ?? [])];
  const seen = new Set(collected);
  const surname = archiveSurnameKey(name);
  if (!surname) return collected;
  for (const key of bySurname.get(surname) ?? []) {
    if (key === exact) continue;
    const group = byName.get(key) ?? [];
    const sampleName = group[0]?.name;
    if (!sampleName || !archiveNamesMatch(name, sampleName)) continue;
    for (const row of group) {
      if (seen.has(row)) continue;
      seen.add(row);
      collected.push(row);
    }
  }
  return collected;
}

export function findUniqueWinnerMatch(snapshotRecord, winnerRecords, normalizeName = normalizeArchiveName) {
  const normalizedName = normalizeName(snapshotRecord.name);
  const matches = winnerRecords.filter((winner) => (
    winner.state === snapshotRecord.state
    && winner.electionYear === snapshotRecord.electionYear
    && (
      (typeof snapshotRecord.assets === "number" && winner.assets === snapshotRecord.assets)
      || (snapshotRecord.candidateId && winner.candidateId === snapshotRecord.candidateId
        && winner.electionFolder === snapshotRecord.electionFolder)
    )
    && normalizeName(winner.name) === normalizedName
  ));
  return matches.length === 1 ? matches[0] : null;
}

export function buildSittingHistoryEntry({
  snapshotRecord,
  winnerMatch,
  candidacyRows,
  normalizeName = normalizeArchiveName,
  chamber = "assembly",
  fallbackSourceUrl = "https://adrindia.org/sites/default/files/All_India_Sitting_MLAs_Report_2025_English.pdf",
}) {
  const normalizedName = normalizeName(snapshotRecord.name);
  // candidacyRows may include abbreviated given-name variants of the same person.
  const scoped = candidacyRows.filter((row) => (
    row.normalizedName === normalizedName
    || archiveNamesMatch(snapshotRecord.name, row.name)
  ));

  // Always include the current snapshot declaration as an anchor row.
  scoped.push({
    normalizedName,
    name: snapshotRecord.name,
    year: snapshotRecord.electionYear,
    assets: snapshotRecord.assets,
    sourceUrl: winnerMatch?.candidateUrl
      || snapshotRecord.candidateUrl
      || fallbackSourceUrl,
    state: snapshotRecord.state,
    constituency: snapshotRecord.constituency,
    chamber,
    electionFolder: winnerMatch?.electionFolder ?? snapshotRecord.electionFolder ?? null,
    candidateId: winnerMatch?.candidateId ?? snapshotRecord.candidateId ?? null,
    electionState: snapshotRecord.state,
  });

  const points = buildSafeAssetTrail(scoped, {
    year: snapshotRecord.electionYear,
    constituency: snapshotRecord.constituency,
    assets: snapshotRecord.assets,
  });
  if (!points) return null;

  return {
    rank: snapshotRecord.rank,
    name: snapshotRecord.name,
    normalizedName,
    state: snapshotRecord.state,
    constituency: snapshotRecord.constituency,
    electionYear: snapshotRecord.electionYear,
    winnerElectionFolder: winnerMatch?.electionFolder ?? null,
    winnerCandidateId: winnerMatch?.candidateId ?? null,
    points,
  };
}
