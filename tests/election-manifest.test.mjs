import assert from "node:assert/strict";
import test from "node:test";

import {
  loadElectionManifest,
  validateElectionManifest,
} from "../scripts/lib/election-manifest.mjs";

const REQUIRED_ADDITIONS = [
  ["Assam", 2026, "Assam2026"],
  ["Assam", 2006, "assam2006"],
  ["Bihar", 2025, "Bihar2025"],
  ["Bihar", 2010, "bih2010"],
  ["Bihar", 2005, "bih2005"],
  ["Jammu Kashmir", 2014, "jk2014"],
  ["Jammu Kashmir", 2008, "jk2008"],
  ["Kerala", 2026, "Kerala2026"],
  ["Maharashtra", 2004, "mah2004"],
  ["Odisha", 2004, "orissa2004"],
  ["Puducherry", 2026, "Puducherry2026"],
  ["Sikkim", 2004, "sikkim2004"],
  ["Tamil Nadu", 2026, "TamilNadu2026"],
  ["West Bengal", 2026, "WestBengal2026"],
];

const REQUIRED_LEGACY_FOLDERS = [
  "ap09",
  "jarka09",
  "jarka05",
  "manipur07",
  "utk07",
];

test("reviewed manifest enumerates imported, pending, legacy, and excluded folders", async () => {
  const manifest = await loadElectionManifest();
  assert.equal(manifest.elections.length, 140);
  assert.equal(
    manifest.elections.filter(({ availability }) => availability === "imported")
      .length,
    122,
  );
  assert.equal(
    manifest.elections.filter(
      ({ availability }) => availability === "verified-not-imported",
    ).length,
    18,
  );
  assert.equal(
    manifest.elections.filter((entry) => entry.chamber === "lok_sabha").length,
    5,
  );

  for (const [state, year, folder] of REQUIRED_ADDITIONS) {
    assert.ok(
      manifest.elections.some(
        (entry) =>
          entry.state === state &&
          entry.year === year &&
          entry.folder === folder &&
          entry.availability === "verified-not-imported",
      ),
      `missing reviewed addition ${folder}`,
    );
  }

  for (const folder of REQUIRED_LEGACY_FOLDERS) {
    assert.ok(
      manifest.elections.some(
        (entry) => entry.folder === folder && entry.availability === "imported",
      ),
      `missing retained legacy folder ${folder}`,
    );
  }

  assert.deepEqual(manifest.exclusions, [
    {
      state: "Karnataka",
      year: 2004,
      folder: "karnataka2004",
      indexUrl: "https://www.myneta.info/karnataka2004/index.php",
      availability: "excluded",
      reviewBasis: "public-folder-review",
      reason:
        "Candidate and winner analyzed-summary endpoints returned no pages during review.",
    },
  ]);
});

test("validator rejects schema drift and contradictory availability metadata", async () => {
  const manifest = await loadElectionManifest();

  const unknownField = structuredClone(manifest);
  unknownField.elections[0].complete = true;
  assert.throws(
    () => validateElectionManifest(unknownField),
    /must contain exactly/,
  );

  const unknownAvailability = structuredClone(manifest);
  unknownAvailability.elections[0].availability = "available";
  assert.throws(
    () => validateElectionManifest(unknownAvailability),
    /availability is not supported/,
  );

  const contradictoryBasis = structuredClone(manifest);
  contradictoryBasis.elections[0].reviewBasis = "public-folder-review";
  assert.throws(
    () => validateElectionManifest(contradictoryBasis),
    /imported entries require local-candidate-archive/,
  );
});

test("validator rejects noncanonical URLs, duplicates, overlaps, and ordering", async () => {
  const manifest = await loadElectionManifest();

  const queryUrl = structuredClone(manifest);
  queryUrl.elections[0].indexUrl += "?action=summary";
  assert.throws(
    () => validateElectionManifest(queryUrl),
    /canonical MyNeta index URL/,
  );

  const duplicateFolder = structuredClone(manifest);
  duplicateFolder.elections[1].folder = duplicateFolder.elections[0].folder;
  duplicateFolder.elections[1].indexUrl = duplicateFolder.elections[0].indexUrl;
  assert.throws(
    () => validateElectionManifest(duplicateFolder),
    /duplicates another manifest folder/,
  );

  const overlap = structuredClone(manifest);
  const included = overlap.elections[0];
  overlap.exclusions[0] = {
    ...overlap.exclusions[0],
    state: included.state,
    year: included.year,
    folder: included.folder,
    indexUrl: included.indexUrl,
  };
  assert.throws(
    () => validateElectionManifest(overlap),
    /overlaps an included election/,
  );

  const unsorted = structuredClone(manifest);
  [unsorted.elections[0], unsorted.elections[1]] = [
    unsorted.elections[1],
    unsorted.elections[0],
  ];
  assert.throws(
    () => validateElectionManifest(unsorted),
    /must be sorted/,
  );
});

test("validator requires a real review date", async () => {
  const manifest = await loadElectionManifest();
  manifest.review.reviewedAt = "2026-02-31";
  assert.throws(
    () => validateElectionManifest(manifest),
    /real calendar date/,
  );
});
