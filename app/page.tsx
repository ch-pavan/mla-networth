"use client";

import { useEffect, useMemo, useState } from "react";

type MLA = {
  name: string; state: string; constituency: string; party: string; assets: number;
  liabilities: number; growth: number; years: number[]; values: number[]; cases: number;
  historical?: boolean; education?: string; age?: number | null; gender?: string; sourceRank?: number; sourceUrl?: string;
};

type AdrRecord = { rank:number; state:string; electionYear:number; constituency:string; name:string; party:string; age:number|null; gender:string; assets:number; liabilities:number; criminalCases:number; seriousCriminalCases:number; education:string; panDeclared:boolean };
type AdrSnapshot = { meta:{recordCount:number;sourceUrl:string;published:string;note:string}; records:AdrRecord[] };
type HistoryComparison = { state:string;currentYear:number;previousYear:number;name:string;normalizedName:string;party:string;currentAssets:number;previousAssets:number;percentChange:number;remarks:string;comparisonUrl:string;currentSnapshotRank:number|null;matchedToSnapshot:boolean };
type HistorySnapshot = { meta:{electionPagesAvailable:number;comparisonCount:number;snapshotMatchCount:number;firstYear:number;latestYear:number;note:string}; comparisons:HistoryComparison[] };
type WinnerRecord = { state:string;electionYear:number;electionFolder:string;rankByAssets:number;candidateId:number;name:string;normalizedName:string;constituency:string;normalizedConstituency:string;party:string;criminalCases:number;education:string;assets:number;liabilities:number;candidateUrl:string };
type WinnerArchive = { meta:{winnerRecords:number;electionFolders:number;states:number;firstYear:number;latestYear:number;note:string}; records:WinnerRecord[] };
type CandidateRecord = { ordinal:number;candidateId:number;name:string;normalizedName:string;constituency:string;normalizedConstituency:string;party:string;criminalCases:number;education:string;assets:number;liabilities:number;candidateUrl:string };
type CandidateElection = { state:string;electionYear:number;electionFolder:string;candidateCount:number;constituencyCount:number;complete:boolean;file:string;sourceUrl:string };
type CandidateIndex = { meta:{candidateRecords:number;electionFolders:number;completeElectionFolders:number;states:number;firstYear:number;latestYear:number;note:string};states:{state:string;elections:CandidateElection[]}[] };
type CandidateShard = { meta:CandidateElection;records:CandidateRecord[] };

