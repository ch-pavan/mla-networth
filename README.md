# NetaWorth

Public ledger of wealth declared by India’s elected representatives — sitting MLAs, winners, and candidates across state assembly elections (2004–2025).

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

The shipped product is a client-rendered Next.js App Router application built with [vinext](https://github.com/cloudflare/vinext) for Cloudflare Workers. Its live data source is generated, versioned JSON under `public/data/`:

- `adr-sitting-mlas-2025.json` is the current nationwide sitting-MLA snapshot.
- `adr-recontest-history.json` contains attributed affidavit-to-affidavit comparisons.
- `adr-winner-archive.json` contains constituency winner records.
- `candidates/index.json` and the election shards beside it contain the candidate archive.

The browser reads these files directly. Changes to `db/`, `drizzle/`, or `app/api/` do not change the public UI unless the UI is explicitly migrated to those endpoints.

### D1 status

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

Refresh the dependent MyNeta datasets in this order because the winner and candidate scripts discover elections from the history snapshot:

```bash
npm run data:history
npm run data:winners
npm run data:candidates
npm run verify
```

These commands make network requests to third-party source sites and can produce large diffs. Check record counts, coverage flags, retrieval timestamps, source hashes, spot samples, and all test failures before committing. `data:candidates` intentionally reuses existing parser-version-3 shards; it is not a guaranteed full refetch of cached elections. A full archive refresh therefore requires a deliberate cache-invalidation change and additional review, not an ad hoc deletion during routine maintenance.

The optional normalized-file-to-SQL importer writes a seed file and rejection report; it does not apply a migration or alter a remote database:

```bash
npm run data:import -- <normalized.csv-or-json> <output-seed.sql>
```

Never commit downloaded source documents unless their licensing and repository size have been reviewed. Never commit Cloudflare credentials or local environment files.

## Deployment runbook

This repository deliberately does not encode an owner’s Cloudflare account, production project, resource IDs, secrets, domain, or release credentials. Before the first deployment, the repository owner must:

1. Choose and document the Cloudflare Worker/project and domain outside source control.
2. Decide whether the release is the current static-JSON product or includes D1. For the static product, do not expose the unfinished D1 APIs as an operational dependency. For D1, replace the placeholder with an approved production binding and separately review migrations, seed data, backup, and rollback.
3. Configure deployment credentials in the CI/CD or operator environment, never in tracked files.
4. Run `npm ci && npm run verify` and review the generated production build.
5. Deploy through the owner-approved Cloudflare workflow. There is intentionally no `deploy` package script until the production project and binding configuration are defined.
6. Smoke-test `/`, a sitting-MLA profile, a candidate profile, and representative files under `/data/`. Confirm source links, record counts, search, filtering, and error responses.

For a static-data rollback, redeploy the last known-good commit and verify its matching versioned JSON. If a future release changes D1, database rollback and compatibility must be planned independently; reverting application code alone may not reverse data changes.

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
