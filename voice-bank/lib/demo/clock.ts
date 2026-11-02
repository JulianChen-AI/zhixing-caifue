import type {BankState} from '../bank/types.ts';

export const businessNow=(state?:BankState)=>state?.demoClock == null ? Date.now() : Date.parse(state.demoClock);
export const businessISO=(state?:BankState)=>new Date(businessNow(state)).toISOString();
export function businessDay(state?:BankState){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(businessNow(state)).map(({type,value})=>[type,value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
