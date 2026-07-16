#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const elections = [
  ["Andhra Pradesh",2024,"AndhraPradesh2024"],["Arunachal Pradesh",2024,"ArunachalPradesh2024"],["Assam",2021,"Assam2021"],
  ["Bihar",2020,"Bihar2020"],["Chhattisgarh",2023,"Chhattisgarh2023"],["Delhi",2025,"Delhi2025"],["Goa",2022,"Goa2022"],
  ["Gujarat",2022,"Gujarat2022"],["Haryana",2024,"Haryana2024"],["Himachal Pradesh",2022,"HimachalPradesh2022"],
  ["Jammu Kashmir",2024,"JammuKashmir2024"],["Jharkhand",2024,"Jharkhand2024"],["Karnataka",2023,"Karnataka2023"],
  ["Kerala",2021,"Kerala2021"],["Madhya Pradesh",2023,"MadhyaPradesh2023"],["Maharashtra",2024,"Maharashtra2024"],
  ["Manipur",2022,"Manipur2022"],["Meghalaya",2023,"Meghalaya2023"],["Mizoram",2023,"Mizoram2023"],
  ["Nagaland",2023,"Nagaland2023"],["Odisha",2024,"Odisha2024"],["Puducherry",2021,"Puducherry2021"],
  ["Punjab",2022,"Punjab2022"],["Rajasthan",2023,"Rajasthan2023"],["Sikkim",2024,"Sikkim2024"],
  ["Tamil Nadu",2021,"TamilNadu2021"],["Telangana",2023,"Telangana2023"],["Tripura",2023,"Tripura2023"],
  ["Uttar Pradesh",2022,"UttarPradesh2022"],["Uttarakhand",2022,"Uttarakhand2022"],["West Bengal",2021,"WestBengal2021"],
];
const decode=(s)=>s.replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replaceAll("&nbsp;"," ").replaceAll("&amp;","&").replaceAll("&#039;","'").replaceAll("&quot;",'"').replace(/\s+/g," ").trim();
const money=(s)=>{const m=s.match(/[0-9][0-9,]*/);return m?Number(m[0].replaceAll(",","")):0};
const normalize=(s)=>s.normalize("NFKD").replace(/[.']/g,"").replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase();

async function fetchElection([state,currentYear,folder]){
  const url=`https://www.myneta.info/${folder}/index.php?action=recontestAssetsComparison`;
  const response=await fetch(url,{headers:{"user-agent":"NetaWorth public-interest data index; source attribution included"}});
  if(!response.ok) return {state,currentYear,folder,url,status:response.status,comparisons:[]};
  const html=await response.text();
  const years=[...html.matchAll(/Total Assets in [^<]*?\b(20\d{2})\b/gi)].map(m=>Number(m[1]));
  const previousYear=years.find(y=>y!==currentYear)??null;
  const comparisons=[];
  for(const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const raw=match[1];
    const cells=[...raw.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
    if(cells.length<6||!/^\d+$/.test(decode(cells[0]))) continue;
    const label=decode(cells[1]); const partyMatch=label.match(/^(.*) \(([^()]*)\)$/);
    if(!partyMatch) continue;
    const href=(cells[1].match(/href=(?:["']?)([^\s"'>]+)/i)?.[1]??url).replaceAll("&amp;","&");
    const previousFolder=href.match(/[?&]myneta_folder2=([^&]+)/i)?.[1]??null;
    comparisons.push({
      state,currentYear,previousYear,rank:Number(decode(cells[0])),name:partyMatch[1].trim(),normalizedName:normalize(partyMatch[1]),
      party:partyMatch[2].trim(),currentAssets:money(cells[2]),previousAssets:money(cells[3]),assetChange:money(cells[4]),
      percentChange:Number((decode(cells[5]).match(/-?[0-9.]+/)??[0])[0]),remarks:decode(cells[6]??""),comparisonUrl:href,previousFolder,
    });
  }
  return {state,currentYear,previousYear,folder,url,status:response.status,comparisons,sha256:createHash("sha256").update(html).digest("hex")};
}

const results=[], queue=[...elections], processed=new Set();
while(queue.length){
  const batch=[];
  while(queue.length&&batch.length<5){const item=queue.shift();if(!processed.has(item[2].toLowerCase())){processed.add(item[2].toLowerCase());batch.push(item)}}
  if(!batch.length) continue;
  const fetched=await Promise.all(batch.map(fetchElection)); results.push(...fetched);
  for(const result of fetched){
    const next=result.comparisons.find(c=>c.previousFolder)?.previousFolder;
    if(next&&result.previousYear>=2004&&!processed.has(next.toLowerCase())) queue.push([result.state,result.previousYear,next]);
  }
}
const snapshot=JSON.parse(await readFile("public/data/adr-sitting-mlas-2025.json","utf8"));
const current=new Map(snapshot.records.map(r=>[`${r.state}|${normalize(r.name)}`,r]));
const comparisons=results.flatMap(r=>r.comparisons).map(c=>{
  const match=current.get(`${c.state}|${c.normalizedName}`);
  const exact=Boolean(match&&match.electionYear===c.currentYear&&match.assets===c.currentAssets);
  return {...c,currentSnapshotRank:exact?match.rank:null,currentConstituency:exact?match.constituency:null,matchedToSnapshot:exact};
});
const matchedRanks=new Set(comparisons.filter(x=>x.currentSnapshotRank).map(x=>x.currentSnapshotRank));
const years=comparisons.flatMap(x=>[x.previousYear,x.currentYear]);
const payload={meta:{title:"MyNeta re-contesting candidate asset comparisons",source:"Association for Democratic Reforms / MyNeta",retrievedAt:new Date().toISOString(),statesRequested:elections.length,electionPagesChecked:results.length,electionPagesAvailable:results.filter(r=>r.comparisons.length).length,comparisonCount:comparisons.length,snapshotMatchCount:matchedRanks.size,firstYear:Math.min(...years),latestYear:Math.max(...years),note:"Each comparison is published by MyNeta from self-sworn election affidavits. Remarks flag identity differences noted by the source."},elections:results.map(({comparisons,...r})=>({...r,comparisonCount:comparisons.length})),comparisons};
await writeFile("public/data/adr-recontest-history.json",JSON.stringify(payload)+"\n");
console.log(JSON.stringify(payload.meta,null,2));
