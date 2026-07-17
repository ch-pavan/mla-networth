import { readFile } from "node:fs/promises";

export const DEFAULT_ELECTION_MANIFEST_URL = new URL(
  "../../data/election-manifest.json",
  import.meta.url,
);

const AVAILABILITY = new Set(["imported", "verified-not-imported"]);
const REVIEW_BASIS = new Set([
  "local-candidate-archive",
  "public-folder-review",
]);

function assertRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function assertExactKeys(value, expected, path) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TypeError(
      `${path} must contain exactly: ${wanted.join(", ")}; received: ${actual.join(", ")}`,
    );
  }
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty, trimmed string`);
  }
}

function validateIndexUrl(indexUrl, folder, path) {
  assertNonEmptyString(indexUrl, path);

  let parsed;
  try {
    parsed = new URL(indexUrl);
  } catch {
    throw new TypeError(`${path} must be an absolute URL`);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "www.myneta.info" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== `/${folder}/index.php`
  ) {
    throw new TypeError(
      `${path} must be the canonical MyNeta index URL for folder ${folder}`,
    );
  }
}

function validateCommonEntry(entry, path) {
  assertNonEmptyString(entry.state, `${path}.state`);
  if (!Number.isInteger(entry.year) || entry.year < 1900 || entry.year > 2100) {
    throw new TypeError(`${path}.year must be an integer from 1900 through 2100`);
  }
  assertNonEmptyString(entry.folder, `${path}.folder`);
  if (!/^[A-Za-z0-9]+$/.test(entry.folder)) {
    throw new TypeError(`${path}.folder may contain only ASCII letters and digits`);
  }
  validateIndexUrl(entry.indexUrl, entry.folder, `${path}.indexUrl`);
  if (!REVIEW_BASIS.has(entry.reviewBasis)) {
    throw new TypeError(`${path}.reviewBasis is not supported`);
  }
}

function compareEntries(left, right) {
  return (
    left.state.localeCompare(right.state, "en") ||
    right.year - left.year ||
    left.folder.localeCompare(right.folder, "en")
  );
}

export function validateElectionManifest(manifest) {
  assertRecord(manifest, "manifest");
  assertExactKeys(
    manifest,
    [
      "schemaVersion",
      "source",
      "review",
      "availabilitySemantics",
      "exclusions",
      "elections",
    ],
    "manifest",
  );

  if (manifest.schemaVersion !== 1) {
    throw new TypeError("manifest.schemaVersion must be 1");
  }

  assertRecord(manifest.source, "manifest.source");
  assertExactKeys(manifest.source, ["name", "origin"], "manifest.source");
  assertNonEmptyString(manifest.source.name, "manifest.source.name");
  if (manifest.source.origin !== "https://www.myneta.info") {
    throw new TypeError(
      "manifest.source.origin must be https://www.myneta.info",
    );
  }

  assertRecord(manifest.review, "manifest.review");
  assertExactKeys(
    manifest.review,
    ["status", "reviewedAt", "method"],
    "manifest.review",
  );
  if (manifest.review.status !== "reviewed") {
    throw new TypeError('manifest.review.status must be "reviewed"');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.review.reviewedAt)) {
    throw new TypeError("manifest.review.reviewedAt must be an ISO date");
  }
  const reviewedDate = new Date(`${manifest.review.reviewedAt}T00:00:00Z`);
  if (
    Number.isNaN(reviewedDate.valueOf()) ||
    reviewedDate.toISOString().slice(0, 10) !== manifest.review.reviewedAt
  ) {
    throw new TypeError("manifest.review.reviewedAt must be a real calendar date");
  }
  assertNonEmptyString(manifest.review.method, "manifest.review.method");

  assertRecord(
    manifest.availabilitySemantics,
    "manifest.availabilitySemantics",
  );
  assertExactKeys(
    manifest.availabilitySemantics,
    ["imported", "verified-not-imported", "excluded"],
    "manifest.availabilitySemantics",
  );
  for (const key of ["imported", "verified-not-imported", "excluded"]) {
    assertNonEmptyString(
      manifest.availabilitySemantics[key],
      `manifest.availabilitySemantics.${key}`,
    );
  }

  if (!Array.isArray(manifest.elections) || manifest.elections.length === 0) {
    throw new TypeError("manifest.elections must be a non-empty array");
  }
  if (!Array.isArray(manifest.exclusions)) {
    throw new TypeError("manifest.exclusions must be an array");
  }

  const seenFolders = new Set();
  const seenElections = new Set();
  for (const [index, entry] of manifest.elections.entries()) {
    const path = `manifest.elections[${index}]`;
    assertRecord(entry, path);
    assertExactKeys(
      entry,
      ["state", "year", "folder", "indexUrl", "availability", "reviewBasis"],
      path,
    );
    validateCommonEntry(entry, path);
    if (!AVAILABILITY.has(entry.availability)) {
      throw new TypeError(`${path}.availability is not supported`);
    }
    if (
      entry.availability === "imported" &&
      entry.reviewBasis !== "local-candidate-archive"
    ) {
      throw new TypeError(
        `${path} imported entries require local-candidate-archive reviewBasis`,
      );
    }
    if (
      entry.availability === "verified-not-imported" &&
      entry.reviewBasis !== "public-folder-review"
    ) {
      throw new TypeError(
        `${path} verified-not-imported entries require public-folder-review reviewBasis`,
      );
    }

    const folderKey = entry.folder.toLowerCase();
    const electionKey = `${entry.state.toLowerCase()}\u0000${entry.year}`;
    if (seenFolders.has(folderKey)) {
      throw new TypeError(`${path}.folder duplicates another manifest folder`);
    }
    if (seenElections.has(electionKey)) {
      throw new TypeError(`${path} duplicates another state/year election`);
    }
    seenFolders.add(folderKey);
    seenElections.add(electionKey);

    if (index > 0 && compareEntries(manifest.elections[index - 1], entry) > 0) {
      throw new TypeError(
        "manifest.elections must be sorted by state, descending year, then folder",
      );
    }
  }

  for (const [index, entry] of manifest.exclusions.entries()) {
    const path = `manifest.exclusions[${index}]`;
    assertRecord(entry, path);
    assertExactKeys(
      entry,
      [
        "state",
        "year",
        "folder",
        "indexUrl",
        "availability",
        "reviewBasis",
        "reason",
      ],
      path,
    );
    validateCommonEntry(entry, path);
    if (entry.availability !== "excluded") {
      throw new TypeError(`${path}.availability must be excluded`);
    }
    if (entry.reviewBasis !== "public-folder-review") {
      throw new TypeError(`${path}.reviewBasis must be public-folder-review`);
    }
    assertNonEmptyString(entry.reason, `${path}.reason`);

    const folderKey = entry.folder.toLowerCase();
    const electionKey = `${entry.state.toLowerCase()}\u0000${entry.year}`;
    if (seenFolders.has(folderKey) || seenElections.has(electionKey)) {
      throw new TypeError(`${path} overlaps an included election`);
    }
    seenFolders.add(folderKey);
    seenElections.add(electionKey);
  }

  return manifest;
}

export async function loadElectionManifest(
  manifestUrl = DEFAULT_ELECTION_MANIFEST_URL,
) {
  const source = await readFile(manifestUrl, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(`Invalid election manifest JSON: ${error.message}`);
  }
  return validateElectionManifest(manifest);
}
