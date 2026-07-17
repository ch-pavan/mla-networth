const MONEY_STATUSES = ["parsed", "nil", "masked", "missing"];

/**
 * Convert the limited HTML found in MyNeta summary-table cells to plain text.
 * This is intentionally not a general-purpose HTML parser.
 */
export function decodeMynetaCell(cell) {
  return String(cell ?? "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#160;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a MyNeta monetary table cell without treating unavailable data as ₹0.
 *
 * `nil` is the source's explicit declaration of no amount and therefore has a
 * numeric value of zero. Empty and non-numeric/masked cells retain `null` and
 * their source text so downstream consumers cannot mistake them for zero.
 */
export function parseMynetaMoneyCell(cell) {
  const source = String(cell ?? "");
  const raw = decodeMynetaCell(source);
  if (/<img\b[^>]*\b(?:src\s*=\s*["']?[^>]*image_v2\.php|col\s*=\s*["']?(?:ta|lia)\b)/i.test(source)) {
    return { value: null, status: "masked", raw };
  }
  if (!raw) return { value: null, status: "missing", raw };
  if (/^nil\.?$/i.test(raw)) return { value: 0, status: "nil", raw };

  const amountMatch = raw.match(/(?:₹|Rs\.?|INR)\s*:?[ \u00a0]*([0-9][0-9,]*)/i)
    ?? raw.match(/^([0-9][0-9,]*)$/);
  if (!amountMatch) return { value: null, status: "masked", raw };

  const digits = amountMatch[1].replaceAll(",", "");
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value < 0) {
    return { value: null, status: "masked", raw };
  }

  return { value, status: "parsed", raw };
}

function isoDate(dayText, monthText, yearText) {
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;

  return `${yearText.padStart(4, "0")}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
}

/**
 * Separate record-level by-election details embedded in MyNeta constituency
 * labels. The containing election's year remains the fallback for ordinary and
 * "before bye-election" records.
 */
export function parseMynetaConstituencyLabel(label, containingElectionYear) {
  const constituency = decodeMynetaCell(label);
  const beforeMatch = constituency.match(
    /^(.+?)\s*(?::\s*|\(\s*)BEFORE\s+BYE\s*-?\s*ELECTION\s*\)?\s*$/i,
  );
  if (beforeMatch) {
    return {
      baseConstituency: beforeMatch[1].trim(),
      electionType: "general",
      electionDate: null,
      electionYear: containingElectionYear,
    };
  }

  const byElectionMatch = constituency.match(
    /^(.+?)\s*(?::\s*|\(\s*)BYE\s*-?\s*ELECTION(?:\s+ON)?\s+(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*\)?\s*$/i,
  );
  if (byElectionMatch) {
    const electionDate = isoDate(byElectionMatch[2], byElectionMatch[3], byElectionMatch[4]);
    if (electionDate) {
      return {
        baseConstituency: byElectionMatch[1].trim(),
        electionType: "by-election",
        electionDate,
        electionYear: Number(byElectionMatch[4]),
      };
    }
  }

  return {
    baseConstituency: constituency,
    electionType: "general",
    electionDate: null,
    electionYear: containingElectionYear,
  };
}

export function countMynetaRecordStatuses(records) {
  const counts = {
    assets: Object.fromEntries(MONEY_STATUSES.map((status) => [status, 0])),
    liabilities: Object.fromEntries(MONEY_STATUSES.map((status) => [status, 0])),
  };

  for (const record of records) {
    for (const field of ["assets", "liabilities"]) {
      const status = record[`${field}Status`];
      if (!MONEY_STATUSES.includes(status)) {
        throw new Error(`Unknown ${field} status: ${String(status)}`);
      }
      counts[field][status] += 1;
    }
  }

  return counts;
}

export function sumMynetaRecordStatusCounts(summaries) {
  const total = countMynetaRecordStatuses([]);
  for (const summary of summaries) {
    for (const field of ["assets", "liabilities"]) {
      for (const status of MONEY_STATUSES) total[field][status] += summary[field][status];
    }
  }
  return total;
}