const mlaData: MLA[] = [
  { name: "D. K. Shivakumar", state: "Karnataka", constituency: "Kanakapura", party: "INC", assets: 1413, liabilities: 265, growth: 68.2, years: [2008,2013,2018,2023], values:[75,251,840,1413], cases: 19 },
  { name: "K. H. Puttaswamy Gowda", state: "Karnataka", constituency: "Gauribidanur", party: "IND", assets: 1267, liabilities: 5, growth: 112.4, years:[2013,2018,2023], values:[131,592,1267], cases: 0 },
  { name: "Parag Shah", state: "Maharashtra", constituency: "Ghatkopar East", party: "BJP", assets: 500, liabilities: 66, growth: 17.1, years:[2014,2019], values:[78,500], cases: 0 },
  { name: "Priya Krishna", state: "Karnataka", constituency: "Govindarajanagar", party: "INC", assets: 1156, liabilities: 881, growth: 29.5, years:[2008,2013,2018,2023], values:[767,910,1020,1156], cases: 8 },
  { name: "Mangal Prabhat Lodha", state: "Maharashtra", constituency: "Malabar Hill", party: "BJP", assets: 441, liabilities: 14, growth: 22.8, years:[2009,2014,2019], values:[68,198,441], cases: 5 },
  { name: "Jayantibhai Patel", state: "Gujarat", constituency: "Mansa", party: "BJP", assets: 661, liabilities: 233, growth: 154.8, years:[2012,2017,2022], values:[67,102,661], cases: 0 },
  { name: "T. S. Baba", state: "Chhattisgarh", constituency: "Ambikapur", party: "INC", assets: 500, liabilities: 0.09, growth: 6.7, years:[2008,2013,2018,2023], values:[120,214,501,500], cases: 0 },
  { name: "N. Chandrababu Naidu", state: "Andhra Pradesh", constituency: "Kuppam", party: "TDP", assets: 931, liabilities: 10, growth: 41.2, years:[2009,2014,2019,2024], values:[39,178,668,931], cases: 24 },
  { name: "Komatireddy Raj Gopal Reddy", state: "Telangana", constituency: "Munugode", party: "INC", assets: 458, liabilities: 45, growth: 91.3, years:[2014,2018,2023], values:[86,314,458], cases: 1 },
  { name: "Y. S. Jagan Mohan Reddy", state: "Andhra Pradesh", constituency: "Pulivendla", party: "YSRCP", assets: 757, liabilities: 26, growth: 47.6, years:[2014,2019,2024], values:[416,510,757], cases: 26 },
  { name: "Siddaramaiah", state: "Karnataka", constituency: "Varuna", party: "INC", assets: 51.9, liabilities: 23, growth: 34.7, years:[2008,2013,2018,2023], values:[5.5,13.6,20.4,51.9], cases: 13 },
  { name: "K. Chandrashekar Rao", state: "Telangana", constituency: "Gajwel", party: "BRS", assets: 58.9, liabilities: 17, growth: 18.3, years:[2014,2018,2023], values:[23.6,22.6,58.9], cases: 9 },
  { name: "Revanth Reddy", state: "Telangana", constituency: "Kodangal", party: "INC", assets: 30.0, liabilities: 1.3, growth: 73.1, years:[2009,2014,2018,2023], values:[3.6,6.7,24.5,30], cases: 89 },
  { name: "Pinarayi Vijayan", state: "Kerala", constituency: "Dharmadam", party: "CPI(M)", assets: 1.2, liabilities: 0, growth: 11.2, years:[2016,2021], values:[0.8,1.2], cases: 2 },
  { name: "Himanta Biswa Sarma", state: "Assam", constituency: "Jalukbari", party: "BJP", assets: 17.3, liabilities: 3.6, growth: 28.8, years:[2011,2016,2021], values:[6.4,8.5,17.3], cases: 0 },
  { name: "Bhupendra Patel", state: "Gujarat", constituency: "Ghatlodia", party: "BJP", assets: 8.2, liabilities: 0.7, growth: 12.1, years:[2017,2022], values:[5.2,8.2], cases: 0 },
  { name: "Mamata Banerjee", state: "West Bengal", constituency: "Bhabanipur", party: "AITC", assets: 0.16, liabilities: 0, growth: -2.4, years:[2011,2016,2021], values:[0.05,0.3,0.16], cases: 0 },
  { name: "Sukhvinder Singh Sukhu", state: "Himachal Pradesh", constituency: "Nadaun", party: "INC", assets: 7.8, liabilities: 0.5, growth: 25.4, years:[2012,2017,2022], values:[2.2,4.1,7.8], cases: 5 },
  { name: "Ashok Gehlot", state: "Rajasthan", constituency: "Sardarpura", party: "INC", assets: 6.6, liabilities: 0, growth: 17.8, years:[2008,2013,2018,2023], values:[1.5,3.1,6.5,6.6], cases: 0 },
  { name: "Vasundhara Raje", state: "Rajasthan", constituency: "Jhalrapatan", party: "BJP", assets: 10.9, liabilities: 0.9, growth: 9.4, years:[2008,2013,2018,2023], values:[4.3,4.1,4.9,10.9], cases: 0 },
  { name: "Akhilesh Yadav", state: "Uttar Pradesh", constituency: "Karhal", party: "SP", assets: 40.0, liabilities: 0.4, growth: 19.5, years:[2009,2012,2019,2022], values:[8.8,17.2,37.8,40], cases: 3 },
  { name: "Yogi Adityanath", state: "Uttar Pradesh", constituency: "Gorakhpur Urban", party: "BJP", assets: 1.5, liabilities: 0, growth: 7.2, years:[2009,2014,2017,2022], values:[0.3,0.7,0.95,1.5], cases: 1 },
  { name: "Nitish Kumar", state: "Bihar", constituency: "MLC", party: "JD(U)", assets: 0.75, liabilities: 0, growth: 5.8, years:[2012,2015,2020,2024], values:[0.46,0.56,0.63,0.75], cases: 0 },
  { name: "Tejashwi Yadav", state: "Bihar", constituency: "Raghopur", party: "RJD", assets: 8.2, liabilities: 0.2, growth: 13.6, years:[2015,2020], values:[2.3,8.2], cases: 11 },
  { name: "Arvind Kejriwal", state: "Delhi", constituency: "New Delhi", party: "AAP", assets: 3.4, liabilities: 0, growth: 8.9, years:[2013,2015,2020], values:[2.1,2.1,3.4], cases: 13 },
];

