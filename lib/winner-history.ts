export type WinnerHistoryRecord = {
  state: string;
  normalizedConstituency: string;
  electionFolder: string;
  electionYear: number;
  electionDate?: string;
};

function validElectionDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function effectiveElectionYear(record: WinnerHistoryRecord): number {
  const date = validElectionDate(record.electionDate);
  return date ? Number(date.slice(0, 4)) : record.electionYear;
}

export function compareWinnerElections(
  left: WinnerHistoryRecord,
  right: WinnerHistoryRecord,
): number {
  const yearDifference = effectiveElectionYear(left) - effectiveElectionYear(right);
  if (yearDifference) return yearDifference;

  const leftDate = validElectionDate(left.electionDate) ?? `${left.electionYear}-00-00`;
  const rightDate = validElectionDate(right.electionDate) ?? `${right.electionYear}-00-00`;
  return leftDate.localeCompare(rightDate)
    || left.electionFolder.localeCompare(right.electionFolder);
}

/**
 * A published constituency label is not a stable seat identifier. If one
 * state/label group contains multiple winners for the same source election,
 * the archive cannot prove that those rows belong to one seat lineage.
 */
export function hasAmbiguousSeatLineage(records: readonly WinnerHistoryRecord[]): boolean {
  const dates = new Set<string>();
  const folders = new Map<string, WinnerHistoryRecord[]>();

  for (const record of records) {
    const date = validElectionDate(record.electionDate);
    if (date) {
      if (dates.has(date)) return true;
      dates.add(date);
    }

    const folder = record.electionFolder.toLowerCase();
    folders.set(folder, [...(folders.get(folder) ?? []), record]);
  }

  for (const rows of folders.values()) {
    if (rows.length < 2) continue;
    const distinctDates = new Set(rows.map((row) => validElectionDate(row.electionDate)));
    if (distinctDates.has(null) || distinctDates.size !== rows.length) return true;
  }

  return false;
}

export function buildDisplayableSeatHistories<T extends WinnerHistoryRecord>(
  records: readonly T[],
): T[][] {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = `${record.state}|${record.normalizedConstituency}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return [...groups.values()]
    .filter((rows) => !hasAmbiguousSeatLineage(rows))
    .map((rows) => [...rows].sort(compareWinnerElections));
}
