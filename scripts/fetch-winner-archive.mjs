#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { deobfuscateMynetaHtml } from "./lib/myneta-html.mjs";

const history=JSON.parse(await readFile("public/data/adr-recontest-history.json","utf8"));
const elections=[...new Map(history.elections.map(e=>[e.folder.toLowerCase(),{state:e.state,year:e.currentYear,folder:e.folder}])).values()].sort((a,b)=>a.state.localeCompare(b.state)||a.year-b.year);
const decode=(s)=>s.replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replaceAll("&nbsp;"," ").replaceAll("&amp;","&").replaceAll("&#039;","'").replaceAll("&quot;",'"').replace(/\s+/g," ").trim();
const money=(s)=>{const plain=decode(s);const m=plain.match(/(?:Rs\s*)?([0-9][0-9,]*)/i);return m?Number(m[1].replaceAll(",","")):0};
const normalize=(s)=>s.normalize("NFKD").replace(/[.']/g,"").replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase();
const urlFor=(folder,page)=>`https://www.myneta.info/${folder}/index.php?action=summary&page=${page}&sort=asset&subAction=winner_analyzed`;

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function get(task,attempt=1){
  const url=urlFor(task.folder,task.page);
  try{
    const response=await fetch(url,{headers:{"user-agent":"NetaWorth public-interest data index; source attribution included"}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const html=await response.text();
    return {...task,url,status:response.status,html,sha256:createHash("sha256").update(html).digest("hex")};
  }catch(error){
    if(attempt>=3)throw new Error(`Failed to fetch ${url} after ${attempt} attempts`,{cause:error});
    await sleep(attempt*1000);
    return get(task,attempt+1);
  }
}
async function batches(tasks,size=4){const out=[];for(let i=0;i<tasks.length;i+=size)out.push(...await Promise.all(tasks.slice(i,i+size).map(task=>get(task))));return out}
function parsePage(page){
  const rows=[],html=deobfuscateMynetaHtml(page.html);
  for(const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
    if(cells.length<8||!/^\d+$/.test(decode(cells[0])))continue;
    const candidateId=Number(cells[1].match(/candidate_id=(\d+)/i)?.[1]??0); const name=decode(cells[1]);
    if(!candidateId||!name)continue;
    rows.push({state:page.state,electionYear:page.year,electionFolder:page.folder,rankByAssets:Number(decode(cells[0])),candidateId,name,normalizedName:normalize(name),constituency:decode(cells[2]),normalizedConstituency:normalize(decode(cells[2])),party:decode(cells[3]),criminalCases:Number((decode(cells[4]).match(/\d+/)??[0])[0]),education:decode(cells[5]),assets:money(cells[6]),liabilities:money(cells[7]),candidateUrl:`https://www.myneta.info/${page.folder}/candidate.php?candidate_id=${candidateId}`});
  }
  return rows;
}

const firstPages=await batches(elections.map(e=>({...e,page:1})));
const remaining=[];
for(const page of firstPages){
  const max=Number(page.html.match(/Showing page\s*<b>\d+<\/b>\s*of\s*<strong>(\d+)<\/strong>/i)?.[1]??(parsePage(page).length?1:0));
  for(let n=2;n<=max;n++)remaining.push({state:page.state,year:page.year,folder:page.folder,page:n});
}
const pages=[...firstPages,...await batches(remaining)];
const records=[]; const seen=new Set();
for(const page of pages){for(const row of parsePage(page)){const key=`${row.electionFolder}|${row.candidateId}`;if(!seen.has(key)){seen.add(key);records.push(row)}}}
records.sort((a,b)=>a.state.localeCompare(b.state)||a.electionYear-b.electionYear||a.constituency.localeCompare(b.constituency));
const coverage=elections.map(e=>{
  const subset=records.filter(r=>r.electionFolder.toLowerCase()===e.folder.toLowerCase());
  const sourcePages=pages.filter(p=>p.folder.toLowerCase()===e.folder.toLowerCase());
  const expectedFromOrdinals=Math.max(0,...subset.map(r=>r.rankByAssets));
  const uniqueOrdinals=new Set(subset.map(r=>r.rankByAssets)).size;
  return {...e,winnerCount:subset.length,expectedFromOrdinals,complete:subset.length===expectedFromOrdinals&&uniqueOrdinals===expectedFromOrdinals,pageCount:sourcePages.length,sourceSha256:createHash("sha256").update(sourcePages.map(p=>p.sha256).join("|")).digest("hex"),sourceUrl:urlFor(e.folder,1)};
});
const incomplete=coverage.filter(e=>!e.complete);
if(incomplete.length)throw new Error(`Refusing to write an incomplete winner archive: ${incomplete.map(e=>`${e.folder} (${e.winnerCount}/${e.expectedFromOrdinals})`).join(", ")}`);
const years=records.map(r=>r.electionYear);
const payload={meta:{title:"India state assembly winner archive",source:"Association for Democratic Reforms / MyNeta",retrievedAt:new Date().toISOString(),parserVersion:2,electionFolders:elections.length,electionsWithWinners:coverage.filter(e=>e.winnerCount).length,completeElectionFolders:coverage.filter(e=>e.complete).length,winnerRecords:records.length,states:new Set(records.map(r=>r.state)).size,firstYear:Math.min(...years),latestYear:Math.max(...years),note:"Winner records are taken from MyNeta election summaries derived from candidate affidavits. JavaScript-obfuscated rows are decoded in an isolated VM. Constituency names are retained as published for each election."},coverage,records};
await writeFile("public/data/adr-winner-archive.json",JSON.stringify(payload)+"\n");
console.log(JSON.stringify(payload.meta,null,2));
