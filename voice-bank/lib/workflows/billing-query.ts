import type {BankState} from '../bank/types.ts';
import {WorkflowError,type Params} from './types.ts';
import {businessDay,businessNow} from '../demo/clock.ts';

export const isBillingQuery=(id:string)=>id==='BI01'||id==='BI02';
export type QueryClarification={field:'period'|'merchant'|'category';message:string};
const present=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const monthText=(year:number,month:number)=>`${year}-${String(month).padStart(2,'0')}`;
const categories=['餐饮','饮品','订阅','居住','人情往来','未分类'];
const timeWords=/这个月|本月|上个月|上月|今年|去年|本年度|全部期间|所有期间|所有月份|全部月份|历年|全部记录|所有记录|20\d{2}年(?:\d{1,2}月)?|20\d{2}-\d{2}/g;

/** The calendar day a phrase like 上周五 / 这周三 / 周五 / 昨天 / 前天 / 今天 names, with weeks starting on Monday. */
export function spokenDay(text:string,today:string):string|undefined{
 const shift=(n:number)=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 if(/大前天/.test(text))return shift(-3);if(/前天/.test(text))return shift(-2);if(/昨天/.test(text))return shift(-1);if(/今天/.test(text))return shift(0);
 const m=text.match(/(上上|上|这|本)?\s*(?:周|星期|礼拜)([一二三四五六日天])/);if(!m)return;
 const todayIndex=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7,day='一二三四五六日天'.indexOf(m[2]),target=day>6?6:day;
 let offset=(m[1]==='上上'?-14:m[1]==='上'?-7:0)+target-todayIndex;
 // A bare “周五” still ahead this week means the one just past.
 if(!m[1]&&offset>0)offset-=7;
 return shift(offset);
}

/** A period is a year, a month, a day, or a day range “YYYY-MM-DD~YYYY-MM-DD”. */
export const PERIOD=/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-\d{2}(?:~\d{4}-\d{2}-\d{2})?)?)?$/;
export function inBillingPeriod(date:string,period:string){
 if(!period)return true;
 const [from,to]=period.split('~');
 return to?date>=from&&date<=to:date.startsWith(from);
}
const shiftDay=(day:string,n:number)=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const countHan=(w:string)=>/\d/.test(w)?Number(w):({一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10} as Record<string,number>)[w]||(w.startsWith('十')?10+(({一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9} as Record<string,number>)[w[1]]||0):0);
/** Days and day ranges named in a sentence, in the order said (上上周五和这周三 → two days). */
export function spokenPeriods(text:string,today:string):string[]{
 const found:{at:number;period:string}[]=[];
 for(const m of text.matchAll(/(上上|上|这|本)?\s*(?:周|星期|礼拜)([一二三四五六日天])|大前天|前天|昨天|今天/g)){const day=spokenDay(m[0],today);if(day)found.push({at:m.index!,period:day});}
 const monday=shiftDay(today,-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7));
 for(const m of text.matchAll(/(上上|上|这|本)(?:个)?(?:周|星期|礼拜)(?![一二三四五六日天])/g)){const back=m[1]==='上上'?2:m[1]==='上'?1:0,start=shiftDay(monday,-7*back);found.push({at:m.index!,period:`${start}~${back?shiftDay(start,6):today}`});}
 for(const m of text.matchAll(/(?:最近|近)\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天|(?:最近|近)(?:一)?(?:周|星期)/g)){const n=m[1]?countHan(m[1]):7;if(n>=1&&n<=92)found.push({at:m.index!,period:`${shiftDay(today,1-n)}~${today}`});}
 return found.sort((a,b)=>a.at-b.at).map(x=>x.period);
}

