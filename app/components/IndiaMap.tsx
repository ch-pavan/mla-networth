"use client";

import type { Feature, FeatureCollection, Geometry } from "geojson";
import { geoMercator, geoPath } from "d3-geo";
import { scaleLinear } from "d3-scale";
import { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { constituencyMatchKey, normalizeConstituencyName, toAdrStateName } from "../../lib/geo-names";
import { formatRupees } from "../../lib/format-money";
import { publicUrl } from "../../lib/public-url";

type StateProps = { st_nm?: string };
type AcProps = { name?: string };

function asFeatureCollection<P>(topo: Topology, objectName: string): FeatureCollection<Geometry, P> | null {
  const object = topo.objects[objectName];
  if (!object || object.type !== "GeometryCollection") return null;
  return feature(topo, object as never) as unknown as FeatureCollection<Geometry, P>;
}

export type SeatRow = {
  rank: number;
  state: string;
  constituency: string;
  name: string;
  party: string;
  assets: number;
};

export type StateAggregate = {
  state: string;
  totalAssets: number;
  count: number;
};

type MatchIndex = { byKey: Record<string, string> };
type AcIndex = { states: Record<string, { file: string; sharedFrom?: string }> };

type HoverInfo = {
  title: string;
  subtitle: string;
  value: string;
  x: number;
  y: number;
};

type Props = {
  stateAggregates: StateAggregate[];
  seatsByState: Record<string, SeatRow[]>;
  activeState: string | null;
  onSelectState: (state: string | null) => void;
  onSelectSeat: (seat: SeatRow) => void;
};

function colorScale(values: number[]) {
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);
  const max = finite.length ? Math.max(...finite) : 1;
  const min = finite.length ? Math.min(...finite) : 0;
  return scaleLinear<string, string>()
    .domain([min, (min + max) / 2, max])
    .range(["#f3e4cf", "#e39a52", "#b24512"])
    .clamp(true);
}

