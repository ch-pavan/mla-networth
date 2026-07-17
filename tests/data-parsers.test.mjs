import assert from "node:assert/strict";
import test from "node:test";
import { deobfuscateMynetaHtml } from "../scripts/lib/myneta-html.mjs";
import {
  countMynetaRecordStatuses,
  parseMynetaConstituencyLabel,
  parseMynetaMoneyCell,
  sumMynetaRecordStatusCounts,
} from "../scripts/lib/myneta-records.mjs";

function packLikeMyneta(row, { alphabet = "lkwPjcerR", offset = 8, radix = 2 } = {}) {
  const escapedRow = row
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
  const statement = `document.write('${escapedRow}');`;
  const bytes = new TextEncoder().encode(statement);
  const delimiter = alphabet[radix];
  const encoded = [...bytes].map((byte) => (
    (byte + offset)
      .toString(radix)
      .replace(/\d/g, (digit) => alphabet[Number(digit)])
  )).join(delimiter) + delimiter;

  return `var _0xdata=["","split","0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/","slice","indexOf","","",".","pow","reduce","reverse","0"];function _0xbase(d,e,f){var g=_0xdata[2][_0xdata[1]](_0xdata[0]);var h=g[_0xdata[3]](0,e);var i=g[_0xdata[3]](0,f);var j=d[_0xdata[1]](_0xdata[0])[_0xdata[10]]()[_0xdata[9]](function(a,b,c){if(h[_0xdata[4]](b)!==-1)return a+=h[_0xdata[4]](b)*(Math[_0xdata[8]](e,c))},0);var k=_0xdata[0];while(j>0){k=i[j%f]+k;j=(j-(j%f))/f}return k||_0xdata[11]}eval(function(h,u,n,t,e,r){r="";for(var i=0,len=h.length;i<len;i++){var s="";while(h[i]!==n[e]){s+=h[i];i++}for(var j=0;j<n.length;j++)s=s.replace(new RegExp(n[j],"g"),j);r+=String.fromCharCode(_0xbase(s,e,10)-t)}return decodeURIComponent(escape(r))}("${encoded}",68,"${alphabet}",${offset},${radix},48))`;
}

test("decodes the custom packed table-row shape emitted by MyNeta", () => {
  const row = "<tr><td>9</td><td>Decoded winner</td></tr>";
  const html = `<table><script>${packLikeMyneta(row)}</script></table>`;
  const decoded = deobfuscateMynetaHtml(html);

  assert.equal(decoded, `<table>${row}</table>`);
  assert.doesNotMatch(decoded, /<script/);
});

test("decodes UTF-8 and multiple rows without evaluating the wrapper", () => {
  const rows = "<tr><td>न</td><td>Candidate &amp; spouse</td></tr><tr><td>2</td><td>₹1 Cr</td></tr>";
  const html = `<script type="text/javascript">${packLikeMyneta(rows, { alphabet: "IvFUJfxWj", offset: 30, radix: 5 })}</script>`;

  assert.equal(deobfuscateMynetaHtml(html), rows);
});

