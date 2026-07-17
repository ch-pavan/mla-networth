export type AssetComparison = {
  state: string;
  currentYear: number;
  previousYear: number;
  name?: string;
  normalizedName?: string;
  currentAssets: number;
  previousAssets: number;
  comparisonUrl: string;
};

export type AssetHistoryAnchor = {
  state: string;
  electionYear: number;
  name: string;
  assets: number;
  sourceUrl: string;
};

export type VerifiedAssetHistoryPoint = {
  year: number;
  assets: number;
  sourceUrl: string;
};

export function normalizePersonName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[.']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Builds a backwards affidavit trail from a known current record.
 *
 * A comparison is accepted only when state, normalized name, current year, and
 * current asset value exactly match the point already in the chain. Ambiguous
 * links stop the chain instead of guessing which person or declaration to use.
 */
export function buildVerifiedAssetHistory(
  anchor: AssetHistoryAnchor,
  comparisons: readonly AssetComparison[],
): VerifiedAssetHistoryPoint[] {
  const normalizedName = normalizePersonName(anchor.name);
  const eligible = comparisons.filter((comparison) => {
    const comparisonName = comparison.normalizedName || comparison.name || "";
    return comparison.state === anchor.state
      && normalizePersonName(comparisonName) === normalizedName
      && Number.isFinite(comparison.currentAssets)
      && Number.isFinite(comparison.previousAssets)
      && comparison.previousYear < comparison.currentYear;
  });

  const points: VerifiedAssetHistoryPoint[] = [{
    year: anchor.electionYear,
    assets: anchor.assets,
    sourceUrl: anchor.sourceUrl,
  }];
  const visited = new Set<string>();
  let currentYear = anchor.electionYear;
  let currentAssets = anchor.assets;

  while (true) {
    const linkKey = `${currentYear}|${currentAssets}`;
    if (visited.has(linkKey)) break;
    visited.add(linkKey);

    const matches = eligible.filter((comparison) => (
      comparison.currentYear === currentYear
      && comparison.currentAssets === currentAssets
    ));
    if (matches.length !== 1) break;

    const match = matches[0];
    if (points.length === 1) points[0] = { ...points[0], sourceUrl: match.comparisonUrl };
    points.unshift({
      year: match.previousYear,
      assets: match.previousAssets,
      sourceUrl: match.comparisonUrl,
    });
    currentYear = match.previousYear;
    currentAssets = match.previousAssets;
  }

  return points;
}
