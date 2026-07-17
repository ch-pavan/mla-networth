# Geographic boundaries

- `india-states.json` — India states/UTs TopoJSON (from [udit-001/india-maps-data](https://github.com/udit-001/india-maps-data)).
- `ac/*.json` — Assembly constituency TopoJSON per state, simplified from [DataMeet India_AC](https://github.com/datameet/maps) (CC BY 4.0).
- `ac-index.json` — state → file index.
- `constituency-matches.json` / `constituency-match-index.json` — ADR sitting-MLA constituency → geo feature joins.
- `pc/india.json` — Parliamentary constituency TopoJSON from DataMeet [`india_pc_2019_simplified`](https://github.com/datameet/maps/tree/master/parliamentary-constituencies) (CC0).
- `pc-index.json` / `pc-match-index.json` — Lok Sabha sitting-MP → PC feature joins (`npm run data:match-pc-geo`).

Telangana uses Andhra Pradesh polygons in the DataMeet AC source (pre-split). Matching is by constituency name.
