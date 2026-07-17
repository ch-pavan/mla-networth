"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import IndiaMap, { type SeatRow, type StateAggregate } from "../components/IndiaMap";
import { formatRupees } from "../../lib/format-money";
import { publicUrl } from "../../lib/public-url";

type AdrRecord = {
  rank: number;
  state: string;
  constituency: string;
  name: string;
  party: string;
  assets: number;
};

type AdrSnapshot = {
  meta: { recordCount: number; sourceUrl: string; published: string; note: string };
  records: AdrRecord[];
};

export default function MapPage() {
  const [snapshot, setSnapshot] = useState<AdrSnapshot | null>(null);
  const [error, setError] = useState("");
  const [activeState, setActiveState] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(publicUrl("/data/adr-sitting-mlas-2025.json"), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Snapshot failed (${response.status})`);
        return response.json() as Promise<AdrSnapshot>;
      })
      .then((data) => setSnapshot(data))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load sitting MLA data");
      });
    return () => controller.abort();
  }, []);

  const seatsByState = useMemo(() => {
    const map: Record<string, SeatRow[]> = {};
    for (const record of snapshot?.records ?? []) {
      const seat: SeatRow = {
        rank: record.rank,
        state: record.state,
        constituency: record.constituency,
        name: record.name,
        party: record.party,
        assets: record.assets,
      };
      (map[record.state] ??= []).push(seat);
    }
    for (const seats of Object.values(map)) {
      seats.sort((a, b) => b.assets - a.assets);
    }
    return map;
  }, [snapshot]);

  const stateAggregates = useMemo<StateAggregate[]>(() => {
    return Object.entries(seatsByState)
      .map(([state, seats]) => ({
        state,
        totalAssets: seats.reduce((sum, seat) => sum + seat.assets, 0),
        count: seats.length,
      }))
      .sort((a, b) => b.totalAssets - a.totalAssets);
  }, [seatsByState]);

  const panelRows = activeState
    ? (seatsByState[activeState] ?? []).slice(0, 40)
    : stateAggregates;

  const nationalTotal = useMemo(
    () => stateAggregates.reduce((sum, row) => sum + row.totalAssets, 0),
    [stateAggregates],
  );

  return (
    <>
      <a className="skipLink" href="#main-content">Skip to map</a>
      <main className="mapPage" id="main-content">
        <header className="topbar personNav">
          <Link className="brand" href="/" aria-label="NetaWorth home">
            <span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span>
          </Link>
          <nav aria-label="Primary">
            <Link href="/">Database</Link>
            <Link href="/map" aria-current="page">Map</Link>
            <Link href="/about">About</Link>
          </nav>
        </header>

        <section className="mapHero">
          <span className="sectionNo">MAP / AGGREGATE WEALTH</span>
          <h1>{activeState ? activeState : "India"}</h1>
          <p>
            {activeState
              ? "Each constituency is colored by that sitting MLA’s declared assets. Tap a seat to open the record."
              : "States are colored by the sum of sitting-MLA declared assets. Tap a state to open its constituencies."}
          </p>
          <div className="mapHeroStats">
            <div>
              <b>{snapshot ? formatRupees(activeState ? (seatsByState[activeState] ?? []).reduce((s, r) => s + r.assets, 0) : nationalTotal) : "—"}</b>
              <small>{activeState ? "state aggregate assets" : "national aggregate assets"}</small>
            </div>
            <div>
              <b>{activeState ? (seatsByState[activeState]?.length ?? 0) : (snapshot?.meta.recordCount ?? "—")}</b>
              <small>{activeState ? "sitting MLAs in view" : "sitting MLAs indexed"}</small>
            </div>
          </div>
        </section>

        {error && <div className="empty mapPageError" role="alert"><p>{error}</p></div>}

        <section className="mapWorkspace">
          <IndiaMap
            stateAggregates={stateAggregates}
            seatsByState={seatsByState}
            activeState={activeState}
            onSelectState={setActiveState}
            onSelectSeat={(seat) => {
              window.location.assign(publicUrl(`/person?type=current&rank=${seat.rank}`));
            }}
          />

          <aside className="mapRanks" aria-label={activeState ? "Constituency ranking" : "State ranking"}>
            <header>
              <span>{activeState ? "CONSTITUENCIES" : "STATES BY TOTAL ASSETS"}</span>
              <h2>{activeState ? activeState : "Where the pile sits"}</h2>
            </header>
            <ol>
              {activeState
                ? (panelRows as SeatRow[]).map((seat, index) => (
                  <li key={`${seat.rank}-${seat.constituency}`}>
                    <button type="button" onClick={() => window.location.assign(publicUrl(`/person?type=current&rank=${seat.rank}`))}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <b>{seat.constituency}</b>
                        <small>{seat.name} · {seat.party}</small>
                      </div>
                      <em>{formatRupees(seat.assets)}</em>
                    </button>
                  </li>
                ))
                : (panelRows as StateAggregate[]).map((row, index) => (
                  <li key={row.state}>
                    <button type="button" onClick={() => setActiveState(row.state)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <b>{row.state}</b>
                        <small>{row.count.toLocaleString("en-IN")} sitting MLAs</small>
                      </div>
                      <em>{formatRupees(row.totalAssets)}</em>
                    </button>
                  </li>
                ))}
            </ol>
          </aside>
        </section>
      </main>
    </>
  );
}
