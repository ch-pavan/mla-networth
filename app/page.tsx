"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { availableMoney, compareAvailableMoneyDescending, formatCrores as fmt, type MoneyStatus } from "../lib/format-money";
import { buildVerifiedAssetHistory, normalizePersonName } from "../lib/profile-history";
import { publicUrl } from "../lib/public-url";
import { buildDisplayableSeatHistories, compareWinnerElections } from "../lib/winner-history";

type House = "assembly" | "lok_sabha" | "rajya_sabha";
type MLA = {
  name: string; state: string; constituency: string; party: string; assets: number;
  liabilities: number; growth: number; years: number[]; values: number[]; cases: number;
  historical?: boolean; education?: string; age?: number | null; gender?: string; sourceRank?: number; sourceUrl?: string;
  electionFolder?: string; candidateId?: number; chamber: House;
};

type AdrRecord = { rank:number; state:string; electionYear?:number|null; constituency:string; name:string; party:string; age:number|null; gender:string; assets:number|null; liabilities:number|null; criminalCases:number; seriousCriminalCases:number; education:string; panDeclared:boolean; chamber?:string; electionFolder?:string; candidateId?:number; candidateUrl?:string; term?:string|null };
type AdrSnapshot = { meta:{recordCount:number;sourceUrl:string;published:string;note:string;chamber?:string;title?:string}; records:AdrRecord[] };
type Chamber = "all" | House;

const HOUSE_BADGE: Record<House, string> = { assembly: "MLA", lok_sabha: "LS", rajya_sabha: "RS" };
type DatasetKey = "snapshot"|"history"|"archive"|"candidateIndex"|"mpSnapshot"|"rsSnapshot";
type DatasetAttempts = Record<DatasetKey,number>;
type HistoryComparison = { state:string;currentYear:number;previousYear:number;name:string;normalizedName:string;party:string;currentAssets:number;previousAssets:number;percentChange:number;remarks:string;comparisonUrl:string;currentSnapshotRank:number|null;matchedToSnapshot:boolean };
type HistorySnapshot = { meta:{electionPagesAvailable:number;comparisonCount:number;snapshotMatchCount:number;firstYear:number;latestYear:number;note:string}; comparisons:HistoryComparison[] };
type WinnerRecord = { state:string;electionYear:number;electionDate?:string;electionType?:string;baseConstituency?:string;electionFolder:string;rankByAssets:number;candidateId:number;name:string;normalizedName:string;constituency:string;normalizedConstituency:string;party:string;criminalCases:number;education:string;assets:number|null;assetsStatus?:MoneyStatus;liabilities:number|null;liabilitiesStatus?:MoneyStatus;candidateUrl:string };
type WinnerArchive = { meta:{winnerRecords:number;electionFolders:number;states:number;firstYear:number;latestYear:number;note:string}; records:WinnerRecord[] };
type CandidateRecord = { ordinal:number;candidateId:number;name:string;normalizedName:string;constituency:string;normalizedConstituency:string;party:string;criminalCases:number;education:string;assets:number|null;assetsStatus?:MoneyStatus;liabilities:number|null;liabilitiesStatus?:MoneyStatus;electionYear?:number;electionDate?:string|null;electionType?:string;baseConstituency?:string;candidateUrl:string };
type CandidateElection = { state:string;electionYear:number;electionFolder:string;candidateCount:number;constituencyCount:number;complete:boolean;file:string;sourceUrl:string };
type CandidateIndex = { meta:{candidateRecords:number;electionFolders:number;completeElectionFolders:number;states:number;firstYear:number;latestYear:number;note:string};states:{state:string;elections:CandidateElection[]}[] };
type CandidateShard = { meta:CandidateElection;records:CandidateRecord[] };
type WatchItem = { id:string; label:string; href:string };

const WATCHLIST_STORAGE_KEY = "netaworth-watchlist-v1";
const WATCHLIST_EVENT = "netaworth-watchlist-change";

const parties: Record<string,string> = { BJP:"#f28b22", INC:"#3f78c5", TDP:"#e4c72f", YSRCP:"#2f69b1", BRS:"#e85a98", "CPI(M)":"#d94841", AITC:"#38a169", SP:"#d94d5c", AAP:"#3677c8", "JD(U)":"#459b71", RJD:"#43985b", IND:"#7d8696" };

const normalizeName = normalizePersonName;
const errorMessage = (error:unknown) => error instanceof Error ? error.message : "The data could not be loaded.";

async function fetchJson<T>(url:string, signal:AbortSignal):Promise<T> {
  const response=await fetch(url,{signal});
  if(!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function readWatchlistSnapshot(){
  if(typeof window==="undefined") return "[]";
  try { return window.localStorage.getItem(WATCHLIST_STORAGE_KEY)??"[]"; }
  catch { return "[]"; }
}

function subscribeWatchlist(onStoreChange:()=>void){
  if(typeof window==="undefined") return ()=>{};
  window.addEventListener("storage",onStoreChange);
  window.addEventListener(WATCHLIST_EVENT,onStoreChange);
  return ()=>{
    window.removeEventListener("storage",onStoreChange);
    window.removeEventListener(WATCHLIST_EVENT,onStoreChange);
  };
}

function parseWatchlist(value:string):WatchItem[]{
  try {
    const parsed:unknown=JSON.parse(value);
    if(!Array.isArray(parsed)) return [];
    return parsed.filter((item):item is WatchItem=>Boolean(item)&&typeof item==="object"&&typeof item.id==="string"&&typeof item.label==="string"&&typeof item.href==="string");
  } catch {
    return [];
  }
}

function writeWatchlist(items:WatchItem[]){
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY,JSON.stringify(items));
    window.dispatchEvent(new Event(WATCHLIST_EVENT));
  } catch {
    // Storage may be unavailable in private browsing; the public database still works.
  }
}

function Sparkline({ values, color="#df6b32" }:{values:number[],color?:string}) {
  const max=Math.max(...values), min=Math.min(...values), range=max-min||1;
  const pts=values.map((v,i)=>`${(i/(values.length-1))*90+5},${34-((v-min)/range)*28}`).join(" ");
  return <svg className="spark" viewBox="0 0 100 40" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{values.map((v,i)=><circle key={i} cx={(i/(values.length-1))*90+5} cy={34-((v-min)/range)*28} r="2.5" fill={color}/>)}</svg>
}

