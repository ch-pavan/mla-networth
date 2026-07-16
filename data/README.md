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
