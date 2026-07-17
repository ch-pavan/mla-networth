import assert from "node:assert/strict";
import test from "node:test";
import {
  attachSnapshotMatches,
  collectPreviousElectionTasks,
  inferComparisonPreviousYear,
  inferYearFromElectionFolder,
  parseCandidatePartyLabel,
  parseRecontestPage,
} from "../scripts/lib/recontest-history.mjs";

const sourceUrl = "https://www.myneta.info/Karnataka2023/index.php?action=recontestAssetsComparison";

function comparisonRow({
  rank,
  label = "Candidate (INC)",
  previousFolder = "karnataka2018",
  currentAssets = "1,00,00,000",
  previousAssets = "50,00,000",
  percent = "100%",
  remarks = "",
}) {
  const href = `${sourceUrl}&amp;myneta_folder2=${previousFolder}&amp;id1=${rank}&amp;id2=${rank + 10}`;
  return `<tr><td>${rank}</td><td><a href="${href}">${label}</a></td><td>Rs ${currentAssets}</td><td>Rs ${previousAssets}</td><td>Rs 50,00,000</td><td>${percent}</td><td>${remarks}</td></tr>`;
}

function comparisonPage(rows, previousYear = 2018) {
  return `<html><body><table><thead><tr><th>Total Assets in Karnataka 2023</th><th>Total Assets in Karnataka ${previousYear}</th></tr></thead><tbody>${rows.join("")}</tbody></table></body></html>`;
}

test("parses nested candidate and party parentheses from the final suffix", () => {
  assert.deepEqual(
    parseCandidatePartyLabel("S.N. Subbareddy (Chinnakayalapalli) (JD(S))"),
    { name: "S.N. Subbareddy (Chinnakayalapalli)", party: "JD(S)" },
  );
  assert.deepEqual(
    parseCandidatePartyLabel("K. Babu (CPI(M))"),
    { name: "K. Babu", party: "CPI(M)" },
  );
});

test("infers each predecessor year from its own folder before using the page header", () => {
  assert.equal(inferYearFromElectionFolder("bih2010"), 2010);
  assert.equal(inferYearFromElectionFolder("upbye13"), 2013);
  assert.equal(inferYearFromElectionFolder("2008Chhattisgarh"), 2008);
  assert.deepEqual(inferComparisonPreviousYear({
    previousFolder: "gujaratbye2014",
    currentFolder: "Gujarat2017",
    currentYear: 2017,
    pagePreviousYear: 2012,
  }), { previousYear: 2014, previousYearSource: "folder" });
  assert.deepEqual(inferComparisonPreviousYear({
    previousFolder: "bihar2015",
    currentFolder: "Bihar2015",
    currentYear: 2015,
    pagePreviousYear: 2010,
  }), { previousYear: 2010, previousYearSource: "page-header" });
});

test("parses all rows, retains review metadata, and excludes uncertain links from profiles", () => {
  const parsed = parseRecontestPage({
    html: comparisonPage([
      comparisonRow({
        rank: 1,
        label: "S.N. Subbareddy (Chinnakayalapalli) (JD(S))",
        previousFolder: "karnataka2018",
      }),
      comparisonRow({
        rank: 2,
        label: "Talasani Srinivas Yadav (BRS)",
        previousFolder: "telangana2018",
        remarks: "PAN is Different Party in last election was TRS",
      }),
      comparisonRow({
        rank: 3,
        previousFolder: "Karnataka2023",
      }),
    ]),
    state: "Karnataka",
    currentYear: 2023,
    folder: "Karnataka2023",
    url: sourceUrl,
  });

  assert.equal(parsed.coverage.complete, true);
  assert.equal(parsed.coverage.expectedFromRanks, 3);
  assert.deepEqual(parsed.comparisons.map((row) => row.party), ["JD(S)", "BRS", "INC"]);
  assert.deepEqual(parsed.comparisons.map((row) => row.previousYear), [2018, 2018, 2018]);
  assert.equal(parsed.comparisons[0].eligibleForProfileHistory, true);
  assert.equal(parsed.comparisons[1].identityReviewStatus, "review-required");
  assert.equal(parsed.comparisons[1].identityReviewReason, "pan-different");
  assert.equal(parsed.comparisons[1].eligibleForProfileHistory, false);
  assert.equal(parsed.comparisons[2].previousYearSource, "page-header");
  assert.equal(parsed.comparisons[2].eligibleForProfileHistory, false);
});

