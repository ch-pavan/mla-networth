# NetaWorth

Public ledger of wealth declared by India’s elected representatives — sitting MLAs, Lok Sabha MPs, Rajya Sabha MPs, winners, and candidates from reviewed election sources.

Data comes from election affidavits (ECI / ADR / MyNeta). Figures are self-declared, not independently audited market wealth.

**Live:** [netaworth.vercel.app](https://netaworth.vercel.app)

## Prerequisites

- Node.js `22.x`
- npm (use `npm ci` for reproducible installs)

## Quick start

```bash
npm ci
npm run dev
```

The app does not require a database for the public UI.

## Architecture

Client-rendered Next.js App Router app. Live data is versioned JSON under `public/data/`:

| File | Contents |
|---|---|
| `adr-sitting-mlas-2025.json` | Nationwide sitting-MLA snapshot |
| `lok-sabha-sitting-mps.json` | Lok Sabha MP snapshot (latest GE winners) |
| `rajya-sabha-sitting-mps.json` | Rajya Sabha MP snapshot (ADR March 2026 PDF) |
| `adr-recontest-history.json` | Affidavit-to-affidavit comparisons |
| `adr-winner-archive.json` | Assembly constituency winners |
| `lok-sabha-winner-archive.json` | Lok Sabha winners (2004–2024) |
| `candidates/index.json` (+ shards) | Candidate archive |

`data/election-manifest.json` is the reviewed source-coverage input for the candidate, winner, and recontest generators (135 included MyNeta election folders). Counts describe reviewed/imported coverage, not an exhaustive ECI census.

The browser reads these files directly. Changes to `db/`, `drizzle/`, or `app/api/` do not affect the public UI unless it is migrated to those endpoints.

### Optional D1

Cloudflare D1 and Drizzle are an unfinished path. Schema, migrations, importer, and read APIs exist for development, but there is no production database, binding, or UI integration. Do not treat D1 routes as production-ready.

## Verification

```bash
npm ci
npm run verify
```

Runs ESLint, a production build, and dataset/UI smoke tests. Separately:

```bash
npm run lint
npm run typecheck
npm run build
node --test tests/rendered-html.test.mjs
```

CI uses Node 22 on pushes to `main` and on pull requests.

## Deployment

| Target | URL | Command |
|---|---|---|
| **Vercel** (primary) | https://netaworth.vercel.app | `npm run build:vercel` |
| GitHub Pages | https://ch-pavan.github.io/mla-networth/ | `npm run build:pages` |

Pushes to `main` deploy both targets (Vercel via Git integration; Pages via `.github/workflows/pages.yml`).

Both builds exclude unfinished Cloudflare D1 routes under `app/api/`. The public UI reads `public/data/`. Canonical metadata uses `NEXT_PUBLIC_SITE_URL` when set, otherwise the host’s production domain.

## Data refresh runbook

Read [the data contract](data/README.md) before refreshing. Preserve source attribution and review generated diffs.

Sitting MLAs from a reviewed ADR PDF (needs Python + `pdfplumber`):

```bash
python3 scripts/extract-adr-report.py <path-to-reviewed-report.pdf> public/data/adr-sitting-mlas-2025.json
```

Candidate and winner archives load the reviewed election manifest. Run candidates before winners:

```bash
npm run data:candidates
npm run data:winners
npm run data:history
npm run verify
```

These hit third-party sites and can produce large diffs. Check record counts, coverage flags, timestamps, hashes, money-status totals, by-election totals, spot samples, and test failures before committing. Generators decode only the recognized MyNeta packed-row format; unknown scripts and non-contiguous ranks fail instead of silently dropping rows.

Candidate amounts use `parsed`, `nil`, `masked`, and `missing`. Only `nil` means explicitly no amount; masked/missing stay `null`. Profile lookups write to ignored `work/myneta-profile-cache/`. Winner amounts conflicting with candidate profiles land in `moneyConflicts`.

Optional SQL seed (does not migrate or touch a remote DB):

```bash
npm run data:import -- <normalized.csv-or-json> <output-seed.sql>
```

Never commit source PDFs/credentials without review. D1 is not part of production deploys.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local development |
| `npm run build` | vinext production build |
| `npm run build:pages` | Static export for GitHub Pages |
| `npm run build:vercel` | Next.js production build for Vercel |
| `npm test` | Build + dataset/UI smoke tests |
| `npm run lint` | ESLint |
| `npm run typecheck` | Typecheck |
| `npm run verify` | Lint, typecheck, build, tests |
| `npm run data:candidates` | Refresh candidate archive |
| `npm run data:winners` | Refresh winner archive |
| `npm run data:history` | Refresh recontest history |
| `npm run data:loksabha` | Refresh Lok Sabha candidates, winners, sitting MPs |
| `npm run data:rajyasabha` | Extract Rajya Sabha sitting MPs from ADR PDF |
| `npm run data:match-geo` | Match assembly constituencies to AC geo |
| `npm run data:match-pc-geo` | Match Lok Sabha constituencies to PC geo |
| `npm run data:import` | Import affidavits into SQL seed |
| `npm run db:generate` | Generate Drizzle migrations |

See `data/README.md` for the data contract and source rules.
