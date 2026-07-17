#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { deobfuscateMynetaHtml } from "./lib/myneta-html.mjs";

const history=JSON.parse(await readFile("public/data/adr-recontest-history.json","utf8"));
const elections=[...new Map(history.elections.map(e=>[e.folder.toLowerCase(),{state:e.state,year:e.currentYear,folder:e.folder}])).values()].sort((a,b)=>a.state.localeCompare(b.state)||a.year-b.year);
const outputDir="public/data/candidates";
await mkdir(outputDir,{recursive:true});

const decode=(s)=>s.replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replaceAll("&nbsp;"," ").replaceAll("&amp;","&").replaceAll("&#039;","'").replaceAll("&quot;",'"').replace(/\s+/g," ").trim();
const money=(s)=>{const m=decode(s).match(/(?:Rs\s*)?([0-9][0-9,]*)/i);return m?Number(m[1].replaceAll(",","")):0};
const normalize=(s)=>s.normalize("NFKD").replace(/[.']/g,"").replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase();
const urlFor=(folder,page)=>`https://www.myneta.info/${folder}/index.php?action=summary&page=${page}&sort=candidate&subAction=candidates_analyzed`;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function get(task,attempt=1){
  const url=urlFor(task.folder,task.page);
  try{
    const response=await fetch(url,{headers:{"user-agent":"NetaWorth public-interest data index; source attribution included"}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const html=await response.text(); return {...task,url,status:response.status,html,sha256:createHash("sha256").update(html).digest("hex")};
  }catch(error){if(attempt>=3)throw error;await sleep(attempt*1000);return get(task,attempt+1)}
}
async function batches(tasks,size=8){const out=[];for(let i=0;i<tasks.length;i+=size)out.push(...await Promise.all(tasks.slice(i,i+size).map(t=>get(t))));return out}
function parsePage(page){
  const rows=[],html=deobfuscateMynetaHtml(page.html);
  for(const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
    if(cells.length<8||!/^\d+$/.test(decode(cells[0])))continue;
    const candidateId=Number(cells[1].match(/candidate_id=(\d+)/i)?.[1]??0),name=decode(cells[1]),constituency=decode(cells[2]);
    if(!candidateId||!name||!constituency)continue;
    rows.push({ordinal:Number(decode(cells[0])),candidateId,name,normalizedName:normalize(name),constituency,normalizedConstituency:normalize(constituency),party:decode(cells[3]),criminalCases:Number((decode(cells[4]).match(/\d+/)??[0])[0]),education:decode(cells[5]),assets:money(cells[6]),liabilities:money(cells[7]),candidateUrl:`https://www.myneta.info/${page.folder}/candidate.php?candidate_id=${candidateId}`});
  }
  return rows;
}
async function exists(file){try{await access(file);return true}catch{return false}}

async function processElection(election,position){
  const file=`${outputDir}/${election.folder.toLowerCase()}.json`;
  if(await exists(file)){
    const cached=JSON.parse(await readFile(file,"utf8"));if(cached.meta.parserVersion===3){console.log(`[${position+1}/${elections.length}] cached ${election.state} ${election.year}: ${cached.meta.candidateCount}`);return cached.meta}
  }
  const first=await get({...election,page:1});
  const pageCount=Number(first.html.match(/Showing page\s*<b>\d+<\/b>\s*of\s*<strong>(\d+)<\/strong>/i)?.[1]??(parsePage(first).length?1:0));
  const pages=[first,...await batches(Array.from({length:Math.max(0,pageCount-1)},(_,i)=>({...election,page:i+2})))];
  const records=[],seen=new Set();
  for(const page of pages)for(const row of parsePage(page)){if(!seen.has(row.candidateId)){seen.add(row.candidateId);records.push(row)}}
  records.sort((a,b)=>a.constituency.localeCompare(b.constituency)||a.name.localeCompare(b.name));
  const expectedFromOrdinals=Math.max(0,...records.map(r=>r.ordinal));
  const meta={parserVersion:3,state:election.state,electionYear:election.year,electionFolder:election.folder,candidateCount:records.length,expectedFromOrdinals,complete:records.length===expectedFromOrdinals,constituencyCount:new Set(records.map(r=>r.normalizedConstituency)).size,pageCount,sourceUrl:urlFor(election.folder,1),sourceSha256:createHash("sha256").update(pages.map(p=>p.sha256).join("|")).digest("hex"),retrievedAt:new Date().toISOString(),file:`/data/candidates/${election.folder.toLowerCase()}.json`};
  await writeFile(file,JSON.stringify({meta,records})+"\n");console.log(`[${position+1}/${elections.length}] fetched ${election.state} ${election.year}: ${records.length} candidates / ${pageCount} pages`);return meta;
}
let next=0;const manifest=[];
await Promise.all(Array.from({length:4},async()=>{while(true){const position=next++;if(position>=elections.length)return;manifest.push(await processElection(elections[position],position))}}));
manifest.sort((a,b)=>a.state.localeCompare(b.state)||a.electionYear-b.electionYear);
const total=manifest.reduce((sum,e)=>sum+e.candidateCount,0);
const states=[...new Set(manifest.map(e=>e.state))].sort();
const index={meta:{title:"India state assembly candidate-affidavit archive",source:"Association for Democratic Reforms / MyNeta",retrievedAt:new Date().toISOString(),parserVersion:3,electionFolders:manifest.length,completeElectionFolders:manifest.filter(e=>e.complete).length,candidateRecords:total,states:states.length,firstYear:Math.min(...manifest.map(e=>e.electionYear)),latestYear:Math.max(...manifest.map(e=>e.electionYear)),note:"Every record is from a MyNeta candidate summary derived from a self-sworn election affidavit. JavaScript-obfuscated rows are decoded in a sandbox; alphabetical pagination avoids unstable ties in asset sorting. Election shards load on demand."},states:states.map(state=>({state,elections:manifest.filter(e=>e.state===state).sort((a,b)=>b.electionYear-a.electionYear)}))};
await writeFile(`${outputDir}/index.json`,JSON.stringify(index)+"\n");
console.log(JSON.stringify(index.meta,null,2));
