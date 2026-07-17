#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REQUIRED = [
  "state",
  "state_code",
  "assembly_seats",
  "constituency_no",
  "constituency",
  "year",
  "candidate",
  "party",
  "winner",
  "total_assets",
  "liabilities",
  "affidavit_url",
];

const REQUIRED_INTEGERS = [
  "assembly_seats",
  "constituency_no",
  "year",
  "total_assets",
  "liabilities",
];

function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (quoted && character === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift()?.map((value) => value.trim()) ?? [];
  return rows.map((values) => Object.fromEntries(
    headers.map((header, index) => [header, (values[index] ?? "").trim()]),
  ));
}

const clean = (value) => String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
const slug = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const stableIdentifier = (value) => Buffer.from(value, "utf8").toString("base64url");
const hasText = (value) => typeof value === "string" && value.length > 0;

function parseInteger(value) {
  if (value == null || typeof value === "boolean") return null;
  const normalized = String(value).replace(/[₹,\s]/g, "");
  if (!/^-?\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

const int = (value, fallback = null) => parseInteger(value) ?? fallback;
const bool = (value) => /^(1|true|yes|winner|won)$/i.test(value) ? 1 : 0;

function candidacyKey(row) {
  return [
    row.state_code.toLowerCase(),
    row.constituency_no,
    row.year,
    (row.election_type || "general").toLowerCase(),
    row.candidate.toLowerCase(),
  ].join("|");
}

function identityFor(row, key) {
  if (row.reviewed_canonical_id) {
    const identifier = String(row.reviewed_canonical_id);
    return {
      key: `reviewed:${identifier}`,
      slug: `reviewed-${stableIdentifier(identifier)}`,
      confidence: 0.9,
      notes: `Cross-candidacy identity linked by reviewed canonical identifier ${identifier}.`,
    };
  }

  return {
    key: `candidacy:${key}`,
    slug: `${slug(row.candidate) || "candidate"}-${stableIdentifier(key)}`,
    confidence: 0,
    notes: "Candidacy-scoped record; no cross-election identity has been reviewed.",
  };
}

const [,, inputPath, outputPath = "drizzle/seed-affidavits.sql"] = process.argv;
if (!inputPath) {
  console.error("Usage: npm run data:import -- data/affidavits.csv [drizzle/seed-affidavits.sql]");
  process.exit(1);
}

const raw = await readFile(inputPath, "utf8");
const records = inputPath.endsWith(".json") ? JSON.parse(raw) : parseCsv(raw);
const missing = REQUIRED.filter((key) => !records.length || !(key in records[0]));
if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);

const rejected = [];
const accepted = [];
const seen = new Set();

for (const [index, record] of records.entries()) {
  const row = Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key,
    typeof value === "string" ? clean(value) : value,
  ]));
  const errors = [];
  const hasIdentityFields = [row.candidate, row.constituency, row.state, row.state_code, row.party].every(hasText);

  if (!hasIdentityFields) {
    errors.push("missing identity field");
  }

  for (const field of REQUIRED_INTEGERS) {
    const parsed = parseInteger(row[field]);
    if (parsed === null) {
      errors.push(`invalid required integer: ${field}`);
    } else {
      row[field] = parsed;
    }
  }

  if (Number.isInteger(row.assembly_seats) && row.assembly_seats <= 0) {
    errors.push("assembly_seats must be positive");
  }
  if (Number.isInteger(row.constituency_no) && row.constituency_no <= 0) {
    errors.push("constituency_no must be positive");
  }
  if (Number.isInteger(row.year) && row.year <= 0) {
    errors.push("year must be positive");
  }
  if (Number.isInteger(row.total_assets) && row.total_assets < 0) {
    errors.push("total_assets must be non-negative");
  }
  if (Number.isInteger(row.liabilities) && row.liabilities < 0) {
    errors.push("liabilities must be non-negative");
  }
  if (!/^https:\/\//.test(row.affidavit_url)) errors.push("invalid affidavit URL");

  const key = hasIdentityFields && Number.isInteger(row.constituency_no) && Number.isInteger(row.year)
    ? candidacyKey(row)
    : `invalid-row-${index + 2}`;
  if (seen.has(key)) errors.push("duplicate candidacy");

  if (errors.length) {
    rejected.push({ line: index + 2, key, errors });
    continue;
  }

  const identity = identityFor(row, key);
  seen.add(key);
  accepted.push({ ...row, personKey: identity.key, personSlug: identity.slug, identity });
}

const states = new Map();
const parties = new Map();
const people = new Map();
const elections = new Map();
const constituencies = new Map();

for (const row of accepted) {
  states.set(row.state_code, { name: row.state, seats: row.assembly_seats, slug: slug(row.state) });
  parties.set(row.party, { name: row.party_name || row.party, slug: slug(row.party) });
  if (!people.has(row.personKey)) {
    people.set(row.personKey, {
      name: row.candidate,
      slug: row.personSlug,
      confidence: row.identity.confidence,
      notes: row.identity.notes,
    });
  }
  elections.set(`${row.state_code}|${row.year}|${row.election_type || "general"}`, row);
  constituencies.set(`${row.state_code}|${row.constituency_no}`, row);
}

