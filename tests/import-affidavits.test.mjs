import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const importer = new URL("../scripts/import-affidavits.mjs", import.meta.url);
const fixture = new URL("./fixtures/affidavits-identity.csv", import.meta.url);

async function runImporter(outputPath) {
  await execFileAsync(process.execPath, [importer.pathname, fixture.pathname, outputPath]);
  return Promise.all([
    readFile(outputPath, "utf8"),
    readFile(`${outputPath}.report.json`, "utf8").then(JSON.parse),
  ]);
}

function insertedPeople(sql) {
  return sql.split("\n").filter((line) => line.startsWith("INSERT OR IGNORE INTO people "));
}

test("keeps namesakes candidacy-scoped unless a reviewed canonical identifier is supplied", async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "netaworth-import-"));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const [firstSql, report] = await runImporter(path.join(temporaryDirectory, "first.sql"));
  const [secondSql] = await runImporter(path.join(temporaryDirectory, "second.sql"));
  const people = insertedPeople(firstSql);
  const alexPeople = people.filter((line) => line.includes("'Alex Lee'"));
  const reviewedPeople = people.filter((line) => line.includes("'Sam Review'"));

  assert.equal(report.rowsSeen, 8);
  assert.equal(report.rowsAccepted, 5);
  assert.equal(report.rowsRejected, 3);
  assert.deepEqual(
    report.rejected.map((row) => row.errors),
    [
      ["invalid required integer: total_assets"],
      ["invalid required integer: liabilities"],
      ["invalid required integer: year"],
    ],
  );

  assert.equal(people.length, 4);
  assert.equal(alexPeople.length, 3);
  assert.equal(new Set(alexPeople.map((line) => line.match(/'([^']+)',0,'Candidacy-scoped record/)[1])).size, 3);
  assert.ok(alexPeople.every((line) => line.includes("no cross-election identity has been reviewed")));

  assert.equal(reviewedPeople.length, 1);
  assert.match(reviewedPeople[0], /,0\.9,'Cross-candidacy identity linked by reviewed canonical identifier person-42\.'/);

  const alexCandidacies = firstSql.split("\n").filter((line) => (
    line.startsWith("INSERT OR IGNORE INTO candidacies ") && line.includes("'Alex Lee'")
  ));
  assert.equal(alexCandidacies.length, 3);
  assert.equal(new Set(alexCandidacies.map((line) => line.match(/JOIN people p ON p\.slug='([^']+)'/)[1])).size, 3);

  const reviewedCandidacies = firstSql.split("\n").filter((line) => (
    line.startsWith("INSERT OR IGNORE INTO candidacies ") && line.includes("'Sam Review'")
  ));
  assert.equal(reviewedCandidacies.length, 2);
  assert.equal(new Set(reviewedCandidacies.map((line) => line.match(/JOIN people p ON p\.slug='([^']+)'/)[1])).size, 1);

  assert.deepEqual(insertedPeople(secondSql), people, "person identifiers must be stable across repeated imports");
});
