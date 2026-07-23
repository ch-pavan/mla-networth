export type AssetComparison = {
  state: string;
  currentYear: number;
  previousYear: number;
  name?: string;
  normalizedName?: string;
  currentAssets: number;
  previousAssets: number;
  comparisonUrl: string;
  identityReviewStatus?: "source-linked" | "review-required";
  eligibleForProfileHistory?: boolean;
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

export type ArchiveHistoryPoint = {
  year: number;
  assets: number;
  sourceUrl: string;
  state?: string | null;
  constituency?: string | null;
  chamber?: string | null;
};

export function normalizePersonName(name: string): string {
  const collapsed = name
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

/**
 * Prefer the longer imported-archive trail when it includes the current
 * declaration. Otherwise keep the exact-asset recontest chain.
 */
export function selectAssetHistory(
  anchor: AssetHistoryAnchor,
  comparisons: readonly AssetComparison[],
  archivePoints?: readonly ArchiveHistoryPoint[] | null,
): VerifiedAssetHistoryPoint[] {
  const recontest = buildVerifiedAssetHistory(anchor, comparisons);
  if (!archivePoints?.length) return recontest;

  const normalized = archivePoints
    .filter((point) => Number.isFinite(point.year) && Number.isFinite(point.assets) && point.sourceUrl)
    .map((point) => ({
      year: point.year,
      assets: point.assets,
      sourceUrl: point.sourceUrl,
    }))
    .sort((left, right) => left.year - right.year || left.assets - right.assets);

  if (!normalized.length) return recontest;

  const last = normalized.at(-1)!;
  const anchorsCurrent = last.year === anchor.electionYear && last.assets === anchor.assets;
  if (!anchorsCurrent) return recontest;
  if (normalized.length < recontest.length) return recontest;

  return normalized.map((point, index) => (
    index === normalized.length - 1
      ? { ...point, sourceUrl: anchor.sourceUrl || point.sourceUrl }
      : point
  ));
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
    return comparison.eligibleForProfileHistory !== false
      && comparison.identityReviewStatus !== "review-required"
      && comparison.state === anchor.state
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
