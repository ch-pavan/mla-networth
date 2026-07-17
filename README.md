# NetaWorth

Public ledger of wealth declared by India’s elected representatives — sitting MLAs, winners, and candidates from reviewed state-assembly election sources.

Data comes from election affidavits (ECI / ADR / MyNeta). Figures are self-declared, not independently audited market wealth.

## Prerequisites

- Node.js `>=22.13.0`
- npm (the lockfile is authoritative; use `npm ci` for reproducible installs)

## Quick start

```bash
npm ci
npm run dev
```

The development server prints its local URL. The application does not require a populated database for its current public UI.

## Architecture

The shipped product is a client-rendered Next.js App Router application built with [vinext](https://github.com/cloudflare/vinext). Its live data source is generated, versioned JSON under `public/data/`:

- `adr-sitting-mlas-2025.json` is the current nationwide sitting-MLA snapshot.
- `adr-recontest-history.json` contains attributed affidavit-to-affidavit comparisons.
- `adr-winner-archive.json` contains constituency winner records.
- `candidates/index.json` and the election shards beside it contain the candidate archive.

`data/election-manifest.json` is the reviewed source-coverage input for the candidate, winner, and recontest generators. It contains 135 included MyNeta election folders: 121 represented in the local candidate archive at review time and 14 additional public folders verified during review. One folder is explicitly excluded because the required analyzed-summary pages were unavailable. These counts describe reviewed and imported MyNeta source coverage, not an exhaustive census of every election conducted by the ECI.

The browser reads these files directly. Changes to `db/`, `drizzle/`, or `app/api/` do not change the public UI unless the UI is explicitly migrated to those endpoints.

### Optional D1 status

Cloudflare D1 and Drizzle are an unfinished, optional path. The schema, migration, importer, and read APIs are present for development, but the repository does not contain a production database ID, a production binding, seeded production data, or a completed UI integration. The UUID in `vite.config.ts` is a local placeholder. Do not treat the D1 routes as production-ready or deploy them against a real database without an explicit migration and data-review plan.

## Verification

Run the same checks as CI before opening or merging a pull request:

```bash
npm ci
npm run verify
```

`npm run verify` runs ESLint, produces a vinext production build, and runs the dataset and product smoke tests. To run the stages separately:

```bash
npm run lint
npm run typecheck
npm run build
node --test tests/rendered-html.test.mjs
```

CI runs on Node 22 for pushes to `main` and for pull requests.

## Data refresh runbook

Read [the data contract](data/README.md) before refreshing anything. Preserve source attribution and review generated diffs; a successful scraper run is not by itself evidence that identities or monetary values are correct.

The sitting-MLA snapshot starts from a locally reviewed ADR PDF. The extractor requires Python and `pdfplumber`:

```bash
python3 scripts/extract-adr-report.py <path-to-reviewed-report.pdf> public/data/adr-sitting-mlas-2025.json
```

The candidate and winner archives do not discover elections from recontest history. All three generators load the reviewed election manifest directly. Run candidates before winners because winner amounts are cross-checked against the regenerated candidate shards; the history refresh is otherwise independent:

```bash
npm run data:candidates
npm run data:winners
npm run data:history
npm run verify
```

These commands make network requests to third-party source sites and can produce large diffs. Check record counts, source-row coverage flags, retrieval timestamps, source hashes, money-status totals, by-election totals, spot samples, and all test failures before committing. The generators decode only the recognized MyNeta packed-row format and never execute source JavaScript. Unknown packed scripts and non-contiguous source ranks fail generation instead of silently dropping rows.

Candidate summary amounts use explicit `parsed`, `nil`, `masked`, and `missing` statuses. Only `nil` means the source explicitly declared no amount; masked and missing values remain `null`, not zero. The candidate generator checks masked or missing summary amounts against the candidate profile and writes successful or definitive unavailable lookups to resumable, atomic checkpoints under the ignored `work/myneta-profile-cache/` directory. The winner generator then reconciles each winner against the candidate archive. Direct candidate-profile values are authoritative; conflicting winner-summary values are retained in each record's `moneyConflicts` review field and counted in archive metadata.

By-election suffixes are parsed at the record level. A by-election record therefore carries its own election date, year, type, and base constituency even when it appears inside a general-election source folder.

The optional normalized-file-to-SQL importer writes a seed file and rejection report; it does not apply a migration or alter a remote database:

```bash
npm run data:import -- <normalized.csv-or-json> <output-seed.sql>
```

Never commit downloaded source documents unless their licensing and repository size have been reviewed. Never commit Cloudflare credentials or local environment files. Deployment is outside the scope of the current release; the repository intentionally has no production deployment configuration or `deploy` package script.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local development |
| `npm run build` | Production build |
| `npm test` | Build + dataset/UI smoke tests |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Check application and Cloudflare runtime types |
| `npm run verify` | Run lint, build, and tests |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run data:import` | Import affidavits into SQL seed |
| `npm run data:history` | Refresh recontest history snapshot |
| `npm run data:winners` | Refresh winner archive |
| `npm run data:candidates` | Refresh candidate archive shards |

See `data/README.md` for the data contract and source rules.
