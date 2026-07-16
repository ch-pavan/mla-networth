CREATE TABLE `affidavits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidacy_id` integer NOT NULL,
	`movable_assets_rupees` integer,
	`immovable_assets_rupees` integer,
	`total_assets_rupees` integer NOT NULL,
	`liabilities_rupees` integer DEFAULT 0 NOT NULL,
	`declared_income_rupees` integer,
	`spouse_assets_rupees` integer,
	`dependents_assets_rupees` integer,
	`criminal_cases` integer DEFAULT 0 NOT NULL,
	`serious_criminal_cases` integer DEFAULT 0 NOT NULL,
	`education` text,
	`profession` text,
	`pan_declared` integer,
	`affidavit_url` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_retrieved_at` text NOT NULL,
	`verified_at` text,
	`verification_status` text DEFAULT 'raw' NOT NULL,
	FOREIGN KEY (`candidacy_id`) REFERENCES `candidacies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `affidavits_candidacy_uq` ON `affidavits` (`candidacy_id`);--> statement-breakpoint
CREATE INDEX `affidavits_assets_idx` ON `affidavits` (`total_assets_rupees`);--> statement-breakpoint
CREATE TABLE `person_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_alias_source_uq` ON `person_aliases` (`person_id`,`normalized_alias`,`source`);--> statement-breakpoint
CREATE INDEX `person_alias_normalized_idx` ON `person_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE TABLE `candidacies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`election_id` integer NOT NULL,
	`constituency_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`party_id` integer,
	`candidate_name_as_filed` text NOT NULL,
	`age` integer,
	`winner` integer DEFAULT false NOT NULL,
	`votes` integer,
	`vote_share` real,
	`margin` integer,
	FOREIGN KEY (`election_id`) REFERENCES `elections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`constituency_id`) REFERENCES `constituencies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidacies_election_seat_person_uq` ON `candidacies` (`election_id`,`constituency_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `candidacies_person_idx` ON `candidacies` (`person_id`);--> statement-breakpoint
CREATE INDEX `candidacies_constituency_idx` ON `candidacies` (`constituency_id`);--> statement-breakpoint
CREATE INDEX `candidacies_winner_idx` ON `candidacies` (`winner`);--> statement-breakpoint
CREATE TABLE `constituencies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`state_id` integer NOT NULL,
	`eci_number` integer NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`reservation` text DEFAULT 'GEN' NOT NULL,
	`district` text,
	`active_from` integer,
	`active_to` integer,
	FOREIGN KEY (`state_id`) REFERENCES `states`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `constituencies_state_number_uq` ON `constituencies` (`state_id`,`eci_number`);--> statement-breakpoint
CREATE INDEX `constituencies_state_idx` ON `constituencies` (`state_id`);--> statement-breakpoint
CREATE INDEX `constituencies_name_idx` ON `constituencies` (`name`);--> statement-breakpoint
CREATE TABLE `data_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_kind` text NOT NULL,
	`source_url` text NOT NULL,
	`source_sha256` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`rows_seen` integer DEFAULT 0 NOT NULL,
	`rows_accepted` integer DEFAULT 0 NOT NULL,
	`rows_rejected` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `elections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`state_id` integer NOT NULL,
	`year` integer NOT NULL,
	`election_type` text DEFAULT 'general' NOT NULL,
	`polling_date` text,
	`source_url` text NOT NULL,
	FOREIGN KEY (`state_id`) REFERENCES `states`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `elections_state_year_type_uq` ON `elections` (`state_id`,`year`,`election_type`);--> statement-breakpoint
CREATE TABLE `parties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`abbreviation` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parties_abbreviation_uq` ON `parties` (`abbreviation`);--> statement-breakpoint
CREATE UNIQUE INDEX `parties_slug_uq` ON `parties` (`slug`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_name` text NOT NULL,
	`slug` text NOT NULL,
	`gender` text,
	`birth_year` integer,
	`identity_confidence` real DEFAULT 1 NOT NULL,
	`identity_notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_slug_uq` ON `people` (`slug`);--> statement-breakpoint
CREATE INDEX `people_name_idx` ON `people` (`canonical_name`);--> statement-breakpoint
CREATE TABLE `states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`eci_code` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`assembly_seats` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `states_eci_code_uq` ON `states` (`eci_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `states_slug_uq` ON `states` (`slug`);