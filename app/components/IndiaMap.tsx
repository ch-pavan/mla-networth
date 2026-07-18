"use client";

import type { Feature, FeatureCollection, Geometry } from "geojson";
import { geoMercator, geoPath } from "d3-geo";
import { scaleQuantile } from "d3-scale";
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
  assets: number | null;
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
  knownCount: number;
  byChamber?: Record<"assembly" | "lok_sabha" | "rajya_sabha", {
    totalAssets: number;
    count: number;
    knownCount: number;
  }>;
};

type MatchIndex = { byKey: Record<string, string> };
type AcIndex = { states: Record<string, { file: string; sharedFrom?: string }> };
type PcIndex = { meta: { file: string; objectName: string; nameProperty: string; stateProperty: string } };

type HoverInfo = {
  title: string;
  subtitle: string;
  value: string;
  coverage: string;
  context?: string;
};

type Props = {
  mapView: MapView;
  stateAggregates: StateAggregate[];
  seatsByState: Record<string, SeatRow[]>;
  activeState: string | null;
  onSelectState: (state: string | null) => void;
  onSelectSeat: (seat: SeatRow) => void;
};

const MAP_COLORS = ["#d9e4dc", "#b8d5c5", "#edcf91", "#e68b4f", "#bd4a20"];

const STATE_LABEL_TREATMENTS: Record<string, { label?: string; dx?: number; dy?: number }> = {
  Bihar: { dx: -8, dy: -7 },
  Jharkhand: { dx: -18, dy: 7 },
  "West Bengal": { label: "W. Bengal", dx: 22, dy: 18 },
};

function colorScale(values: number[]) {
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);
  return scaleQuantile<string>()
    .domain(finite.length ? finite : [0])
    .range(MAP_COLORS);
}

function amountLabel(value: number | null): string {
  return value === null ? "Amount unavailable" : formatRupees(value);
}

function pcFeatureState(properties: AcProps | null | undefined): string {
  // The community PC topology predates Ladakh's separate UT label; PC 4 is the Ladakh seat.
  if (normalizeConstituencyName(String(properties?.pc_name ?? "")) === "LADAKH") return "Ladakh";
  return toMapStateName(String(properties?.st_name ?? ""));
}

