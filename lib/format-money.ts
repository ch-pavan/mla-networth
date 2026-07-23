export type MoneyStatus = "parsed" | "nil" | "masked" | "missing";
export type MoneyValue = number | null | undefined;

function withSign(value:number,formatted:string):string {
  return `${value<0?"−":""}₹${formatted}`;
}

export function availableMoney(value:MoneyValue,status?:MoneyStatus):number|null {
  if(status==="masked"||status==="missing") return null;
  return typeof value==="number"&&Number.isFinite(value)?value:null;
}

export function formatCrores(value:MoneyValue,unavailable="Unavailable"):string {
  const available=availableMoney(value);
  if(available===null) return unavailable;
  value=available;
  const amount=Math.abs(value);
  if(amount>=1e5) return withSign(value,`${(amount/1e5).toFixed(2)} Lakh Cr`);
  if(amount>=1000) return withSign(value,`${Math.round(amount).toLocaleString("en-IN")} Cr`);
  if(amount>=1) return withSign(value,`${amount.toFixed(amount<10?1:0)} Cr`);
  return withSign(value,`${Math.round(amount*100)} L`);
}

export function formatRupees(rupees:MoneyValue,unavailable="Unavailable"):string {
  const available=availableMoney(rupees);
  return available===null?unavailable:formatCrores(available/1e7,unavailable);
}

export function compareAvailableMoneyDescending(left:MoneyValue,right:MoneyValue):number {
  const leftAmount=availableMoney(left);
  const rightAmount=availableMoney(right);
  if(leftAmount===null) return rightAmount===null?0:1;
  if(rightAmount===null) return -1;
  return rightAmount-leftAmount;
}

export function declaredNetWorth(assets:MoneyValue,liabilities:MoneyValue):number|null {
  const availableAssets=availableMoney(assets);
  const availableLiabilities=availableMoney(liabilities);
  return availableAssets===null||availableLiabilities===null
    ?null
    :availableAssets-availableLiabilities;
}
