import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source=await readFile(new URL("../lib/format-money.ts",import.meta.url),"utf8");
const formatterModule=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const {
  availableMoney,
  compareAvailableMoneyDescending,
  declaredNetWorth,
  formatCrores,
  formatRupees,
}=formatterModule;

test("formats negative net worth with the correct sign and unit",()=>{
  assert.equal(formatCrores(-9.18),"−₹9.2 Cr");
  assert.equal(formatRupees(-91800000),"−₹9.2 Cr");
});

test("formats lakh, crore, and thousand-crore values consistently",()=>{
  assert.equal(formatCrores(0.42),"₹42 L");
  assert.equal(formatCrores(42),"₹42 Cr");
  assert.equal(formatCrores(1413),"₹1.41k Cr");
});

test("keeps unavailable declaration amounts distinct from zero",()=>{
  assert.equal(formatCrores(null),"Unavailable");
  assert.equal(formatRupees(undefined),"Unavailable");
  assert.equal(formatRupees(null,"—"),"—");
  assert.equal(availableMoney(0,"masked"),null);
  assert.equal(availableMoney(0,"missing"),null);
  assert.equal(availableMoney(0,"nil"),0);
  assert.equal(formatRupees(availableMoney(0,"nil")),"₹0 L");
});

test("sorts available amounts first without reordering unavailable ties",()=>{
  const rows=[
    {id:"masked",amount:null},
    {id:"high",amount:200},
    {id:"missing",amount:undefined},
    {id:"low",amount:100},
  ];
  rows.sort((left,right)=>compareAvailableMoneyDescending(left.amount,right.amount));
  assert.deepEqual(rows.map(row=>row.id),["high","low","masked","missing"]);
});

test("computes net worth only when both declarations are available",()=>{
  assert.equal(declaredNetWorth(500,125),375);
  assert.equal(declaredNetWorth(0,0),0);
  assert.equal(declaredNetWorth(null,125),null);
  assert.equal(declaredNetWorth(500,undefined),null);
});