test("fails closed on rank gaps, undecoded scripts, and masked monetary cells", () => {
  const empty = parseRecontestPage({
    html: comparisonPage([]),
    state: "Karnataka",
    currentYear: 2023,
    folder: "Karnataka2023",
    url: sourceUrl,
  });
  assert.equal(empty.coverage.complete, true);
  assert.equal(empty.coverage.expectedFromRanks, 0);
  assert.deepEqual(empty.comparisons, []);

  assert.throws(() => parseRecontestPage({
    html: comparisonPage([comparisonRow({ rank: 1 }), comparisonRow({ rank: 3 })]),
    state: "Karnataka",
    currentYear: 2023,
    folder: "Karnataka2023",
    url: sourceUrl,
  }), /incomplete comparison ranks/);

  assert.throws(() => parseRecontestPage({
    html: comparisonPage([comparisonRow({ rank: 1 })])
      .replace("</tbody>", "<script>eval(function(h,u,n,t,e,r){process.exit(1)}())</script></tbody>"),
    state: "Karnataka",
    currentYear: 2023,
    folder: "Karnataka2023",
    url: sourceUrl,
  }), /packed row scripts could not be decoded/);

  assert.throws(() => parseRecontestPage({
    html: comparisonPage([
      comparisonRow({ rank: 1 }).replace("Rs 1,00,00,000", '<img src="image_v2.php?col=ta">'),
    ]),
    state: "Karnataka",
    currentYear: 2023,
    folder: "Karnataka2023",
    url: sourceUrl,
  }), /monetary value is missing or masked/);
});

test("traverses every distinct external predecessor folder", () => {
  const results = [{
    state: "Bihar",
    currentYear: 2015,
    folder: "bihar2015",
    comparisons: [
      { state: "Bihar", previousYear: 2010, previousFolder: "bih2010" },
      { state: "Bihar", previousYear: 2010, previousFolder: "bih2010" },
      { state: "Bihar", previousYear: 2010, previousFolder: "bihar2015" },
      { state: "Bihar", previousYear: 2013, previousFolder: "biharbye2013" },
    ],
  }];

  assert.deepEqual(collectPreviousElectionTasks(results), [
    ["Bihar", 2010, "bih2010"],
    ["Bihar", 2013, "biharbye2013"],
  ]);
});

test("matches duplicate names only when year and assets identify one snapshot record", () => {
  const base = {
    state: "Karnataka",
    currentYear: 2023,
    normalizedName: "m krishnappa",
    currentAssets: 100,
  };
  const snapshot = [
    { rank: 31, state: "Karnataka", electionYear: 2023, name: "M Krishnappa", assets: 100, constituency: "Vijayanagar" },
    { rank: 139, state: "Karnataka", electionYear: 2023, name: "M Krishnappa", assets: 200, constituency: "Bangalore South" },
  ];

  const [matched] = attachSnapshotMatches([base], snapshot);
  assert.equal(matched.matchedToSnapshot, true);
  assert.equal(matched.currentSnapshotRank, 31);
  assert.equal(matched.snapshotMatchStatus, "matched");

  const [ambiguous] = attachSnapshotMatches([base], [
    snapshot[0],
    { ...snapshot[1], assets: 100 },
  ]);
  assert.equal(ambiguous.matchedToSnapshot, false);
  assert.equal(ambiguous.currentSnapshotRank, null);
  assert.equal(ambiguous.snapshotMatchStatus, "ambiguous");
});