export default function IndiaMap({ stateAggregates, seatsByState, activeState, onSelectState, onSelectSeat }: Props) {
  const [statesTopo, setStatesTopo] = useState<Topology | null>(null);
  const [acTopo, setAcTopo] = useState<Topology | null>(null);
  const [acIndex, setAcIndex] = useState<AcIndex | null>(null);
  const [matchIndex, setMatchIndex] = useState<MatchIndex | null>(null);
  const [loadError, setLoadError] = useState("");
  const [acError, setAcError] = useState("");
  const [hover, setHover] = useState<HoverInfo | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(publicUrl("/data/geo/india-states.json"), { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`States map failed (${r.status})`);
        return r.json();
      }),
      fetch(publicUrl("/data/geo/ac-index.json"), { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`AC index failed (${r.status})`);
        return r.json();
      }),
      fetch(publicUrl("/data/geo/constituency-match-index.json"), { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`Match index failed (${r.status})`);
        return r.json();
      }),
    ])
      .then(([topo, ac, matches]) => {
        setStatesTopo(topo as Topology);
        setAcIndex(ac as AcIndex);
        setMatchIndex(matches as MatchIndex);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Map data unavailable");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activeState || !acIndex) {
      setAcTopo(null);
      setAcError("");
      return;
    }
    const entry = acIndex.states[activeState];
    if (!entry) {
      setAcTopo(null);
      setAcError(`No constituency boundaries for ${activeState}`);
      return;
    }
    const controller = new AbortController();
    setAcError("");
    setAcTopo(null);
    void fetch(publicUrl(`/data/geo/${entry.file}`), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Constituency map failed (${r.status})`);
        return r.json();
      })
      .then((topo) => {
        if (!controller.signal.aborted) setAcTopo(topo as Topology);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setAcError(error instanceof Error ? error.message : "Constituency map unavailable");
      });
    return () => controller.abort();
  }, [activeState, acIndex]);

  const stateTotals = useMemo(() => {
    const map = new Map(stateAggregates.map((s) => [s.state, s]));
    return map;
  }, [stateAggregates]);

  const stateFill = useMemo(() => colorScale(stateAggregates.map((s) => s.totalAssets)), [stateAggregates]);

  const seatLookup = useMemo(() => {
    if (!activeState || !matchIndex) return new Map<string, SeatRow>();
    const seats = seatsByState[activeState] ?? [];
    const byGeo = new Map<string, SeatRow>();
    for (const seat of seats) {
      const key = constituencyMatchKey(seat.state, seat.constituency);
      const geoName = matchIndex.byKey[key];
      if (!geoName) continue;
      byGeo.set(normalizeConstituencyName(geoName), seat);
    }
    return byGeo;
  }, [activeState, matchIndex, seatsByState]);

  const seatFill = useMemo(() => {
    const values = [...seatLookup.values()].map((s) => s.assets);
    return colorScale(values);
  }, [seatLookup]);

  const indiaPaths = useMemo(() => {
    if (!statesTopo) return [];
    const fc = asFeatureCollection<StateProps>(statesTopo, "states");
    if (!fc) return [];
    const projection = geoMercator().fitSize([900, 900], fc);
    const path = geoPath(projection);
    return fc.features.map((f: Feature<Geometry, StateProps>, i: number) => {
      const geoName = String(f.properties?.st_nm ?? "");
      const adr = toAdrStateName(geoName);
      const agg = stateTotals.get(adr);
      return {
        id: `${adr}-${i}`,
        adr,
        d: path(f) ?? "",
        hasData: Boolean(agg),
        fill: agg ? stateFill(agg.totalAssets) : "#e8e2d6",
        totalAssets: agg?.totalAssets ?? 0,
        count: agg?.count ?? 0,
      };
    });
  }, [statesTopo, stateFill, stateTotals]);

  const acPaths = useMemo(() => {
    if (!acTopo || !activeState) return [];
    const layerKey = acTopo.objects.constituencies ? "constituencies" : Object.keys(acTopo.objects)[0];
    const fc = asFeatureCollection<AcProps>(acTopo, layerKey);
    if (!fc) return [];
    // Telangana shares Andhra polygons — keep only matched seats when shared.
    const shared = Boolean(acIndex?.states[activeState]?.sharedFrom);
    const projection = geoMercator().fitSize([900, 900], fc);
    const path = geoPath(projection);
    return fc.features.flatMap((f: Feature<Geometry, AcProps>, i: number) => {
      const rawName = String(f.properties?.name ?? "");
      const norm = normalizeConstituencyName(rawName);
      const seat = seatLookup.get(norm);
      if (shared && !seat) return [];
      return [{
        id: `${rawName}-${i}`,
        name: rawName,
        d: path(f) ?? "",
        seat,
        fill: seat ? seatFill(seat.assets) : "#ebe4d8",
      }];
    });
  }, [acTopo, activeState, acIndex, seatLookup, seatFill]);

  if (loadError) {
    return <div className="mapCanvas mapEmpty" role="alert">{loadError}</div>;
  }
  if (!statesTopo) {
    return <div className="mapCanvas mapEmpty">Loading India map…</div>;
  }

  return (
    <div className="mapCanvas">
      <div className="mapToolbar">
        {activeState ? (
          <button type="button" className="mapBack" onClick={() => onSelectState(null)}>← All India</button>
        ) : (
          <span className="mapLevel">INDIA · aggregate declared assets</span>
        )}
        <span className="mapLevel">{activeState ? `${activeState} · seat declarations` : "Tap a state to open constituencies"}</span>
      </div>

      <svg viewBox="0 0 900 900" role="img" aria-label={activeState ? `${activeState} constituency wealth map` : "India state wealth map"}>
        {!activeState && indiaPaths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill={p.fill}
            className={`mapPath${p.hasData ? "" : " isMuted"}${p.hasData ? " isClickable" : ""}`}
            onMouseMove={(event) => {
              if (!p.hasData) return;
              const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
              setHover({
                title: p.adr,
                subtitle: `${p.count.toLocaleString("en-IN")} sitting MLAs`,
                value: formatRupees(p.totalAssets),
                x: event.clientX - (rect?.left ?? 0),
                y: event.clientY - (rect?.top ?? 0),
              });
            }}
            onMouseLeave={() => setHover(null)}
            onClick={() => { if (p.hasData) onSelectState(p.adr); }}
          >
            <title>{p.hasData ? `${p.adr}: ${formatRupees(p.totalAssets)}` : p.adr}</title>
          </path>
        ))}

        {activeState && acError && (
          <text x="450" y="450" textAnchor="middle" className="mapSvgNote">{acError}</text>
        )}
        {activeState && !acError && !acTopo && (
          <text x="450" y="450" textAnchor="middle" className="mapSvgNote">Loading constituencies…</text>
        )}
        {activeState && acPaths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill={p.fill}
            className={`mapPath${p.seat ? " isClickable" : " isMuted"}`}
            onMouseMove={(event) => {
              const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
              setHover({
                title: p.seat?.constituency ?? p.name,
                subtitle: p.seat ? `${p.seat.name} · ${p.seat.party}` : "No matched sitting MLA",
                value: p.seat ? formatRupees(p.seat.assets) : "—",
                x: event.clientX - (rect?.left ?? 0),
                y: event.clientY - (rect?.top ?? 0),
              });
            }}
            onMouseLeave={() => setHover(null)}
            onClick={() => { if (p.seat) onSelectSeat(p.seat); }}
          >
            <title>{p.seat ? `${p.seat.constituency}: ${formatRupees(p.seat.assets)}` : p.name}</title>
          </path>
        ))}
      </svg>

      {hover && (
        <div className="mapTooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <b>{hover.title}</b>
          <span>{hover.subtitle}</span>
          <strong>{hover.value}</strong>
        </div>
      )}

      <div className="mapLegend" aria-hidden="true">
        <span>Lower</span>
        <i></i>
        <span>Higher aggregate</span>
      </div>
      <small className="mapCredit">Boundaries: DataMeet / community maps · figures are self-declared affidavit assets</small>
    </div>
  );
}
