"use client";

import { useEffect, useMemo, useState } from "react";

type Candidate = {
  candidateId:number; name:string; normalizedName:string; constituency:string; party:string;
  criminalCases:number; education:string; assets:number; liabilities:number; candidateUrl:string;
};
type Election = { state:string; electionYear:number; electionFolder:string; file:string };
type CandidateIndex = { states:{state:string;elections:Election[]}[] };
type CandidateShard = { meta:Election; records:Candidate[] };
type Current = { rank:number;state:string;electionYear:number;constituency:string;name:string;party:string;age:number|null;gender:string;assets:number;liabilities:number;criminalCases:number;seriousCriminalCases:number;education:string;panDeclared:boolean };
type Comparison = { state:string;currentYear:number;previousYear:number;name:string;normalizedName:string;party:string;currentAssets:number;previousAssets:number;percentChange:number;comparisonUrl:string };
type Profile = {
  kind:"candidate"|"current"; name:string;state:string;year:number;constituency:string;party:string;
  assets:number;liabilities:number;criminalCases:number;education:string;sourceUrl:string;
  age?:number|null;gender?:string;seriousCases?:number;panDeclared?:boolean;recordId:string;
};
type HistoryPoint = { year:number;assets:number;liabilities:number;party:string;constituency:string;href?:string };

const money=(rupees:number)=>{
  const crore=rupees/1e7;
  if(crore>=1000)return `₹${(crore/1000).toFixed(2)}k Cr`;
  if(crore>=1)return `₹${crore.toFixed(crore<10?1:0)} Cr`;
  return `₹${Math.round(rupees/1e5)} L`;
};
const initials=(name:string)=>name.split(/\s+/).filter(x=>x.length>1).slice(0,2).map(x=>x[0]).join("");

