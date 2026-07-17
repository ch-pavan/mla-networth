"use client";

import type { Feature, FeatureCollection, Geometry } from "geojson";
import { geoMercator, geoPath } from "d3-geo";
import { scaleLinear } from "d3-scale";
import { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import {
  constituencyMatchKey,
  normalizeConstituencyName,
  pcMatchKey,
  toMapStateName,
} from "../../lib/geo-names";
import { formatRupees } from "../../lib/format-money";
import { publicUrl } from "../../lib/public-url";

type StateProps = { st_nm?: string };
type AcProps = { name?: string; pc_name?: string; st_name?: string };

function asFeatureCollection<P>(topo: Topology, objectName: string): FeatureCollection<Geometry, P> | null {
  const object = topo.objects[objectName];
  if (!object || object.type !== "GeometryCollection") return null;
  return feature(topo, object as never) as unknown as FeatureCollection<Geometry, P>;
}

export type MapView = "aggregate" | "assembly" | "lok_sabha" | "rajya_sabha";

export type SeatRow = {
  rank: number;
  state: string;
  constituency: string;
  name: string;
  party: string;
  assets: number;
  chamber?: "assembly" | "lok_sabha" | "rajya_sabha";
  electionFolder?: string;
  candidateId?: number;
  candidateUrl?: string;
  sourceUrl?: string;
};

export type StateAggregate = {
  state: string;
  totalAssets: number;
  count: number;
  byChamber?: { assembly: number; lok_sabha: number; rajya_sabha: number };
};

type MatchIndex = { byKey: Record<string, string> };
type AcIndex = { states: Record<string, { file: string; sharedFrom?: string }> };
type PcIndex = { meta: { file: string; objectName: string; nameProperty: string; stateProperty: string } };

type HoverInfo = {
  title: string;
  subtitle: string;
  value: string;
  x: number;
  y: number;
};

type Props = {
  mapView: MapView;
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

export default function IndiaMap({
  mapView,
  stateAggregates,
  seatsByState,
  activeState,
  onSelectState,
  onSelectSeat,
}: Props) {
  const [statesTopo, setStatesTopo] = useState<Topology | null>(null);
  const [acTopo, setAcTopo] = useState<Topology | null>(null);
  const [pcTopo, setPcTopo] = useState<Topology | null>(null);
  const [acIndex, setAcIndex] = useState<AcIndex | null>(null);
  const [pcIndex, setPcIndex] = useState<PcIndex | null>(null);
  const [acMatchIndex, setAcMatchIndex] = useState<MatchIndex | null>(null);
  const [pcMatchIndex, setPcMatchIndex] = useState<MatchIndex | null>(null);
  const [loadError, setLoadError] = useState("");
  const [seatError, setSeatError] = useState("");
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const drillMode = mapView === "assembly" || mapView === "lok_sabha";
  const showSeatLayer = Boolean(activeState && drillMode);

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
        if (!r.ok) throw new Error(`AC match index failed (${r.status})`);
        return r.json();
      }),
      fetch(publicUrl("/data/geo/pc-index.json"), { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`PC index failed (${r.status})`);
        return r.json();
      }),
      fetch(publicUrl("/data/geo/pc-match-index.json"), { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`PC match index failed (${r.status})`);
        return r.json();
      }),
    ])
      .then(([topo, ac, acMatches, pc, pcMatches]) => {
        setStatesTopo(topo as Topology);
        setAcIndex(ac as AcIndex);
        setAcMatchIndex(acMatches as MatchIndex);
        setPcIndex(pc as PcIndex);
        setPcMatchIndex(pcMatches as MatchIndex);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Map data unavailable");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setAcTopo(null);
    setPcTopo(null);
    setSeatError("");
    if (!activeState || !drillMode) return;

    if (mapView === "assembly") {
      if (!acIndex) return;
      const entry = acIndex.states[activeState] ?? acIndex.states[toMapStateName(activeState)];
      // AC index uses ADR names (Jammu Kashmir); map state uses Jammu and Kashmir.
      const adrKey = Object.keys(acIndex.states).find((key) => toMapStateName(key) === toMapStateName(activeState));
      const resolved = entry ?? (adrKey ? acIndex.states[adrKey] : null);
      if (!resolved) {
        setSeatError(`No assembly constituency boundaries for ${activeState}`);
        return;
      }
      const controller = new AbortController();
      void fetch(publicUrl(`/data/geo/${resolved.file}`), { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`Constituency map failed (${r.status})`);
          return r.json();
        })
        .then((topo) => {
          if (!controller.signal.aborted) setAcTopo(topo as Topology);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setSeatError(error instanceof Error ? error.message : "Constituency map unavailable");
        });
      return () => controller.abort();
    }

    if (mapView === "lok_sabha") {
      if (!pcIndex) return;
      const controller = new AbortController();
      void fetch(publicUrl(`/data/geo/${pcIndex.meta.file}`), { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`PC map failed (${r.status})`);
          return r.json();
        })
        .then((topo) => {
          if (!controller.signal.aborted) setPcTopo(topo as Topology);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setSeatError(error instanceof Error ? error.message : "PC map unavailable");
        });
      return () => controller.abort();
    }
  }, [activeState, acIndex, pcIndex, mapView, drillMode]);

  const stateTotals = useMemo(() => {
    const map = new Map(stateAggregates.map((s) => [toMapStateName(s.state), s]));
    return map;
  }, [stateAggregates]);

  const stateFill = useMemo(() => colorScale(stateAggregates.map((s) => s.totalAssets)), [stateAggregates]);

  const seatLookup = useMemo(() => {
    if (!activeState || !showSeatLayer) return new Map<string, SeatRow>();
    const seats = seatsByState[activeState] ?? seatsByState[toMapStateName(activeState)] ?? [];
    const byGeo = new Map<string, SeatRow>();
    if (mapView === "assembly" && acMatchIndex) {
      for (const seat of seats) {
        const key = constituencyMatchKey(seat.state, seat.constituency);
        const geoName = acMatchIndex.byKey[key];
        if (!geoName) continue;
        byGeo.set(normalizeConstituencyName(geoName), seat);
      }
    }
    if (mapView === "lok_sabha" && pcMatchIndex) {
      for (const seat of seats) {
        const key = pcMatchKey(seat.state, seat.constituency);
        const geoName = pcMatchIndex.byKey[key];
        if (!geoName) continue;
        byGeo.set(normalizeConstituencyName(geoName), seat);
      }
    }
    return byGeo;
  }, [activeState, showSeatLayer, seatsByState, mapView, acMatchIndex, pcMatchIndex]);

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
      const mapState = toMapStateName(geoName);
      const agg = stateTotals.get(mapState);
      return {
        id: `${mapState}-${i}`,
        mapState,
        d: path(f) ?? "",
        hasData: Boolean(agg),
        fill: agg ? stateFill(agg.totalAssets) : "#e8e2d6",
        totalAssets: agg?.totalAssets ?? 0,
        count: agg?.count ?? 0,
      };
    });
  }, [statesTopo, stateFill, stateTotals]);

  const seatPaths = useMemo(() => {
    if (!activeState || !showSeatLayer) return [];

    if (mapView === "assembly" && acTopo) {
      const layerKey = acTopo.objects.constituencies ? "constituencies" : Object.keys(acTopo.objects)[0];
      const fc = asFeatureCollection<AcProps>(acTopo, layerKey);
      if (!fc) return [];
      const adrKey = acIndex
        ? Object.keys(acIndex.states).find((key) => toMapStateName(key) === toMapStateName(activeState))
        : undefined;
      const shared = Boolean(adrKey && acIndex?.states[adrKey]?.sharedFrom);
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
    }

    if (mapView === "lok_sabha" && pcTopo && pcIndex) {
      const fc = asFeatureCollection<AcProps>(pcTopo, pcIndex.meta.objectName);
      if (!fc) return [];
      const targetState = toMapStateName(activeState);
      const filtered = {
        type: "FeatureCollection" as const,
        features: fc.features.filter((f) => toMapStateName(String(f.properties?.st_name ?? "")) === targetState),
      };
      if (!filtered.features.length) return [];
      const projection = geoMercator().fitSize([900, 900], filtered);
      const path = geoPath(projection);
      return filtered.features.map((f: Feature<Geometry, AcProps>, i: number) => {
        const rawName = String(f.properties?.pc_name ?? "");
        const norm = normalizeConstituencyName(rawName);
        const seat = seatLookup.get(norm);
        return {
          id: `${rawName}-${i}`,
          name: rawName,
          d: path(f) ?? "",
          seat,
          fill: seat ? seatFill(seat.assets) : "#ebe4d8",
        };
      });
    }

    return [];
  }, [acTopo, pcTopo, pcIndex, acIndex, activeState, showSeatLayer, mapView, seatLookup, seatFill]);

  const unitLabel = mapView === "lok_sabha" ? "Lok Sabha MPs" : mapView === "rajya_sabha" ? "Rajya Sabha MPs" : mapView === "assembly" ? "sitting MLAs" : "legislators";
  const drillHint = mapView === "assembly"
    ? "Tap a state to open assembly constituencies"
    : mapView === "lok_sabha"
      ? "Tap a state to open parliamentary constituencies"
      : mapView === "rajya_sabha"
        ? "Tap a state to list Rajya Sabha MPs"
        : "Tap a state for the house breakdown";

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
        <span className="mapLevel">{activeState ? `${activeState} · ${mapView === "lok_sabha" ? "PC" : mapView === "assembly" ? "AC" : "state"} declarations` : drillHint}</span>
      </div>

      <svg viewBox="0 0 900 900" role="img" aria-label={activeState ? `${activeState} wealth map` : "India state wealth map"}>
        {(!showSeatLayer || mapView === "rajya_sabha" || mapView === "aggregate") && indiaPaths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill={p.fill}
            className={`mapPath${p.hasData ? "" : " isMuted"}${p.hasData ? " isClickable" : ""}`}
            onMouseMove={(event) => {
              if (!p.hasData) return;
              const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
              setHover({
                title: p.mapState,
                subtitle: `${p.count.toLocaleString("en-IN")} ${unitLabel}`,
                value: formatRupees(p.totalAssets),
                x: event.clientX - (rect?.left ?? 0),
                y: event.clientY - (rect?.top ?? 0),
              });
            }}
            onMouseLeave={() => setHover(null)}
            onClick={() => { if (p.hasData) onSelectState(p.mapState); }}
          >
            <title>{p.hasData ? `${p.mapState}: ${formatRupees(p.totalAssets)}` : p.mapState}</title>
          </path>
        ))}

        {showSeatLayer && seatError && (
          <text x="450" y="450" textAnchor="middle" className="mapSvgNote">{seatError}</text>
        )}
        {showSeatLayer && !seatError && !seatPaths.length && (
          <text x="450" y="450" textAnchor="middle" className="mapSvgNote">Loading constituencies…</text>
        )}
        {showSeatLayer && seatPaths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill={p.fill}
            className={`mapPath${p.seat ? " isClickable" : " isMuted"}`}
            onMouseMove={(event) => {
              const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
              setHover({
                title: p.seat?.constituency ?? p.name,
                subtitle: p.seat ? `${p.seat.name} · ${p.seat.party}` : "No matched sitting MP",
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
