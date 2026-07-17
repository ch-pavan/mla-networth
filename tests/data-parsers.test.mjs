import assert from "node:assert/strict";
import test from "node:test";
import { deobfuscateMynetaHtml } from "../scripts/lib/myneta-html.mjs";

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
