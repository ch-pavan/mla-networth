import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeMynetaCell, parseMynetaMoneyCell } from "./myneta-records.mjs";

export const ARCHIVE_PARSER_VERSION = 5;
export const PROFILE_CACHE_VERSION = 1;
export const MONEY_FIELDS = ["assets", "liabilities"];

const VALID_MONEY_STATUSES = new Set(["parsed", "nil", "masked", "missing"]);

function missingMoney() {
  return { value: null, status: "missing", raw: "" };
}

function validateMoneyResult(value, context) {
  if (
    value === null
    || typeof value !== "object"
    || !VALID_MONEY_STATUSES.has(value.status)
    || !(value.value === null || (Number.isSafeInteger(value.value) && value.value >= 0))
    || typeof value.raw !== "string"
  ) {
    throw new TypeError(`Invalid cached money result for ${context}`);
  }
  if ((value.status === "parsed" || value.status === "nil") !== (value.value !== null)) {
    throw new TypeError(`Inconsistent cached money result for ${context}`);
  }
  return value;
}

/** Parse the top-level Assets and Liabilities rows published on a candidate profile. */
export function parseCandidateProfileMoney(html) {
  const result = {
    assets: missingMoney(),
    liabilities: missingMoney(),
  };
  const found = new Set();

  for (const row of String(html ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (match) => match[1],
    );
    if (cells.length < 2) continue;
    const label = decodeMynetaCell(cells[0]).replace(/\s*:\s*$/, "").toLowerCase();
    if (!MONEY_FIELDS.includes(label)) continue;

    const parsed = parseMynetaMoneyCell(cells[1]);
    if (found.has(label)) {
      const existing = result[label];
      if (existing.value !== parsed.value || existing.status !== parsed.status) {
        throw new Error(`Candidate profile contains conflicting ${label} rows`);
      }
      continue;
    }
    result[label] = parsed;
    found.add(label);
  }

  return result;
}

/** Parse Age (and Sex/Gender when present) from a MyNeta candidate profile page. */
export function parseCandidateProfileIdentity(html) {
  const text = String(html ?? "");
  const ageMatch = text.match(/<b>\s*Age\s*:?\s*<\/b>\s*(\d{1,3})\b/i);
  const ageValue = ageMatch ? Number(ageMatch[1]) : null;
  const age = Number.isInteger(ageValue) && ageValue > 0 && ageValue < 120 ? ageValue : null;

  const sexMatch = text.match(/<b>\s*(?:Sex|Gender)\s*:?\s*<\/b>\s*([A-Za-z]+)/i);
  let gender = null;
  if (sexMatch) {
    const raw = sexMatch[1].trim().toLowerCase();
    if (raw.startsWith("m")) gender = "M";
    else if (raw.startsWith("f")) gender = "F";
  }

  return { age, gender };
}

export function candidateProfileUrl(election, candidateId) {
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) {
    throw new TypeError("candidateId must be a positive safe integer");
  }
  const url = new URL(election.indexUrl);
  url.pathname = url.pathname.replace(/index\.php$/, "candidate.php");
  url.searchParams.set("candidate_id", String(candidateId));
  return url.toString();
}

export function summaryUrl(election, page, { sort, subAction }) {
  if (!Number.isSafeInteger(page) || page <= 0) {
    throw new TypeError("page must be a positive safe integer");
  }
  const url = new URL(election.indexUrl);
  url.searchParams.set("action", "summary");
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", sort);
  url.searchParams.set("subAction", subAction);
  return url.toString();
}

