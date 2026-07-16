#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REQUIRED = ["state","state_code","assembly_seats","constituency_no","constituency","year","candidate","party","winner","total_assets","liabilities","affidavit_url"];

function parseCsv(input) {
  const rows=[]; let row=[], cell="", quoted=false;
  for (let i=0;i<input.length;i++) {
    const c=input[i], n=input[i+1];
    if (quoted && c==='"' && n==='"') { cell+='"'; i++; }
    else if (c==='"') quoted=!quoted;
    else if (!quoted && c===',') { row.push(cell); cell=""; }
    else if (!quoted && (c==='\n'||c==='\r')) { if(c==='\r'&&n==='\n') i++; row.push(cell); if(row.some(v=>v.trim())) rows.push(row); row=[]; cell=""; }
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  const headers=rows.shift()?.map(x=>x.trim())??[];
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]??"").trim()])));
}

const clean = (s) => s.normalize("NFKC").replace(/\s+/g," ").trim();
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const sql = (v) => v==null ? "NULL" : `'${String(v).replaceAll("'","''")}'`;
const int = (v, fallback=null) => { const n=Number(String(v).replace(/[₹,\s]/g,"")); return Number.isFinite(n)?Math.round(n):fallback };
const bool = (v) => /^(1|true|yes|winner|won)$/i.test(v)?1:0;

const [,,inputPath,outputPath="drizzle/seed-affidavits.sql"] = process.argv;
if(!inputPath){console.error("Usage: npm run data:import -- data/affidavits.csv [drizzle/seed-affidavits.sql]");process.exit(1)}
const raw=await readFile(inputPath,"utf8");
const records=inputPath.endsWith(".json")?JSON.parse(raw):parseCsv(raw);
const missing=REQUIRED.filter(k=>!records.length||!(k in records[0]));
if(missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);

const rejected=[]; const accepted=[]; const seen=new Set();
for(const [i,r] of records.entries()){
  const row=Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==="string"?clean(v):v]));
  const key=[row.state_code,row.constituency_no,row.year,row.candidate].join("|").toLowerCase();
  const errors=[];
  if(!row.candidate||!row.constituency||!row.state) errors.push("missing identity field");
  if(int(row.total_assets)<0||int(row.liabilities)<0) errors.push("negative money value");
  if(!/^https:\/\//.test(row.affidavit_url)) errors.push("invalid affidavit URL");
  if(seen.has(key)) errors.push("duplicate candidacy");
  if(errors.length){rejected.push({line:i+2,key,errors});continue}
  seen.add(key); accepted.push(row);
}

const states=new Map(), parties=new Map(), people=new Map(), elections=new Map(), constituencies=new Map();
for(const r of accepted){
  states.set(r.state_code,{name:r.state,seats:int(r.assembly_seats,0),slug:slug(r.state)});
  parties.set(r.party,{name:r.party_name||r.party,slug:slug(r.party)});
  people.set(slug(r.candidate),{name:r.candidate});
  elections.set(`${r.state_code}|${r.year}`,r);
  constituencies.set(`${r.state_code}|${r.constituency_no}`,r);
}