function legendLabels(thresholds: number[], hasValues: boolean): string[] {
  return MAP_COLORS.map((_, index) => {
    if (!hasValues || !thresholds.length) return "No values";
    if (index === 0) return `≤ ${formatRupees(thresholds[0])}`;
    if (index === MAP_COLORS.length - 1) return `> ${formatRupees(thresholds.at(-1) ?? 0)}`;
    return `${formatRupees(thresholds[index - 1])}–${formatRupees(thresholds[index])}`;
  });
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
  const [seatLayer, setSeatLayer] = useState<{ key: string; topology?: Topology; error?: string } | null>(null);
  const [acIndex, setAcIndex] = useState<AcIndex | null>(null);
  const [pcIndex, setPcIndex] = useState<PcIndex | null>(null);
  const [acMatchIndex, setAcMatchIndex] = useState<MatchIndex | null>(null);
  const [pcMatchIndex, setPcMatchIndex] = useState<MatchIndex | null>(null);
  const [loadError, setLoadError] = useState("");
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const drillMode = mapView === "assembly" || mapView === "lok_sabha";
  const showSeatLayer = Boolean(activeState && drillMode);
  const inspectionContext = `${mapView}:${activeState ?? "india"}`;

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

  const assemblyGeoEntry = useMemo(() => {
    if (!activeState || !acIndex) return null;
    const direct = acIndex.states[activeState] ?? acIndex.states[toMapStateName(activeState)];
    // AC index uses ADR names (Jammu Kashmir); map state uses Jammu and Kashmir.
    const adrKey = Object.keys(acIndex.states).find((key) => toMapStateName(key) === toMapStateName(activeState));
    return direct ?? (adrKey ? acIndex.states[adrKey] : null) ?? null;
  }, [activeState, acIndex]);

  useEffect(() => {
    if (!activeState || !drillMode) return;
    const key = `${mapView}:${activeState}`;

    if (mapView === "assembly") {
      if (!assemblyGeoEntry) return;
      const controller = new AbortController();
      void fetch(publicUrl(`/data/geo/${assemblyGeoEntry.file}`), { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`Constituency map failed (${r.status})`);
          return r.json();
        })
        .then((topo) => {
          if (!controller.signal.aborted) setSeatLayer({ key, topology: topo as Topology });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setSeatLayer({ key, error: error instanceof Error ? error.message : "Constituency map unavailable" });
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
          if (!controller.signal.aborted) setSeatLayer({ key, topology: topo as Topology });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setSeatLayer({ key, error: error instanceof Error ? error.message : "PC map unavailable" });
        });
      return () => controller.abort();
    }
  }, [activeState, assemblyGeoEntry, pcIndex, mapView, drillMode]);

  const seatLayerKey = activeState && drillMode ? `${mapView}:${activeState}` : null;
  const loadedSeatTopology = seatLayerKey && seatLayer?.key === seatLayerKey ? seatLayer.topology ?? null : null;
  const seatError = mapView === "assembly" && activeState && acIndex && !assemblyGeoEntry
    ? `No assembly constituency boundaries for ${activeState}`
    : seatLayerKey && seatLayer?.key === seatLayerKey
      ? seatLayer.error ?? ""
      : "";

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
    const values = [...seatLookup.values()].flatMap((s) => s.assets === null ? [] : [s.assets]);
    return colorScale(values);
  }, [seatLookup]);

  const indiaPaths = useMemo(() => {
    if (!statesTopo) return [];
    const fc = asFeatureCollection<StateProps>(statesTopo, "states");
    if (!fc) return [];
    const projection = geoMercator().fitExtent([[70, 24], [830, 736]], fc);
    const path = geoPath(projection);
    return fc.features.map((f: Feature<Geometry, StateProps>, i: number) => {
      const geoName = String(f.properties?.st_nm ?? "");
      const mapState = toMapStateName(geoName);
      const agg = stateTotals.get(mapState);
      const labelTreatment = STATE_LABEL_TREATMENTS[mapState];
      return {
        id: `${mapState}-${i}`,
        mapState,
        d: path(f) ?? "",
        hasData: Boolean(agg),
        hasAmount: Boolean(agg?.knownCount),
        fill: agg?.knownCount ? stateFill(agg.totalAssets) : "url(#mapUnknown)",
        totalAssets: agg?.totalAssets ?? 0,
        count: agg?.count ?? 0,
        knownCount: agg?.knownCount ?? 0,
        centroid: path.centroid(f),
        area: path.area(f),
        label: labelTreatment?.label ?? mapState.replace(" and ", " & "),
        labelDx: labelTreatment?.dx ?? 0,
        labelDy: labelTreatment?.dy ?? 0,
      };
    });
  }, [statesTopo, stateFill, stateTotals]);

  const seatPaths = useMemo(() => {
    if (!activeState || !showSeatLayer) return [];

    if (mapView === "assembly" && loadedSeatTopology) {
      const layerKey = loadedSeatTopology.objects.constituencies ? "constituencies" : Object.keys(loadedSeatTopology.objects)[0];
      const fc = asFeatureCollection<AcProps>(loadedSeatTopology, layerKey);
      if (!fc) return [];
      const adrKey = acIndex
        ? Object.keys(acIndex.states).find((key) => toMapStateName(key) === toMapStateName(activeState))
        : undefined;
      const shared = Boolean(adrKey && acIndex?.states[adrKey]?.sharedFrom);
      const projection = geoMercator().fitExtent([[60, 30], [840, 730]], fc);
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
          fill: seat?.assets != null ? seatFill(seat.assets) : "url(#mapUnknown)",
        }];
      });
    }

    if (mapView === "lok_sabha" && loadedSeatTopology && pcIndex) {
      const fc = asFeatureCollection<AcProps>(loadedSeatTopology, pcIndex.meta.objectName);
      if (!fc) return [];
      const targetState = toMapStateName(activeState);
      const filtered = {
        type: "FeatureCollection" as const,
        features: fc.features.filter((f) => pcFeatureState(f.properties) === targetState),
      };
      if (!filtered.features.length) return [];
      const projection = geoMercator().fitExtent([[60, 30], [840, 730]], filtered);
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
          fill: seat?.assets != null ? seatFill(seat.assets) : "url(#mapUnknown)",
        };
      });
    }

    return [];
  }, [loadedSeatTopology, pcIndex, acIndex, activeState, showSeatLayer, mapView, seatLookup, seatFill]);

  const unitLabel = mapView === "lok_sabha" ? "2024 Lok Sabha winners" : mapView === "rajya_sabha" ? "Rajya Sabha MPs" : mapView === "assembly" ? "sitting MLAs" : "records";
  const drillHint = mapView === "assembly"
    ? "Tap a state to open assembly constituencies"
    : mapView === "lok_sabha"
      ? "Tap a state to open parliamentary constituencies"
      : mapView === "rajya_sabha"
        ? "Tap a state to list Rajya Sabha MPs"
        : "Tap a state for the house breakdown";

  const visibleScale = showSeatLayer ? seatFill : stateFill;
  const visibleValueCount = showSeatLayer
    ? [...seatLookup.values()].filter((seat) => seat.assets !== null).length
    : stateAggregates.filter((state) => state.knownCount > 0).length;
  const visibleLegend = legendLabels(visibleScale.quantiles(), visibleValueCount > 0);
  const selectedStateInfo = activeState ? stateTotals.get(toMapStateName(activeState)) : null;
  const defaultInfo: HoverInfo = selectedStateInfo
    ? {
        title: selectedStateInfo.state,
        subtitle: `${selectedStateInfo.count.toLocaleString("en-IN")} ${unitLabel}`,
        value: selectedStateInfo.knownCount ? formatRupees(selectedStateInfo.totalAssets) : "Amount unavailable",
        coverage: `${selectedStateInfo.knownCount.toLocaleString("en-IN")} of ${selectedStateInfo.count.toLocaleString("en-IN")} declarations include an asset amount`,
      }
    : activeState
      ? {
          title: activeState,
          subtitle: `No ${unitLabel} indexed in this view`,
          value: "Amount unavailable",
          coverage: "The state selection is preserved. Choose another house or return to All India.",
        }
    : {
        title: "Explore declared wealth",
        subtitle: drillHint,
        value: "Five comparable bands",
        coverage: "Use the map or the ranked list. Keyboard users can tab through mapped regions.",
      };
  const inspection = hover?.context === inspectionContext ? hover : defaultInfo;

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
          <span className="mapLevel">INDIA · DECLARED ASSET ATLAS</span>
        )}
        <span className="mapLevel">{activeState ? `${activeState} · ${mapView === "lok_sabha" ? "PC" : mapView === "assembly" ? "AC" : "state"} declarations` : drillHint}</span>
      </div>

      <p id="map-accessibility-hint" className="mapA11yHint">
        Tab through regions and press Enter or Space to select. Press Escape to return to the India view.
      </p>

      <div className="mapSvgFrame">
      <svg
        viewBox="0 0 900 760"
        role="group"
        aria-label={activeState ? `${activeState} declared asset map` : "India state declared asset map"}
        aria-describedby="map-accessibility-hint"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !activeState) return;
          event.preventDefault();
          onSelectState(null);
        }}
      >
        <defs>
          <pattern id="mapUnknown" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="#31443c" />
            <line x1="0" y1="0" x2="0" y2="10" stroke="#718077" strokeWidth="3" />
          </pattern>
        </defs>
        {(!showSeatLayer || mapView === "rajya_sabha" || mapView === "aggregate") && indiaPaths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill={p.fill}
            className={`mapPath${p.hasData ? "" : " isMuted"}${p.hasData ? " isClickable" : ""}${activeState === p.mapState ? " isSelected" : ""}`}
            role={p.hasData ? "button" : undefined}
            tabIndex={p.hasData ? 0 : -1}
            aria-label={p.hasData ? `${p.mapState}, ${amountLabel(p.hasAmount ? p.totalAssets : null)}, ${p.knownCount} of ${p.count} declarations with amounts` : `${p.mapState}, no mapped declarations`}
            aria-pressed={p.hasData ? activeState === p.mapState : undefined}
            onPointerEnter={() => {
              if (!p.hasData) return;
              setHover({
                title: p.mapState,
                subtitle: `${p.count.toLocaleString("en-IN")} ${unitLabel}`,
                value: amountLabel(p.hasAmount ? p.totalAssets : null),
                coverage: `${p.knownCount.toLocaleString("en-IN")} of ${p.count.toLocaleString("en-IN")} declarations include an asset amount`,
                context: inspectionContext,
              });
            }}
            onFocus={() => {
              if (!p.hasData) return;
              setHover({
                title: p.mapState,
                subtitle: `${p.count.toLocaleString("en-IN")} ${unitLabel}`,
                value: amountLabel(p.hasAmount ? p.totalAssets : null),
                coverage: `${p.knownCount.toLocaleString("en-IN")} of ${p.count.toLocaleString("en-IN")} declarations include an asset amount`,
                context: inspectionContext,
              });
            }}
            onClick={() => { if (p.hasData) onSelectState(p.mapState); }}
            onKeyDown={(event) => {
              if (!p.hasData || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              onSelectState(p.mapState);
            }}
          >
            <title>{p.hasData ? `${p.mapState}: ${amountLabel(p.hasAmount ? p.totalAssets : null)}` : p.mapState}</title>
          </path>
        ))}

        {(!showSeatLayer || mapView === "rajya_sabha" || mapView === "aggregate") && indiaPaths
          .filter((p) => p.hasData && p.area > 1250 && Number.isFinite(p.centroid[0]) && Number.isFinite(p.centroid[1]))
          .map((p) => (
            <text key={`${p.id}-label`} x={p.centroid[0] + p.labelDx} y={p.centroid[1] + p.labelDy} textAnchor="middle" className="mapStateLabel" aria-hidden="true">
              {p.label}
            </text>
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
            className={`mapPath${p.seat ? " isClickable" : " isUnmatched"}`}
            role={p.seat ? "button" : undefined}
            tabIndex={p.seat ? 0 : -1}
            aria-label={p.seat ? `${p.seat.constituency}, ${p.seat.name}, ${amountLabel(p.seat.assets)}` : `${p.name}, no matched declaration`}
            onPointerEnter={() => {
              setHover({
                title: p.seat?.constituency ?? p.name,
                subtitle: p.seat ? `${p.seat.name} · ${p.seat.party}` : mapView === "assembly" ? "No matched sitting MLA" : "No matched Lok Sabha winner",
                value: p.seat ? amountLabel(p.seat.assets) : "No matched declaration",
                coverage: p.seat?.assets == null ? "The source does not provide a usable asset amount." : "Select to open the declaration record.",
                context: inspectionContext,
              });
            }}
            onFocus={() => {
              setHover({
                title: p.seat?.constituency ?? p.name,
                subtitle: p.seat ? `${p.seat.name} · ${p.seat.party}` : mapView === "assembly" ? "No matched sitting MLA" : "No matched Lok Sabha winner",
                value: p.seat ? amountLabel(p.seat.assets) : "No matched declaration",
                coverage: p.seat?.assets == null ? "The source does not provide a usable asset amount." : "Select to open the declaration record.",
                context: inspectionContext,
              });
            }}
            onClick={() => { if (p.seat) onSelectSeat(p.seat); }}
            onKeyDown={(event) => {
              if (!p.seat || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              onSelectSeat(p.seat);
            }}
          >
            <title>{p.seat ? `${p.seat.constituency}: ${amountLabel(p.seat.assets)}` : p.name}</title>
          </path>
        ))}
      </svg>
      </div>

      <div className="mapInspector" aria-live="polite">
        <span>IN VIEW</span>
        <div><b>{inspection.title}</b><small>{inspection.subtitle}</small></div>
        <strong>{inspection.value}</strong>
        <small>{inspection.coverage}</small>
      </div>

      <div className="mapLegend" aria-label={`${showSeatLayer ? "Seat" : "State"} declared asset color bands`}>
        <span className="mapLegendTitle">{showSeatLayer ? "DECLARED ASSETS BY SEAT" : "AGGREGATE DECLARED ASSETS"}</span>
        <div className="mapLegendBands">
          {MAP_COLORS.map((color, index) => (
            <span key={color}><i style={{ background: color }}></i><small>{visibleLegend[index]}</small></span>
          ))}
          <span><i className="mapUnknownSwatch"></i><small>Amount unavailable</small></span>
        </div>
      </div>
      <small className="mapCredit">Boundaries: DataMeet / community maps · figures are self-declared affidavit assets · aggregate totals sum records, not unique people</small>
    </div>
  );
}