export function createLimiter(maximum) {
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    throw new TypeError("maximum must be a positive safe integer");
  }
  let active = 0;
  const waiting = [];

  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  return async function limit(operation) {
    if (active >= maximum) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

export function hasContiguousRanks(records, rankField) {
  if (!records.length) return false;
  const ranks = records.map((record) => record[rankField]);
  if (ranks.some((rank) => !Number.isSafeInteger(rank) || rank <= 0)) return false;
  const unique = new Set(ranks);
  if (unique.size !== records.length) return false;
  return Math.max(...ranks) === records.length;
}

export async function writeJsonAtomic(file, value) {
  const target = file instanceof URL ? file : pathToFileURL(resolve(file));
  await mkdir(new URL("./", target), { recursive: true });
  const temporary = new URL(`${target.pathname}.${process.pid}.${Date.now()}.tmp`, target);
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx" });
  await rename(temporary, target);
}

export function needsCandidateProfile(record) {
  return MONEY_FIELDS.some((field) => record[`${field}Status`] === "masked" || record[`${field}Status`] === "missing");
}

export function applyCandidateProfileMoney(record, profileMoney, profileAvailable = true) {
  const next = { ...record };
  for (const field of MONEY_FIELDS) {
    const statusKey = `${field}Status`;
    const sourceKey = `${field}Source`;
    if (record[statusKey] === "parsed" || record[statusKey] === "nil") {
      next[sourceKey] = "summary";
      continue;
    }

    if (!profileAvailable) {
      next[sourceKey] = "unavailable";
      continue;
    }

    const profileValue = validateMoneyResult(profileMoney[field], field);
    next[field] = profileValue.value;
    next[statusKey] = profileValue.status;
    next[sourceKey] = "candidate-profile";
  }
  return next;
}

export function reconcileWinnerMoney(winner, candidate) {
  if (!candidate) {
    throw new Error(`Winner ${winner.electionFolder}/${winner.candidateId} is missing from the candidate archive`);
  }

  const next = { ...winner };
  const moneyConflicts = {};
  for (const field of MONEY_FIELDS) {
    const winnerValue = winner[field];
    const candidateValue = candidate[field];
    if (winnerValue !== null && candidateValue !== null && winnerValue !== candidateValue) {
      moneyConflicts[field] = {
        winnerSummary: { value: winnerValue, status: winner[`${field}Status`] },
        candidateArchive: {
          value: candidateValue,
          status: candidate[`${field}Status`],
          source: candidate[`${field}Source`] ?? "candidate-archive",
        },
      };
    }

    if (candidateValue !== null) {
      next[field] = candidateValue;
      next[`${field}Status`] = candidate[`${field}Status`];
      next[`${field}Source`] = "candidate-archive";
    } else {
      next[`${field}Source`] = winner[`${field}Source`] ?? "winner-summary";
    }
  }
  if (Object.keys(moneyConflicts).length) next.moneyConflicts = moneyConflicts;
  return next;
}

function profileCacheFile(cacheRoot, election, candidateId) {
  return new URL(
    `${encodeURIComponent(election.folder.toLowerCase())}/${candidateId}.json`,
    cacheRoot,
  );
}

async function readProfileCache(file, expectedUrl) {
  try {
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (
      cached.cacheVersion !== PROFILE_CACHE_VERSION
      || cached.url !== expectedUrl
      || ![200, 404, 410].includes(cached.httpStatus)
      || typeof cached.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(cached.sha256)
    ) return null;

    if (cached.httpStatus === 200) {
      return {
        available: true,
        httpStatus: cached.httpStatus,
        sha256: cached.sha256,
        money: {
          assets: validateMoneyResult(cached.money?.assets, "assets"),
          liabilities: validateMoneyResult(cached.money?.liabilities, "liabilities"),
        },
        cacheHit: true,
      };
    }
    return {
      available: false,
      httpStatus: cached.httpStatus,
      sha256: cached.sha256,
      money: null,
      cacheHit: true,
    };
  } catch {
    return null;
  }
}

async function writeProfileCache(file, payload) {
  await writeJsonAtomic(file, payload);
}

/**
 * Fetch and cache a parsed candidate profile. Successful and definitive 404/410
 * responses are cached atomically. Transient failures are retried and never
 * cached, so a later generator run resumes from the successful checkpoints.
 */
export async function fetchCandidateProfileMoney({
  election,
  candidateId,
  cacheRoot,
  fetchImpl = fetch,
  attempts = 3,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const url = candidateProfileUrl(election, candidateId);
  const cacheFile = profileCacheFile(cacheRoot, election, candidateId);
  const cached = await readProfileCache(cacheFile, url);
  if (cached) return cached;

  let latestError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "user-agent": "NetaWorth public-interest data index; source attribution included" },
      });
      const body = await response.text();
      const sha256 = createHash("sha256").update(body).digest("hex");
      if (response.status === 404 || response.status === 410) {
        const payload = {
          cacheVersion: PROFILE_CACHE_VERSION,
          url,
          httpStatus: response.status,
          sha256,
        };
        await writeProfileCache(cacheFile, payload);
        return { available: false, httpStatus: response.status, sha256, money: null, cacheHit: false };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const money = parseCandidateProfileMoney(body);
      const payload = {
        cacheVersion: PROFILE_CACHE_VERSION,
        url,
        httpStatus: response.status,
        sha256,
        money,
      };
      await writeProfileCache(cacheFile, payload);
      return { available: true, httpStatus: response.status, sha256, money, cacheHit: false };
    } catch (error) {
      latestError = error;
      if (attempt < attempts) await sleep(attempt * 1_000);
    }
  }
  throw new Error(`Failed to fetch ${url} after ${attempts} attempts`, { cause: latestError });
}