export default function PersonPage(){
  const [profile,setProfile]=useState<Profile|null>(null);
  const [history,setHistory]=useState<HistoryPoint[]>([]);
  const [error,setError]=useState("");

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const type=params.get("type");
    if(type==="candidate"){
      const folder=params.get("election")??"";
      const id=Number(params.get("id"));
      fetch("/data/candidates/index.json").then(r=>r.json()).then(async(index:CandidateIndex)=>{
        const election=index.states.flatMap(s=>s.elections).find(e=>e.electionFolder.toLowerCase()===folder.toLowerCase());
        if(!election)throw new Error("Election record not found");
        const shard:CandidateShard=await fetch(election.file).then(r=>r.json());
        const person=shard.records.find(r=>r.candidateId===id);
        if(!person)throw new Error("Candidate record not found");
        setProfile({kind:"candidate",name:person.name,state:election.state,year:election.electionYear,constituency:person.constituency,party:person.party,assets:person.assets,liabilities:person.liabilities,criminalCases:person.criminalCases,education:person.education,sourceUrl:person.candidateUrl,recordId:`${election.electionFolder}/${person.candidateId}`});
        const elections=index.states.find(s=>s.state===election.state)?.elections??[];
        const matches=(await Promise.all(elections.map(async e=>{
          const data:CandidateShard=await fetch(e.file).then(r=>r.json());
          return data.records.filter(r=>r.normalizedName===person.normalizedName).map(r=>({year:e.electionYear,assets:r.assets,liabilities:r.liabilities,party:r.party,constituency:r.constituency,href:`/person?type=candidate&election=${encodeURIComponent(e.electionFolder)}&id=${r.candidateId}`}));
        }))).flat().sort((a,b)=>a.year-b.year);
        setHistory(matches);
      }).catch(e=>setError(e.message));
      return;
    }

    const rank=Number(params.get("rank"));
    Promise.all([fetch("/data/adr-sitting-mlas-2025.json").then(r=>r.json()),fetch("/data/adr-recontest-history.json").then(r=>r.json())]).then(([snapshot,comparisons]:[{records:Current[]},{comparisons:Comparison[]}])=>{
      const person=snapshot.records.find(r=>r.rank===rank);
      if(!person)throw new Error("Representative record not found");
      const related=comparisons.comparisons.filter(c=>c.state===person.state&&c.normalizedName===person.name.normalize("NFKD").replace(/[.']/g,"").replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase()).sort((a,b)=>a.currentYear-b.currentYear);
      const points=new Map<number,HistoryPoint>();
      for(const row of related){points.set(row.previousYear,{year:row.previousYear,assets:row.previousAssets,liabilities:0,party:row.party,constituency:person.constituency});points.set(row.currentYear,{year:row.currentYear,assets:row.currentAssets,liabilities:row.currentYear===person.electionYear?person.liabilities:0,party:row.party,constituency:person.constituency})}
      points.set(person.electionYear,{year:person.electionYear,assets:person.assets,liabilities:person.liabilities,party:person.party,constituency:person.constituency});
      setProfile({kind:"current",name:person.name,state:person.state,year:person.electionYear,constituency:person.constituency,party:person.party,assets:person.assets,liabilities:person.liabilities,criminalCases:person.criminalCases,education:person.education,sourceUrl:related.at(-1)?.comparisonUrl||"https://adrindia.org/sites/default/files/All_India_Sitting_MLAs_Report_2025_English.pdf",age:person.age,gender:person.gender,seriousCases:person.seriousCriminalCases,panDeclared:person.panDeclared,recordId:`ADR-2025-${person.rank}`});
      setHistory([...points.values()].sort((a,b)=>a.year-b.year));
    }).catch(e=>setError(e.message));
  },[]);

  const maxAssets=useMemo(()=>Math.max(1,...history.map(h=>h.assets)),[history]);
  const first=history[0]?.assets;
  const growth=first&&profile?((profile.assets-first)/first)*100:null;

  return <main className="personPage">
    <header className="topbar personNav"><a className="brand" href="/"><span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span></a><a className="backLink" href="/">← Back to database</a></header>
    {!profile&&!error&&<section className="personLoading"><i></i><p>Opening the public record…</p></section>}
    {error&&<section className="personLoading"><h1>Record unavailable</h1><p>{error}</p><a href="/">Return to NetaWorth</a></section>}
    {profile&&<>
      <section className="personHero">
        <div className="personCrumb">PUBLIC RECORD / {profile.state.toUpperCase()} / {profile.year}</div>
        <div className="personHeroGrid"><div className="personMonogram">{initials(profile.name)}</div><div><span className="recordType">{profile.kind==="current"?"SITTING MLA PROFILE":"CANDIDATE AFFIDAVIT PROFILE"}</span><h1>{profile.name}</h1><p><b>{profile.party}</b> · {profile.constituency}, {profile.state}</p></div><div className="personNet"><small>ASSETS LESS LIABILITIES</small><b>{money(profile.assets-profile.liabilities)}</b><span>Based on declared values</span></div></div>
      </section>
      <section className="personContent">
        <div className="personMain">
          <div className="personMetrics"><article><small>DECLARED ASSETS</small><b>{money(profile.assets)}</b></article><article><small>LIABILITIES</small><b>{money(profile.liabilities)}</b></article><article><small>CRIMINAL CASES</small><b>{profile.criminalCases}</b></article>{growth!==null&&<article><small>CHANGE SINCE FIRST MATCH</small><b className={growth>=0?"positive":"negative"}>{growth>=0?"+":""}{growth.toFixed(1)}%</b></article>}</div>
          <article className="personTimeline"><header><div><span>DECLARATION TRAIL</span><h2>Declared assets over time</h2></div><small>₹ values are affidavit declarations</small></header><div className="personBars">{history.map(point=><a href={point.href} className="personBar" key={`${point.year}-${point.constituency}`}><b>{money(point.assets)}</b><div><i style={{height:`${Math.max(12,(point.assets/maxAssets)*220)}px`}}></i></div><time>{point.year}</time><small>{point.party}<br/>{point.constituency}</small></a>)}</div>{history.length===1&&<p className="singleRecord">Only one matching election affidavit is currently connected to this identity.</p>}</article>
        </div>
        <aside className="personFacts"><span>RECORD DETAILS</span><dl><div><dt>Election year</dt><dd>{profile.year}</dd></div><div><dt>State / UT</dt><dd>{profile.state}</dd></div><div><dt>Constituency</dt><dd>{profile.constituency}</dd></div><div><dt>Party</dt><dd>{profile.party}</dd></div><div><dt>Education</dt><dd>{profile.education||"Not declared"}</dd></div>{profile.kind==="current"&&<><div><dt>Age / gender</dt><dd>{profile.age??"—"} / {profile.gender||"—"}</dd></div><div><dt>Serious cases</dt><dd>{profile.seriousCases??0}</dd></div><div><dt>PAN declared</dt><dd>{profile.panDeclared?"Yes":"No"}</dd></div></>}<div><dt>NetaWorth record</dt><dd>{profile.recordId}</dd></div></dl><a href={profile.sourceUrl} target="_blank">Verify source affidavit ↗</a><p>These are self-declared figures, not independently audited market wealth. A matching name across elections is a research lead and may require manual identity verification.</p></aside>
      </section>
    </>}
  </main>;
}
