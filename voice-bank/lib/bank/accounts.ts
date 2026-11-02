import type { Account } from './types.ts';

/** Book balance minus money held for accepted, unsettled purchases. */
export const availableBalance=(a:Account)=>a.balance-(a.held||0);

/** Named accounts and stated own-account tails must identify the same account. */
export function accountCandidates(text:string,accounts:Account[]){
 const named=accounts.filter(a=>{
  if(text.includes(a.name)||text.includes(a.id))return true;
  const alias=a.id==='daily'?'日常':a.id==='savings'?'储蓄':'';if(!alias)return false;
  return new RegExp('(?:从|用|选择|选|改用)\\s*'+alias+'(?!目标|计划)').test(text)||new RegExp(alias+'(?:和|或|与|、|那张|那个|这张|吧|[。！!\\s]*$)').test(text);
 });
 const tails=[...text.replace(/\s/g,'').matchAll(/尾号(\d{4})(?!\d)/g)].map(m=>m[1]);
 const byTail=accounts.filter(a=>tails.includes(a.tail));
 return named.length&&byTail.length?named.filter(a=>byTail.some(b=>a.id===b.id)):named.length?named:byTail;
}