const sourceUrl = accepted[0]?.source_url || "https://www.myneta.info/";
const retrievedAt = new Date().toISOString();
const hash = createHash("sha256").update(raw).digest("hex");
const out = ["PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;"];

for (const [code, state] of states) {
  out.push(`INSERT OR IGNORE INTO states (eci_code,name,slug,assembly_seats) VALUES (${sql(code)},${sql(state.name)},${sql(state.slug)},${state.seats});`);
}
for (const [abbreviation, party] of parties) {
  out.push(`INSERT OR IGNORE INTO parties (abbreviation,name,slug) VALUES (${sql(abbreviation)},${sql(party.name)},${sql(party.slug)});`);
}
for (const person of people.values()) {
  out.push(`INSERT OR IGNORE INTO people (canonical_name,slug,identity_confidence,identity_notes) VALUES (${sql(person.name)},${sql(person.slug)},${person.confidence},${sql(person.notes)});`);
}
for (const row of constituencies.values()) {
  out.push(`INSERT OR IGNORE INTO constituencies (state_id,eci_number,name,slug,reservation) SELECT id,${row.constituency_no},${sql(row.constituency)},${sql(slug(row.constituency))},${sql(row.reservation || "GEN")} FROM states WHERE eci_code=${sql(row.state_code)};`);
}
for (const row of elections.values()) {
  out.push(`INSERT OR IGNORE INTO elections (state_id,year,election_type,source_url) SELECT id,${row.year},${sql(row.election_type || "general")},${sql(row.source_url || sourceUrl)} FROM states WHERE eci_code=${sql(row.state_code)};`);
}
for (const row of accepted) {
  out.push(`INSERT OR IGNORE INTO candidacies (election_id,constituency_id,person_id,party_id,candidate_name_as_filed,age,winner,votes,vote_share,margin) SELECT e.id,c.id,p.id,pt.id,${sql(row.candidate)},${int(row.age, "NULL")},${bool(row.winner)},${int(row.votes, "NULL")},${row.vote_share ? Number(row.vote_share) : "NULL"},${int(row.margin, "NULL")} FROM elections e JOIN states s ON s.id=e.state_id JOIN constituencies c ON c.state_id=s.id AND c.eci_number=${row.constituency_no} JOIN people p ON p.slug=${sql(row.personSlug)} LEFT JOIN parties pt ON pt.abbreviation=${sql(row.party)} WHERE s.eci_code=${sql(row.state_code)} AND e.year=${row.year} AND e.election_type=${sql(row.election_type || "general")};`);
  out.push(`INSERT OR IGNORE INTO affidavits (candidacy_id,movable_assets_rupees,immovable_assets_rupees,total_assets_rupees,liabilities_rupees,declared_income_rupees,spouse_assets_rupees,dependents_assets_rupees,criminal_cases,serious_criminal_cases,education,profession,pan_declared,affidavit_url,source_kind,source_retrieved_at,verification_status) SELECT id,${int(row.movable_assets, "NULL")},${int(row.immovable_assets, "NULL")},${row.total_assets},${row.liabilities},${int(row.declared_income, "NULL")},${int(row.spouse_assets, "NULL")},${int(row.dependents_assets, "NULL")},${int(row.criminal_cases, 0)},${int(row.serious_criminal_cases, 0)},${sql(row.education || null)},${sql(row.profession || null)},${row.pan_declared ? bool(row.pan_declared) : "NULL"},${sql(row.affidavit_url)},${sql(row.source_kind || "ADR")},${sql(retrievedAt)},${sql(row.verification_status || "parsed")} FROM candidacies WHERE election_id=(SELECT e.id FROM elections e JOIN states s ON s.id=e.state_id WHERE s.eci_code=${sql(row.state_code)} AND e.year=${row.year} AND e.election_type=${sql(row.election_type || "general")}) AND constituency_id=(SELECT c.id FROM constituencies c JOIN states s ON s.id=c.state_id WHERE s.eci_code=${sql(row.state_code)} AND c.eci_number=${row.constituency_no}) AND person_id=(SELECT id FROM people WHERE slug=${sql(row.personSlug)});`);
}

out.push(`INSERT INTO data_imports (source_kind,source_url,source_sha256,started_at,completed_at,rows_seen,rows_accepted,rows_rejected,status,notes) VALUES ('normalized-csv',${sql(sourceUrl)},${sql(hash)},${sql(retrievedAt)},${sql(retrievedAt)},${records.length},${accepted.length},${rejected.length},'completed',${sql(`Generated by import-affidavits.mjs from ${path.basename(inputPath)}`)});`);
out.push("COMMIT;");

await writeFile(outputPath, `${out.join("\n")}\n`);
await writeFile(`${outputPath}.report.json`, `${JSON.stringify({
  source: path.resolve(inputPath),
  sha256: hash,
  rowsSeen: records.length,
  rowsAccepted: accepted.length,
  rowsRejected: rejected.length,
  rejected,
}, null, 2)}\n`);

console.log(JSON.stringify({
  output: outputPath,
  rowsSeen: records.length,
  rowsAccepted: accepted.length,
  rowsRejected: rejected.length,
}, null, 2));
