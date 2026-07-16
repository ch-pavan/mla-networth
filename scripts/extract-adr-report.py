#!/usr/bin/env python3
"""Extract ADR's 2025 all-India sitting MLA appendix into a reviewable JSON snapshot."""
import argparse, hashlib, json, re
from datetime import datetime, timezone
from pathlib import Path
import pdfplumber

def money(value):
    if not value: return 0
    first=value.split("\n",1)[0]
    digits=re.sub(r"[^0-9]","",first)
    return int(digits) if digits else 0

def clean(value):
    return re.sub(r"\s+"," ",(value or "").replace("\n"," ")).strip()

def assembly(value):
    text=clean(value)
    match=re.search(r"\b(20\d{2})$",text)
    if not match: return text,None
    return text[:match.start()].strip(),int(match.group(1))

parser=argparse.ArgumentParser()
parser.add_argument("pdf")
parser.add_argument("output")
args=parser.parse_args()
pdf_path=Path(args.pdf)
rows=[]
with pdfplumber.open(pdf_path) as doc:
    for page_number,page in enumerate(doc.pages,1):
        if page_number < 66: continue
        for table in page.extract_tables():
            for row in table:
                if not row or len(row)<13 or not (row[0] or "").strip().isdigit(): continue
                state,year=assembly(row[1])
                if not state or not year: continue
                rows.append({
                    "rank":int(row[0]), "state":state, "electionYear":year,
                    "constituency":clean(row[2]), "name":clean(row[3]), "party":clean(row[4]),
                    "age":int(row[5]) if (row[5] or "").strip().isdigit() else None,
                    "gender":clean(row[6]), "assets":money(row[7]), "liabilities":money(row[8]),
                    "criminalCases":int(row[9]) if (row[9] or "").strip().isdigit() else 0,
                    "seriousCriminalCases":int(row[10]) if (row[10] or "").strip().isdigit() else 0,
                    "education":clean(row[11]), "panDeclared":clean(row[12])=="Y",
                })
rows.sort(key=lambda r:r["rank"])
payload={
    "meta":{
        "title":"Analysis of Sitting MLAs from 28 State Assemblies and 3 Union Territories of India 2025",
        "publisher":"Association for Democratic Reforms",
        "published":"2025-03-17",
        "sourceUrl":"https://adrindia.org/sites/default/files/All_India_Sitting_MLAs_Report_2025_English.pdf",
        "primarySource":"Election Commission of India candidate affidavits",
        "sourceSha256":hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
        "extractedAt":datetime.now(timezone.utc).isoformat(),
        "recordCount":len(rows),
        "note":"Self-declared affidavit values. Not independently audited market wealth."
    },
    "records":rows
}
Path(args.output).parent.mkdir(parents=True,exist_ok=True)
Path(args.output).write_text(json.dumps(payload,separators=(",",":"),ensure_ascii=False)+"\n",encoding="utf-8")
print(json.dumps({"output":args.output,"records":len(rows),"firstRank":rows[0]["rank"] if rows else None,"lastRank":rows[-1]["rank"] if rows else None},indent=2))
