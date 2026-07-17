# NetaWorth data contract

The public site treats every wealth figure as an attributed declaration, never as independently verified market wealth.

## Authoritative sources

- Election Commission of India candidate affidavits: primary source for filed declarations.
- Election Commission statistical reports: primary source for elections, constituencies, winners, votes and margins.
- Association for Democratic Reforms / MyNeta: normalized secondary source used to cross-check and accelerate affidavit extraction.

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

`npm run data:history` starts with MyNeta's published re-contesting-candidate table for the latest election in each of 31 assemblies, then follows each documented predecessor folder back through 2004 where available. The generated snapshot records the current and previous affidavit values, percentage change, MyNeta identity remarks, comparison URL, source-page SHA-256 fingerprints, and whether the newest comparison matched the current national sitting-MLA snapshot.

The live join requires matching state, election year, normalized name, and exact current asset value. Older points are appended only when one comparison's previous year and asset value exactly equal the next comparison's current side. Comparisons that do not pass remain in the research dataset but are not attached to a live MLA profile until identity review resolves spelling changes, reordered names, party switches, or constituency moves.

## Constituency winner archive

`npm run data:winners` reads the election folders discovered by the history crawler and retrieves every paginated MyNeta `winner_analyzed` table. It retains the source spelling of each constituency and candidate, the election folder, candidate ID and direct profile URL, party, education, criminal-case count, assets and liabilities. The generated archive includes a page-level source fingerprint rolled up for every election folder.

Seat histories currently group on normalized state and constituency labels. Delimitation, renamed seats and materially different source spellings are kept separate until an explicit constituency-lineage table can establish the relationship without guessing.

## Complete candidate archive

`npm run data:candidates` imports every paginated `candidates_analyzed` table from the 121 discovered state-election folders. The importer evaluates MyNeta's obfuscated table-row scripts inside an isolated VM with only a stubbed `document.write`, and uses alphabetical pagination to avoid unstable ordering among candidates with identical asset values. Every election is stored as a separate on-demand JSON shard with its source URL, page fingerprint, expected ordinal count and completeness flag.

The internal website loads only the selected election shard. Candidate profiles, asset values, liabilities, education, criminal-case counts and exact-name histories are displayed inside NetaWorth; outbound source URLs are retained only for verification.