test("keeps the former constructor/process sandbox escape inert", () => {
  const html = '<script>eval(function(){document.write(document.write.constructor("return process")().cwd())}())</script>';

  assert.equal(deobfuscateMynetaHtml(html), html);
  assert.doesNotMatch(deobfuscateMynetaHtml(html), new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("retains unsupported or malformed scripts instead of dropping records", () => {
  const unsupported = "<script>eval(function(){process.exit(1)}())</script>";
  const malformed = `<script>${packLikeMyneta("<tr><td>1</td></tr>").replace(/,8,2,48\)\)$/, ",8,11,48))")}</script>`;

  assert.equal(deobfuscateMynetaHtml(unsupported), unsupported);
  assert.equal(deobfuscateMynetaHtml(malformed), malformed);
});

test("rejects decoded active content even when it uses the recognized encoding", () => {
  const dangerous = '<tr><td><img src=x onerror="process.exit(1)"></td></tr>';
  const html = `<script>${packLikeMyneta(dangerous)}</script>`;

  assert.equal(deobfuscateMynetaHtml(html), html);
});

test("parses declared money while distinguishing nil, masked, and missing cells", () => {
  assert.deepEqual(
    parseMynetaMoneyCell("Rs&nbsp;1,23,456<br><span>~ 1 Lacs+</span>"),
    { value: 123456, status: "parsed", raw: "Rs 1,23,456 ~ 1 Lacs+" },
  );
  assert.deepEqual(
    parseMynetaMoneyCell("₹0"),
    { value: 0, status: "parsed", raw: "₹0" },
  );
  assert.deepEqual(
    parseMynetaMoneyCell("NIL"),
    { value: 0, status: "nil", raw: "NIL" },
  );
  assert.deepEqual(
    parseMynetaMoneyCell("Rs ********"),
    { value: null, status: "masked", raw: "Rs ********" },
  );
  assert.deepEqual(
    parseMynetaMoneyCell("Not Available"),
    { value: null, status: "masked", raw: "Not Available" },
  );
  assert.deepEqual(
    parseMynetaMoneyCell("<span>&nbsp;</span>"),
    { value: null, status: "missing", raw: "" },
  );
});

test("parses record-level by-election fields from published constituency labels", () => {
  assert.deepEqual(
    parseMynetaConstituencyLabel("HAYULIANG (ST) : BYE ELECTION ON 19-11-2016", 2014),
    {
      baseConstituency: "HAYULIANG (ST)",
      electionType: "by-election",
      electionDate: "2016-11-19",
      electionYear: 2016,
    },
  );
  assert.deepEqual(
    parseMynetaConstituencyLabel("LIROMOBA : BYE- ELECTION ON 13-02-2015", 2014),
    {
      baseConstituency: "LIROMOBA",
      electionType: "by-election",
      electionDate: "2015-02-13",
      electionYear: 2015,
    },
  );
  assert.deepEqual(
    parseMynetaConstituencyLabel("Channapatna: Bye-election 18-08-2009", 2008),
    {
      baseConstituency: "Channapatna",
      electionType: "by-election",
      electionDate: "2009-08-18",
      electionYear: 2009,
    },
  );
  assert.deepEqual(
    parseMynetaConstituencyLabel("Suzapur (Bye-election on 07-11-2009)", 2006),
    {
      baseConstituency: "Suzapur",
      electionType: "by-election",
      electionDate: "2009-11-07",
      electionYear: 2009,
    },
  );
});

test("never classifies before-by-election or malformed labels as by-elections", () => {
  assert.deepEqual(
    parseMynetaConstituencyLabel("PIRAVOM: BEFORE BYE-ELECTION", 2011),
    {
      baseConstituency: "PIRAVOM",
      electionType: "general",
      electionDate: null,
      electionYear: 2011,
    },
  );
  assert.deepEqual(
    parseMynetaConstituencyLabel("BAGALKOT : BYE ELECTION ON 31-02-2026", 2023),
    {
      baseConstituency: "BAGALKOT : BYE ELECTION ON 31-02-2026",
      electionType: "general",
      electionDate: null,
      electionYear: 2023,
    },
  );
  assert.deepEqual(
    parseMynetaConstituencyLabel("ACHAMPET (SC)", 2009),
    {
      baseConstituency: "ACHAMPET (SC)",
      electionType: "general",
      electionDate: null,
      electionYear: 2009,
    },
  );
});

test("aggregates money status metadata without collapsing unavailable values", () => {
  const first = countMynetaRecordStatuses([
    { assetsStatus: "parsed", liabilitiesStatus: "nil" },
    { assetsStatus: "masked", liabilitiesStatus: "missing" },
  ]);
  const second = countMynetaRecordStatuses([
    { assetsStatus: "nil", liabilitiesStatus: "parsed" },
  ]);

  assert.deepEqual(sumMynetaRecordStatusCounts([first, second]), {
    assets: { parsed: 1, nil: 1, masked: 1, missing: 0 },
    liabilities: { parsed: 1, nil: 1, masked: 0, missing: 1 },
  });
  assert.throws(
    () => countMynetaRecordStatuses([{ assetsStatus: "unknown", liabilitiesStatus: "parsed" }]),
    /Unknown assets status/,
  );
});
