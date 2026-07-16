import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const states = sqliteTable("states", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eciCode: text("eci_code").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  assemblySeats: integer("assembly_seats").notNull(),
}, (t) => [uniqueIndex("states_eci_code_uq").on(t.eciCode), uniqueIndex("states_slug_uq").on(t.slug)]);

export const constituencies = sqliteTable("constituencies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stateId: integer("state_id").notNull().references(() => states.id),
  eciNumber: integer("eci_number").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  reservation: text("reservation", { enum: ["GEN", "SC", "ST"] }).notNull().default("GEN"),
  district: text("district"),
  activeFrom: integer("active_from"),
  activeTo: integer("active_to"),
}, (t) => [
  uniqueIndex("constituencies_state_number_uq").on(t.stateId, t.eciNumber),
  index("constituencies_state_idx").on(t.stateId),
  index("constituencies_name_idx").on(t.name),
]);

export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  canonicalName: text("canonical_name").notNull(),
  slug: text("slug").notNull(),
  gender: text("gender"),
  birthYear: integer("birth_year"),
  identityConfidence: real("identity_confidence").notNull().default(1),
  identityNotes: text("identity_notes"),
}, (t) => [uniqueIndex("people_slug_uq").on(t.slug), index("people_name_idx").on(t.canonicalName)]);

export const parties = sqliteTable("parties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  abbreviation: text("abbreviation").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  color: text("color"),
}, (t) => [uniqueIndex("parties_abbreviation_uq").on(t.abbreviation), uniqueIndex("parties_slug_uq").on(t.slug)]);

export const elections = sqliteTable("elections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stateId: integer("state_id").notNull().references(() => states.id),
  year: integer("year").notNull(),
  electionType: text("election_type", { enum: ["general", "bye"] }).notNull().default("general"),
  pollingDate: text("polling_date"),
  sourceUrl: text("source_url").notNull(),
}, (t) => [uniqueIndex("elections_state_year_type_uq").on(t.stateId, t.year, t.electionType)]);

export const candidacies = sqliteTable("candidacies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  electionId: integer("election_id").notNull().references(() => elections.id),
  constituencyId: integer("constituency_id").notNull().references(() => constituencies.id),
  personId: integer("person_id").notNull().references(() => people.id),
  partyId: integer("party_id").references(() => parties.id),
  candidateNameAsFiled: text("candidate_name_as_filed").notNull(),
  age: integer("age"),
  winner: integer("winner", { mode: "boolean" }).notNull().default(false),
  votes: integer("votes"),
  voteShare: real("vote_share"),
  margin: integer("margin"),
}, (t) => [
  uniqueIndex("candidacies_election_seat_person_uq").on(t.electionId, t.constituencyId, t.personId),
  index("candidacies_person_idx").on(t.personId),
  index("candidacies_constituency_idx").on(t.constituencyId),
  index("candidacies_winner_idx").on(t.winner),
]);

export const affidavits = sqliteTable("affidavits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  candidacyId: integer("candidacy_id").notNull().references(() => candidacies.id),
  movableAssets: integer("movable_assets_rupees"),
  immovableAssets: integer("immovable_assets_rupees"),
  totalAssets: integer("total_assets_rupees").notNull(),
  liabilities: integer("liabilities_rupees").notNull().default(0),
  declaredIncome: integer("declared_income_rupees"),
  spouseAssets: integer("spouse_assets_rupees"),
  dependentsAssets: integer("dependents_assets_rupees"),
  criminalCases: integer("criminal_cases").notNull().default(0),
  seriousCriminalCases: integer("serious_criminal_cases").notNull().default(0),
  education: text("education"),
  profession: text("profession"),
  panDeclared: integer("pan_declared", { mode: "boolean" }),
  affidavitUrl: text("affidavit_url").notNull(),
  sourceKind: text("source_kind", { enum: ["ECI", "ADR"] }).notNull(),
  sourceRetrievedAt: text("source_retrieved_at").notNull(),
  verifiedAt: text("verified_at"),
  verificationStatus: text("verification_status", { enum: ["raw", "parsed", "reviewed", "verified"] }).notNull().default("raw"),
}, (t) => [uniqueIndex("affidavits_candidacy_uq").on(t.candidacyId), index("affidavits_assets_idx").on(t.totalAssets)]);

export const dataImports = sqliteTable("data_imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceKind: text("source_kind").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceSha256: text("source_sha256"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  rowsSeen: integer("rows_seen").notNull().default(0),
  rowsAccepted: integer("rows_accepted").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull(),
  notes: text("notes"),
});

export const aliases = sqliteTable("person_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: integer("person_id").notNull().references(() => people.id),
  alias: text("alias").notNull(),
  normalizedAlias: text("normalized_alias").notNull(),
  source: text("source").notNull(),
}, (t) => [uniqueIndex("person_alias_source_uq").on(t.personId, t.normalizedAlias, t.source), index("person_alias_normalized_idx").on(t.normalizedAlias)]);