const sourceUrl=accepted[0]?.source_url||"https://www.myneta.info/";
const retrievedAt=new Date().toISOString();
const hash=createHash("sha256").update(raw).digest("hex");
const out=["PRAGMA foreign_keys = ON;","BEGIN TRANSACTION;"];
for(const [code,s] of states) out.push(`INSERT OR IGNORE INTO states (eci_code,name,slug,assembly_seats) VALUES (${sql(code)},${sql(s.name)},${sql(s.slug)},${s.seats});`);
for(const [abbr,p] of parties) out.push(`INSERT OR IGNORE INTO parties (abbreviation,name,slug) VALUES (${sql(abbr)},${sql(p.name)},${sql(p.slug)});`);
for(const [personSlug,p] of people) out.push(`INSERT OR IGNORE INTO people (canonical_name,slug,identity_confidence) VALUES (${sql(p.name)},${sql(personSlug)},1);`);
for(const [,r] of constituencies) out.push(`INSERT OR IGNORE INTO constituencies (state_id,eci_number,name,slug,reservation) SELECT id,${int(r.constituency_no)},${sql(r.constituency)},${sql(slug(r.constituency))},${sql(r.reservation||"GEN")} FROM states WHERE eci_code=${sql(r.state_code)};`);
for(const [,r] of elections) out.push(`INSERT OR IGNORE INTO elections (state_id,year,election_type,source_url) SELECT id,${int(r.year)},${sql(r.election_type||"general")},${sql(r.source_url||sourceUrl)} FROM states WHERE eci_code=${sql(r.state_code)};`);
for(const r of accepted){
  const personSlug=slug(r.candidate);
  out.push(`INSERT OR IGNORE INTO candidacies (election_id,constituency_id,person_id,party_id,candidate_name_as_filed,age,winner,votes,vote_share,margin) SELECT e.id,c.id,p.id,pt.id,${sql(r.candidate)},${int(r.age,"NULL")},${bool(r.winner)},${int(r.votes,"NULL")},${r.vote_share?Number(r.vote_share):"NULL"},${int(r.margin,"NULL")} FROM elections e JOIN states s ON s.id=e.state_id JOIN constituencies c ON c.state_id=s.id AND c.eci_number=${int(r.constituency_no)} JOIN people p ON p.slug=${sql(personSlug)} LEFT JOIN parties pt ON pt.abbreviation=${sql(r.party)} WHERE s.eci_code=${sql(r.state_code)} AND e.year=${int(r.year)};`);
  out.push(`INSERT OR IGNORE INTO affidavits (candidacy_id,movable_assets_rupees,immovable_assets_rupees,total_assets_rupees,liabilities_rupees,declared_income_rupees,spouse_assets_rupees,dependents_assets_rupees,criminal_cases,serious_criminal_cases,education,profession,pan_declared,affidavit_url,source_kind,source_retrieved_at,verification_status) SELECT id,${int(r.movable_assets,"NULL")},${int(r.immovable_assets,"NULL")},${int(r.total_assets,0)},${int(r.liabilities,0)},${int(r.declared_income,"NULL")},${int(r.spouse_assets,"NULL")},${int(r.dependents_assets,"NULL")},${int(r.criminal_cases,0)},${int(r.serious_criminal_cases,0)},${sql(r.education||null)},${sql(r.profession||null)},${r.pan_declared?bool(r.pan_declared):"NULL"},${sql(r.affidavit_url)},${sql(r.source_kind||"ADR")},${sql(retrievedAt)},${sql(r.verification_status||"parsed")} FROM candidacies WHERE election_id=(SELECT e.id FROM elections e JOIN states s ON s.id=e.state_id WHERE s.eci_code=${sql(r.state_code)} AND e.year=${int(r.year)}) AND constituency_id=(SELECT c.id FROM constituencies c JOIN states s ON s.id=c.state_id WHERE s.eci_code=${sql(r.state_code)} AND c.eci_number=${int(r.constituency_no)}) AND person_id=(SELECT id FROM people WHERE slug=${sql(personSlug)});`);
}
out.push(`INSERT INTO data_imports (source_kind,source_url,source_sha256,started_at,completed_at,rows_seen,rows_accepted,rows_rejected,status,notes) VALUES ('normalized-csv',${sql(sourceUrl)},${sql(hash)},${sql(retrievedAt)},${sql(retrievedAt)},${records.length},${accepted.length},${rejected.length},'completed',${sql(`Generated by import-affidavits.mjs from ${path.basename(inputPath)}`)});`);
out.push("COMMIT;");
await writeFile(outputPath,out.join("\n")+"\n");
await writeFile(`${outputPath}.report.json`,JSON.stringify({source:path.resolve(inputPath),sha256:hash,rowsSeen:records.length,rowsAccepted:accepted.length,rowsRejected:rejected.length,rejected},null,2)+"\n");
console.log(JSON.stringify({output:outputPath,rowsSeen:records.length,rowsAccepted:accepted.length,rowsRejected:rejected.length},null,2));
