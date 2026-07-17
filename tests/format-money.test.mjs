import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source=await readFile(new URL("../lib/format-money.ts",import.meta.url),"utf8");
const formatterModule=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const { formatCrores, formatRupees }=formatterModule;

test("formats negative net worth with the correct sign and unit",()=>{
  assert.equal(formatCrores(-9.18),"−₹9.2 Cr");
  assert.equal(formatRupees(-91800000),"−₹9.2 Cr");
});

test("formats lakh, crore, and thousand-crore values consistently",()=>{
  assert.equal(formatCrores(0.42),"₹42 L");
  assert.equal(formatCrores(42),"₹42 Cr");
  assert.equal(formatCrores(1413),"₹1.41k Cr");
});
