"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { availableMoney, declaredNetWorth, formatRupees as money, type MoneyStatus } from "../../lib/format-money";
import { buildVerifiedAssetHistory, type AssetComparison } from "../../lib/profile-history";
import { publicUrl } from "../../lib/public-url";

type Candidate = {
  candidateId:number; name:string; normalizedName:string; constituency:string; party:string;
  criminalCases:number; education:string; assets:number|null; assetsStatus?:MoneyStatus;
  liabilities:number|null; liabilitiesStatus?:MoneyStatus; electionYear?:number;
  electionDate?:string|null; electionType?:string; baseConstituency?:string; candidateUrl:string;
};
type Election = { state:string; electionYear:number; electionFolder:string; file:string };
type CandidateIndex = { states:{state:string;elections:Election[]}[] };
type CandidateShard = { meta:Election; records:Candidate[] };
type Current = { rank:number;state:string;electionYear:number;constituency:string;name:string;party:string;age:number|null;gender:string;assets:number;liabilities:number;criminalCases:number;seriousCriminalCases:number;education:string;panDeclared:boolean };
type Profile = {
  kind:"candidate"|"current"; name:string;state:string;year:number;constituency:string;party:string;
  assets:number|null;liabilities:number|null;criminalCases:number;education:string;sourceUrl:string;
  electionDate?:string|null;electionType?:string;
  age?:number|null;gender?:string;seriousCases?:number;panDeclared?:boolean;recordId:string;
};
type HistoryPoint = { year:number;assets:number|null;sourceUrl:string };

const ADR_REPORT_URL="https://adrindia.org/sites/default/files/All_India_Sitting_MLAs_Report_2025_English.pdf";

