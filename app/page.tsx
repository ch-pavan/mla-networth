"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { availableMoney, compareAvailableMoneyDescending, formatCrores as fmt, type MoneyStatus } from "../lib/format-money";
import { buildVerifiedAssetHistory, normalizePersonName } from "../lib/profile-history";
import { publicUrl } from "../lib/public-url";
import { buildDisplayableSeatHistories, compareWinnerElections } from "../lib/winner-history";

type MLA = {
  name: string; state: string; constituency: string; party: string; assets: number;
  liabilities: number; growth: number; years: number[]; values: number[]; cases: number;
  historical?: boolean; education?: string; age?: number | null; gender?: string; sourceRank?: number; sourceUrl?: string;
};

type AdrRecord = { rank:number; state:string; electionYear:number; constituency:string; name:string; party:string; age:number|null; gender:string; assets:number; liabilities:number; criminalCases:number; seriousCriminalCases:number; education:string; panDeclared:boolean };
type AdrSnapshot = { meta:{recordCount:number;sourceUrl:string;published:string;note:string}; records:AdrRecord[] };
type HistoryComparison = { state:string;currentYear:number;previousYear:number;name:string;normalizedName:string;party:string;currentAssets:number;previousAssets:number;percentChange:number;remarks:string;comparisonUrl:string;currentSnapshotRank:number|null;matchedToSnapshot:boolean };
type HistorySnapshot = { meta:{electionPagesAvailable:number;comparisonCount:number;snapshotMatchCount:number;firstYear:number;latestYear:number;note:string}; comparisons:HistoryComparison[] };
type WinnerRecord = { state:string;electionYear:number;electionDate?:string;electionType?:string;baseConstituency?:string;electionFolder:string;rankByAssets:number;candidateId:number;name:string;normalizedName:string;constituency:string;normalizedConstituency:string;party:string;criminalCases:number;education:string;assets:number|null;assetsStatus?:MoneyStatus;liabilities:number|null;liabilitiesStatus?:MoneyStatus;candidateUrl:string };
type WinnerArchive = { meta:{winnerRecords:number;electionFolders:number;states:number;firstYear:number;latestYear:number;note:string}; records:WinnerRecord[] };
type CandidateRecord = { ordinal:number;candidateId:number;name:string;normalizedName:string;constituency:string;normalizedConstituency:string;party:string;criminalCases:number;education:string;assets:number|null;assetsStatus?:MoneyStatus;liabilities:number|null;liabilitiesStatus?:MoneyStatus;electionYear?:number;electionDate?:string|null;electionType?:string;baseConstituency?:string;candidateUrl:string };
type CandidateElection = { state:string;electionYear:number;electionFolder:string;candidateCount:number;constituencyCount:number;complete:boolean;file:string;sourceUrl:string };
type CandidateIndex = { meta:{candidateRecords:number;electionFolders:number;completeElectionFolders:number;states:number;firstYear:number;latestYear:number;note:string};states:{state:string;elections:CandidateElection[]}[] };
type CandidateShard = { meta:CandidateElection;records:CandidateRecord[] };
type DatasetKey = "snapshot"|"history"|"archive"|"candidateIndex";
type DatasetAttempts = Record<DatasetKey,number>;
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
  const [state,setState]=useState("All India");
  const [sort,setSort]=useState<"assets"|"growth"|"liabilities">("assets");
  const [activeRank,setActiveRank]=useState<number|null>(null);
  const [watchOpen,setWatchOpen]=useState(false);
  const [mlaLimit,setMlaLimit]=useState(12);
  const [candidateLimit,setCandidateLimit]=useState(50);
  const [seatLimit,setSeatLimit]=useState(8);
  const [snapshot,setSnapshot]=useState<AdrSnapshot|null>(null);
  const [history,setHistory]=useState<HistorySnapshot|null>(null);
  const [archive,setArchive]=useState<WinnerArchive|null>(null);
  const [dataErrors,setDataErrors]=useState<Partial<Record<DatasetKey,string>>>({});
  const [dataAttempts,setDataAttempts]=useState<DatasetAttempts>({snapshot:0,history:0,archive:0,candidateIndex:0});
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
    void fetchJson<CandidateIndex>(publicUrl("/data/candidates/index.json"),controller.signal).then(data=>{
      if(!controller.signal.aborted){setCandidateIndex(data);setDataErrors(current=>({...current,candidateIndex:undefined}))}
    }).catch(error=>{if(!controller.signal.aborted)setDataErrors(current=>({...current,candidateIndex:errorMessage(error)}))});
    return ()=>controller.abort();
  },[dataAttempts.candidateIndex]);

  useEffect(()=>{
    if(!requestedSections.history) return;
    const controller=new AbortController();
    void fetchJson<HistorySnapshot>(publicUrl("/data/adr-recontest-history.json"),controller.signal).then(data=>{
      if(!controller.signal.aborted){setHistory(data);setDataErrors(current=>({...current,history:undefined}))}
    }).catch(error=>{if(!controller.signal.aborted)setDataErrors(current=>({...current,history:errorMessage(error)}))});
    return ()=>controller.abort();
  },[requestedSections.history,dataAttempts.history]);

  useEffect(()=>{
    if(!requestedSections.archive) return;
    const controller=new AbortController();
    void fetchJson<WinnerArchive>(publicUrl("/data/adr-winner-archive.json"),controller.signal).then(data=>{
      if(!controller.signal.aborted){setArchive(data);setDataErrors(current=>({...current,archive:undefined}))}
    }).catch(error=>{if(!controller.signal.aborted)setDataErrors(current=>({...current,archive:errorMessage(error)}))});
    return ()=>controller.abort();
  },[requestedSections.archive,dataAttempts.archive]);

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

  const allData=useMemo(()=>{
    if(!snapshot) return [];
    const comparisons=new Map<string,HistoryComparison[]>();
    for(const h of history?.comparisons??[]){const key=`${h.state}|${h.normalizedName}`;comparisons.set(key,[...(comparisons.get(key)??[]),h])}
    return snapshot.records.map((r):MLA=>{
      const segments=(comparisons.get(`${r.state}|${normalizeName(r.name)}`)??[]).sort((a,b)=>a.currentYear-b.currentYear);
      const timeline=buildVerifiedAssetHistory({state:r.state,electionYear:r.electionYear,name:r.name,assets:r.assets,sourceUrl:snapshot.meta.sourceUrl},segments);
      const firstAssets=timeline[0]?.assets??r.assets;
      const growth=timeline.length>1&&firstAssets>0?Math.round(((r.assets-firstAssets)/firstAssets)*100):0;
      return {name:r.name,state:r.state,constituency:r.constituency,party:r.party,assets:r.assets/1e7,liabilities:r.liabilities/1e7,growth,years:timeline.length>1?timeline.map(x=>x.year):[r.electionYear,r.electionYear],values:timeline.length>1?timeline.map(x=>x.assets/1e7):[r.assets/1e7,r.assets/1e7],cases:r.criminalCases,historical:timeline.length>1,education:r.education,age:r.age,gender:r.gender,sourceRank:r.rank,sourceUrl:timeline.length>1?timeline.at(-2)?.sourceUrl:undefined};
    });
  },[snapshot,history]);
  const states=["All India",...Array.from(new Set(allData.map(m=>m.state))).sort()];
  const filtered=useMemo(()=>allData.filter(m=>(state==="All India"||m.state===state)&&normalizeName(`${m.name} ${m.constituency} ${m.party} ${m.state}`).includes(normalizeName(query))).sort((a,b)=>b[sort]-a[sort]),[allData,query,state,sort]);
  const stateStats=useMemo(()=>Array.from(new Set(allData.map(m=>m.state))).map(s=>{const d=allData.filter(m=>m.state===s);return {state:s, avg:d.reduce((a,b)=>a+b.assets,0)/d.length, growth:d.reduce((a,b)=>a+b.growth,0)/d.length,count:d.length}}).sort((a,b)=>b.avg-a.avg).slice(0,8),[allData]);
  const headline=allData.length?allData.reduce((a,b)=>b.assets>a.assets?b:a):null;
  const active=allData.find(m=>m.sourceRank===activeRank)??allData[0]??null;
  const archiveStates=useMemo(()=>[...new Set((archive?.records??[]).map(r=>r.state))].sort(),[archive]);
  const seatGroups=useMemo(()=>{
    const matching=(archive?.records??[]).filter(row=>row.state===archiveState&&row.normalizedConstituency.includes(normalizeName(seatQuery)));
    return buildDisplayableSeatHistories(matching).sort((a,b)=>compareWinnerElections(b.at(-1)!,a.at(-1)!)||a[0].constituency.localeCompare(b[0].constituency));
  },[archive,archiveState,seatQuery]);
  const medianGrowth=useMemo(()=>{const values=(history?.comparisons??[]).map(x=>x.percentChange).filter(Number.isFinite).sort((a,b)=>a-b);return values.length?Math.round(values[Math.floor(values.length/2)]):0},[history]);
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
    setActiveRank(representative.sourceRank??null);
    document.getElementById("profile")?.scrollIntoView({behavior:"smooth",block:"start"});
  };
  const currentWatchItem=(representative:MLA):WatchItem=>({
    id:`current:${representative.sourceRank??normalizeName(`${representative.state}-${representative.name}-${representative.constituency}`)}`,
    label:`${representative.name} — ${representative.constituency}, ${representative.state}`,
    href:publicUrl(`/person?type=current&rank=${representative.sourceRank??1}`),
  });

  return <><a className="skipLink" href="#main-content">Skip to the database</a><main id="main-content">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Neta Worth home"><span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span></a>
      <nav><a href="#explore">Current MLAs</a><a href="#candidates">Candidate DB</a><a href="#archive">Seats</a><a href="#analysis">Analysis</a><a href="#method">Method</a></nav>
      <div className="headerActions"><button className="iconBtn" aria-label="Search" onClick={()=>document.getElementById("search")?.focus()}>⌕</button><button ref={watchButton} className="watchBtn" aria-controls="watchlist" aria-expanded={watchOpen} onClick={()=>setWatchOpen(value=>!value)}>Watchlist <b>{watch.length}</b></button></div>
    </header>

    <section ref={watchPanel} id="watchlist" className="watchPanel" hidden={!watchOpen} role="dialog" aria-modal="false" aria-labelledby="watchlist-title">
      <header><h2 id="watchlist-title">Your watchlist</h2><button type="button" onClick={()=>setWatchOpen(false)} aria-label="Close watchlist">×</button></header>
      {watch.length===0?<p>No saved representatives yet.</p>:<ul>{watch.map(item=><li key={item.id}><a href={item.href}>{item.label}</a> <button type="button" onClick={()=>toggleWatch(item)} aria-label={`Remove ${item.label} from watchlist`}>Remove</button></li>)}</ul>}
    </section>

    <section id="top" className="hero">
      <div className="eyebrow"><span>THE PUBLIC LEDGER</span><span>Updated from election affidavits</span></div>
      <div className="heroGrid">
        <div><h1>Follow the money.<br/><em>Know your neta.</em></h1><p className="dek">India&apos;s most ambitious public record of the wealth declared by elected representatives—across elections, parties and 4,123 assembly constituencies.</p>
          <div className="searchBox"><span aria-hidden="true">⌕</span><input id="search" aria-label="Search representatives" value={query} onChange={e=>{setQuery(e.target.value);setMlaLimit(12)}} placeholder="Search an MLA, constituency, party or state…"/>{query&&<button className="clearSearch" type="button" onClick={()=>setQuery("")} aria-label="Clear representative search">×</button>}<kbd>⌘/Ctrl K</kbd></div>
          <div className="quick"><span>TRY</span>{["D K Shivakumar","Karnataka","BJP"].map(x=><button key={x} onClick={()=>{setQuery(x);setMlaLimit(12);document.getElementById("explore")?.scrollIntoView({behavior:"smooth"})}}>{x}</button>)}</div>
        </div>
        {headline?<aside className="headlineCard"><div className="cardKicker">BIGGEST DECLARED FORTUNE</div><div className="rank">01</div><h2>{headline.name}</h2><p>{headline.constituency} · {headline.state}</p><div className="bigMoney">{fmt(headline.assets)}</div><div className="rise">{headline.historical!==false?`↗ ${headline.growth}%`:"2025 national snapshot"} <span>{headline.historical!==false?"since previous affidavit":"ADR rank #1"}</span></div><Sparkline values={headline.values}/><button onClick={()=>window.location.assign(publicUrl(`/person?type=current&rank=${headline.sourceRank??1}`))}>View the full record →</button></aside>:<aside className="headlineCard" role={dataErrors.snapshot?"alert":"status"}><div className="cardKicker">CURRENT SNAPSHOT</div><h2>{dataErrors.snapshot?"Data unavailable":"Loading public records…"}</h2><p>{dataErrors.snapshot??"Opening the nationwide sitting-MLA index."}</p>{dataErrors.snapshot&&<button onClick={()=>retryData("snapshot")}>Retry data →</button>}</aside>}
      </div>
      <div className="ticker"><span>IN NUMBERS</span><div><b>4,123</b><small>assembly constituencies</small></div><div><b>{candidateIndex?.meta.candidateRecords.toLocaleString("en-IN")??(dataErrors.candidateIndex?"Unavailable":"Loading")}</b><small>candidate affidavits</small></div><div><b>{archive?.meta.winnerRecords.toLocaleString("en-IN")??(dataErrors.archive?"Unavailable":"On demand")}</b><small>historical winners</small></div><div><b>{history?.meta.comparisonCount.toLocaleString("en-IN")??(dataErrors.history?"Unavailable":"On demand")}</b><small>asset comparisons</small></div><div><b>{history?`${history.meta.firstYear}—${history.meta.latestYear}`:(dataErrors.history?"Unavailable":"On demand")}</b><small>comparison years covered</small></div></div>
    </section>

    <section id="explore" className="section explorer" ref={explorerSection}>
      <div className="sectionHead"><div><span className="sectionNo">01 / EXPLORE</span><h2>The wealth table</h2><p>Search the nationwide 2025 sitting-MLA affidavit snapshot.</p></div><div className="dataStamp"><i></i> ADR NATIONAL REPORT · {snapshot?`${snapshot.meta.recordCount.toLocaleString("en-IN")} RECORDS`:(dataErrors.snapshot?"DATA UNAVAILABLE":"LOADING")}</div></div>
      <div className="toolbar"><div className="stateTabs">{["All India","Karnataka","Maharashtra","Telangana","Andhra Pradesh"].map(s=><button className={state===s?"active":""} onClick={()=>{setState(s);setMlaLimit(12)}} key={s}>{s}</button>)}</div><select value={state} onChange={e=>{setState(e.target.value);setMlaLimit(12)}} aria-label="Select state">{states.map(s=><option key={s}>{s}</option>)}</select></div>
      {dataErrors.snapshot&&!snapshot&&<div className="empty" role="alert"><p>The sitting-MLA index could not be loaded: {dataErrors.snapshot}</p><button className="outline" onClick={()=>retryData("snapshot")}>Retry national data</button></div>}
      <div className="tableWrap"><table><thead><tr><th>#</th><th>Representative</th><th>Constituency</th><th aria-sort={sort==="assets"?"descending":"none"}><button onClick={()=>{setSort("assets");setMlaLimit(12)}}>Declared assets {sort==="assets"?"↓":""}</button></th><th aria-sort={sort==="liabilities"?"descending":"none"}><button onClick={()=>{setSort("liabilities");setMlaLimit(12)}}>Liabilities {sort==="liabilities"?"↓":""}</button></th><th aria-sort={sort==="growth"?"descending":"none"}><button onClick={()=>{setSort("growth");setMlaLimit(12)}}>Growth {sort==="growth"?"↓":""}</button></th><th>Trail</th><th>Save</th></tr></thead><tbody>{filtered.slice(0,mlaLimit).map((m,i)=>{const item=currentWatchItem(m);const isWatched=watchedIds.has(item.id);return <tr key={`${m.name}-${m.constituency}-${m.sourceRank??i}`} className={active?.sourceRank===m.sourceRank?"selected":""}><td className="muted">{String(m.sourceRank??i+1).padStart(2,"0")}</td><td><button type="button" onClick={()=>selectRepresentative(m)} aria-controls="profile" aria-pressed={active?.sourceRank===m.sourceRank} style={{border:0,background:"transparent",padding:0,textAlign:"left"}}><strong>{m.name}</strong><span className="party"><i style={{background:parties[m.party]||"#777"}}></i>{m.party}</span></button></td><td><strong>{m.constituency}</strong><span>{m.state}</span></td><td className="money">{fmt(m.assets)}</td><td>{fmt(m.liabilities)}</td><td><span className={m.historical===false?"muted":m.growth>=0?"positive":"negative"}>{m.historical===false?"—":`${m.growth>=0?"↗":"↘"} ${Math.abs(m.growth)}%`}</span></td><td><Sparkline values={m.values} color={parties[m.party]}/></td><td><button className={isWatched?"star on":"star"} onClick={()=>toggleWatch(item)} aria-pressed={isWatched} aria-label={`${isWatched?"Remove":"Add"} ${m.name} ${isWatched?"from":"to"} watchlist`}>{isWatched?"★":"☆"}</button></td></tr>})}</tbody></table>{snapshot&&filtered.length===0&&<div className="empty">No matching records. Try a broader search.</div>}{!snapshot&&!dataErrors.snapshot&&<div className="empty" role="status">Loading the national representative index…</div>}</div>
      <p className="tableNote">Showing {Math.min(mlaLimit,filtered.length)} of {filtered.length} matching representatives · Select a representative name to inspect the declaration trail.</p>
      {mlaLimit<filtered.length&&<button className="loadMore" onClick={()=>setMlaLimit(limit=>Math.min(limit+24,filtered.length))}>Load more representatives</button>}
    </section>

    <section id="profile" className="profile section">
      {active?(()=>{const item=currentWatchItem(active);const isWatched=watchedIds.has(item.id);return <><div className="profileTop"><div><span className="sectionNo">02 / DECLARATION TRAIL</span><div className="personTitle"><div className="monogram">{active.name.split(" ").filter(x=>x.length>1).slice(0,2).map(x=>x[0]).join("")}</div><div><h2>{active.name}</h2><p><b>{active.party}</b> · {active.constituency}, {active.state}</p></div></div></div><button className="outline" aria-pressed={isWatched} onClick={()=>toggleWatch(item)}>{isWatched?"★ Watching":"☆ Add to watchlist"}</button></div>
      <div className="profileGrid"><div className="timelineCard"><div className="cardTitle"><h3>{active.historical===false?"Declared asset snapshot":"Declared assets over time"}</h3><span>₹ crore</span></div><div className="barChart">{active.values.map((v,i)=>{const max=Math.max(...active.values);return <div className="barCol" key={`${active.years[i]}-${i}`}><b>{fmt(v)}</b><div className="bar" style={{height:`${Math.max(8,(v/max)*190)}px`}}></div><span>{active.years[i]}</span></div>})}</div><div className="growthSummary"><div><small>{active.historical===false?"NATIONAL RANK":"TOTAL CHANGE"}</small><b>{active.historical===false?`#${active.sourceRank}`:`${active.assets-active.values[0]>=0?"+":"−"}${fmt(Math.abs(active.assets-active.values[0])).replace("₹","")}`}</b></div><div><small>{active.historical===false?"EDUCATION":"CHANGE SINCE FIRST"}</small><b>{active.historical===false?(active.education||"—"):`${active.growth>=0?"+":""}${active.growth}%`}</b></div><div><small>{active.historical===false?"AGE / GENDER":"DECLARATIONS"}</small><b>{active.historical===false?`${active.age??"—"} / ${active.gender||"—"}`:active.years.length}</b></div></div></div>
        <div className="breakdown"><h3>Latest declaration</h3><div className="networth"><small>EST. DECLARED NET WORTH</small><b>{fmt(active.assets-active.liabilities)}</b><span>Assets less liabilities</span></div><div className="stack"><div style={{width:`${Math.max(5,active.assets+active.liabilities>0?active.assets/(active.assets+active.liabilities)*100:0)}%`}}></div></div><dl><div><dt>Gross assets</dt><dd>{fmt(active.assets)}</dd></div><div><dt>Liabilities</dt><dd>{fmt(active.liabilities)}</dd></div><div><dt>Pending criminal cases</dt><dd>{active.cases}</dd></div><div><dt>Affidavit year</dt><dd>{active.years.at(-1)}</dd></div></dl><Link className="profileLink" href={`/person?type=current&rank=${active.sourceRank??1}`}>Open full record →</Link><a href={active.sourceUrl||snapshot?.meta.sourceUrl||"https://www.myneta.info/"} target="_blank" rel="noreferrer">{active.sourceUrl?"View affidavit comparison ↗":"View national source report ↗"}</a></div></div>{dataErrors.history&&<div className="empty" role="alert"><p>Historical comparisons could not be loaded: {dataErrors.history}</p><button className="outline" onClick={()=>retryData("history")}>Retry history</button></div>}</>} )():<div className="empty" role={dataErrors.snapshot?"alert":"status"}>{dataErrors.snapshot?"The national declaration trail is unavailable.":"Loading the first declaration trail…"}</div>}
    </section>

    <section id="candidates" className="candidateDb section" ref={candidateSection}>
      <div className="sectionHead"><div><span className="sectionNo">03 / IMPORTED DATABASE</span><h2>Candidate affidavits in the imported archive.</h2><p>Search MyNeta-analyzed records imported from discovered election folders.</p></div><div className="dataStamp"><i></i> {candidateIndex?`${candidateIndex.meta.candidateRecords.toLocaleString("en-IN")} RECORDS · ${candidateIndex.meta.electionFolders} IMPORTED FOLDERS`:(dataErrors.candidateIndex?"DATABASE UNAVAILABLE":"LOADING DATABASE")}</div></div>
      {dataErrors.candidateIndex&&!candidateIndex&&<div className="empty" role="alert"><p>The candidate database index could not be loaded: {dataErrors.candidateIndex}</p><button className="outline" onClick={()=>retryData("candidateIndex")}>Retry database index</button></div>}
      <div className="candidateControls"><label><span>STATE / UT</span><select value={candidateState} disabled={!candidateIndex} onChange={e=>{const next=e.target.value;candidateRequest.current+=1;setCandidateState(next);setCandidateYear(candidateIndex?.states.find(s=>s.state===next)?.elections[0]?.electionYear??2023);setCandidateShard(null);setCandidateLoadError("");setCandidateLimit(50)}}>{candidateIndex?.states.map(s=><option key={s.state}>{s.state}</option>)}</select></label><label><span>ELECTION</span><select value={candidateYear} disabled={!candidateIndex} onChange={e=>{candidateRequest.current+=1;setCandidateYear(Number(e.target.value));setCandidateShard(null);setCandidateLoadError("");setCandidateLimit(50)}}>{candidateElections.map(e=><option key={e.electionFolder} value={e.electionYear}>{e.electionYear} · {e.candidateCount.toLocaleString("en-IN")} candidates</option>)}</select></label><label className="candidateSearch"><span>SEARCH THIS ELECTION</span><input value={candidateQuery} disabled={!candidateShard} onChange={e=>{setCandidateQuery(e.target.value);setCandidateLimit(50)}} placeholder="Candidate, constituency or party…"/></label></div>
      <div className="candidateWorkspace"><div className="candidateList"><div className="candidateListHead"><span>{candidateShard?`${candidateShard.meta.candidateCount.toLocaleString("en-IN")} candidates in ${candidateState} ${candidateYear}`:(candidateLoadError?"Election unavailable":"Loading election…")}</span><small>Available declared assets first</small></div>{candidateResults.slice(0,candidateLimit).map(row=>{const assets=availableMoney(row.assets,row.assetsStatus);return <button key={row.candidateId} onClick={()=>window.location.assign(publicUrl(`/person?type=candidate&election=${encodeURIComponent(candidateShard?.meta.electionFolder??"")}&id=${row.candidateId}`))}><div><strong>{row.name}</strong><small>{row.constituency} · {row.party}{row.electionYear&&row.electionYear!==candidateYear?` · ${row.electionYear}`:""}</small></div><span>{fmt(assets===null?null:assets/1e7)} →</span></button>})}{candidateLoadError&&<div className="empty" role="alert"><p>This election could not be loaded: {candidateLoadError}</p><button className="outline" onClick={()=>{candidateRequest.current+=1;setCandidateLoadError("");setCandidateShard(null);setCandidateAttempt(value=>value+1)}}>Retry election</button></div>}{candidateShard&&candidateResults.length===0&&<div className="empty">No candidates match this search.</div>}{candidateLimit<candidateResults.length&&<button className="loadMore" onClick={()=>setCandidateLimit(limit=>Math.min(limit+50,candidateResults.length))}>Load more candidates</button>}</div>
        </div>
    </section>

    <section id="archive" className="archive section" ref={archiveSection}>
      <div className="sectionHead"><div><span className="sectionNo">04 / CONSTITUENCY ARCHIVE</span><h2>Winner records across imported elections.</h2><p>Browse declared wealth and party succession where a same-seat history can be connected without ambiguity.</p></div><div className="dataStamp"><i></i> {archive?`${archive.meta.winnerRecords.toLocaleString("en-IN")} WINNER RECORDS · ${archive.meta.electionFolders} IMPORTED FOLDERS`:(dataErrors.archive?"ARCHIVE UNAVAILABLE":"LOADING ARCHIVE")}</div></div>
      {dataErrors.archive&&!archive&&<div className="empty archiveEmpty" role="alert"><p>The constituency archive could not be loaded: {dataErrors.archive}</p><button className="outline" onClick={()=>retryData("archive")}>Retry archive</button></div>}
      <div className="archiveControls"><label><span>STATE / UT</span><select value={archiveState} disabled={!archive} onChange={e=>{setArchiveState(e.target.value);setSeatQuery("");setSeatLimit(8)}}>{archiveStates.map(s=><option key={s}>{s}</option>)}</select></label><label className="seatSearch"><span>CONSTITUENCY</span><input value={seatQuery} disabled={!archive} onChange={e=>{setSeatQuery(e.target.value);setSeatLimit(8)}} placeholder="Type a constituency name…"/></label><div className="archiveCount"><b>{seatGroups.length}</b><span>matching seat histories</span></div></div>
      <div className="seatGrid">{seatGroups.slice(0,seatLimit).map(rows=><article className="seatCard" key={`${rows[0].state}-${rows[0].normalizedConstituency}`}><header><div><span>{rows[0].state}</span><h3>{rows.at(-1)?.constituency}</h3></div><b>{rows.length} elections</b></header><div className="seatTimeline">{rows.map((row,i)=>{const assets=availableMoney(row.assets,row.assetsStatus);return <a href={publicUrl(`/person?type=candidate&election=${encodeURIComponent(row.electionFolder)}&id=${row.candidateId}`)} key={`${row.electionFolder}-${row.candidateId}`}><i className={i===rows.length-1?"current":""}></i><time dateTime={row.electionDate??undefined}>{row.electionYear}</time><div><strong>{row.name}</strong><small>{row.party} · {fmt(assets===null?null:assets/1e7)} assets</small></div><span>→</span></a>})}</div></article>)}</div>
      {seatLimit<seatGroups.length&&<button className="loadMore" onClick={()=>setSeatLimit(limit=>Math.min(limit+8,seatGroups.length))}>Load more seat histories</button>}
      {archive&&seatGroups.length===0&&<div className="empty archiveEmpty">No constituency matches in {archiveState}. Try a shorter name.</div>}
    </section>

    <section id="states" className="section states"><div className="sectionHead"><div><span className="sectionNo">05 / THE MAP</span><h2>State of wealth</h2><p>Average assets in the nationwide sitting-MLA index, ranked high to low.</p></div></div><div className="stateGrid"><div className="indiaPanel"><div className="mapType">INDIA</div><h3>Where political wealth concentrates</h3><p>The southern and western states dominate the top of the current declared-asset index.</p><div className="mapBlocks">{stateStats.map((s,i)=><button key={s.state} className={`mapBlock b${i}`} onClick={()=>{setState(s.state);document.getElementById("explore")?.scrollIntoView({behavior:"smooth"})}}><b>{s.state.slice(0,3).toUpperCase()}</b><span>{fmt(s.avg)}</span></button>)}</div><small>Tap a state block to filter the wealth table</small></div><div className="stateRanks">{stateStats.map((s,i)=><div key={s.state}><span>{String(i+1).padStart(2,"0")}</span><div><b>{s.state}</b><small>{s.count} indexed leaders</small></div><div className="rankBar"><i style={{width:`${(s.avg/(stateStats[0]?.avg||1))*100}%`}}></i></div><strong>{fmt(s.avg)}</strong></div>)}</div></div></section>

    <section id="analysis" className="analysis section"><div className="sectionHead"><div><span className="sectionNo">06 / ANALYSIS</span><h2>Signals in the declarations</h2></div></div><div className="storyGrid"><article className="leadStory"><span>WEALTH VELOCITY</span><h3>The affidavit-to-affidavit jump</h3><div className="storyNumber">{history?medianGrowth:"—"}{history&&<sup>%</sup>}</div><p>{history?`Median declared-asset change across ${history.meta.comparisonCount.toLocaleString("en-IN")} historical comparisons.`:"Historical comparisons load as this section approaches."}</p><div className="miniLegend"><i></i> Growth between consecutive affidavits</div></article><article><span>PARTY LENS</span><h3>Average assets by party</h3>{partyStats.slice(0,6).map(item=><div className="partyBar" key={item.party}><b>{item.party}</b><div><i style={{width:`${(item.average/largestPartyAverage)*100}%`,background:item.color}}></i></div><span>{fmt(item.average)} · n={item.count}</span></div>)}</article><article className="question"><span>WATCH THIS</span><h3>Growth ≠ wrongdoing</h3><p>Asset changes can reflect inheritance, business income, valuation changes, spouse holdings, debt, or corrections. The numbers are leads for scrutiny—not verdicts.</p><a href="#method">Read our methodology →</a></article></div></section>

    <section id="method" className="method"><div><span className="sectionNo">07 / SOURCE NOTE</span><h2>Public records,<br/>carefully connected.</h2></div><div><p>NetaWorth hosts and organizes the usable database itself. Every figure originates in a candidate&apos;s self-sworn election affidavit; MyNeta and ECI links remain as citations for verification. “Net worth” here means declared total assets minus declared liabilities, not independently audited market wealth.</p><div className="methodLinks"><a href="https://affidavit.eci.gov.in/" target="_blank" rel="noreferrer">Election Commission affidavit portal ↗</a><a href="https://adrindia.org/sites/default/files/All_India_Sitting_MLAs_Report_2025_English.pdf" target="_blank" rel="noreferrer">ADR national MLA report ↗</a><a href="https://www.myneta.info/" target="_blank" rel="noreferrer">MyNeta source archive ↗</a></div><small>The internal database contains {(candidateIndex?.meta.candidateRecords??172969).toLocaleString("en-IN")} MyNeta-analyzed candidate records imported from {(candidateIndex?.meta.electionFolders??135)} reviewed state-election folders through 2026. It also contains {(snapshot?.meta.recordCount??4092).toLocaleString("en-IN")} sitting MLAs from the ADR 2025 snapshot, {(archive?.meta.winnerRecords??17785).toLocaleString("en-IN")} imported historical-winner records through 2026 and {(history?.meta.comparisonCount??10243).toLocaleString("en-IN")} asset comparisons spanning 2004—2025. Exact-name histories are useful leads, while verified growth timelines require state, election year, normalized name and exact asset values to agree. Constituency labels remain as published and may reflect delimitation or spelling changes; ambiguous same-label winner groups are omitted rather than merged into a false seat history. Check the cited primary affidavit before investigative or legal use.</small></div></section>
    <footer><div className="brand"><span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span></div><p>Making political money legible.</p><nav aria-label="Project information"><Link href="/about#data">Data</Link><Link href="/about#methodology">Methodology</Link><Link href="/about#corrections">Corrections</Link><Link href="/about">About</Link></nav><small>Built in the public interest · India · 2026</small></footer>
  </main></>
}