const parties: Record<string,string> = { BJP:"#f28b22", INC:"#3f78c5", TDP:"#e4c72f", YSRCP:"#2f69b1", BRS:"#e85a98", "CPI(M)":"#d94841", AITC:"#38a169", SP:"#d94d5c", AAP:"#3677c8", "JD(U)":"#459b71", RJD:"#43985b", IND:"#7d8696" };

const fmt = (n:number) => n >= 1000 ? `₹${(n/1000).toFixed(2)}k Cr` : n >= 1 ? `₹${n.toFixed(n<10?1:0)} Cr` : `₹${Math.round(n*100)} L`;
const normalizeName = (s:string) => s.normalize("NFKD").replace(/[.']/g,"").replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase();

function Sparkline({ values, color="#df6b32" }:{values:number[],color?:string}) {
  const max=Math.max(...values), min=Math.min(...values), range=max-min||1;
  const pts=values.map((v,i)=>`${(i/(values.length-1))*90+5},${34-((v-min)/range)*28}`).join(" ");
  return <svg className="spark" viewBox="0 0 100 40" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{values.map((v,i)=><circle key={i} cx={(i/(values.length-1))*90+5} cy={34-((v-min)/range)*28} r="2.5" fill={color}/>)}</svg>
}

export default function Home() {
  const [query,setQuery]=useState("");
  const [state,setState]=useState("All India");
  const [sort,setSort]=useState<"assets"|"growth"|"liabilities">("assets");
  const [active,setActive]=useState<MLA>(mlaData[0]);
  const [watch,setWatch]=useState<string[]>([]);
  const [snapshot,setSnapshot]=useState<AdrSnapshot|null>(null);
  const [history,setHistory]=useState<HistorySnapshot|null>(null);
  const [archive,setArchive]=useState<WinnerArchive|null>(null);
  const [archiveState,setArchiveState]=useState("Karnataka");
  const [seatQuery,setSeatQuery]=useState("Kanakapura");
  const [candidateIndex,setCandidateIndex]=useState<CandidateIndex|null>(null);
  const [candidateState,setCandidateState]=useState("Karnataka");
  const [candidateYear,setCandidateYear]=useState(2023);
  const [candidateShard,setCandidateShard]=useState<CandidateShard|null>(null);
  const [candidateQuery,setCandidateQuery]=useState("");
  useEffect(()=>{Promise.all([fetch("/data/adr-sitting-mlas-2025.json").then(r=>r.json()),fetch("/data/adr-recontest-history.json").then(r=>r.json()),fetch("/data/adr-winner-archive.json").then(r=>r.json()),fetch("/data/candidates/index.json").then(r=>r.json())]).then(([current,historical,winners,candidates]:[AdrSnapshot,HistorySnapshot,WinnerArchive,CandidateIndex])=>{setSnapshot(current);setHistory(historical);setArchive(winners);setCandidateIndex(candidates)}).catch(()=>{})},[]);
  const candidateElections=useMemo(()=>candidateIndex?.states.find(s=>s.state===candidateState)?.elections??[],[candidateIndex,candidateState]);
  useEffect(()=>{const election=candidateElections.find(e=>e.electionYear===candidateYear);if(!election)return;setCandidateShard(null);fetch(election.file).then(r=>r.json()).then((data:CandidateShard)=>setCandidateShard(data)).catch(()=>{})},[candidateElections,candidateYear]);
  const allData=useMemo(()=>{
    if(!snapshot) return mlaData;
    const comparisons=new Map<string,HistoryComparison[]>();
    for(const h of history?.comparisons??[]){const key=`${h.state}|${h.normalizedName}`;comparisons.set(key,[...(comparisons.get(key)??[]),h])}
    return snapshot.records.map((r):MLA=>{
      const segments=(comparisons.get(`${r.state}|${normalizeName(r.name)}`)??[]).sort((a,b)=>a.currentYear-b.currentYear);
      const latest=segments.find(h=>h.currentYear===r.electionYear&&h.currentAssets===r.assets);
      const points=new Map<number,number>(); let cursor=latest;
      while(cursor){points.set(cursor.currentYear,cursor.currentAssets/1e7);points.set(cursor.previousYear,cursor.previousAssets/1e7);const previousYear=cursor.previousYear,previousAssets=cursor.previousAssets;cursor=segments.find(h=>h.currentYear===previousYear&&h.currentAssets===previousAssets)}
      const timeline=[...points].sort((a,b)=>a[0]-b[0]);
      return {name:r.name,state:r.state,constituency:r.constituency,party:r.party,assets:r.assets/1e7,liabilities:r.liabilities/1e7,growth:latest?.percentChange??0,years:timeline.length?timeline.map(x=>x[0]):[r.electionYear,r.electionYear],values:timeline.length?timeline.map(x=>x[1]):[r.assets/1e7,r.assets/1e7],cases:r.criminalCases,historical:Boolean(latest),education:r.education,age:r.age,gender:r.gender,sourceRank:r.rank,sourceUrl:latest?.comparisonUrl};
    });
  },[snapshot,history]);
  const states=["All India",...Array.from(new Set(allData.map(m=>m.state))).sort()];
  const filtered=useMemo(()=>allData.filter(m=>(state==="All India"||m.state===state)&&normalizeName(`${m.name} ${m.constituency} ${m.party}`).includes(normalizeName(query))).sort((a,b)=>b[sort]-a[sort]),[allData,query,state,sort]);
  const stateStats=useMemo(()=>Array.from(new Set(allData.map(m=>m.state))).map(s=>{const d=allData.filter(m=>m.state===s);return {state:s, avg:d.reduce((a,b)=>a+b.assets,0)/d.length, growth:d.reduce((a,b)=>a+b.growth,0)/d.length,count:d.length}}).sort((a,b)=>b.avg-a.avg).slice(0,8),[allData]);
  const headline=allData.reduce((a,b)=>b.assets>a.assets?b:a,allData[0]);
  const archiveStates=useMemo(()=>[...new Set((archive?.records??[]).map(r=>r.state))].sort(),[archive]);
  const seatGroups=useMemo(()=>{
    const groups=new Map<string,WinnerRecord[]>();
    for(const row of archive?.records??[]){if(row.state!==archiveState||!row.normalizedConstituency.includes(normalizeName(seatQuery)))continue;groups.set(row.normalizedConstituency,[...(groups.get(row.normalizedConstituency)??[]),row])}
    return [...groups.values()].map(rows=>rows.sort((a,b)=>a.electionYear-b.electionYear)).sort((a,b)=>(b.at(-1)?.electionYear??0)-(a.at(-1)?.electionYear??0)||a[0].constituency.localeCompare(b[0].constituency)).slice(0,8);
  },[archive,archiveState,seatQuery]);
  const medianGrowth=useMemo(()=>{const values=(history?.comparisons??[]).map(x=>x.percentChange).filter(Number.isFinite).sort((a,b)=>a-b);return values.length?Math.round(values[Math.floor(values.length/2)]):0},[history]);
  const candidateResults=useMemo(()=>[...(candidateShard?.records??[])].filter(row=>normalizeName(`${row.name} ${row.constituency} ${row.party}`).includes(normalizeName(candidateQuery))).sort((a,b)=>b.assets-a.assets).slice(0,50),[candidateShard,candidateQuery]);
  const toggleWatch=(name:string)=>setWatch(w=>w.includes(name)?w.filter(x=>x!==name):[...w,name]);

  return <main>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Neta Worth home"><span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span></a>
      <nav><a href="#explore">Current MLAs</a><a href="#candidates">Candidate DB</a><a href="#archive">Seats</a><a href="#analysis">Analysis</a><a href="#method">Method</a></nav>
      <div className="headerActions"><button className="iconBtn" aria-label="Search" onClick={()=>document.getElementById("search")?.focus()}>⌕</button><button className="watchBtn" onClick={()=>alert(watch.length?`Watching: ${watch.join(", ")}`:"Your watchlist is empty")}>Watchlist <b>{watch.length}</b></button></div>
    </header>

    <section id="top" className="hero">
      <div className="eyebrow"><span>THE PUBLIC LEDGER</span><span>Updated from election affidavits</span></div>
      <div className="heroGrid">
        <div><h1>Follow the money.<br/><em>Know your neta.</em></h1><p className="dek">India&apos;s most ambitious public record of the wealth declared by elected representatives—across elections, parties and 4,123 assembly constituencies.</p>
          <div className="searchBox"><span>⌕</span><input id="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search an MLA, constituency, party or state…"/><kbd>⌘ K</kbd></div>
          <div className="quick"><span>TRY</span>{["D K Shivakumar","Karnataka","BJP"].map(x=><button key={x} onClick={()=>setQuery(x)}>{x}</button>)}</div>
        </div>
        <aside className="headlineCard"><div className="cardKicker">BIGGEST DECLARED FORTUNE</div><div className="rank">01</div><h2>{headline.name}</h2><p>{headline.constituency} · {headline.state}</p><div className="bigMoney">{fmt(headline.assets)}</div><div className="rise">{headline.historical!==false?`↗ ${headline.growth}%`:"2025 national snapshot"} <span>{headline.historical!==false?"since previous affidavit":"ADR rank #1"}</span></div><Sparkline values={headline.values}/><button onClick={()=>window.location.assign(`/person?type=current&rank=${headline.sourceRank??1}`)}>View the full record →</button></aside>
      </div>
      <div className="ticker"><span>IN NUMBERS</span><div><b>4,123</b><small>assembly constituencies</small></div><div><b>{candidateIndex?.meta.candidateRecords.toLocaleString("en-IN")??"Loading"}</b><small>candidate affidavits</small></div><div><b>{archive?.meta.winnerRecords.toLocaleString("en-IN")??"—"}</b><small>historical winners</small></div><div><b>{history?.meta.comparisonCount.toLocaleString("en-IN")??"—"}</b><small>asset comparisons</small></div><div><b>{history?`${history.meta.firstYear}—${history.meta.latestYear}`:"—"}</b><small>election years covered</small></div></div>
    </section>

    <section id="explore" className="section explorer">
      <div className="sectionHead"><div><span className="sectionNo">01 / EXPLORE</span><h2>The wealth table</h2><p>Search the nationwide 2025 sitting-MLA affidavit snapshot.</p></div><div className="dataStamp"><i></i> ADR NATIONAL REPORT · {snapshot?`${snapshot.meta.recordCount.toLocaleString("en-IN")} RECORDS`:"LOADING"}</div></div>
      <div className="toolbar"><div className="stateTabs">{["All India","Karnataka","Maharashtra","Telangana","Andhra Pradesh"].map(s=><button className={state===s?"active":""} onClick={()=>setState(s)} key={s}>{s}</button>)}</div><select value={state} onChange={e=>setState(e.target.value)} aria-label="Select state">{states.map(s=><option key={s}>{s}</option>)}</select></div>
      <div className="tableWrap"><table><thead><tr><th>#</th><th>Representative</th><th>Constituency</th><th><button onClick={()=>setSort("assets")}>Declared assets {sort==="assets"?"↓":""}</button></th><th><button onClick={()=>setSort("liabilities")}>Liabilities {sort==="liabilities"?"↓":""}</button></th><th><button onClick={()=>setSort("growth")}>Growth {sort==="growth"?"↓":""}</button></th><th>Trail</th><th></th></tr></thead><tbody>{filtered.slice(0,12).map((m,i)=><tr key={`${m.name}-${m.constituency}-${m.sourceRank??i}`} onClick={()=>window.location.assign(`/person?type=current&rank=${m.sourceRank??i+1}`)}><td className="muted">{String(m.sourceRank??i+1).padStart(2,"0")}</td><td><strong>{m.name}</strong><span className="party"><i style={{background:parties[m.party]||"#777"}}></i>{m.party}</span></td><td><strong>{m.constituency}</strong><span>{m.state}</span></td><td className="money">{fmt(m.assets)}</td><td>{fmt(m.liabilities)}</td><td><span className={m.historical===false?"muted":m.growth>=0?"positive":"negative"}>{m.historical===false?"—":`${m.growth>=0?"↗":"↘"} ${Math.abs(m.growth)}%`}</span></td><td><Sparkline values={m.values} color={parties[m.party]}/></td><td><button className={watch.includes(m.name)?"star on":"star"} onClick={e=>{e.stopPropagation();toggleWatch(m.name)}} aria-label="Add to watchlist">{watch.includes(m.name)?"★":"☆"}</button></td></tr>)}</tbody></table>{filtered.length===0&&<div className="empty">No matching records. Try a broader search.</div>}</div>
      <p className="tableNote">Showing {Math.min(12,filtered.length)} of {filtered.length} matching representatives · Click any row for the full declaration trail.</p>
    </section>

    <section id="profile" className="profile section">
      <div className="profileTop"><div><span className="sectionNo">02 / DECLARATION TRAIL</span><div className="personTitle"><div className="monogram">{active.name.split(" ").filter(x=>x.length>1).slice(0,2).map(x=>x[0]).join("")}</div><div><h2>{active.name}</h2><p><b>{active.party}</b> · {active.constituency}, {active.state}</p></div></div></div><button className="outline" onClick={()=>toggleWatch(active.name)}>{watch.includes(active.name)?"★ Watching":"☆ Add to watchlist"}</button></div>
      <div className="profileGrid"><div className="timelineCard"><div className="cardTitle"><h3>{active.historical===false?"Declared asset snapshot":"Declared assets over time"}</h3><span>₹ crore</span></div><div className="barChart">{active.values.map((v,i)=>{const max=Math.max(...active.values);return <div className="barCol" key={`${active.years[i]}-${i}`}><b>{fmt(v)}</b><div className="bar" style={{height:`${Math.max(8,(v/max)*190)}px`}}></div><span>{active.years[i]}</span></div>})}</div><div className="growthSummary"><div><small>{active.historical===false?"NATIONAL RANK":"TOTAL CHANGE"}</small><b>{active.historical===false?`#${active.sourceRank}`:`+${fmt(active.assets-active.values[0]).replace("₹","")}`}</b></div><div><small>{active.historical===false?"EDUCATION":"COMPOUND GROWTH"}</small><b>{active.historical===false?(active.education||"—"):`${active.growth}%`}</b></div><div><small>{active.historical===false?"AGE / GENDER":"DECLARATIONS"}</small><b>{active.historical===false?`${active.age??"—"} / ${active.gender||"—"}`:active.years.length}</b></div></div></div>
        <div className="breakdown"><h3>Latest declaration</h3><div className="networth"><small>EST. DECLARED NET WORTH</small><b>{fmt(active.assets-active.liabilities)}</b><span>Assets less liabilities</span></div><div className="stack"><div style={{width:`${Math.max(5,active.assets/(active.assets+active.liabilities)*100)}%`}}></div></div><dl><div><dt>Gross assets</dt><dd>{fmt(active.assets)}</dd></div><div><dt>Liabilities</dt><dd>{fmt(active.liabilities)}</dd></div><div><dt>Pending criminal cases</dt><dd>{active.cases}</dd></div><div><dt>Affidavit year</dt><dd>{active.years.at(-1)}</dd></div></dl><a href={active.sourceUrl||snapshot?.meta.sourceUrl||"https://www.myneta.info/"} target="_blank">{active.sourceUrl?"View affidavit comparison ↗":"View national source report ↗"}</a></div></div>
    </section>

    <section id="candidates" className="candidateDb section">
      <div className="sectionHead"><div><span className="sectionNo">03 / COMPLETE DATABASE</span><h2>Every candidate affidavit.</h2><p>Search election records inside NetaWorth. Source sites are citations, not the interface.</p></div><div className="dataStamp"><i></i> {candidateIndex?`${candidateIndex.meta.candidateRecords.toLocaleString("en-IN")} RECORDS · ${candidateIndex.meta.completeElectionFolders}/${candidateIndex.meta.electionFolders} ELECTIONS COMPLETE`:"LOADING DATABASE"}</div></div>
      <div className="candidateControls"><label><span>STATE / UT</span><select value={candidateState} onChange={e=>{const next=e.target.value;setCandidateState(next);setCandidateYear(candidateIndex?.states.find(s=>s.state===next)?.elections[0]?.electionYear??2023)}}>{candidateIndex?.states.map(s=><option key={s.state}>{s.state}</option>)}</select></label><label><span>ELECTION</span><select value={candidateYear} onChange={e=>setCandidateYear(Number(e.target.value))}>{candidateElections.map(e=><option key={e.electionFolder} value={e.electionYear}>{e.electionYear} · {e.candidateCount.toLocaleString("en-IN")} candidates</option>)}</select></label><label className="candidateSearch"><span>SEARCH THIS ELECTION</span><input value={candidateQuery} onChange={e=>setCandidateQuery(e.target.value)} placeholder="Candidate, constituency or party…"/></label></div>
      <div className="candidateWorkspace"><div className="candidateList"><div className="candidateListHead"><span>{candidateShard?`${candidateShard.meta.candidateCount.toLocaleString("en-IN")} candidates in ${candidateState} ${candidateYear}`:"Loading election…"}</span><small>Top 50 matches by declared assets</small></div>{candidateResults.map(row=><button key={row.candidateId} onClick={()=>window.location.assign(`/person?type=candidate&election=${encodeURIComponent(candidateShard?.meta.electionFolder??"")}&id=${row.candidateId}`)}><div><strong>{row.name}</strong><small>{row.constituency} · {row.party}</small></div><span>{fmt(row.assets/1e7)} →</span></button>)}</div>
        </div>
    </section>

    <section id="archive" className="archive section">
      <div className="sectionHead"><div><span className="sectionNo">04 / CONSTITUENCY ARCHIVE</span><h2>One seat. Every election.</h2><p>Browse the declared wealth and party succession of assembly winners from 2004–2025.</p></div><div className="dataStamp"><i></i> {archive?`${archive.meta.winnerRecords.toLocaleString("en-IN")} WINNER RECORDS · ${archive.meta.electionFolders} ELECTIONS`:"LOADING ARCHIVE"}</div></div>
      <div className="archiveControls"><label><span>STATE / UT</span><select value={archiveState} onChange={e=>{setArchiveState(e.target.value);setSeatQuery("")}}>{archiveStates.map(s=><option key={s}>{s}</option>)}</select></label><label className="seatSearch"><span>CONSTITUENCY</span><input value={seatQuery} onChange={e=>setSeatQuery(e.target.value)} placeholder="Type a constituency name…"/></label><div className="archiveCount"><b>{seatGroups.length}</b><span>matching seat histories</span></div></div>
      <div className="seatGrid">{seatGroups.map(rows=><article className="seatCard" key={`${rows[0].state}-${rows[0].normalizedConstituency}`}><header><div><span>{rows[0].state}</span><h3>{rows.at(-1)?.constituency}</h3></div><b>{rows.length} elections</b></header><div className="seatTimeline">{rows.map((row,i)=><a href={`/person?type=candidate&election=${encodeURIComponent(row.electionFolder)}&id=${row.candidateId}`} key={`${row.electionFolder}-${row.candidateId}`}><i className={i===rows.length-1?"current":""}></i><time>{row.electionYear}</time><div><strong>{row.name}</strong><small>{row.party} · {fmt(row.assets/1e7)} assets</small></div><span>→</span></a>)}</div></article>)}</div>
      {archive&&seatGroups.length===0&&<div className="empty archiveEmpty">No constituency matches in {archiveState}. Try a shorter name.</div>}
    </section>

    <section id="states" className="section states"><div className="sectionHead"><div><span className="sectionNo">03 / THE MAP</span><h2>State of wealth</h2><p>Average assets in the nationwide sitting-MLA index, ranked high to low.</p></div></div><div className="stateGrid"><div className="indiaPanel"><div className="mapType">INDIA</div><h3>Where political wealth concentrates</h3><p>The southern and western states dominate the top of the current declared-asset index.</p><div className="mapBlocks">{stateStats.map((s,i)=><button key={s.state} className={`mapBlock b${i}`} onClick={()=>{setState(s.state);document.getElementById("explore")?.scrollIntoView({behavior:"smooth"})}}><b>{s.state.slice(0,3).toUpperCase()}</b><span>{fmt(s.avg)}</span></button>)}</div><small>Tap a state block to filter the wealth table</small></div><div className="stateRanks">{stateStats.map((s,i)=><div key={s.state}><span>{String(i+1).padStart(2,"0")}</span><div><b>{s.state}</b><small>{s.count} indexed leaders</small></div><div className="rankBar"><i style={{width:`${(s.avg/stateStats[0].avg)*100}%`}}></i></div><strong>{fmt(s.avg)}</strong></div>)}</div></div></section>

    <section id="analysis" className="analysis section"><div className="sectionHead"><div><span className="sectionNo">05 / ANALYSIS</span><h2>Signals in the declarations</h2></div></div><div className="storyGrid"><article className="leadStory"><span>WEALTH VELOCITY</span><h3>The affidavit-to-affidavit jump</h3><div className="storyNumber">{medianGrowth}<sup>%</sup></div><p>Median declared-asset change across {history?.meta.comparisonCount.toLocaleString("en-IN")??"the indexed"} historical comparisons.</p><div className="miniLegend"><i></i> Growth between consecutive affidavits</div></article><article><span>PARTY LENS</span><h3>Average assets by party</h3>{Object.entries(parties).slice(0,6).map(([p,c])=>{const d=allData.filter(m=>m.party===p);const av=d.length?d.reduce((a,b)=>a+b.assets,0)/d.length:0;return <div className="partyBar" key={p}><b>{p}</b><div><i style={{width:`${Math.min(100,av/8)}%`,background:c}}></i></div><span>{d.length?fmt(av):"—"}</span></div>})}</article><article className="question"><span>WATCH THIS</span><h3>Growth ≠ wrongdoing</h3><p>Asset changes can reflect inheritance, business income, valuation changes, spouse holdings, debt, or corrections. The numbers are leads for scrutiny—not verdicts.</p><a href="#method">Read our methodology →</a></article></div></section>

    <section id="method" className="method"><div><span className="sectionNo">SOURCE NOTE</span><h2>Public records,<br/>carefully connected.</h2></div><div><p>NetaWorth hosts and organizes the usable database itself. Every figure originates in a candidate&apos;s self-sworn election affidavit; MyNeta and ECI links remain as citations for verification. “Net worth” here means declared total assets minus declared liabilities, not independently audited market wealth.</p><div className="methodLinks"><a href="https://affidavit.eci.gov.in/" target="_blank">Election Commission affidavit portal ↗</a><a href="https://adrindia.org/sites/default/files/All_India_Sitting_MLAs_Report_2025_English.pdf" target="_blank">ADR national MLA report ↗</a><a href="https://www.myneta.info/" target="_blank">MyNeta source archive ↗</a></div><small>The internal database contains 153,470 candidate records from all 121 discovered state-election folders, with every source page decoded and coverage-checked. It also contains 4,092 sitting MLAs, 13,916 historical winners and 7,723 asset comparisons spanning 2004—2025. Exact-name histories are useful leads, while verified growth timelines require state, election year, normalized name and exact asset values to agree. Constituency labels remain as published and may reflect delimitation or spelling changes. Check the cited primary affidavit before investigative or legal use.</small></div></section>
    <footer><div className="brand"><span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span></div><p>Making political money legible.</p><div>Data · Methodology · Corrections · About</div><small>Built in the public interest · India · 2026</small></footer>
  </main>
}
