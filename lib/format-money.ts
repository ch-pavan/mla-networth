function withSign(value:number,formatted:string):string {
  return `${value<0?"−":""}₹${formatted}`;
}

export function formatCrores(value:number):string {
  const amount=Math.abs(value);
  if(amount>=1000)return withSign(value,`${(amount/1000).toFixed(2)}k Cr`);
  if(amount>=1)return withSign(value,`${amount.toFixed(amount<10?1:0)} Cr`);
  return withSign(value,`${Math.round(amount*100)} L`);
}

export function formatRupees(rupees:number):string {
  return formatCrores(rupees/1e7);
}
