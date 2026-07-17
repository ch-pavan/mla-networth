"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import IndiaMap, { type MapView, type SeatRow, type StateAggregate } from "../components/IndiaMap";
import { toMapStateName } from "../../lib/geo-names";
import { formatRupees } from "../../lib/format-money";
import { publicUrl } from "../../lib/public-url";

type AdrRecord = {
  rank: number;
  state: string;
  constituency: string;
  name: string;
  party: string;
  assets: number;
  electionFolder?: string;
  candidateId?: number;
  candidateUrl?: string;
};

type AdrSnapshot = {
  meta: { recordCount: number; sourceUrl: string; published: string; note: string };
  records: AdrRecord[];
};

type ChamberSeat = SeatRow & { chamber: "assembly" | "lok_sabha" | "rajya_sabha" };

function seatHref(seat: ChamberSeat): string {
  if (seat.chamber === "lok_sabha" && seat.electionFolder && seat.candidateId) {
    return publicUrl(`/person?type=candidate&election=${encodeURIComponent(seat.electionFolder)}&id=${seat.candidateId}`);
  }
  if (seat.chamber === "rajya_sabha") {
    return publicUrl(`/person?type=current&chamber=rajya_sabha&rank=${seat.rank}`);
  }
  return publicUrl(`/person?type=current&chamber=assembly&rank=${seat.rank}`);
}

function recordsToSeats(
  records: AdrRecord[] | undefined,
  chamber: ChamberSeat["chamber"],
  sourceUrl?: string,
): ChamberSeat[] {
  return (records ?? []).map((record) => ({
    rank: record.rank,
    state: toMapStateName(record.state),
    constituency: record.constituency || (chamber === "rajya_sabha" ? "Rajya Sabha" : record.constituency),
    name: record.name,
    party: record.party,
    assets: record.assets ?? 0,
    chamber,
    electionFolder: record.electionFolder,
    candidateId: record.candidateId,
    candidateUrl: record.candidateUrl,
    sourceUrl: record.candidateUrl || sourceUrl,
  }));
}

function buildSeatsByState(seats: ChamberSeat[]): Record<string, ChamberSeat[]> {
  const map: Record<string, ChamberSeat[]> = {};
  for (const seat of seats) {
    (map[seat.state] ??= []).push(seat);
  }
  for (const list of Object.values(map)) {
    list.sort((a, b) => b.assets - a.assets);
  }
  return map;
}

function buildAggregates(seatsByState: Record<string, ChamberSeat[]>, withBreakdown = false): StateAggregate[] {
  return Object.entries(seatsByState)
    .map(([state, seats]) => {
      const byChamber = { assembly: 0, lok_sabha: 0, rajya_sabha: 0 };
      let totalAssets = 0;
      for (const seat of seats) {
        totalAssets += seat.assets;
        byChamber[seat.chamber] += seat.assets;
      }
      return {
        state,
        totalAssets,
        count: seats.length,
        ...(withBreakdown ? { byChamber } : {}),
      };
    })
    .sort((a, b) => b.totalAssets - a.totalAssets);
}

