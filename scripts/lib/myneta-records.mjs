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

/**
 * Parse MyNeta Rajya Sabha constituency / heading labels such as
 * `UP (2024-2030) JAYA AMITABH BACHCHAN` or `WEST BENGAL (2017-2023) NAME`.
 */
export function parseRajyaSabhaTermLabel(label) {
  const text = decodeMynetaCell(label);
  const match = text.match(/^(.*?)\s*\((\d{4})\s*[-–]\s*(\d{4})\)\s*(.*)$/i);
  if (!match) {
    return { label: text, stateHint: null, termFrom: null, termTo: null, remainder: text };
  }
  const stateHint = match[1].replace(/[-–]\s*$/, "").trim() || null;
  return {
    label: text,
    stateHint,
    termFrom: Number(match[2]),
    termTo: Number(match[3]),
    remainder: match[4].trim(),
  };
}

const RAJYA_SABHA_STATE_ALIASES = new Map(Object.entries({
  "andaman and nicobar islands": "Andaman and Nicobar Islands",
  "andhra pradesh": "Andhra Pradesh",
  "arunachal pradesh": "Arunachal Pradesh",
  assam: "Assam",
  bihar: "Bihar",
  chhattisgarh: "Chhattisgarh",
  goa: "Goa",
  gujarat: "Gujarat",
  haryana: "Haryana",
  "himachal pradesh": "Himachal Pradesh",
  "jammu and kashmir": "Jammu and Kashmir",
  jharkhand: "Jharkhand",
  karnataka: "Karnataka",
  kerala: "Kerala",
  "madhya pradesh": "Madhya Pradesh",
  maharashtra: "Maharashtra",
  manipur: "Manipur",
  meghalaya: "Meghalaya",
  mizoram: "Mizoram",
  nagaland: "Nagaland",
  odisha: "Odisha",
  orissa: "Odisha",
  puducherry: "Puducherry",
  punjab: "Punjab",
  rajasthan: "Rajasthan",
  sikkim: "Sikkim",
  "tamil nadu": "Tamil Nadu",
  telangana: "Telangana",
  tripura: "Tripura",
  "uttar pradesh": "Uttar Pradesh",
  uttarakhand: "Uttarakhand",
  "west bengal": "West Bengal",
  "nct of delhi": "NCT of Delhi",
  delhi: "NCT of Delhi",
  "nominated": "Nominated",
  up: "Uttar Pradesh",
  "u.p.": "Uttar Pradesh",
  "u.p": "Uttar Pradesh",
  wb: "West Bengal",
  "w.b.": "West Bengal",
  mp: "Madhya Pradesh",
  "m.p.": "Madhya Pradesh",
  "m.p": "Madhya Pradesh",
  tn: "Tamil Nadu",
  "t.n.": "Tamil Nadu",
  ap: "Andhra Pradesh",
  "a.p.": "Andhra Pradesh",
  hp: "Himachal Pradesh",
  "h.p.": "Himachal Pradesh",
  jk: "Jammu and Kashmir",
  "j&k": "Jammu and Kashmir",
  rj: "Rajasthan",
  mh: "Maharashtra",
  gj: "Gujarat",
  ka: "Karnataka",
  kl: "Kerala",
  pb: "Punjab",
  hr: "Haryana",
  cg: "Chhattisgarh",
  ct: "Chhattisgarh",
  od: "Odisha",
  or: "Odisha",
  ts: "Telangana",
  tg: "Telangana",
  uk: "Uttarakhand",
  ua: "Uttarakhand",
  ml: "Meghalaya",
  mn: "Manipur",
  mz: "Mizoram",
  nl: "Nagaland",
  sk: "Sikkim",
  tr: "Tripura",
  ar: "Arunachal Pradesh",
  as: "Assam",
  br: "Bihar",
  jh: "Jharkhand",
  ga: "Goa",
  py: "Puducherry",
  dl: "NCT of Delhi",
}));

export function canonicalizeRajyaSabhaState(value) {
  const raw = decodeMynetaCell(value).toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (RAJYA_SABHA_STATE_ALIASES.has(raw)) return RAJYA_SABHA_STATE_ALIASES.get(raw);
  const stripped = raw.replace(/\d+$/g, "").replace(/[.-]+$/g, "").trim();
  if (RAJYA_SABHA_STATE_ALIASES.has(stripped)) return RAJYA_SABHA_STATE_ALIASES.get(stripped);
  // Title-case long names already close to canonical.
  if (raw.length > 3 && !/^[a-z]{1,3}\d*$/i.test(raw)) {
    return raw.replace(/\b\w/g, (character) => character.toUpperCase());
  }
  return null;
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
