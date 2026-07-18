#!/usr/bin/env python3
"""Extract ADR sitting Rajya Sabha MP asset appendix into a JSON snapshot."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

SOURCE_URL = (
    "https://adrindia.org/sites/default/files/"
    "Analysis_of_Criminal_Background_Financial_Education_Gender_and_other_details_of_"
    "Sitting_Rajya_Sabha_MPs_March2026_Eng_0.pdf"
)

STATE_ALIASES = {
    "Chattisgarh": "Chhattisgarh",
    "Jammu And Kashmir": "Jammu and Kashmir",
    "NCT Of Delhi": "Delhi",
}


def money(value) -> int | None:
    if value is None:
        return None
    text = str(value).split("\n", 1)[0]
    digits = re.sub(r"[^0-9]", "", text)
    if not digits:
        return 0 if str(value).strip() in {"0", "Nil", "NIL", "nil"} else None
    return int(digits)


def clean(value) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\n", " ")).strip()


def canonical_state(value: str) -> str:
    state = clean(value)
    return STATE_ALIASES.get(state, state)


def parse_term(value: str) -> tuple[str | None, int | None, int | None]:
    text = clean(value)
    match = re.search(r"\((\d{4})\s*[-–]\s*(\d{4})\)", text)
    if not match:
        return text or None, None, None
    return text, int(match.group(1)), int(match.group(2))


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def extract_asset_rows(pdf_path: Path) -> list[dict]:
    rows: list[dict] = []
    with pdfplumber.open(pdf_path) as doc:
        # Full asset appendix (pages are 1-indexed in ADR kits; pdfplumber is 0-indexed).
        for page in doc.pages[36:50]:
            for table in page.extract_tables() or []:
                for raw in table:
                    if not raw or len(raw) < 9:
                        continue
                    sno = clean(raw[0])
                    if not sno.isdigit():
                        continue
                    term_label, term_from, term_to = parse_term(raw[3] or "")
                    age_text = clean(raw[5])
                    rows.append(
                        {
                            "rank": int(sno),
                            "name": clean(raw[1]),
                            "state": canonical_state(raw[2]),
                            "term": term_label,
                            "termFrom": term_from,
                            "termTo": term_to,
                            "electionYear": term_from,
                            "party": clean(raw[4]),
                            "age": int(age_text) if age_text.isdigit() else None,
                            "gender": "",
                            "movableAssets": money(raw[6]),
                            "immovableAssets": money(raw[7]),
                            "assets": money(raw[8]),
                            "liabilities": None,
                            "criminalCases": None,
                            "seriousCriminalCases": None,
                            "education": "",
                            "panDeclared": clean(raw[9]).upper().startswith("Y") if len(raw) > 9 else False,
                            "constituency": "Rajya Sabha",
                            "chamber": "rajya_sabha",
                        }
                    )
    # Prefer the last occurrence of each rank (later pages can repeat tops in summaries).
    by_rank: dict[int, dict] = {}
    for row in rows:
        by_rank[row["rank"]] = row
    ordered = [by_rank[rank] for rank in sorted(by_rank)]
    if len(ordered) != 229:
        raise SystemExit(f"Expected 229 sitting RS asset rows, found {len(ordered)}")
    return ordered


def attach_top_liabilities(pdf_path: Path, records: list[dict]) -> int:
    liabilities: dict[str, int] = {}
    with pdfplumber.open(pdf_path) as doc:
        for page in doc.pages[14:30]:
            for table in page.extract_tables() or []:
                if not table:
                    continue
                header = " | ".join(clean(c) for c in table[0])
                if "Liabilities (Rs)" not in header:
                    continue
                for raw in table[1:]:
                    if not raw or len(raw) < 6 or not clean(raw[0]).isdigit():
                        continue
                    name = clean(raw[1])
                    amount = money(raw[5])
                    if name and amount is not None:
                        liabilities[normalize_name(name)] = amount
    attached = 0
    for record in records:
        amount = liabilities.get(normalize_name(record["name"]))
        if amount is not None:
            record["liabilities"] = amount
            attached += 1
    return attached


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("output")
    args = parser.parse_args()
    pdf_path = Path(args.pdf)
    records = extract_asset_rows(pdf_path)
    liability_matches = attach_top_liabilities(pdf_path, records)
    payload = {
        "meta": {
            "title": "Sitting Rajya Sabha MPs — ADR analysis, March 2026",
            "chamber": "rajya_sabha",
            "publisher": "Association for Democratic Reforms",
            "asOf": "2026-03-17",
            "published": "2026-03-19",
            "sourceUrl": SOURCE_URL,
            "primarySource": "Election Commission of India candidate affidavits",
            "sourceSha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
            "extractedAt": datetime.now(timezone.utc).isoformat(),
            "recordCount": len(records),
            "sittingMps": 233,
            "analyzedRecords": 229,
            "vacantSeats": 1,
            "affidavitsUnavailable": 3,
            "liabilityMatchesFromTopTable": liability_matches,
            "note": (
                "Self-declared affidavit values from ADR's March 2026 sitting Rajya Sabha report. "
                "Not independently audited market wealth. Full liabilities are not published for every MP "
                f"in the appendix; only {liability_matches} names were matched from the top-liabilities table, "
                "while unmatched liabilities and case counts remain null. ADR analyzed 229 of 233 "
                "sitting MPs as of 17 March 2026; one seat was vacant and affidavits for three MPs "
                "were unavailable. The report was published on 19 March 2026."
            ),
        },
        "records": records,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(output),
                "records": len(records),
                "liabilityMatches": liability_matches,
                "first": records[0]["name"],
                "topAssets": records[0]["assets"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