export default function Home() {
  const [query,setQuery]=useState("");
  const [chamber,setChamber]=useState<Chamber>("all");
  const [state,setState]=useState("All India");
  const [sort,setSort]=useState<"assets"|"growth"|"liabilities">("assets");
  const [activeId,setActiveId]=useState<string|null>(null);
  const [watchOpen,setWatchOpen]=useState(false);
  const [mlaLimit,setMlaLimit]=useState(12);
  const [candidateLimit,setCandidateLimit]=useState(50);
  const [seatLimit,setSeatLimit]=useState(8);
  const [snapshot,setSnapshot]=useState<AdrSnapshot|null>(null);
  const [mpSnapshot,setMpSnapshot]=useState<AdrSnapshot|null>(null);
  const [rsSnapshot,setRsSnapshot]=useState<AdrSnapshot|null>(null);
  const [history,setHistory]=useState<HistorySnapshot|null>(null);
  const [archive,setArchive]=useState<WinnerArchive|null>(null);
  const [lsArchive,setLsArchive]=useState<WinnerArchive|null>(null);
  const [dataErrors,setDataErrors]=useState<Partial<Record<DatasetKey,string>>>({});
  const [dataAttempts,setDataAttempts]=useState<DatasetAttempts>({snapshot:0,history:0,archive:0,candidateIndex:0,mpSnapshot:0,rsSnapshot:0});
  const [requestedSections,setRequestedSections]=useState({history:false,archive:false,candidates:false});
  const [archiveState,setArchiveState]=useState("Karnataka");
  const [seatQuery,setSeatQuery]=useState("Kanakapura");
  const [candidateIndex,setCandidateIndex]=useState<CandidateIndex|null>(null);
  const [candidateState,setCandidateState]=useState("Karnataka");
  const [candidateYear,setCandidateYear]=useState(2023);
  const [candidateShard,setCandidateShard]=useState<CandidateShard|null>(null);
  const [candidateQuery,setCandidateQuery]=useState("");
  const [candidateLoadError,setCandidateLoadError]=useState("");
  const [candidateAttempt,setCandidateAttempt]=useState(0);
  const candidateRequest=useRef(0);
  const watchButton=useRef<HTMLButtonElement|null>(null);
  const watchPanel=useRef<HTMLElement|null>(null);
  const explorerSection=useRef<HTMLElement|null>(null);
  const candidateSection=useRef<HTMLElement|null>(null);
  const archiveSection=useRef<HTMLElement|null>(null);
  const watchlistSnapshot=useSyncExternalStore(subscribeWatchlist,readWatchlistSnapshot,()=>"[]");
  const watch=useMemo(()=>parseWatchlist(watchlistSnapshot),[watchlistSnapshot]);

  useEffect(()=>{
    if(typeof IntersectionObserver==="undefined"){
      const fallback=window.setTimeout(()=>setRequestedSections({history:true,archive:true,candidates:true}),0);
      return ()=>window.clearTimeout(fallback);
    }
    const sectionByElement=new Map<Element,"history"|"archive"|"candidates">();
    if(explorerSection.current) sectionByElement.set(explorerSection.current,"history");
    if(candidateSection.current) sectionByElement.set(candidateSection.current,"candidates");
    if(archiveSection.current) sectionByElement.set(archiveSection.current,"archive");
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(!entry.isIntersecting) continue;
        const section=sectionByElement.get(entry.target);
        if(section) setRequestedSections(current=>current[section]?current:{...current,[section]:true});
        observer.unobserve(entry.target);
      }
    },{rootMargin:"200px 0px"});
    sectionByElement.forEach((_,element)=>observer.observe(element));
    return ()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    const controller=new AbortController();
    void fetchJson<AdrSnapshot>(publicUrl("/data/adr-sitting-mlas-2025.json"),controller.signal).then(data=>{
      if(!controller.signal.aborted){setSnapshot(data);setDataErrors(current=>({...current,snapshot:undefined}))}
    }).catch(error=>{if(!controller.signal.aborted)setDataErrors(current=>({...current,snapshot:errorMessage(error)}))});
    return ()=>controller.abort();
  },[dataAttempts.snapshot]);

  useEffect(()=>{
    const controller=new AbortController();
    void fetchJson<AdrSnapshot>(publicUrl("/data/lok-sabha-sitting-mps.json"),controller.signal).then(data=>{
      if(!controller.signal.aborted){setMpSnapshot(data);setDataErrors(current=>({...current,mpSnapshot:undefined}))}
    }).catch(error=>{if(!controller.signal.aborted)setDataErrors(current=>({...current,mpSnapshot:errorMessage(error)}))});
    return ()=>controller.abort();
  },[dataAttempts.mpSnapshot]);

  useEffect(()=>{
    const controller=new AbortController();
    void fetchJson<AdrSnapshot>(publicUrl("/data/rajya-sabha-sitting-mps.json"),controller.signal).then(data=>{
      if(!controller.signal.aborted){setRsSnapshot(data);setDataErrors(current=>({...current,rsSnapshot:undefined}))}
    }).catch(error=>{if(!controller.signal.aborted)setDataErrors(current=>({...current,rsSnapshot:errorMessage(error)}))});
    return ()=>controller.abort();
  },[dataAttempts.rsSnapshot]);

  useEffect(()=>{
    const controller=new AbortController();
    void fetchJson<CandidateIndex>(publicUrl("/data/candidates/index.json"),controller.signal).then(data=>{
      if(!controller.signal.aborted){setCandidateIndex(data);setDataErrors(current=>({...current,candidateIndex:undefined}))}
    }).catch(error=>{if(!controller.signal.aborted)setDataErrors(current=>({...current,candidateIndex:errorMessage(error)}))});
    return ()=>controller.abort();
  },[dataAttempts.candidateIndex]);

  useEffect(()=>{
    if(!requestedSections.history) return;
    if(chamber!=="assembly") return;
    const controller=new AbortController();
    void fetchJson<HistorySnapshot>(publicUrl("/data/adr-recontest-history.json"),controller.signal).then(data=>{
      if(!controller.signal.aborted){setHistory(data);setDataErrors(current=>({...current,history:undefined}))}
    }).catch(error=>{if(!controller.signal.aborted)setDataErrors(current=>({...current,history:errorMessage(error)}))});
    return ()=>controller.abort();
  },[requestedSections.history,dataAttempts.history,chamber]);

  useEffect(()=>{
    if(!requestedSections.archive) return;
    if(chamber==="rajya_sabha"||chamber==="all") return;
    const controller=new AbortController();
    const url=chamber==="lok_sabha"?"/data/lok-sabha-winner-archive.json":"/data/adr-winner-archive.json";
    void fetchJson<WinnerArchive>(publicUrl(url),controller.signal).then(data=>{
      if(!controller.signal.aborted){
        if(chamber==="lok_sabha") setLsArchive(data);
        else setArchive(data);
        setDataErrors(current=>({...current,archive:undefined}));
      }
    }).catch(error=>{if(!controller.signal.aborted)setDataErrors(current=>({...current,archive:errorMessage(error)}))});
    return ()=>controller.abort();
  },[requestedSections.archive,dataAttempts.archive,chamber]);

  useEffect(()=>{
    setState("All India");
    setActiveId(null);
    setMlaLimit(12);
    if(chamber==="lok_sabha"){
      const hasLokSabha=candidateIndex?.states.some((entry)=>entry.state==="Lok Sabha");
      if(hasLokSabha){
        setCandidateState("Lok Sabha");
        setCandidateYear(candidateIndex?.states.find((entry)=>entry.state==="Lok Sabha")?.elections[0]?.electionYear??2024);
      }
      setArchiveState("Andhra Pradesh");
      setSeatQuery("");
      return;
    }
    if(chamber==="rajya_sabha"||chamber==="all"){
      setSeatQuery("");
      return;
    }
    setCandidateState("Karnataka");
    setCandidateYear(2023);
    setArchiveState("Karnataka");
    setSeatQuery("Kanakapura");
  },[chamber,candidateIndex]);

  useEffect(()=>{
    const focusSearch=(event:KeyboardEvent)=>{
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){
        event.preventDefault();
        document.getElementById("search")?.focus();
      }
    };
    window.addEventListener("keydown",focusSearch);
    return ()=>window.removeEventListener("keydown",focusSearch);
  },[]);

  useEffect(()=>{
    if(!watchOpen)return;
    const trigger=watchButton.current;
    const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==="Escape")setWatchOpen(false)};
    window.addEventListener("keydown",closeOnEscape);
    watchPanel.current?.querySelector<HTMLElement>("a,button")?.focus();
    return ()=>{
      window.removeEventListener("keydown",closeOnEscape);
      trigger?.focus();
    };
  },[watchOpen]);

  const candidateElections=useMemo(()=>candidateIndex?.states.find(s=>s.state===candidateState)?.elections??[],[candidateIndex,candidateState]);
  useEffect(()=>{
    if(!requestedSections.candidates) return;
    const election=candidateElections.find(e=>e.electionYear===candidateYear);
    if(!election) return;
    const requestId=++candidateRequest.current;
    const controller=new AbortController();
    void fetchJson<CandidateShard>(publicUrl(election.file),controller.signal).then(data=>{
      if(!controller.signal.aborted&&requestId===candidateRequest.current){
        setCandidateShard(data);
        setCandidateLoadError("");
      }
    }).catch(error=>{
      if(!controller.signal.aborted&&requestId===candidateRequest.current) setCandidateLoadError(errorMessage(error));
    });
    return ()=>controller.abort();
  },[candidateElections,candidateYear,candidateAttempt,requestedSections.candidates]);

  const activeSnapshot=chamber==="lok_sabha"?mpSnapshot:chamber==="rajya_sabha"?rsSnapshot:chamber==="all"?null:snapshot;
  const activeArchive=chamber==="lok_sabha"?lsArchive:archive;
  const chamberErrorKey:DatasetKey=chamber==="lok_sabha"?"mpSnapshot":chamber==="rajya_sabha"?"rsSnapshot":"snapshot";
  const mapRecords=(source:AdrSnapshot|null, house:House, withHistory:boolean):MLA[]=>{
    if(!source) return [];
    const comparisons=new Map<string,HistoryComparison[]>();
    if(withHistory){
      for(const h of history?.comparisons??[]){const key=`${h.state}|${h.normalizedName}`;comparisons.set(key,[...(comparisons.get(key)??[]),h])}
    }
    return source.records.flatMap((r):MLA[]=>{
      const assetsRupees=availableMoney(r.assets);
      const liabilitiesRupees=availableMoney(r.liabilities)??0;
      if(assetsRupees===null) return [];
      const electionYear=r.electionYear??0;
      const segments=(comparisons.get(`${r.state}|${normalizeName(r.name)}`)??[]).sort((a,b)=>a.currentYear-b.currentYear);
      const timeline=withHistory
        ?buildVerifiedAssetHistory({state:r.state,electionYear,name:r.name,assets:assetsRupees,sourceUrl:source.meta.sourceUrl},segments)
        :[{year:electionYear||new Date().getFullYear(),assets:assetsRupees,sourceUrl:r.candidateUrl||source.meta.sourceUrl}];
      const firstAssets=timeline[0]?.assets??assetsRupees;
      const growth=timeline.length>1&&firstAssets>0?Math.round(((assetsRupees-firstAssets)/firstAssets)*100):0;
      const years=timeline.length>1?timeline.map(x=>x.year):[timeline[0].year,timeline[0].year];
      const values=timeline.length>1?timeline.map(x=>x.assets/1e7):[assetsRupees/1e7,assetsRupees/1e7];
      return [{name:r.name,state:r.state,constituency:r.constituency||"Rajya Sabha",party:r.party,assets:assetsRupees/1e7,liabilities:liabilitiesRupees/1e7,growth,years,values,cases:r.criminalCases,historical:timeline.length>1,education:r.education,age:r.age,gender:r.gender,sourceRank:r.rank,sourceUrl:r.candidateUrl||(timeline.length>1?timeline.at(-2)?.sourceUrl:undefined)||source.meta.sourceUrl,electionFolder:r.electionFolder,candidateId:r.candidateId,chamber:house}];
    });
  };
  const allData=useMemo(()=>{
    if(chamber==="all") return [...mapRecords(snapshot,"assembly",false),...mapRecords(mpSnapshot,"lok_sabha",false),...mapRecords(rsSnapshot,"rajya_sabha",false)];
    if(chamber==="lok_sabha") return mapRecords(mpSnapshot,"lok_sabha",false);
    if(chamber==="rajya_sabha") return mapRecords(rsSnapshot,"rajya_sabha",false);
    return mapRecords(snapshot,"assembly",true);
  },[snapshot,mpSnapshot,rsSnapshot,history,chamber]);
  const states=["All India",...Array.from(new Set(allData.map(m=>m.state))).sort()];
  const filtered=useMemo(()=>allData.filter(m=>(state==="All India"||m.state===state)&&normalizeName(`${m.name} ${m.constituency} ${m.party} ${m.state} ${HOUSE_BADGE[m.chamber]}`).includes(normalizeName(query))).sort((a,b)=>b[sort]-a[sort]),[allData,query,state,sort]);
  const stateStats=useMemo(()=>Array.from(new Set(allData.map(m=>m.state))).map(s=>{const d=allData.filter(m=>m.state===s);return {state:s, avg:d.reduce((a,b)=>a+b.assets,0)/d.length, growth:d.reduce((a,b)=>a+b.growth,0)/d.length,count:d.length}}).sort((a,b)=>b.avg-a.avg).slice(0,8),[allData]);
  const headline=allData.length?allData.reduce((a,b)=>b.assets>a.assets?b:a):null;
  const totalDeclaredNetWorth=useMemo(()=>allData.reduce((sum,m)=>sum+(m.assets-m.liabilities),0),[allData]);
  const rowId=(m:MLA)=>`${m.chamber}:${m.sourceRank??normalizeName(`${m.state}-${m.name}-${m.constituency}`)}`;
  const active=allData.find(m=>rowId(m)===activeId)??allData[0]??null;
  const archiveStates=useMemo(()=>[...new Set((activeArchive?.records??[]).map(r=>r.state))].sort(),[activeArchive]);
  useEffect(()=>{
    if(archiveStates.length && !archiveStates.includes(archiveState)) setArchiveState(archiveStates[0]);
  },[archiveStates,archiveState]);
  const seatGroups=useMemo(()=>{
    const matching=(activeArchive?.records??[]).filter(row=>row.state===archiveState&&row.normalizedConstituency.includes(normalizeName(seatQuery)));
    return buildDisplayableSeatHistories(matching).sort((a,b)=>compareWinnerElections(b.at(-1)!,a.at(-1)!)||a[0].constituency.localeCompare(b[0].constituency));
  },[activeArchive,archiveState,seatQuery]);
  const medianGrowth=useMemo(()=>{if(chamber!=="assembly") return 0; const values=(history?.comparisons??[]).map(x=>x.percentChange).filter(Number.isFinite).sort((a,b)=>a-b);return values.length?Math.round(values[Math.floor(values.length/2)]):0},[history,chamber]);
  const partyStats=useMemo(()=>Object.entries(parties).map(([party,color])=>{const records=allData.filter(record=>record.party===party);return {party,color,count:records.length,average:records.length?records.reduce((sum,record)=>sum+record.assets,0)/records.length:0}}).filter(item=>item.count>0),[allData]);
  const largestPartyAverage=Math.max(1,...partyStats.map(item=>item.average));
  const candidateResults=useMemo(()=>[...(candidateShard?.records??[])].filter(row=>normalizeName(`${row.name} ${row.constituency} ${row.party}`).includes(normalizeName(candidateQuery))).sort((a,b)=>compareAvailableMoneyDescending(availableMoney(a.assets,a.assetsStatus),availableMoney(b.assets,b.assetsStatus))||a.ordinal-b.ordinal||a.candidateId-b.candidateId),[candidateShard,candidateQuery]);
  const watchedIds=useMemo(()=>new Set(watch.map(item=>item.id)),[watch]);
  const toggleWatch=(item:WatchItem)=>writeWatchlist(watchedIds.has(item.id)?watch.filter(entry=>entry.id!==item.id):[...watch,item]);
  const retryData=(key:DatasetKey)=>{
    setDataErrors(current=>({...current,[key]:undefined}));
    setDataAttempts(current=>({...current,[key]:current[key]+1}));
  };
  const selectRepresentative=(representative:MLA)=>{
    setActiveId(rowId(representative));
    document.getElementById("profile")?.scrollIntoView({behavior:"smooth",block:"start"});
  };
  const currentWatchItem=(representative:MLA):WatchItem=>({
    id:rowId(representative),
    label:`${representative.name} — ${representative.constituency}, ${representative.state}`,
    href:representative.chamber==="lok_sabha" && representative.electionFolder && representative.candidateId
      ?publicUrl(`/person?type=candidate&election=${encodeURIComponent(representative.electionFolder)}&id=${representative.candidateId}`)
      :representative.chamber==="rajya_sabha"
        ?(representative.sourceUrl||rsSnapshot?.meta.sourceUrl||"https://adrindia.org/")
        :publicUrl(`/person?type=current&chamber=assembly&rank=${representative.sourceRank??1}`),
  });
  const chamberLabel=chamber==="lok_sabha"?"Lok Sabha MPs":chamber==="rajya_sabha"?"Rajya Sabha MPs":chamber==="all"?"sitting legislators":"sitting MLAs";
  const profileHref=(representative:MLA)=>currentWatchItem(representative).href;
  const allError=dataErrors.snapshot||dataErrors.mpSnapshot||dataErrors.rsSnapshot;
  const seatTicker=chamber==="all"
    ?`${(snapshot?.meta.recordCount??4092).toLocaleString("en-IN")} MLA · ${(mpSnapshot?.meta.recordCount??543).toLocaleString("en-IN")} LS · ${(rsSnapshot?.meta.recordCount??229).toLocaleString("en-IN")} RS`
    :chamber==="lok_sabha"?"543":chamber==="rajya_sabha"?"233":"4,123";
  const seatTickerLabel=chamber==="all"?"sitting records by house":chamber==="lok_sabha"?"Lok Sabha seats":chamber==="rajya_sabha"?"Rajya Sabha seats":"assembly constituencies";
  const switchChamber=(next:Chamber)=>{
    if(next===chamber) return;
    setChamber(next);
  };
  return <><a className="skipLink" href="#main-content">Skip to the database</a><main id="main-content">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Neta Worth home"><span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span></a>
      <nav><a href="#explore">{chamber==="assembly"?"Current MLAs":chamber==="all"?"All legislators":"Current MPs"}</a><a href="#candidates">Candidate DB</a>{chamber!=="rajya_sabha"&&chamber!=="all"&&<a href="#archive">Seats</a>}<Link href="/map">Map</Link><a href="#analysis">Analysis</a><a href="#method">Method</a></nav>
      <div className="headerActions"><button className="iconBtn" aria-label="Search" onClick={()=>document.getElementById("search")?.focus()}>⌕</button><button ref={watchButton} className="watchBtn" aria-controls="watchlist" aria-expanded={watchOpen} onClick={()=>setWatchOpen(value=>!value)}>Watchlist <b>{watch.length}</b></button></div>
    </header>

    <section ref={watchPanel} id="watchlist" className="watchPanel" hidden={!watchOpen} role="dialog" aria-modal="false" aria-labelledby="watchlist-title">
      <header><h2 id="watchlist-title">Your watchlist</h2><button type="button" onClick={()=>setWatchOpen(false)} aria-label="Close watchlist">×</button></header>
      {watch.length===0?<p>No saved representatives yet.</p>:<ul>{watch.map(item=><li key={item.id}><a href={item.href}>{item.label}</a> <button type="button" onClick={()=>toggleWatch(item)} aria-label={`Remove ${item.label} from watchlist`}>Remove</button></li>)}</ul>}
    </section>

    <section id="top" className="hero">
      <div className="eyebrow"><span>THE PUBLIC LEDGER</span><span>Updated from election affidavits</span></div>
      <div className="chamberSwitch" role="tablist" aria-label="House">
        <button type="button" role="tab" aria-selected={chamber==="all"} className={chamber==="all"?"active":""} onClick={()=>switchChamber("all")}>All India</button>
        <button type="button" role="tab" aria-selected={chamber==="assembly"} className={chamber==="assembly"?"active":""} onClick={()=>switchChamber("assembly")}>State assemblies</button>
        <button type="button" role="tab" aria-selected={chamber==="lok_sabha"} className={chamber==="lok_sabha"?"active":""} onClick={()=>switchChamber("lok_sabha")}>Lok Sabha</button>
        <button type="button" role="tab" aria-selected={chamber==="rajya_sabha"} className={chamber==="rajya_sabha"?"active":""} onClick={()=>switchChamber("rajya_sabha")}>Rajya Sabha</button>
      </div>
      <div className="heroGrid">
        <div><h1>Follow the money.<br/><em>Know your neta.</em></h1><p className="dek">India&apos;s most ambitious public record of the wealth declared by elected representatives—across assemblies, Parliament, parties and elections.</p>
          <div className="searchBox"><span aria-hidden="true">⌕</span><input id="search" aria-label="Search representatives" value={query} onChange={e=>{setQuery(e.target.value);setMlaLimit(12)}} placeholder={chamber==="all"?"Search any legislator, seat, party or state…":chamber==="assembly"?"Search an MLA, constituency, party or state…":"Search an MP, state, party…"}/>{query&&<button className="clearSearch" type="button" onClick={()=>setQuery("")} aria-label="Clear representative search">×</button>}<kbd>⌘/Ctrl K</kbd></div>
          <div className="quick"><span>TRY</span>{(chamber==="lok_sabha"?["Narendra Modi","Guntur","BJP"]:chamber==="rajya_sabha"?["Jaya Bachchan","Telangana","BJP"]:chamber==="all"?["D K Shivakumar","Narendra Modi","Jaya Bachchan"]:["D K Shivakumar","Karnataka","BJP"]).map(x=><button key={x} onClick={()=>{setQuery(x);setMlaLimit(12);document.getElementById("explore")?.scrollIntoView({behavior:"smooth"})}}>{x}</button>)}</div>
        </div>
        {headline?<aside className="headlineCard"><div className="cardKicker">BIGGEST DECLARED FORTUNE</div><div className="rank">01</div><h2>{headline.name}</h2><p>{HOUSE_BADGE[headline.chamber]} · {headline.constituency} · {headline.state}</p><div className="bigMoney">{fmt(headline.assets)}</div><div className="rise">{headline.historical!==false?`↗ ${headline.growth}%`:(headline.chamber==="lok_sabha"?"2024 Lok Sabha winners":headline.chamber==="rajya_sabha"?"ADR March 2026":"2025 national snapshot")} <span>{headline.historical!==false?"since previous affidavit":"top declaration"}</span></div><Sparkline values={headline.values}/><button onClick={()=>window.location.assign(profileHref(headline))}>View the full record →</button></aside>:<aside className="headlineCard" role={(chamber==="all"?allError:dataErrors[chamberErrorKey])?"alert":"status"}><div className="cardKicker">CURRENT SNAPSHOT</div><h2>{(chamber==="all"?allError:dataErrors[chamberErrorKey])?"Data unavailable":"Loading public records…"}</h2><p>{(chamber==="all"?allError:dataErrors[chamberErrorKey])??(chamber==="all"?"Opening MLA, Lok Sabha and Rajya Sabha indexes.":chamber==="lok_sabha"?"Opening the Lok Sabha winner index.":chamber==="rajya_sabha"?"Opening the Rajya Sabha sitting-MP index.":"Opening the nationwide sitting-MLA index.")}</p>{(chamber==="all"?allError:dataErrors[chamberErrorKey])&&<button onClick={()=>{if(chamber==="all"){retryData("snapshot");retryData("mpSnapshot");retryData("rsSnapshot")}else retryData(chamberErrorKey)}}>Retry data →</button>}</aside>}
      </div>
      <div className="ticker"><span>IN NUMBERS</span><div><b>{allData.length?fmt(totalDeclaredNetWorth):((chamber==="all"?allError:dataErrors[chamberErrorKey])?"Unavailable":"Loading")}</b><small>total declared net worth · {allData.length?`${allData.length.toLocaleString("en-IN")} ${chamberLabel}`:chamberLabel}</small></div><div><b>{seatTicker}</b><small>{seatTickerLabel}</small></div><div><b>{candidateIndex?.meta.candidateRecords.toLocaleString("en-IN")??(dataErrors.candidateIndex?"Unavailable":"Loading")}</b><small>candidate affidavits</small></div><div><b>{chamber==="rajya_sabha"||chamber==="all"?"—":((activeArchive?.meta.winnerRecords??(chamber==="lok_sabha"?undefined:archive?.meta.winnerRecords))?.toLocaleString("en-IN")??(dataErrors.archive?"Unavailable":"On demand"))}</b><small>{chamber==="rajya_sabha"||chamber==="all"?"seat archive in house tabs":"historical winners"}</small></div><div><b>{chamber==="assembly"?(history?.meta.comparisonCount.toLocaleString("en-IN")??(dataErrors.history?"Unavailable":"On demand")):"—"}</b><small>{chamber==="assembly"?"asset comparisons":"history in assemblies"}</small></div></div>
    </section>

    <section id="explore" className="section explorer" ref={explorerSection}>
      <div className="sectionHead"><div><span className="sectionNo">01 / EXPLORE</span><h2>The wealth table</h2><p>{chamber==="all"?"Search sitting MLAs, Lok Sabha MPs and Rajya Sabha MPs in one ledger.":chamber==="lok_sabha"?"Search sitting Lok Sabha MPs from the latest general-election winners.":chamber==="rajya_sabha"?"Search sitting Rajya Sabha MPs from ADR’s March 2026 national analysis.":"Search the nationwide 2025 sitting-MLA affidavit snapshot."}</p></div><div className="dataStamp"><i></i> {chamber==="all"?`ALL HOUSES · ${allData.length?`${allData.length.toLocaleString("en-IN")} RECORDS`:(allError?"DATA UNAVAILABLE":"LOADING")}`:chamber==="lok_sabha"?`LOK SABHA WINNERS · ${mpSnapshot?`${mpSnapshot.meta.recordCount.toLocaleString("en-IN")} RECORDS`:(dataErrors.mpSnapshot?"DATA UNAVAILABLE":"LOADING")}`:chamber==="rajya_sabha"?`ADR RAJYA SABHA · ${rsSnapshot?`${rsSnapshot.meta.recordCount.toLocaleString("en-IN")} RECORDS`:(dataErrors.rsSnapshot?"DATA UNAVAILABLE":"LOADING")}`:`ADR NATIONAL REPORT · ${snapshot?`${snapshot.meta.recordCount.toLocaleString("en-IN")} RECORDS`:(dataErrors.snapshot?"DATA UNAVAILABLE":"LOADING")}`}</div></div>
      <div className="toolbar"><div className="stateTabs">{(chamber==="lok_sabha"?["All India","Uttar Pradesh","Maharashtra","West Bengal","Bihar"]:chamber==="rajya_sabha"?["All India","Uttar Pradesh","Maharashtra","Tamil Nadu","Gujarat"]:["All India","Karnataka","Maharashtra","Telangana","Andhra Pradesh"]).map(s=><button className={state===s?"active":""} onClick={()=>{setState(s);setMlaLimit(12)}} key={s}>{s}</button>)}</div><select value={state} onChange={e=>{setState(e.target.value);setMlaLimit(12)}} aria-label="Select state">{states.map(s=><option key={s}>{s}</option>)}</select></div>
      {chamber!=="all"&&dataErrors[chamberErrorKey]&&!activeSnapshot&&<div className="empty" role="alert"><p>The {chamberLabel} index could not be loaded: {dataErrors[chamberErrorKey]}</p><button className="outline" onClick={()=>retryData(chamberErrorKey)}>Retry national data</button></div>}
      {chamber==="all"&&allError&&!allData.length&&<div className="empty" role="alert"><p>The combined legislator index could not be loaded: {allError}</p><button className="outline" onClick={()=>{retryData("snapshot");retryData("mpSnapshot");retryData("rsSnapshot")}}>Retry national data</button></div>}
      <div className="tableWrap"><table><thead><tr><th>#</th><th>House</th><th>Representative</th><th>Constituency</th><th aria-sort={sort==="assets"?"descending":"none"}><button onClick={()=>{setSort("assets");setMlaLimit(12)}}>Declared assets {sort==="assets"?"↓":""}</button></th><th aria-sort={sort==="liabilities"?"descending":"none"}><button onClick={()=>{setSort("liabilities");setMlaLimit(12)}}>Liabilities {sort==="liabilities"?"↓":""}</button></th><th aria-sort={sort==="growth"?"descending":"none"}><button onClick={()=>{setSort("growth");setMlaLimit(12)}}>Growth {sort==="growth"?"↓":""}</button></th><th>Trail</th><th>Save</th></tr></thead><tbody>{filtered.slice(0,mlaLimit).map((m,i)=>{const item=currentWatchItem(m);const isWatched=watchedIds.has(item.id);const selected=active?rowId(active)===rowId(m):false;return <tr key={rowId(m)} className={selected?"selected":""}><td className="muted">{String(m.sourceRank??i+1).padStart(2,"0")}</td><td><span className="houseBadge">{HOUSE_BADGE[m.chamber]}</span></td><td><button type="button" onClick={()=>selectRepresentative(m)} aria-controls="profile" aria-pressed={selected} style={{border:0,background:"transparent",padding:0,textAlign:"left"}}><strong>{m.name}</strong><span className="party"><i style={{background:parties[m.party]||"#777"}}></i>{m.party}</span></button></td><td><strong>{m.constituency}</strong><span>{m.state}</span></td><td className="money">{fmt(m.assets)}</td><td>{fmt(m.liabilities)}</td><td><span className={m.historical===false?"muted":m.growth>=0?"positive":"negative"}>{m.historical===false?"—":`${m.growth>=0?"↗":"↘"} ${Math.abs(m.growth)}%`}</span></td><td><Sparkline values={m.values} color={parties[m.party]}/></td><td><button className={isWatched?"star on":"star"} onClick={()=>toggleWatch(item)} aria-pressed={isWatched} aria-label={`${isWatched?"Remove":"Add"} ${m.name} ${isWatched?"from":"to"} watchlist`}>{isWatched?"★":"☆"}</button></td></tr>})}</tbody></table>{allData.length>0&&filtered.length===0&&<div className="empty">No matching records. Try a broader search.</div>}{!allData.length&&!(chamber==="all"?allError:dataErrors[chamberErrorKey])&&<div className="empty" role="status">Loading the national representative index…</div>}</div>
      <p className="tableNote">Showing {Math.min(mlaLimit,filtered.length)} of {filtered.length} matching representatives · Select a representative name to inspect the declaration trail.</p>
      {mlaLimit<filtered.length&&<button className="loadMore" onClick={()=>setMlaLimit(limit=>Math.min(limit+24,filtered.length))}>Load more representatives</button>}
    </section>

    <section id="profile" className="profile section">
      {active?(()=>{const item=currentWatchItem(active);const isWatched=watchedIds.has(item.id);return <><div className="profileTop"><div><span className="sectionNo">02 / DECLARATION TRAIL</span><div className="personTitle"><div className="monogram">{active.name.split(" ").filter(x=>x.length>1).slice(0,2).map(x=>x[0]).join("")}</div><div><h2>{active.name}</h2><p><span className="houseBadge">{HOUSE_BADGE[active.chamber]}</span> <b>{active.party}</b> · {active.constituency}, {active.state}</p></div></div></div><button className="outline" aria-pressed={isWatched} onClick={()=>toggleWatch(item)}>{isWatched?"★ Watching":"☆ Add to watchlist"}</button></div>
      <div className="profileGrid"><div className="timelineCard"><div className="cardTitle"><h3>{active.historical===false?"Declared asset snapshot":"Declared assets over time"}</h3><span>₹ crore</span></div><div className="barChart">{active.values.map((v,i)=>{const max=Math.max(...active.values);return <div className="barCol" key={`${active.years[i]}-${i}`}><b>{fmt(v)}</b><div className="bar" style={{height:`${Math.max(8,(v/max)*190)}px`}}></div><span>{active.years[i]}</span></div>})}</div><div className="growthSummary"><div><small>{active.historical===false?"NATIONAL RANK":"TOTAL CHANGE"}</small><b>{active.historical===false?`#${active.sourceRank}`:`${active.assets-active.values[0]>=0?"+":"−"}${fmt(Math.abs(active.assets-active.values[0])).replace("₹","")}`}</b></div><div><small>{active.historical===false?"EDUCATION":"CHANGE SINCE FIRST"}</small><b>{active.historical===false?(active.education||"—"):`${active.growth>=0?"+":""}${active.growth}%`}</b></div><div><small>{active.historical===false?"AGE / GENDER":"DECLARATIONS"}</small><b>{active.historical===false?`${active.age??"—"} / ${active.gender||"—"}`:active.years.length}</b></div></div></div>
        <div className="breakdown"><h3>Latest declaration</h3><div className="networth"><small>EST. DECLARED NET WORTH</small><b>{fmt(active.assets-active.liabilities)}</b><span>Assets less liabilities</span></div><div className="stack"><div style={{width:`${Math.max(5,active.assets+active.liabilities>0?active.assets/(active.assets+active.liabilities)*100:0)}%`}}></div></div><dl><div><dt>Gross assets</dt><dd>{fmt(active.assets)}</dd></div><div><dt>Liabilities</dt><dd>{fmt(active.liabilities)}</dd></div><div><dt>Pending criminal cases</dt><dd>{active.cases}</dd></div><div><dt>Affidavit year</dt><dd>{active.years.at(-1)}</dd></div></dl><Link className="profileLink" href={profileHref(active)}>Open full record →</Link><a href={active.sourceUrl||(active.chamber==="lok_sabha"?mpSnapshot?.meta.sourceUrl:active.chamber==="rajya_sabha"?rsSnapshot?.meta.sourceUrl:snapshot?.meta.sourceUrl)||"https://www.myneta.info/"} target="_blank" rel="noreferrer">{active.sourceUrl?"View source affidavit ↗":"View national source report ↗"}</a></div></div>{chamber==="assembly"&&dataErrors.history&&<div className="empty" role="alert"><p>Historical comparisons could not be loaded: {dataErrors.history}</p><button className="outline" onClick={()=>retryData("history")}>Retry history</button></div>}</>} )():<div className="empty" role={(chamber==="all"?allError:dataErrors[chamberErrorKey])?"alert":"status"}>{(chamber==="all"?allError:dataErrors[chamberErrorKey])?"The national declaration trail is unavailable.":"Loading the first declaration trail…"}</div>}
    </section>

    <section id="candidates" className="candidateDb section" ref={candidateSection}>
      <div className="sectionHead"><div><span className="sectionNo">03 / IMPORTED DATABASE</span><h2>Candidate affidavits in the imported archive.</h2><p>Search MyNeta-analyzed records imported from discovered election folders.</p></div><div className="dataStamp"><i></i> {candidateIndex?`${candidateIndex.meta.candidateRecords.toLocaleString("en-IN")} RECORDS · ${candidateIndex.meta.electionFolders} IMPORTED FOLDERS`:(dataErrors.candidateIndex?"DATABASE UNAVAILABLE":"LOADING DATABASE")}</div></div>
      {dataErrors.candidateIndex&&!candidateIndex&&<div className="empty" role="alert"><p>The candidate database index could not be loaded: {dataErrors.candidateIndex}</p><button className="outline" onClick={()=>retryData("candidateIndex")}>Retry database index</button></div>}
      <div className="candidateControls"><label><span>STATE / UT</span><select value={candidateState} disabled={!candidateIndex} onChange={e=>{const next=e.target.value;candidateRequest.current+=1;setCandidateState(next);setCandidateYear(candidateIndex?.states.find(s=>s.state===next)?.elections[0]?.electionYear??2023);setCandidateShard(null);setCandidateLoadError("");setCandidateLimit(50)}}>{candidateIndex?.states.map(s=><option key={s.state}>{s.state}</option>)}</select></label><label><span>ELECTION</span><select value={candidateYear} disabled={!candidateIndex} onChange={e=>{candidateRequest.current+=1;setCandidateYear(Number(e.target.value));setCandidateShard(null);setCandidateLoadError("");setCandidateLimit(50)}}>{candidateElections.map(e=><option key={e.electionFolder} value={e.electionYear}>{e.electionYear} · {e.candidateCount.toLocaleString("en-IN")} candidates</option>)}</select></label><label className="candidateSearch"><span>SEARCH THIS ELECTION</span><input value={candidateQuery} disabled={!candidateShard} onChange={e=>{setCandidateQuery(e.target.value);setCandidateLimit(50)}} placeholder="Candidate, constituency or party…"/></label></div>
      <div className="candidateWorkspace"><div className="candidateList"><div className="candidateListHead"><span>{candidateShard?`${candidateShard.meta.candidateCount.toLocaleString("en-IN")} candidates in ${candidateState} ${candidateYear}`:(candidateLoadError?"Election unavailable":"Loading election…")}</span><small>Available declared assets first</small></div>{candidateResults.slice(0,candidateLimit).map(row=>{const assets=availableMoney(row.assets,row.assetsStatus);return <button key={row.candidateId} onClick={()=>window.location.assign(publicUrl(`/person?type=candidate&election=${encodeURIComponent(candidateShard?.meta.electionFolder??"")}&id=${row.candidateId}`))}><div><strong>{row.name}</strong><small>{row.constituency} · {row.party}{row.electionYear&&row.electionYear!==candidateYear?` · ${row.electionYear}`:""}</small></div><span>{fmt(assets===null?null:assets/1e7)} →</span></button>})}{candidateLoadError&&<div className="empty" role="alert"><p>This election could not be loaded: {candidateLoadError}</p><button className="outline" onClick={()=>{candidateRequest.current+=1;setCandidateLoadError("");setCandidateShard(null);setCandidateAttempt(value=>value+1)}}>Retry election</button></div>}{candidateShard&&candidateResults.length===0&&<div className="empty">No candidates match this search.</div>}{candidateLimit<candidateResults.length&&<button className="loadMore" onClick={()=>setCandidateLimit(limit=>Math.min(limit+50,candidateResults.length))}>Load more candidates</button>}</div>
        </div>
    </section>

    {chamber!=="rajya_sabha"&&chamber!=="all"&&<section id="archive" className="archive section" ref={archiveSection}>
      <div className="sectionHead"><div><span className="sectionNo">04 / CONSTITUENCY ARCHIVE</span><h2>Winner records across imported elections.</h2><p>{chamber==="lok_sabha"?"Browse Lok Sabha winners by parliamentary constituency where seat history can be connected.":"Browse declared wealth and party succession where a same-seat history can be connected without ambiguity."}</p></div><div className="dataStamp"><i></i> {activeArchive?`${activeArchive.meta.winnerRecords.toLocaleString("en-IN")} WINNER RECORDS · ${activeArchive.meta.electionFolders} IMPORTED FOLDERS`:(dataErrors.archive?"ARCHIVE UNAVAILABLE":"LOADING ARCHIVE")}</div></div>
      {dataErrors.archive&&!activeArchive&&<div className="empty archiveEmpty" role="alert"><p>The constituency archive could not be loaded: {dataErrors.archive}</p><button className="outline" onClick={()=>retryData("archive")}>Retry archive</button></div>}
      <div className="archiveControls"><label><span>STATE / UT</span><select value={archiveState} disabled={!activeArchive} onChange={e=>{setArchiveState(e.target.value);setSeatQuery("");setSeatLimit(8)}}>{archiveStates.map(s=><option key={s}>{s}</option>)}</select></label><label className="seatSearch"><span>CONSTITUENCY</span><input value={seatQuery} disabled={!activeArchive} onChange={e=>{setSeatQuery(e.target.value);setSeatLimit(8)}} placeholder="Type a constituency name…"/></label><div className="archiveCount"><b>{seatGroups.length}</b><span>matching seat histories</span></div></div>
      <div className="seatGrid">{seatGroups.slice(0,seatLimit).map(rows=><article className="seatCard" key={`${rows[0].state}-${rows[0].normalizedConstituency}`}><header><div><span>{rows[0].state}</span><h3>{rows.at(-1)?.constituency}</h3></div><b>{rows.length} elections</b></header><div className="seatTimeline">{rows.map((row,i)=>{const assets=availableMoney(row.assets,row.assetsStatus);return <a href={publicUrl(`/person?type=candidate&election=${encodeURIComponent(row.electionFolder)}&id=${row.candidateId}`)} key={`${row.electionFolder}-${row.candidateId}`}><i className={i===rows.length-1?"current":""}></i><time dateTime={row.electionDate??undefined}>{row.electionYear}</time><div><strong>{row.name}</strong><small>{row.party} · {fmt(assets===null?null:assets/1e7)} assets</small></div><span>→</span></a>})}</div></article>)}</div>
      {seatLimit<seatGroups.length&&<button className="loadMore" onClick={()=>setSeatLimit(limit=>Math.min(limit+8,seatGroups.length))}>Load more seat histories</button>}
      {activeArchive&&seatGroups.length===0&&<div className="empty archiveEmpty">No constituency matches in {archiveState}. Try a shorter name.</div>}
    </section>}

    <section id="states" className="section states"><div className="sectionHead"><div><span className="sectionNo">05 / THE MAP</span><h2>State of wealth</h2><p>{chamber==="all"?"Average declared assets across sitting legislators in the active ledger, ranked high to low.":"Average assets in the active house index, ranked high to low."} <Link href="/map">Open the full map →</Link></p></div></div><div className="stateGrid"><div className="indiaPanel"><div className="mapType">INDIA</div><h3>Where political wealth concentrates</h3><p>The southern and western states dominate the top of the current declared-asset index.</p><div className="mapBlocks">{stateStats.map((s,i)=><button key={s.state} className={`mapBlock b${i}`} onClick={()=>{setState(s.state);document.getElementById("explore")?.scrollIntoView({behavior:"smooth"})}}><b>{s.state.slice(0,3).toUpperCase()}</b><span>{fmt(s.avg)}</span></button>)}</div><small>Tap a state block to filter the wealth table</small></div><div className="stateRanks">{stateStats.map((s,i)=><div key={s.state}><span>{String(i+1).padStart(2,"0")}</span><div><b>{s.state}</b><small>{s.count} indexed leaders</small></div><div className="rankBar"><i style={{width:`${(s.avg/(stateStats[0]?.avg||1))*100}%`}}></i></div><strong>{fmt(s.avg)}</strong></div>)}</div></div></section>

    <section id="analysis" className="analysis section"><div className="sectionHead"><div><span className="sectionNo">06 / ANALYSIS</span><h2>Signals in the declarations</h2></div></div><div className="storyGrid"><article className="leadStory"><span>WEALTH VELOCITY</span><h3>{chamber==="assembly"?"The affidavit-to-affidavit jump":chamber==="all"?"Declared pile across all houses":`Declared pile in the ${chamber==="lok_sabha"?"Lok Sabha":"Rajya Sabha"}`}</h3><div className="storyNumber">{chamber==="assembly"?(history?medianGrowth:"—"):(allData.length?fmt(totalDeclaredNetWorth):"—")}{chamber==="assembly"&&history&&<sup>%</sup>}</div><p>{chamber==="assembly"?(history?`Median declared-asset change across ${history.meta.comparisonCount.toLocaleString("en-IN")} historical comparisons.`:"Historical comparisons load as this section approaches."):(allData.length?`Sum of declared assets minus liabilities across ${allData.length.toLocaleString("en-IN")} ${chamberLabel}.`:`${chamberLabel} totals appear when the snapshot loads.`)}</p><div className="miniLegend"><i></i> {chamber==="assembly"?"Growth between consecutive affidavits":"Assets less liabilities"}</div></article><article><span>PARTY LENS</span><h3>Average assets by party</h3>{partyStats.slice(0,6).map(item=><div className="partyBar" key={item.party}><b>{item.party}</b><div><i style={{width:`${(item.average/largestPartyAverage)*100}%`,background:item.color}}></i></div><span>{fmt(item.average)} · n={item.count}</span></div>)}</article><article className="question"><span>WATCH THIS</span><h3>Growth ≠ wrongdoing</h3><p>Asset changes can reflect inheritance, business income, valuation changes, spouse holdings, debt, or corrections. The numbers are leads for scrutiny—not verdicts.</p><a href="#method">Read our methodology →</a></article></div></section>

    <section id="method" className="method"><div><span className="sectionNo">07 / SOURCE NOTE</span><h2>Public records,<br/>carefully connected.</h2></div><div><p>NetaWorth organizes election-affidavit declarations into a searchable public ledger. Figures come from ECI, ADR and MyNeta; every record keeps its source link for verification.</p><div className="methodLinks"><a href="https://affidavit.eci.gov.in/" target="_blank" rel="noreferrer">Election Commission affidavit portal ↗</a><a href="https://adrindia.org/sites/default/files/All_India_Sitting_MLAs_Report_2025_English.pdf" target="_blank" rel="noreferrer">ADR national MLA report ↗</a><a href="https://adrindia.org/sites/default/files/Analysis_of_Criminal_Background_Financial_Education_Gender_and_other_details_of_Sitting_Rajya_Sabha_MPs_March2026_Eng_0.pdf" target="_blank" rel="noreferrer">ADR sitting Rajya Sabha report ↗</a><a href="https://www.myneta.info/" target="_blank" rel="noreferrer">MyNeta source archive ↗</a></div><small>The internal database contains {(candidateIndex?.meta.candidateRecords??181307).toLocaleString("en-IN")} MyNeta-analyzed candidate records imported from {(candidateIndex?.meta.electionFolders??136)} reviewed election folders through 2026. It also contains {(snapshot?.meta.recordCount??4092).toLocaleString("en-IN")} sitting MLAs from the ADR 2025 snapshot, {(mpSnapshot?.meta.recordCount??543).toLocaleString("en-IN")} Lok Sabha MPs, {(rsSnapshot?.meta.recordCount??229).toLocaleString("en-IN")} Rajya Sabha MPs, {(archive?.meta.winnerRecords??17785).toLocaleString("en-IN")} imported historical-winner records through 2026 and {(history?.meta.comparisonCount??10243).toLocaleString("en-IN")} asset comparisons spanning 2004—2025. Exact-name histories are useful leads, while verified growth timelines require state, election year, normalized name and exact asset values to agree. Constituency labels remain as published and may reflect delimitation or spelling changes; ambiguous same-label winner groups are omitted rather than merged into a false seat history. Check the cited primary affidavit before investigative or legal use.</small></div></section>
    <footer><div className="brand"><span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span></div><p>Making political money legible.</p><nav aria-label="Project information"><Link href="/about#data">Data</Link><Link href="/about#methodology">Methodology</Link><Link href="/about#corrections">Corrections</Link><Link href="/about">About</Link></nav><small><a href="https://github.com/ch-pavan/mla-networth" target="_blank" rel="noreferrer">Open source</a> · Built in the public interest · India · 2026</small></footer>
  </main></>
}
