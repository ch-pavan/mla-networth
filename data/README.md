# NetaWorth data contract

The public site treats every wealth figure as an attributed declaration, never as independently verified market wealth.

## Authoritative sources

- Election Commission of India candidate affidavits: primary source for filed declarations.
- Election Commission statistical reports: primary source for elections, constituencies, winners, votes and margins.
- Association for Democratic Reforms / MyNeta: normalized secondary source used to cross-check and accelerate affidavit extraction.

## Reviewed source coverage

`data/election-manifest.json` is the explicit input to the candidate, winner, and recontest generators. The current reviewed manifest includes 135 MyNeta state-election folders: 121 had a local candidate shard at review time and 14 additional public folders were verified for import. Karnataka 2004 is recorded separately as excluded because its required candidate and winner analyzed-summary pages were unavailable during review.

Manifest membership means a MyNeta folder was reviewed under the method recorded in the manifest. It does not claim that MyNeta, ADR, or this repository covers every ECI election or affidavit. Likewise, `sourceRowsComplete` means all ranked rows exposed by a particular analyzed-summary page set were parsed without a rank gap; it is not a claim of electoral completeness.

## Normalized import columns

Required: `state`, `state_code`, `assembly_seats`, `constituency_no`, `constituency`, `year`, `candidate`, `party`, `winner`, `total_assets`, `liabilities`, `affidavit_url`.

Optional: `party_name`, `reservation`, `election_type`, `age`, `votes`, `vote_share`, `margin`, `movable_assets`, `immovable_assets`, `declared_income`, `spouse_assets`, `dependents_assets`, `criminal_cases`, `serious_criminal_cases`, `education`, `profession`, `pan_declared`, `source_kind`, `source_url`, `verification_status`, `reviewed_canonical_id`.

All monetary values are integer rupees. Each row represents one candidate in one constituency in one election. Names are retained exactly as filed.

The normalized importer creates a separate, stable person record for every candidacy by default, even when two rows contain the same candidate name. These records have identity confidence `0` and an explicit note that no cross-election identity review has occurred. This avoids inventing a relationship between namesakes or assuming that a repeated name identifies the same person.

Cross-candidacy merging is opt-in only: rows may share a non-empty `reviewed_canonical_id` after a human has reviewed the source candidacies and confirmed that they identify the same person. The identifier is an internal durable key, not a name or a generated guess. Reviewed links receive identity confidence `0.9` plus a note naming the reviewed identifier. Changing or removing that identifier intentionally creates a different person identity on the next import.

## Verification levels

- `raw`: captured but not parsed.
- `parsed`: machine-normalized with schema validation.
- `reviewed`: identity and money fields manually checked.
- `verified`: checked against the linked ECI affidavit.

The importer rejects duplicate candidacies, missing or invalid required integers, non-positive seat/year values, negative monetary values, missing identity fields and non-HTTPS affidavit links. Required numeric values never silently fall back to `0` or `NULL`. Every run records a SHA-256 source fingerprint and a rejection report.

## Historical comparison snapshot

`npm run data:history` starts from every included election folder in the reviewed manifest, then follows every distinct predecessor folder published in MyNeta's re-contesting-candidate tables back through 2004 where available. The generated snapshot records the current and previous affidavit values, percentage change, MyNeta identity remarks, comparison URL, source-page SHA-256 fingerprints, and whether the newest comparison matched the current national sitting-MLA snapshot. Each comparison year is inferred from its predecessor folder when possible rather than applying one page-header year to every row.

The live join requires one unambiguous match on state, election year, normalized name, and exact current asset value. Older points are appended only when one comparison's previous year and asset value exactly equal the next comparison's current side. MyNeta rows marked `PAN is Different`, rows with uncertain year attribution, and ambiguous or unmatched snapshot identities remain in the research dataset but are excluded from profile histories pending review.

Packed MyNeta rows are decoded by a narrow parser for the documented base-N wrapper. Source JavaScript is never evaluated or run. Unknown packed scripts, malformed monetary values, and missing or duplicate ranks make the refresh fail closed.

## Constituency winner archive

`npm run data:winners` reads election folders directly from the reviewed manifest and retrieves every paginated MyNeta `winner_analyzed` table. It retains the source spelling of each constituency and candidate, the election folder, candidate ID and direct profile URL, party, education, criminal-case count, assets and liabilities. The generated archive includes a page-level source fingerprint rolled up for every election folder. It requires regenerated candidate shards and reconciles every winner by election folder and candidate ID. Direct candidate-profile values are authoritative; conflicting winner-summary values remain attached as `moneyConflicts` evidence and are counted in archive metadata.

General-election and by-election records retain record-level `electionYear`, `electionDate`, `electionType`, and `baseConstituency`. Seat histories group on normalized state and base-constituency labels, but groups with more than one winner on the same election date are quarantined rather than presented as one lineage. Delimitation, renamed seats and materially different source spellings remain separate until an explicit constituency-lineage table can establish the relationship without guessing.

## Candidate archive

`npm run data:candidates` imports every paginated `candidates_analyzed` table for the included folders in the reviewed manifest. It decodes recognized obfuscated table rows without executing source JavaScript and uses alphabetical pagination to avoid unstable ordering among candidates with identical asset values. Every election is stored as a separate on-demand JSON shard with its source URL, page fingerprint, expected ordinal count, and `sourceRowsComplete` flag.

Assets and liabilities carry one of four statuses:

- `parsed`: the source published a numeric amount, including an explicit numeric zero.
- `nil`: the source explicitly published `NIL`; the value is zero.
- `masked`: the source concealed or replaced the amount; the value is `null`.
- `missing`: the source did not publish a parseable amount; the value is `null`.

Masked and missing summary cells are checked against the candidate profile's top-level Assets and Liabilities rows. Successful profile reads and definitive `404`/`410` responses are checkpointed atomically under ignored `work/myneta-profile-cache/` files; transient failures are retried and not cached, so an interrupted refresh can resume. A source that remains unavailable is represented as `null`, never invented as zero.

The website loads only the selected election shard. Candidate profiles, asset values, liabilities, education, criminal-case counts and exact-name histories are displayed inside NetaWorth; outbound source URLs are retained for verification. Counts in the site and archive metadata describe imported records from reviewed source folders, not every affidavit ever filed.