export default function MapPage() {
  const [mlaSnapshot, setMlaSnapshot] = useState<AdrSnapshot | null>(null);
  const [lsSnapshot, setLsSnapshot] = useState<AdrSnapshot | null>(null);
  const [rsSnapshot, setRsSnapshot] = useState<AdrSnapshot | null>(null);
  const [error, setError] = useState("");
  const [mapView, setMapView] = useState<MapView>("aggregate");
  const [activeState, setActiveState] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(publicUrl("/data/adr-sitting-mlas-2025.json"), { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`MLA snapshot failed (${r.status})`);
        return r.json() as Promise<AdrSnapshot>;
      }),
      fetch(publicUrl("/data/lok-sabha-sitting-mps.json"), { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`Lok Sabha snapshot failed (${r.status})`);
        return r.json() as Promise<AdrSnapshot>;
      }),
      fetch(publicUrl("/data/rajya-sabha-sitting-mps.json"), { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`Rajya Sabha snapshot failed (${r.status})`);
        return r.json() as Promise<AdrSnapshot>;
      }),
    ])
      .then(([mla, ls, rs]) => {
        setMlaSnapshot(mla);
        setLsSnapshot(ls);
        setRsSnapshot(rs);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load sitting legislator data");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setActiveState(null);
  }, [mapView]);

  const mlaSeats = useMemo(
    () => recordsToSeats(mlaSnapshot?.records, "assembly", mlaSnapshot?.meta.sourceUrl),
    [mlaSnapshot],
  );
  const lsSeats = useMemo(
    () => recordsToSeats(lsSnapshot?.records, "lok_sabha", lsSnapshot?.meta.sourceUrl),
    [lsSnapshot],
  );
  const rsSeats = useMemo(
    () => recordsToSeats(rsSnapshot?.records, "rajya_sabha", rsSnapshot?.meta.sourceUrl),
    [rsSnapshot],
  );

  const activeSeats = useMemo(() => {
    if (mapView === "assembly") return mlaSeats;
    if (mapView === "lok_sabha") return lsSeats;
    if (mapView === "rajya_sabha") return rsSeats;
    return [...mlaSeats, ...lsSeats, ...rsSeats];
  }, [mapView, mlaSeats, lsSeats, rsSeats]);

  const seatsByState = useMemo(() => buildSeatsByState(activeSeats), [activeSeats]);
  const stateAggregates = useMemo(
    () => buildAggregates(seatsByState, mapView === "aggregate"),
    [seatsByState, mapView],
  );
  const nationalTotal = useMemo(
    () => stateAggregates.reduce((sum, row) => sum + row.totalAssets, 0),
    [stateAggregates],
  );

  const panelSeats = activeState ? (seatsByState[activeState] ?? []).slice(0, 40) : [];
  const selectedAggregate = activeState
    ? stateAggregates.find((row) => row.state === activeState) ?? null
    : null;

  const heroCopy = (() => {
    if (mapView === "aggregate") {
      return activeState
        ? "Declared assets from sitting MLAs, Lok Sabha MPs and Rajya Sabha MPs in this state."
        : "States are colored by the sum of declared assets across all three houses. Tap a state for the breakdown.";
    }
    if (mapView === "assembly") {
      return activeState
        ? "Each assembly constituency is colored by that sitting MLA’s declared assets."
        : "States are colored by sitting-MLA declared assets. Tap a state to open constituencies.";
    }
    if (mapView === "lok_sabha") {
      return activeState
        ? "Each parliamentary constituency is colored by that sitting MP’s declared assets."
        : "States are colored by Lok Sabha MP declared assets. Tap a state to open constituencies.";
    }
    return activeState
      ? "Rajya Sabha MPs nominated from this state, ranked by declared assets."
      : "States are colored by Rajya Sabha MP declared assets. Tap a state to list MPs.";
  })();

  const recordCount = mapView === "assembly"
    ? mlaSnapshot?.meta.recordCount
    : mapView === "lok_sabha"
      ? lsSnapshot?.meta.recordCount
      : mapView === "rajya_sabha"
        ? rsSnapshot?.meta.recordCount
        : (mlaSnapshot && lsSnapshot && rsSnapshot)
          ? mlaSnapshot.meta.recordCount + lsSnapshot.meta.recordCount + rsSnapshot.meta.recordCount
          : undefined;

  const openSeat = (seat: SeatRow) => {
    window.location.assign(seatHref(seat as ChamberSeat));
  };

  return (
    <>
      <a className="skipLink" href="#main-content">Skip to map</a>
      <main className="mapPage" id="main-content">
        <header className="topbar personNav">
          <Link className="brand" href="/" aria-label="NetaWorth home">
            <span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span>
          </Link>
          <nav aria-label="Primary">
            <Link href="/">Home</Link>
            <Link href="/map" aria-current="page">Map</Link>
          </nav>
        </header>

        <section className="mapHero">
          <span className="sectionNo">MAP / AGGREGATE WEALTH</span>
          <h1>{activeState ? activeState : "India"}</h1>
          <p>{heroCopy}</p>
          <div className="chamberSwitch" role="tablist" aria-label="Map view">
            <button type="button" role="tab" aria-selected={mapView === "aggregate"} className={mapView === "aggregate" ? "active" : ""} onClick={() => setMapView("aggregate")}>Aggregate</button>
            <button type="button" role="tab" aria-selected={mapView === "assembly"} className={mapView === "assembly" ? "active" : ""} onClick={() => setMapView("assembly")}>Assemblies</button>
            <button type="button" role="tab" aria-selected={mapView === "lok_sabha"} className={mapView === "lok_sabha" ? "active" : ""} onClick={() => setMapView("lok_sabha")}>Lok Sabha</button>
            <button type="button" role="tab" aria-selected={mapView === "rajya_sabha"} className={mapView === "rajya_sabha" ? "active" : ""} onClick={() => setMapView("rajya_sabha")}>Rajya Sabha</button>
          </div>
          <div className="mapHeroStats">
            <div>
              <b>{recordCount != null ? formatRupees(activeState ? (selectedAggregate?.totalAssets ?? 0) : nationalTotal) : "—"}</b>
              <small>{activeState ? "state aggregate assets" : "national aggregate assets"}</small>
            </div>
            <div>
              <b>{activeState ? (seatsByState[activeState]?.length ?? 0) : (recordCount ?? "—")}</b>
              <small>{activeState ? "records in view" : "records indexed"}</small>
            </div>
          </div>
        </section>

        {error && <div className="empty mapPageError" role="alert"><p>{error}</p></div>}

        <section className="mapWorkspace">
          <IndiaMap
            mapView={mapView}
            stateAggregates={stateAggregates}
            seatsByState={seatsByState}
            activeState={activeState}
            onSelectState={setActiveState}
            onSelectSeat={openSeat}
          />

          <aside className="mapRanks" aria-label={activeState ? "Seat ranking" : "State ranking"}>
            <header>
              <span>{activeState ? (mapView === "aggregate" ? "HOUSE BREAKDOWN" : "CONSTITUENCIES / MPS") : "STATES BY TOTAL ASSETS"}</span>
              <h2>{activeState ? activeState : "Where the pile sits"}</h2>
            </header>
            {activeState && mapView === "aggregate" && selectedAggregate?.byChamber ? (
              <ol>
                {([
                  ["assembly", "State assemblies", selectedAggregate.byChamber.assembly],
                  ["lok_sabha", "Lok Sabha", selectedAggregate.byChamber.lok_sabha],
                  ["rajya_sabha", "Rajya Sabha", selectedAggregate.byChamber.rajya_sabha],
                ] as const).map(([key, label, assets], index) => (
                  <li key={key}>
                    <button type="button" onClick={() => setMapView(key)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <b>{label}</b>
                        <small>Open {label.toLowerCase()} map</small>
                      </div>
                      <em>{formatRupees(assets)}</em>
                    </button>
                  </li>
                ))}
                {panelSeats.slice(0, 12).map((seat, index) => (
                  <li key={`${seat.chamber}-${seat.rank}-${seat.constituency}`}>
                    <button type="button" onClick={() => openSeat(seat)}>
                      <span>{String(index + 4).padStart(2, "0")}</span>
                      <div>
                        <b>{seat.name}</b>
                        <small>{seat.chamber === "assembly" ? "MLA" : seat.chamber === "lok_sabha" ? "LS" : "RS"} · {seat.constituency} · {seat.party}</small>
                      </div>
                      <em>{formatRupees(seat.assets)}</em>
                    </button>
                  </li>
                ))}
              </ol>
            ) : activeState ? (
              <ol>
                {panelSeats.map((seat, index) => (
                  <li key={`${seat.chamber}-${seat.rank}-${seat.constituency}`}>
                    <button type="button" onClick={() => openSeat(seat)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <b>{seat.constituency}</b>
                        <small>{seat.name} · {seat.party}</small>
                      </div>
                      <em>{formatRupees(seat.assets)}</em>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <ol>
                {stateAggregates.map((row, index) => (
                  <li key={row.state}>
                    <button type="button" onClick={() => setActiveState(row.state)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <b>{row.state}</b>
                        <small>{row.count.toLocaleString("en-IN")} records</small>
                      </div>
                      <em>{formatRupees(row.totalAssets)}</em>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </section>
      </main>
    </>
  );
}
