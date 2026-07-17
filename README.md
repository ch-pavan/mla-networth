# NetaWorth

Public ledger of wealth declared by India’s elected representatives — sitting MLAs, winners, and candidates across state assembly elections (2004–2025).

Data comes from election affidavits (ECI / ADR / MyNeta). Figures are self-declared, not independently audited market wealth.

## Prerequisites

- Node.js `>=22.13.0`

## Quick start

```bash
npm install
npm run dev
```

```bash
npm run build
npm test
```

## Stack

- Next.js App Router via [vinext](https://github.com/cloudflare/vinext) on Cloudflare Workers
- Static JSON under `public/data/` for the live UI
- Optional Cloudflare D1 + Drizzle (`db/`, `/api/*`) for a future DB-backed path

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local development |
| `npm run build` | Production build |
| `npm test` | Build + dataset/UI smoke tests |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run data:import` | Import affidavits into SQL seed |
| `npm run data:history` | Refresh recontest history snapshot |
| `npm run data:winners` | Refresh winner archive |
| `npm run data:candidates` | Refresh candidate archive shards |

See `data/README.md` for the data contract and source rules.