/** Relative dates are resolved once using the bank's calendar, not the model's clock. */
export function parseBillingQuery(text:string,state?:BankState,now=new Date(businessNow(state))){
 const params:Params={},clarifications:QueryClarification[]=[];
 const done=(issue?:QueryClarification)=>{if(issue)clarifications.push(issue);return {params,clarification:clarifications[0],clarifications,periods:[] as string[]};};
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric'}).formatToParts(now);
 const year=Number(parts.find(p=>p.type==='year')!.value),month=Number(parts.find(p=>p.type==='month')!.value);
 const periods:string[]=spokenPeriods(text,businessDay({demoClock:now.toISOString()} as BankState));
 for(const match of text.matchAll(/(20\d{2})(?:年|[-/])(\d{1,2})月?/g)){
  const m=Number(match[2]);if(m<1||m>12)clarifications.push({field:'period',message:'这个月份不存在，请选择明确的统计月份。'});
  else periods.push(monthText(Number(match[1]),m));
 }
 if(/这个月|本月/.test(text))periods.push(monthText(year,month));
 if(/上个月|上月/.test(text))periods.push(monthText(month===1?year-1:year,month===1?12:month-1));
 if(!periods.length){
  const bareMonth=text.match(/(?:^|[^\d年-])(\d{1,2})月/);if(bareMonth){const m=Number(bareMonth[1]);if(m>=1&&m<=12)periods.push(monthText(year,m));else if(!clarifications.length)clarifications.push({field:'period',message:'这个月份不存在，请选择明确的统计月份。'});}
 }
 if(!periods.length){
  const explicit=text.match(/(20\d{2})年/);if(explicit)periods.push(explicit[1]);
  else if(/今年|本年度/.test(text))periods.push(String(year));else if(/去年/.test(text))periods.push(String(year-1));
 }
 const unique=[...new Set(periods)];
 // Several periods in one sentence are each counted; the caller splits them into separate queries.
 // “分别”: each period on its own; “一共” across several periods stays a question, the sum of which months is unclear.
 if(unique.length>1&&!clarifications.length&&!/一共|总共|合计|加起来|总计/.test(text))return {...done(),periods:unique};
 if(unique.length>1)clarifications.push({field:'period',message:'这次提到了多个期间，请先选择要查询的月份或年份。'});
 else if(unique.length&&!clarifications.length)params.period=unique[0];
 else if(/全部期间|所有期间|所有月份|全部月份|历年|全部记录|所有记录/.test(text))params.period='';
 else if(/最近|前阵子|这段时间|这两个月|近一个月/.test(text))clarifications.push({field:'period',message:'请明确统计月份或年份，例如“本月”或“2026年10月”。'});
 if(!state)return done();
 const accounts=state.accounts.filter(a=>text.includes(a.name)||text.includes(a.tail));
 if(accounts.length===1)params.accountId=accounts[0].id;
 else if(accounts.length>1)params.accountId='';
 if(/全部账户|所有账户/.test(text))params.accountId='';
 if(/全部类别|所有类别/.test(text))params.category='';
 if(/全部商户|所有商户/.test(text))params.merchant='';
 const records=state.workflows?.records.transactions||[];
 const knownCategories=[...new Set([...categories,...records.map(r=>String(r.category||'')).filter(Boolean)])];
 const namedCategories=knownCategories.filter(category=>text.includes(category));
 if(namedCategories.length===1)params.category=namedCategories[0];
 if(namedCategories.length>1)clarifications.push({field:'category',message:'请先选择一个消费类别；选择“全部类别”可查看所有类别。'});
 const merchants=[...new Set(records.map(r=>String(r.merchant||'')).filter(Boolean))];
 const quoted=text.match(/(?:商户(?:名称)?(?:包含|是|为|叫)?\s*)[“「"]([^”」"]{1,60})[”」"]/);
 if(quoted){params.merchant=quoted[1].trim();return done();}
 const segments=text.split(/[，,。；;？?]/);
 let subject=(segments.findLast(part=>/花|消费|支出|收入/.test(part))||segments.find(part=>/账单|收支|流水|明细/.test(part))||segments[0]).split(/一共|总共|花了|花费|花多少|消费了?|支出|收入/)[0];
 subject=subject.replace(timeWords,'').replace(/最近|前阵子|这段时间|这两个月|近一个月|查询|统计|查看|看看|看一下|查一下|查下|帮我|请问|账单|明细|收支|流水|交易|情况|报告|多少钱|多少|全部|所有|改成|换成|改为|调整为|改口|选择|先选|只看|只查|先看/g,'').replace(/^(?:先|请|我|的|在|查|看)+/,'').replace(/(?:上|里|的|一共|总共)+$/,'').replace(/^(?:和|与|及|以及)?退款$/,'').trim();
 if(!subject||/^(?:钱|净|总|总计|记录|本期|吗|呢|能吗|类别|商户|账户|期间)$/.test(subject)||namedCategories.includes(subject))return done();
 // Exact merchant names win. Short names may resolve only to one actual merchant.
 const exact=merchants.filter(name=>name===subject),matched=exact.length?exact:merchants.filter(name=>name.includes(subject));
 if(!exact.length&&merchants.filter(name=>subject.includes(name)).length>1)return done({field:'merchant',message:'这次提到了多个商户，请先选择要查询的一个商户，或明确查询全部商户。'});
 if(matched.length===1){params.merchant=matched[0];return done();}
 if(matched.length>1)return done({field:'merchant',message:`“${subject}”对应多个商户，请填写具体商户名称：${matched.slice(0,4).join('、')}。`});
 if(namedCategories.length)return done();
 if(/店|商场|超市|食堂$/.test(subject)){params.merchant=subject;return done();}
 return done({field:'merchant',message:`“${subject}”还不能明确对应消费记录，请填写具体商户，或选择消费类别。`});
}

/** Preserve card choices; supplement voice proposals with independently resolved conditions. */
export function resolveBillingQuery(state:BankState,input:Params,text:string){
 const parsed=parseBillingQuery(text,state),params={...input,...parsed.params};
 if(present(parsed.params.merchant)&&!present(parsed.params.category))delete params.category;
 if(present(parsed.params.category)&&!present(parsed.params.merchant)&&!text.includes(String(input.merchant||'\0')))delete params.merchant;
 for(const issue of parsed.clarifications)delete params[issue.field];
 if(parsed.clarifications.some(issue=>issue.field==='merchant')&&!parsed.params.category)delete params.category;
 return {params,clarifications:parsed.clarifications};
}

export function billingScope(state:BankState,p:Params){
 const period=present(p.period)?p.period:'',merchant=present(p.merchant)?p.merchant:'',category=present(p.category)?p.category:'',accountId=present(p.accountId)?p.accountId:'';
 const account=state.accounts.find(a=>a.id===accountId);
 if(accountId&&!account)throw new WorkflowError('请选择当前可查询的账户。',400,'accountId');
 const day=(d:string)=>`${d.slice(0,4)}年${Number(d.slice(5,7))}月${Number(d.slice(8,10))}日`,[from,to]=period.split('~');
 const periodLabel=to?`${day(from)}至${day(to).slice(5)}`:/^\d{4}-\d{2}-\d{2}$/.test(period)?day(period):/^\d{4}-\d{2}$/.test(period)?`${period.slice(0,4)}年${Number(period.slice(5))}月`:/^\d{4}$/.test(period)?`${period}年`:'全部期间';
 // A day still ahead has no spending yet; say so rather than report a plain zero.
 const ahead=!!period&&/^\d{4}-\d{2}-\d{2}/.test(period)&&period.slice(0,10)>businessDay(state)?'（这一天还没到）':'';
 const label=[periodLabel+ahead,account?`${account.name} · 尾号${account.tail}`:'全部账户',merchant?`商户名称包含“${merchant}”`:'全部商户',category?`类别：${category}`:'全部类别'].join(' · ');
 return {period,accountId,merchant,category,label};
}
type Totals={count:number;expenseCount:number;refundCount:number;grossExpenses:number;netExpenses:number;refunds:number;income:number};
export function billingSpeech(scope:ReturnType<typeof billingScope>,totals:Totals){
 const amount=(cents:number)=>(cents/100).toFixed(2);
 return totals.count?`${scope.label}，共${totals.count}笔记录（消费${totals.expenseCount}笔，退款${totals.refundCount}笔），支出合计${amount(totals.grossExpenses)}元，退款${amount(totals.refunds)}元，净支出${amount(totals.netExpenses)}元，收入${amount(totals.income)}元。`:`${scope.label}，没有匹配的交易记录，净支出0.00元。`;
}
