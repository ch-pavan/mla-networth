/**
 * Build multi-election affidavit trails from imported MyNeta archives.
 *
 * Same-year dual candidacies are resolved for every person the same way:
 * 1. same assets in both seats → keep one point
 * 2. different assets → keep the seat matching the current constituency
 * 3. else if the conflict year is the current declaration → keep current assets
 * 4. else omit that year only (do not discard the rest of the trail)
 */

export function normalizeArchiveName(name) {
  const collapsed = String(name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[.'']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\bchandra babu\b/g, "chandrababu");

  return collapsed
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
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
  for (const raw of rows) {
    const row = mapRow(raw);
    if (!row) continue;
    const key = row.normalizedName;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }
  return byName;
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
  // candidacyRows are already name-keyed; include every state/chamber for that identity.
  const scoped = candidacyRows.filter((row) => row.normalizedName === normalizedName);

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