const initials=(name:string)=>name.split(/\s+/).filter(x=>x.length>1).slice(0,2).map(x=>x[0]).join("");
async function fetchJson<T>(url:string,signal:AbortSignal):Promise<T>{
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error(`Record request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export default function PersonPage(){
  const [profile,setProfile]=useState<Profile|null>(null);
  const [history,setHistory]=useState<HistoryPoint[]>([]);
  const [error,setError]=useState("");

  useEffect(()=>{
    const controller=new AbortController();
    const load=async()=>{
      const params=new URLSearchParams(window.location.search);
      const type=params.get("type");
      if(type==="candidate"){
        const folder=params.get("election")??"";
        const id=Number(params.get("id"));
        const index=await fetchJson<CandidateIndex>(publicUrl("/data/candidates/index.json"),controller.signal);
        const election=index.states.flatMap(s=>s.elections).find(e=>e.electionFolder.toLowerCase()===folder.toLowerCase());
        if(!election)throw new Error("Election record not found");
        const shard=await fetchJson<CandidateShard>(publicUrl(election.file),controller.signal);
        const person=shard.records.find(r=>r.candidateId===id);
        if(!person)throw new Error("Candidate record not found");
        const recordYear=person.electionYear??election.electionYear;
        const assets=availableMoney(person.assets,person.assetsStatus);
        const liabilities=availableMoney(person.liabilities,person.liabilitiesStatus);
        setProfile({kind:"candidate",name:person.name,state:election.state,year:recordYear,constituency:person.baseConstituency||person.constituency,party:person.party,assets,liabilities,criminalCases:person.criminalCases,education:person.education,sourceUrl:person.candidateUrl,electionDate:person.electionDate,electionType:person.electionType,recordId:`${election.electionFolder}/${person.candidateId}`});
        setHistory([{year:recordYear,assets,sourceUrl:person.candidateUrl}]);
        return;
      }

      const rank=Number(params.get("rank"));
      const chamber=params.get("chamber")||"assembly";
      if(chamber==="lok_sabha"){
        const snapshot=await fetchJson<{meta:{sourceUrl:string};records:(Current&{electionFolder?:string;candidateId?:number;candidateUrl?:string;electionYear?:number})[]}>(publicUrl("/data/lok-sabha-sitting-mps.json"),controller.signal);
        const person=snapshot.records.find(r=>r.rank===rank);
        if(!person)throw new Error("Lok Sabha record not found");
        if(person.electionFolder&&person.candidateId){
          window.location.replace(publicUrl(`/person?type=candidate&election=${encodeURIComponent(person.electionFolder)}&id=${person.candidateId}`));
          return;
        }
        setProfile({kind:"current",name:person.name,state:person.state,year:person.electionYear||2024,constituency:person.constituency,party:person.party,assets:person.assets,liabilities:person.liabilities,criminalCases:person.criminalCases,education:person.education,sourceUrl:person.candidateUrl||snapshot.meta.sourceUrl,age:person.age,gender:person.gender,seriousCases:person.seriousCriminalCases,panDeclared:person.panDeclared,recordId:`LS-${person.rank}`});
        setHistory([{year:person.electionYear||2024,assets:person.assets,sourceUrl:person.candidateUrl||snapshot.meta.sourceUrl}]);
        return;
      }
      if(chamber==="rajya_sabha"){
        const snapshot=await fetchJson<{meta:{sourceUrl:string};records:(Current&{electionYear?:number|null})[]}>(publicUrl("/data/rajya-sabha-sitting-mps.json"),controller.signal);
        const person=snapshot.records.find(r=>r.rank===rank);
        if(!person)throw new Error("Rajya Sabha record not found");
        const year=person.electionYear||2026;
        setProfile({kind:"current",name:person.name,state:person.state,year,constituency:person.constituency||"Rajya Sabha",party:person.party,assets:person.assets,liabilities:person.liabilities,criminalCases:person.criminalCases,education:person.education,sourceUrl:snapshot.meta.sourceUrl,age:person.age,gender:person.gender,seriousCases:person.seriousCriminalCases,panDeclared:person.panDeclared,recordId:`RS-${person.rank}`});
        setHistory([{year,assets:person.assets,sourceUrl:snapshot.meta.sourceUrl}]);
        return;
      }
      const [snapshot,comparisons]=await Promise.all([
        fetchJson<{records:Current[]}>(publicUrl("/data/adr-sitting-mlas-2025.json"),controller.signal),
        fetchJson<{comparisons:AssetComparison[]}>(publicUrl("/data/adr-recontest-history.json"),controller.signal),
      ]);
      const person=snapshot.records.find(r=>r.rank===rank);
      if(!person)throw new Error("Representative record not found");
      const verifiedHistory=buildVerifiedAssetHistory({state:person.state,electionYear:person.electionYear,name:person.name,assets:person.assets,sourceUrl:ADR_REPORT_URL},comparisons.comparisons);
      setProfile({kind:"current",name:person.name,state:person.state,year:person.electionYear,constituency:person.constituency,party:person.party,assets:person.assets,liabilities:person.liabilities,criminalCases:person.criminalCases,education:person.education,sourceUrl:verifiedHistory.at(-1)?.sourceUrl||ADR_REPORT_URL,age:person.age,gender:person.gender,seriousCases:person.seriousCriminalCases,panDeclared:person.panDeclared,recordId:`ADR-2025-${person.rank}`});
      setHistory(verifiedHistory);
    };
    void load().catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:"Record unavailable")});
    return ()=>controller.abort();
  },[]);

  const maxAssets=useMemo(()=>Math.max(1,...history.flatMap(point=>point.assets===null?[]:[point.assets])),[history]);
  const first=history[0]?.assets;
  const growth=typeof first==="number"&&first>0&&profile?.kind==="current"&&typeof profile.assets==="number"&&history.length>1?((profile.assets-first)/first)*100:null;
  const netWorth=profile?declaredNetWorth(profile.assets,profile.liabilities):null;

  return <><a className="skipLink" href="#main-content">Skip to public record</a><main className="personPage" id="main-content">
    <header className="topbar personNav"><Link className="brand" href="/"><span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span></Link><nav aria-label="Primary" className="mapPageNav"><Link href="/">Database</Link><Link href="/map">Map</Link><Link href="/about">About</Link></nav></header>
    {!profile&&!error&&<section className="personLoading"><i></i><p>Opening the public record…</p></section>}
    {error&&<section className="personLoading"><h1>Record unavailable</h1><p>{error}</p><Link href="/">Return to NetaWorth</Link></section>}
    {profile&&<>
      <section className="personHero">
        <div className="personCrumb">PUBLIC RECORD / {profile.state.toUpperCase()} / {profile.year}</div>
        <div className="personHeroGrid"><div className="personMonogram">{initials(profile.name)}</div><div><span className="recordType">{profile.kind==="current"?(profile.recordId.startsWith("LS")?"SITTING LOK SABHA PROFILE":profile.recordId.startsWith("RS")?"SITTING RAJYA SABHA PROFILE":"SITTING MLA PROFILE"):"CANDIDATE AFFIDAVIT PROFILE"}</span><h1>{profile.name}</h1><p><b>{profile.party}</b> · {profile.constituency}, {profile.state}</p></div><div className="personNet"><small>ASSETS LESS LIABILITIES</small><b>{money(netWorth)}</b><span>{netWorth===null?"Requires both declared values":"Based on declared values"}</span></div></div>
      </section>
      <section className="personContent">
        <div className="personMain">
          <div className="personMetrics"><article><small>DECLARED ASSETS</small><b>{money(profile.assets)}</b></article><article><small>LIABILITIES</small><b>{money(profile.liabilities)}</b></article><article><small>CRIMINAL CASES</small><b>{profile.criminalCases}</b></article>{growth!==null&&<article><small>CHANGE SINCE FIRST MATCH</small><b className={growth>=0?"positive":"negative"}>{growth>=0?"+":""}{growth.toFixed(1)}%</b></article>}</div>
          <article className="personTimeline"><header><div><span>DECLARATION TRAIL</span><h2>Declared assets over time</h2></div><small>₹ values are affidavit declarations</small></header><div className="personBars">{history.map(point=><a href={point.sourceUrl} target="_blank" rel="noreferrer" className="personBar" key={`${point.year}-${point.assets}`}><b>{money(point.assets)}</b><div>{point.assets===null?<span aria-label="Declared assets unavailable">—</span>:<i style={{height:`${Math.max(12,(point.assets/maxAssets)*220)}px`}}></i>}</div><time>{point.year}</time><small>{point.year===profile.year?<>{profile.party}<br/>{profile.constituency}</>:<>Exact-asset<br/>linked affidavit</>}</small></a>)}</div>{history.length===1&&<p className="singleRecord">{profile.kind==="candidate"?"Only the selected candidate affidavit is shown; same-name records are not combined.":"No earlier exact-asset comparison is connected to this record."}</p>}</article>
        </div>
        <aside className="personFacts"><span>RECORD DETAILS</span><dl><div><dt>Election year</dt><dd>{profile.year}</dd></div>{profile.electionDate&&<div><dt>Election date</dt><dd><time dateTime={profile.electionDate}>{profile.electionDate}</time></dd></div>}{profile.electionType&&<div><dt>Election type</dt><dd>{profile.electionType}</dd></div>}<div><dt>State / UT</dt><dd>{profile.state}</dd></div><div><dt>Constituency</dt><dd>{profile.constituency}</dd></div><div><dt>Party</dt><dd>{profile.party}</dd></div><div><dt>Education</dt><dd>{profile.education||"Not declared"}</dd></div>{profile.kind==="current"&&<><div><dt>Age / gender</dt><dd>{profile.age??"—"} / {profile.gender||"—"}</dd></div><div><dt>Serious cases</dt><dd>{profile.seriousCases??0}</dd></div><div><dt>PAN declared</dt><dd>{profile.panDeclared?"Yes":"No"}</dd></div></>}<div><dt>NetaWorth record</dt><dd>{profile.recordId}</dd></div></dl><a href={profile.sourceUrl} target="_blank" rel="noreferrer">{profile.kind==="current"?"Open national source report ↗":"Verify source affidavit ↗"}</a><p>These are self-declared figures, not independently audited market wealth. {profile.kind==="current"?"History is connected only through contiguous comparisons with exact name, year, state, and asset matches.":"This profile shows only the selected affidavit; same-name records from other elections are not treated as the same person."}</p></aside>
      </section>
    </>}
  </main></>;
}
