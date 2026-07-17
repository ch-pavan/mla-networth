import assert from "node:assert/strict";
import test from "node:test";
import { deobfuscateMynetaHtml } from "../scripts/lib/myneta-html.mjs";

test("decodes MyNeta document.write rows in an isolated VM", () => {
  const row="<tr><td>1</td><td>Decoded winner</td></tr>";
  const html=`<table><script>eval(function(){document.write(${JSON.stringify(row)})}())</script></table>`;
  const decoded=deobfuscateMynetaHtml(html);

  assert.match(decoded,/Decoded winner/);
  assert.doesNotMatch(decoded,/<script>/);
});

test("retains undecodable scripts instead of silently dropping their contents", () => {
  const html="<script>eval(function(){process.exit(1)}())</script>";
  assert.equal(deobfuscateMynetaHtml(html),html);
});
