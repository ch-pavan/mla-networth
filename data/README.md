# NetaWorth data contract

The public site treats every wealth figure as an attributed declaration, never as independently verified market wealth.

## Authoritative sources

- Election Commission of India candidate affidavits: primary source for filed declarations.
- Election Commission statistical reports: primary source for elections, constituencies, winners, votes and margins.
- Association for Democratic Reforms / MyNeta: normalized secondary source used to cross-check and accelerate affidavit extraction.

## Normalized import columns

Required: `state`, `state_code`, `assembly_seats`, `constituency_no`, `constituency`, `year`, `candidate`, `party`, `winner`, `total_assets`, `liabilities`, `affidavit_url`.

Optional: `party_name`, `reservation`, `election_type`, `age`, `votes`, `vote_share`, `margin`, `movable_assets`, `immovable_assets`, `declared_income`, `spouse_assets`, `dependents_assets`, `criminal_cases`, `serious_criminal_cases`, `education`, `profession`, `pan_declared`, `source_kind`, `source_url`, `verification_status`.

All monetary values are integer rupees. Each row represents one candidate in one constituency in one election. Names are retained exactly as filed and linked to a canonical person record separately.

## Verification levels

- `raw`: captured but not parsed.
- `parsed`: machine-normalized with schema validation.
- `reviewed`: identity and money fields manually checked.
- `verified`: checked against the linked ECI affidavit.

The importer rejects duplicate candidacies, negative monetary values, missing identity fields and non-HTTPS affidavit links. Every run records a SHA-256 source fingerprint and a rejection report.

## Historical comparison snapshot

`npm run data:history` starts with MyNeta's published re-contesting-candidate table for the latest election in each of 31 assemblies, then follows each documented predecessor folder back through 2004 where available. The generated snapshot records the current and previous affidavit values, percentage change, MyNeta identity remarks, comparison URL, source-page SHA-256 fingerprints, and whether the newest comparison matched the current national sitting-MLA snapshot.

The live join requires matching state, election year, normalized name, and exact current asset value. Older points are appended only when one comparison's previous year and asset value exactly equal the next comparison's current side. Comparisons that do not pass remain in the research dataset but are not attached to a live MLA profile until identity review resolves spelling changes, reordered names, party switches, or constituency moves.

## Constituency winner archive

`npm run data:winners` reads the election folders discovered by the history crawler and retrieves every paginated MyNeta `winner_analyzed` table. It retains the source spelling of each constituency and candidate, the election folder, candidate ID and direct profile URL, party, education, criminal-case count, assets and liabilities. The generated archive includes a page-level source fingerprint rolled up for every election folder.

Seat histories currently group on normalized state and constituency labels. Delimitation, renamed seats and materially different source spellings are kept separate until an explicit constituency-lineage table can establish the relationship without guessing.
