import { businessNow, businessISO, businessDay } from '../demo/clock.ts';
import type { BankState } from '../bank/types.ts';
import { contactsOf } from '../bank/recipients.ts';
import { availableBalance } from '../bank/accounts.ts';
import type { FlowTask, Params, Row } from './types.ts';
import { WorkflowError } from './types.ts';
import {billingScope,billingSpeech,inBillingPeriod,PERIOD} from './billing-query.ts';
import { goalPlan, replanGoalRules, assertCancellation, cancellationDeadline, assertAaLimit, appendTransaction, monthlyReport } from './business-lite.ts';
import { standingLimits } from './limits.ts';
import { aaShares, reminderDrafts, type AaItem } from './aa.ts';
import { portfolioReview, reviewNote } from './portfolio-review.ts';
import { existingInvite, inviteeName, inviteText, inviteView, INVITE_PERK } from './invite.ts';
import { productDetail, compareProducts, redemptionQuote, cardApplicationGuide, judicialGuide, transferView, ruleView, orderView, subscriptionView, lossView } from './presentation-lite.ts';
export { appendTransaction } from './business-lite.ts';

export const ACTIONS:Record<string,string[]>={IN05:['status','assess'],TR04:['list','create','update','pause','resume','delete'],TR05:['list','create','update','status','remind','reconcile'],TR08:['list','create','update','delete'],TR09:['list','create','update','reconcile','delete'],BI08:['get','set','estimate'],SU02:['create','update'],SU03:['list','create','update','delete'],IN04:['update','pause','resume','close'],IN13:['list','create','update','pause','resume','delete'],IN14:['list','create','update','delete'],CA03:['list','guide','submit','status','supplement','withdraw'],CA04:['get','set','request'],CA05:['query','unlock'],CA06:['freeze','unfreeze'],CA07:['report','status'],CA08:['list','request','status','activate'],CA09:['list','mark_done'],IN16:['review','note'],TR10:['create','status']};
export function step<T>(t:FlowTask,id:string,reason:string,fn:()=>T):T{
 const x=t.steps.find(x=>x.toolId===id);if(!x)throw new WorkflowError('工具不在当前 checklist 的白名单：'+id);
 try{const value=fn();x.status='passed';x.reason=reason;return value;}catch(e){x.status='blocked';x.reason=e instanceof Error?e.message:'工具失败';throw e;}
}
export const rows=(s:BankState,kind:string)=>s.workflows!.records[kind]||[];
export function getRow(s:BankState,kind:string,id:unknown):Row{const r=rows(s,kind).find(x=>x.id===id);if(!r)throw new WorkflowError('找不到当前会话中的'+kind+'对象，请重新选择。');return r;}
export function cents(value:unknown):number{const n=Number(value),c=Math.round(n*100);if(!Number.isFinite(n)||!Number.isSafeInteger(c)||c<=0||c>10000000||Math.abs(c/100-n)>1e-8)throw new WorkflowError('金额需为 0.01 至 100,000 元，最多两位小数。');return c;}
const num=(r:Row,key:string)=>Number(r[key]||0);
const uuid=(prefix:string)=>prefix+'-'+crypto.randomUUID();
const now=(s:BankState)=>businessISO(s);
function account(s:BankState,id:unknown){const a=s.accounts.find(x=>x.id===id);if(!a)throw new WorkflowError('请明确选择付款/到账账户。');return a;}
function add(s:BankState,kind:string,row:Row){(s.workflows!.records[kind]||=[]).push(row);return row;}
function record(s:BankState,amount:number,accountId:string,kind:string,merchant:string,relatedId:string,category='转账'){
 return appendTransaction(s,{id:uuid('txn'),date:s.demoClock == null ? now(s).slice(0,10) : businessDay(s),amount,accountId,kind,merchant,relatedId,category,source:'沙箱执行记录'});
}
function filtered(s:BankState,p:Params){
 const period=p.period==null?'':String(p.period);if(period&&!PERIOD.test(period))throw new WorkflowError('统计期间请用 2026-10、2026 或具体日期。');
 return rows(s,'transactions').filter(r=>inBillingPeriod(String(r.date),period)&&(!p.accountId||r.accountId===p.accountId)&&(!p.merchant||String(r.merchant).includes(String(p.merchant)))&&(!p.category||r.category===p.category));
}
function aggregate(s:BankState,p:Params){const list=filtered(s,p),expense=list.filter(r=>r.kind==='expense').reduce((n,r)=>n+num(r,'amount'),0),refund=list.filter(r=>r.kind==='refund').reduce((n,r)=>n+num(r,'amount'),0),income=list.filter(r=>r.kind==='income').reduce((n,r)=>n+num(r,'amount'),0);return {grossExpenses:expense,netExpenses:expense-refund,refunds:refund,income,count:list.length,expenseCount:list.filter(r=>r.kind==='expense').length,refundCount:list.filter(r=>r.kind==='refund').length,countBasis:'交易笔数包括退款，并非全部为消费',period:p.period||'全部合成记录',category:p.category||'全部',basis:'退款冲减原支出；自有账户转移不计消费',coverage:'当前会话内合成本行流水及沙箱执行记录'};}
/**
 * When a goal would be reached at the current pace: the average monthly surplus (income and refunds minus spending,
 * own-account moves excluded) over the last three full months. An estimate with its basis, never a promise.
 */
export function goalProjection(s:BankState,remaining:number){
 const today=businessDay(s),month=(back:number)=>{const d=new Date(today.slice(0,7)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-back);return d.toISOString().slice(0,7);};
 const months=[1,2,3].map(month).filter(m=>rows(s,'transactions').some(r=>String(r.date).startsWith(m)));
 if(!months.length)return {available:false,reason:'没有完整月份的流水，暂时无法估算。'};
 const surplus=months.map(m=>rows(s,'transactions').filter(r=>String(r.date).startsWith(m)).reduce((n,r)=>n+(r.kind==='income'||r.kind==='refund'?num(r,'amount'):r.kind==='expense'?-num(r,'amount'):0),0));
 const monthly=Math.round(surplus.reduce((a,b)=>a+b,0)/months.length);
 if(remaining<=0)return {available:true,monthly,months:0,basis:`近${months.length}个月平均每月结余`};
 if(monthly<=0)return {available:false,monthly,reason:`近${months.length}个月平均每月没有结余（${(monthly/100).toFixed(2)}元），按现在的花法攒不够，需要先减少支出或设置自动储蓄。`};
 const need=Math.ceil(remaining/monthly),reach=new Date(today.slice(0,7)+'-01T00:00:00Z');reach.setUTCMonth(reach.getUTCMonth()+need);
 return {available:true,monthly,months:need,reachBy:reach.toISOString().slice(0,7),basis:`近${months.length}个月（${Number(months.at(-1)!.slice(5))}—${Number(months[0].slice(5))}月）平均每月结余`};
}
function boolean(p:Params,key:string){return p[key]===true;}

export type EstimateItem={label:string;amount:number};
/** A user's own price guesses, summed in cents; nothing is booked, charged or held. */
export function estimate(items:EstimateItem[]){
 const parts=items.map(i=>({label:i.label,amount:Math.round(i.amount*100)})),total=parts.reduce((n,i)=>n+i.amount,0);
 return {items:parts,total,basis:'用户估算，不是实时价格；不订房、不扣款、不冻结'};
}
/** Next date for a '每月N日' schedule, on or after the business day. */
function nextMonthly(s:BankState,schedule:unknown){
 const d=Number(String(schedule||'').match(/每月\s*(\d{1,2})\s*日/)?.[1]);if(!d)return undefined;
 const [y,m,day]=businessDay(s).split('-').map(Number),pad=(n:number)=>String(n).padStart(2,'0');
 return day<=d?`${y}-${pad(m)}-${pad(d)}`:m===12?`${y+1}-01-${pad(d)}`:`${y}-${pad(m+1)}-${pad(d)}`;
}
/** Future items with where each came from; planned money is not spent and expected income is not available. */
function fundsCalendar(s:BankState){
 const entries=[
  ...rows(s,'subscriptions').filter(r=>r.status==='active'&&r.nextChargeAt).map(r=>({date:String(r.nextChargeAt),name:r.name,amount:r.amount,source:'已知扣费',status:'未发生'})),
  ...rows(s,'budgets').filter(r=>r.date).map(r=>({date:nextMonthly(s,r.date)||String(r.date),name:r.name,amount:r.amount,source:'用户登记',status:'计划支出，未付款、未冻结'})),
  ...rows(s,'rules').filter(r=>r.status==='active'&&nextMonthly(s,r.schedule)).map(r=>({date:nextMonthly(s,r.schedule)!,name:r.kind==='goal'?`存入${String(rows(s,'goals').find(g=>g.id===r.goalId)?.name||'目标')}`:String(r.name||r.kind),amount:r.amount,source:'已建规则',status:'待执行（模拟调度）'})),
  ...rows(s,'transfers').filter(r=>r.status==='scheduled').map(r=>({date:String(r.releaseAt).slice(0,10),name:'延迟到账转账',amount:r.amount,source:'已受理转账',status:'资金已占用，未到账'})),
 ].sort((a,b)=>a.date.localeCompare(b.date));
 const balance=s.accounts.reduce((n,a)=>n+a.balance,0),available=s.accounts.reduce((n,a)=>n+availableBalance(a),0);
 return {calendar:entries,balance,available,planned:entries.reduce((n,e)=>n+Number(e.amount||0),0),assumption:'未来支出尚未发生、不算已支付；预计收入不算可用余额；预算标记不等于冻结；不自动安排资金转移'};
}
/** Only transactions recorded against this card; this is not a full list of its bindings. */
function cardDetail(s:BankState,card:Row){
 const recent=rows(s,'transactions').filter(r=>r.cardId===card.id);
 return recent.length?{...card,recentTransactions:recent,coverage:'仅为已取得的本卡流水；不代表掌握全部绑定或代扣协议'}:card;
}
// Reusable concrete tools. Function checklists and future validated plans share these readers.
const READERS:Record<string,(s:BankState,p:Params)=>unknown>={
 T01:s=>s.accounts.map(({id,name,tail})=>({id,name,tail})),
 T02:(s,p)=>s.accounts.filter(a=>!p.accountId||a.id===p.accountId).map(a=>({...a,...(a.held?{available:availableBalance(a),heldNotice:'理财申购已受理、尚未结算的金额已占用，不能再用'}:{}),asOf:now(s)})),
 T03:(s,p)=>contactsOf(s).filter(c=>!p.query||[c.name,c.label,c.id].some(x=>x.includes(String(p.query)))).map(({id,name,label,tail})=>({id,name,label,tail})),
 B01:(s,p)=>{const scope=billingScope(s,p),summary=aggregate(s,p);return {scope,transactions:filtered(s,p),summary,spokenSummary:billingSpeech(scope,summary),coverage:'合成本行流水与本会话执行记录，不含未导入的外部账户',asOf:now(s)};},
 B03:(s,p)=>{const scope=billingScope(s,p),current=aggregate(s,p),transactions=filtered(s,p),inferred=transactions.filter(r=>r.kind==='expense'&&r.classificationSource!=='user-confirmed'),baseline=p.baseline?aggregate(s,{...p,period:p.baseline}):undefined;return {scope,current,transactions,spokenSummary:billingSpeech(scope,current)+(baseline?' 比较期：'+billingSpeech(billingScope(s,{...p,period:p.baseline}),baseline):'')+(inferred.length?` 其中${inferred.length}笔的类别是按商户推断的，不代表实际商品；可以看明细或纠正分类。`:''),...(baseline?{baseline}:{})};},
 // A platform cancellation the user was guided through stays active until the provider confirms; mark it so it is not mistaken for untouched.
 D02:(s,p)=>rows(s,'subscriptions').filter(r=>(!p.subscriptionId||r.id===p.subscriptionId)&&(!p.channel||r.channel===p.channel)&&(!p.status||r.status===p.status)).map(r=>rows(s,'cancellations').some(c=>c.subscriptionId===r.id&&c.status==='external_pending')&&r.status==='active'?{...r,externalPending:true}:r),
 I06:s=>s.workflows!.riskProfile,
 I07:(s,p)=>rows(s,'products').filter(r=>(!p.productId||r.id===p.productId)&&(!p.riskLevel||Number(r.risk)<=Number(p.riskLevel))&&(!p.type||r.type===p.type)).map(productDetail),
 C01:(s,p)=>p.cardId?cardDetail(s,getRow(s,'cards',p.cardId)):rows(s,'cards').filter(r=>!p.status||r.status===p.status).map(({id,name,tail,status})=>({id,name,tail,status})),
};
export const READ_TOOL_IDS=Object.freeze(Object.keys(READERS));
export function readTool(s:BankState,id:string,params:Params={}){
 if(!READERS[id])throw new WorkflowError('该工具不是已注册的只读能力，不能直接执行写操作或声明式目录项。',501);
 return READERS[id](s,params);
}

export function isWrite(t:Pick<FlowTask,'functionId'|'params'>):boolean{
 const a=String(t.params.action||'');
 // A portfolio review only reads; saving the user's own review note is the one write.
 if(t.functionId==='IN16')return t.params.action==='note';
 if(['TR04','TR05','TR08','TR09','TR10','BI08','SU03','IN05','IN13','IN14','CA03','CA04','CA05','CA07','CA08','CA09'].includes(t.functionId)&&['list','get','query','status','guide'].includes(a))return false;
 return ['TR03','TR04','TR05','TR07','TR08','TR09','TR10','BI03','BI08','SU02','SU03','SU04','SU06','IN01','IN02','IN04','IN05','IN08','IN09','IN12','IN13','IN14','CA03','CA04','CA05','CA06','CA07','CA08','CA09'].includes(t.functionId);
}
export function needsAuth(t:FlowTask){return isWrite(t)&&(t.functionId==='IN01'&&t.params.autoSave===true||['TR03','TR04','SU04','SU06','IN02','IN08','IN09','IN12','IN13','CA03','CA04','CA05','CA06','CA07','CA08','CA09'].includes(t.functionId));}

/** Re-run these from server-owned state both before review and immediately before effect. */
export function preflight(s:BankState,t:FlowTask){
 const p=t.params,id=t.functionId,a=String(p.action||'');
 if(['TR03','TR04'].includes(id)&&(t.riskSignals?.length||/刷单|解冻费|安全账户|保证金|跑分/.test(String(p.note||''))))throw new WorkflowError('命中转账风险信号；升级核验尚未接入，已暂停，不以口头安全确认绕过。');
 if(ACTIONS[id]&&p.action&&!ACTIONS[id].includes(a))throw new WorkflowError('该功能不支持这个操作。');
 for(const key of ['amount','target','total','savePerPeriod'])if(p[key]!=null)cents(p[key]);
 if(p.accountId)account(s,p.accountId);
 if(id==='TR04'&&p.recipientId&&!contactsOf(s).some(c=>c.id===p.recipientId))throw new WorkflowError('周期转账收款人不在已支持的演示联系人中。');
 const entity:Record<string,string>={goalId:'goals',productId:'products',holdingId:'holdings',orderId:'orders',cardId:'cards',oldCardId:'cards',newCardId:'cards',subscriptionId:'subscriptions',transactionId:'transactions',ruleId:'rules',planId:'rules',reminderId:'reminders',applicationId:'applications',replacementId:'replacements',recordId:'relations',sessionId:'aa',contactId:'contacts'};
 for(const [key,kind]of Object.entries(entity))if(p[key])getRow(s,kind,p[key]);
 if(id==='IN05'&&a!=='status'){
  if(!Array.isArray(p.answers)||p.answers.length!==3||!p.answers.every(x=>Number.isInteger(x)&&Number(x)>=1&&Number(x)<=5))throw new WorkflowError('演示问卷需要 3 个 1 至 5 的明确答案；不能由模型代答。');
 }
 if(id==='BI03'&&p.scope&&!['single','future'].includes(String(p.scope)))throw new WorkflowError('分类更正仅支持仅本笔或未来规则，历史批量暂未接入。');
 if(['TR04','IN13'].includes(id)&&['create','update','resume'].includes(a)&&!p.schedule&&a==='create')throw new WorkflowError('请明确周期。');
 if(id==='IN01'&&boolean(p,'autoSave')&&(!p.accountId||!p.schedule))throw new WorkflowError('自动转存需要明确账户、周期并单独授权。');
 // A fixed per-run amount the user named needs no monthly recomputation, so a goal without a deadline still takes it.
 if(id==='IN01'||id==='IN04'&&a==='update'&&!(p.amount!=null&&!p.deadline&&!rows(s,'goals').find(g=>g.id===p.goalId)?.deadline))goalPlan(s,p);
 if(id==='IN02'){
  if(!['deposit','withdraw'].includes(String(p.direction)))throw new WorkflowError('请选择存入还是取出。');
  const g=getRow(s,'goals',p.goalId),amount=cents(p.amount),balance=p.direction==='deposit'?availableBalance(account(s,p.accountId)):num(g,'balance');
  if(g.status==='closed')throw new WorkflowError('目标已关闭，请选择可用目标。');
  if(balance<amount)throw new WorkflowError('可用余额不足，请修改金额。');
 }
 if(id==='IN08'||id==='IN13'&&['create','update','resume'].includes(a)){
  const product=p.productId?getRow(s,'products',p.productId):getRow(s,'products',getRow(s,'rules',p.planId).productId);
  const profile=s.workflows!.riskProfile;
  if(!profile||Date.parse(profile.validUntil)<businessNow(s))throw new WorkflowError('需要先完成有效的演示风险测评，再返回本次购买。');
  if(Number(product.risk)>profile.level)throw new WorkflowError('产品风险高于当前演示测评结果，请重新选择产品。');
  if(p.amount&&p.accountId&&availableBalance(account(s,p.accountId))<cents(p.amount))throw new WorkflowError('账户可用余额不足。');
  step(t,'I09','使用后台画像与产品风险检查',()=>true);
 }
 if(id==='IN09'&&(redemptionQuote(s,p) as {fee:unknown}).fee==null)throw new WorkflowError('当前合成产品赎回费用未知，暂不受理；请先核对产品数据。');
 if(id==='IN09'&&cents(p.amount)>num(getRow(s,'holdings',p.holdingId),'value'))throw new WorkflowError('赎回金额超过可赎持仓。');
 if(id==='IN12')assertCancellation(getRow(s,'orders',p.orderId),businessNow(s));
 if(['SU04','SU06'].includes(id)){
  const sub=getRow(s,'subscriptions',p.subscriptionId);
  if(sub.protected||/贷款|分期|助贷|社保|医保|学费|物业|房租|合约|先学后付/.test(String(sub.name)))throw new WorkflowError('此项属于保护类代扣，本沙箱不提供一键解约；请先联系对应官方渠道。');
  if(id==='SU06'&&sub.status!=='cancelled')throw new WorkflowError('只有本沙箱中已解除的银行协议可恢复。');
  step(t,'D04','核实取消/恢复通道能力',()=>true);
  if(id==='SU04')step(t,'D05','检查保护名单及合约后果',()=>true);
 }
 if(id.startsWith('CA')&&p.cardId){
  const c=getRow(s,'cards',p.cardId);
  if(['CA05','CA06'].includes(id)&&c.restriction==='judicial'&&!(id==='CA05'&&a!=='unlock'))throw new WorkflowError('司法限制不能通过自助操作解除，请联系开户机构核实官方程序。');
  if(c.status==='lost'&&id==='CA06')throw new WorkflowError('正式挂失卡不能再通过临时解冻恢复。');
  if(c.status==='lost'&&id==='CA05'&&a==='unlock')throw new WorkflowError('正式挂失卡不能通过解除限制恢复。');
  if(id==='CA06'&&a==='unfreeze'&&(c.status!=='frozen'||c.restriction!=='none'))throw new WorkflowError('临时解冻只恢复自己临时冻结且无其他限制的卡；风险限制需单独核实解除。');
  if(id==='CA08'&&a==='request'&&(c.status!=='lost'||c.restriction==='judicial'))throw new WorkflowError('本沙箱仅支持已正式挂失且无司法限制的卡申请补卡。');
  if(id==='CA04'&&isWrite(t)&&p.limitType==='credit'&&a!=='request')throw new WorkflowError('授信额度只能提交申请，不能直接设置。');
 }
 if(id==='CA08'&&a==='activate'){
  const replacement=getRow(s,'replacements',p.replacementId),old=getRow(s,'cards',replacement.cardId);
  if(replacement.cardId!==p.cardId)throw new WorkflowError('补卡申请与当前选择的旧卡不匹配。');
  if(replacement.status!=='requested'||old.status!=='lost'||old.restriction==='judicial')throw new WorkflowError('补卡或原卡状态不支持激活，请核实最新记录。');
 }
 if(id==='CA09'&&a==='mark_done'&&getRow(s,'bindings',p.bindingId).cardId!==p.oldCardId)throw new WorkflowError('绑定项不属于当前选择的旧卡。');
 const scheduled=id==='TR07'?rows(s,'transfers').find(r=>r.id===p.transferId):undefined;
 if(scheduled&&(scheduled.status!=='scheduled'||businessNow(s)>=Date.parse(String(scheduled.releaseAt))))throw new WorkflowError('这笔转账已到账或已撤销，不能再撤回；已结算资金不能单方撤回。');
 if(id==='TR07'&&!scheduled&&(!s.task||s.task.id!==p.transferId||['complete','cancelled'].includes(s.task.step)))throw new WorkflowError('此指令已完成或不属于当前可取消草稿；已到账的转账不能撤回。');
 if(id==='TR05'&&a==='create'){
  assertAaLimit(s,Number(p.total),businessNow(s));
  if(!Array.isArray(p.participants))throw new WorkflowError('AA 参与者须为 2 至 20 人。');
  aaShares(cents(p.total),p.participants as string[],(p.adjustments as AaItem[])||[]);
 }
 // One named person per invitation, sent once: a second request for the same person is answered from the record.
 if(id==='TR10'&&a==='create'){const name=inviteeName(p.invitee),sent=existingInvite(s,name);if(sent)throw new WorkflowError(`已经给${name}发过邀请（${String(sent.createdAt).slice(0,10)}，模拟通道），不重复发送。可以说“看看邀请状态”。`);}
 if(id==='TR05'&&a==='remind'&&!reminderDrafts(getRow(s,'aa',p.sessionId)).length)throw new WorkflowError('名单里的人都已付款，没有需要提醒的对象。');
 if(id==='BI09'&&(!Number.isInteger(p.periodCount)||Number(p.periodCount)<1||Number(p.periodCount)>600))throw new WorkflowError('期数应为 1 至 600 的整数。');
 // A zero or false rate is the principal-only estimate that is implemented.
 if(id==='BI09'&&p.interestAssumption!=null&&p.interestAssumption!==false&&Number(p.interestAssumption)!==0)throw new WorkflowError('本版只实现本金试算，利率试算工具尚未接入。');
 if(id==='SU03'&&a==='create'&&(!Number.isInteger(p.leadDays)||Number(p.leadDays)<0||Number(p.leadDays)>30))throw new WorkflowError('提前天数须为 0 至 30 的整数。');
 if(['SU03','IN14'].includes(id)&&p.notifyChannel&&p.notifyChannel!=='in_app')throw new WorkflowError('本沙箱只支持站内提醒。');
}

/**
 * Suitability read before any amount is asked: without a valid formal assessment, or with a product above it,
 * the purchase stops here instead of collecting fields it can never use. A level the user states in words is not an assessment.
 */
export function suitabilityStop(s:BankState,t:Pick<FlowTask,'functionId'|'params'>):string|undefined{
 const a=String(t.params.action||'');
 if(!(t.functionId==='IN08'||t.functionId==='IN13'&&['create','update'].includes(a)))return;
 const profile=s.workflows?.riskProfile,valid=!!profile&&Date.parse(profile.validUntil)>=businessNow(s);
 const product=t.params.productId?rows(s,'products').find(r=>r.id===t.params.productId):undefined;
 if(!valid)return `买${product?.name||'理财产品'}前需要先完成有效的演示风险测评；口头说的测评结果不能代替正式测评。先带你做测评，做完再回到这笔购买。`;
 if(product&&num(product,'risk')>profile!.level){
  const fits=rows(s,'products').filter(r=>num(r,'risk')<=profile!.level).map(r=>`${r.name}（R${num(r,'risk')}）`);
  return `你的测评是C${profile!.level}，${product.name}是R${num(product,'risk')}，风险高于测评结果，按适当性规则不能购买。${fits.length?'可以改选'+fits.join('、')+'，':''}或重新测评后再看。`;
 }
}

const LOSS_POINTS=['净值会下跌，本金可能亏损；过去的收益不代表未来','申购、赎回和管理费用会吃掉一部分收益','急用钱时赎回要等到账，市场不好时可能被迫低价卖出','只用短期内不用的闲钱，先留够生活费和应急金'];
/** Lesson plus the suitability reading. The lesson is voluntary; only the formal profile and the product rule decide eligibility. */
function learnResult(s:BankState,p:Params){
 const profile=s.workflows?.riskProfile as {level:number;validUntil:string}|null|undefined,valid=!!profile&&Date.parse(profile.validUntil)>businessNow(s);
 const products=rows(s,'products'),product=products.find(x=>num(x,'risk')>1)||products[0];
 const match=!product?null:!valid?'need_profile':num(product,'risk')<=profile!.level?'match':'not_match';
 const fit=!product?'':!valid?`买${product.name}前需先完成有效的正式风险测评。`:`你的测评是C${profile!.level}，${product.name}是R${num(product,'risk')}，按模拟机构规则表${match==='match'?'匹配':'不匹配'}。`;
 return {topic:p.topic||'理财可能怎么亏',content:LOSS_POINTS.join('；')+'。',points:LOSS_POINTS,profile:valid?{level:profile!.level,validUntil:profile!.validUntil}:null,product:product?{id:product.id,name:product.name,risk:num(product,'risk')}:null,match,
  spokenSummary:'投教不是购买门槛。可能亏在几处：净值下跌亏本金、费用吃掉收益、急用钱时赎回慢或低价卖出。能否交易只看有效正式测评、机构适当性规则和产品规则。'+fit,synthetic:true,assessmentChanged:false};
}

export function queryBusiness(s:BankState,t:FlowTask):unknown{
 const p=t.params,id=t.functionId;
 switch(id){
  case 'IN05':return step(t,'I06','查询当前会话已保存的测评画像',()=>{const profile=readTool(s,'I06');return {assessmentState:!profile?'not_found':Date.parse((profile as {validUntil:string}).validUntil)>businessNow(s)?'valid':'expired',profile:profile?{level:(profile as {level:number}).level,validUntil:(profile as {validUntil:string}).validUntil}:null,notice:'查询已成功；以上仅反映当前沙箱会话保存的记录，不代表其他机构或历史账户情况。'};});
  case 'TR01':return step(t,'T01','读取会话账户列表',()=>readTool(s,'T01',p));
  case 'TR02':return step(t,'T02','读取当前真实沙箱余额',()=>readTool(s,'T02',p));
  case 'TR06':return step(t,'T08','查询已保存模拟转账',()=>{
   const all=[...s.receipts,...rows(s,'transferHistory')] as Row[],payee=(id:unknown)=>contactsOf(s).find(c=>c.id===id);
   // Periods are business days in Beijing time, so compare the local date rather than the UTC timestamp.
   return all.filter(r=>(!p.transferId||r.id===p.transferId||r.taskId===p.transferId)&&(!p.recipientId||r.recipientId===p.recipientId)&&(!p.period||businessDay({demoClock:String(r.createdAt)} as BankState).startsWith(String(p.period))))
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(r=>({...transferView(r),recipient:payee(r.recipientId)?`${payee(r.recipientId)!.label}${payee(r.recipientId)!.name}`:undefined}));
  });
  case 'TR04':return step(t,'T10','查询周期资金规则',()=>rows(s,'rules').filter(r=>r.kind==='transfer').map(ruleView));
  case 'TR05':return step(t,'T12','读取 AA 及人工核销来源',()=>rows(s,'aa').filter(r=>!p.sessionId||r.id===p.sessionId));
  case 'TR08':return step(t,'T14','读取沙箱联系人',()=>[...contactsOf(s),...rows(s,'contacts')]);
  case 'TR09':return step(t,'T15','查询个人辅助往来记录',()=>rows(s,'relations'));
  case 'TR10':return step(t,'T19','读取已发出的邀请及状态',()=>rows(s,'invites').map(inviteView));
  case 'BI01':return step(t,'B01','查询合成流水并披露覆盖范围',()=>readTool(s,'B01',p));
  case 'BI02':return step(t,'B03','计算确定性统计，退款冲减支出',()=>readTool(s,'B03',p));
  case 'BI04':return step(t,'B05','根据实际关联记录核对，不直接定性',()=>({transactions:filtered(s,p).filter(r=>!p.transactionId||r.id===p.transactionId||r.originalId===p.transactionId),signals:filtered(s,p).filter(r=>r.suspectedDuplicate).map(r=>({transactionId:r.id,reason:'合成数据标记为疑似重复，需核实',verdict:'unknown'}))}));
  case 'BI05':return step(t,'D01','周期记录候选共享，无 App 活跃度数据',()=>({subscriptions:rows(s,'subscriptions'),inference:'周期扣费只说明候选；是否闲置需要用户确认'}));
  case 'BI06':{
   const result=step(t,'B08','基础报告由确定性统计生成',()=>({...monthlyReport(s,p,aggregate(s,p)),narrative:p.narrative?'本版仅按真实统计生成简述，不引用对话或虚构经历':undefined,peerComparison:p.peerComparison?'未接入匿名群体数据，未生成分位':undefined}));
   if(p.share){const x=t.steps.find(x=>x.toolId==='S15');if(x){x.status='blocked';x.reason='分享海报适配器尚未接入，未生成或发布物料。';}return {...result,share:'分享海报尚未接入，未生成或发布物料'};}return result;
  }
  case 'BI08':return step(t,'B09','预算查询及实际消费进度',()=>({budgets:rows(s,'budgets'),spending:aggregate(s,p)}));
  case 'BI09':return step(t,'B10','本金累计；不隐含收益率',()=>({total:cents(p.savePerPeriod)*Number(p.periodCount),periodCount:p.periodCount,assumption:'每期节省 '+p.savePerPeriod+' 元；仅计算本金，不代表实际已存入'}));
  case 'SU01':return step(t,'D02','返回当前协议、来源和未知字段',()=>readTool(s,'D02',p));
  case 'SU03':return step(t,'D10','读取现有提醒设置',()=>rows(s,'reminders').filter(r=>r.subscriptionId===p.subscriptionId));
  case 'SU05':return step(t,'D08','区分银行状态与外部用户报告',()=>({subscription:getRow(s,'subscriptions',p.subscriptionId),...subscriptionView(getRow(s,'subscriptions',p.subscriptionId)),cancellations:rows(s,'cancellations').filter(r=>r.subscriptionId===p.subscriptionId),coverage:'仅沙箱协议状态；外部平台无自动核验接口'}));
  case 'SU07':return step(t,'D12','分开真实扣费和预计未来少支出',()=>({subscriptions:rows(s,'subscriptions'),actual:aggregate(s,{...p,category:'订阅'}),projectedMonthlyReduction:rows(s,'subscriptions').filter(r=>r.status==='cancelled'&&r.cycle==='monthly').reduce((n,r)=>n+num(r,'amount'),0)}));
  case 'SU08':return step(t,'D11','只计算已知扣款日，不移动商户日期',()=>fundsCalendar(s));
  case 'IN03':return step(t,'I03','只读取已入账目标余额',()=>{const g=getRow(s,'goals',p.goalId),remaining=num(g,'target')-num(g,'balance');return {...g,remaining,progress:num(g,'target')?num(g,'balance')/num(g,'target'):0,projection:goalProjection(s,remaining)};});
  case 'IN06':return step(t,'I07','读取合成产品及费率',()=>readTool(s,'I07',p));
  case 'IN07':return step(t,'I08','按相同字段比较指定产品',()=>{if(!Array.isArray(p.productIds)||p.productIds.length<2)throw new WorkflowError('请选择至少两项产品。');return compareProducts(p.productIds.map(x=>getRow(s,'products',x)));});
  case 'IN10':return step(t,'I15','净值、成本与收益同口径；合成数据',()=>rows(s,'holdings').filter(r=>!p.holdingId||r.id===p.holdingId).map(r=>({...r,profit:num(r,'value')-num(r,'cost'),asOf:now(s),synthetic:true})));
  case 'IN11':return step(t,'I13','查询订单实际状态',()=>rows(s,'orders').filter(r=>(!p.orderId||r.id===p.orderId)&&(!p.period||String(r.createdAt).startsWith(String(p.period)))).map(orderView));
  case 'IN13':return step(t,'I16','读取定投规则及当前状态',()=>rows(s,'rules').filter(r=>r.kind==='investment'));
  case 'IN14':return step(t,'I17','读取用户自设提醒',()=>rows(s,'reminders').filter(r=>r.kind==='investment'));
  case 'IN16':return step(t,'I19','按持仓与已结算订单复盘；不给买卖建议、不预测收益',()=>portfolioReview(s,p));
  case 'IN15':return step(t,'I18','演示投教内容不写入风险画像',()=>learnResult(s,p));
  case 'CA01':return step(t,'C01','读取本行沙箱卡片列表',()=>readTool(s,'C01',p));
  case 'CA02':return step(t,'C01','按会话权限披露沙箱卡片信息',()=>readTool(s,'C01',p));
  case 'CA03':return step(t,'C02','按用途解释路径或读取实际收件状态',()=>p.action==='guide'?cardApplicationGuide(p):rows(s,'applications').filter(r=>!p.applicationId||r.id===p.applicationId));
  case 'CA04':return step(t,'C03','只解释可公开的合成额度字段',()=>({card:getRow(s,'cards',p.cardId),explanation:'这是沙箱交易限额；本版没有银行授信审批数据，不推测审批原因'}));
  case 'CA05':return step(t,'C04','按限制类型分流，司法限制不提供自助解锁',()=>judicialGuide(getRow(s,'cards',p.cardId)));
  case 'CA07':return step(t,'C06','读取实际沙箱挂失状态',()=>lossView(getRow(s,'cards',p.cardId)));
  case 'CA08':return step(t,'C07','读取补卡状态，不伪造配送结果',()=>rows(s,'replacements').filter(r=>!p.replacementId||r.id===p.replacementId));
  case 'CA09':return step(t,'C08','读取已记录绑定清单，未授权来源不补全',()=>({bindings:rows(s,'bindings').filter(r=>r.cardId===p.oldCardId),subscriptions:rows(s,'subscriptions'),notice:'当前仅合成绑定信息；不承诺掌握完整第三方绑定关系'}));
  default:throw new WorkflowError('此功能的查询适配器尚未接入。',501);
 }
}

export function executeBusiness(s:BankState,t:FlowTask):unknown{
 const p=t.params,id=t.functionId,a=String(p.action||''),ts=now(s);
 switch(id){
  case 'IN01':return step(t,'I02','创建目标；自动转存默认关闭',()=>{const g=add(s,'goals',{id:uuid('goal'),name:p.name,target:cents(p.target),balance:0,deadline:p.deadline,status:'active'});const savingRule=p.autoSave===true?step(t,'T10','明确请求才建立已确认的自动储蓄规则',()=>add(s,'rules',{id:uuid('rule'),kind:'goal',goalId:g.id,accountId:p.accountId,amount:p.amount!=null?cents(p.amount):goalPlan(s,p).monthlyAmount,...(p.amount!=null?{fixed:true}:{}),schedule:p.schedule,status:'active',authorizedAt:ts,execution:'仅保存规则，尚未接入自动扣款调度'})):undefined;return {...g,autoSave:p.autoSave===true,...(savingRule?{savingRule,notice:'已保存自动转存规则，但自动扣款调度尚未接入。'}:{})};});
  case 'IN02':return step(t,'I04','原子更新来源/目标余额及统一流水',()=>{const g=getRow(s,'goals',p.goalId),acc=account(s,p.accountId),c=cents(p.amount);if(p.direction==='deposit'){acc.balance-=c;g.balance=num(g,'balance')+c;}else{acc.balance+=c;g.balance=num(g,'balance')-c;}record(s,c,acc.id,'internal_transfer',String(g.name),g.id);return {goal:g,accountId:acc.id,balance:acc.balance,moved:c,direction:p.direction};});
  case 'IN04':return step(t,'I02','修改目标不自动移动资金',()=>{const g=getRow(s,'goals',p.goalId);if(p.target!=null)g.target=cents(p.target);if(p.deadline)g.deadline=p.deadline;if(a==='update'){if(g.deadline){const plan=goalPlan(s,{goalId:g.id});g.monthlyAmount=plan.monthlyAmount;g.planBasis=plan.basis;replanGoalRules(s,g);}
   // “每月10号自动转1000进旅游储蓄”: a fixed amount the user named replaces the computed one on this goal's rule.
   if(p.amount!=null)step(t,'T10','按用户指定金额保存目标自动转存规则',()=>{const existing=rows(s,'rules').find(r=>r.kind==='goal'&&r.goalId===g.id),limits=standingLimits(cents(p.amount),p.schedule),fields={accountId:p.accountId||existing?.accountId||'daily',amount:cents(p.amount),schedule:p.schedule||existing?.schedule,fixed:true,status:'active',authorizedAt:ts,maxRuns:limits.runs,cumulativeCap:limits.cap,expiresAt:new Date(businessNow(s)+limits.days*86400000).toISOString(),runs:0};if(existing)Object.assign(existing,fields);else add(s,'rules',{id:uuid('rule'),kind:'goal',goalId:g.id,...fields,execution:'仅保存规则，尚未接入自动扣款调度'});});}if(a==='close'){if(num(g,'balance')>0)throw new WorkflowError('目标内仍有资金，请先明确取出再关闭。');g.status='closed';}if(['pause','resume'].includes(a))step(t,'T10','更新该目标关联自动规则',()=>{const rs=rows(s,'rules').filter(r=>r.goalId===g.id);if(!rs.length)throw new WorkflowError('该目标没有自动转存规则。');rs.forEach(r=>r.status=a==='pause'?'paused':'active');});return g;});
  case 'IN05':return step(t,'I05','仅使用用户明确答案计算演示画像',()=>{const answers=p.answers as number[];const level=Math.max(1,Math.min(5,Math.floor(answers.reduce((n,x)=>n+x,0)/3)));const profile={level,answers,validUntil:new Date(businessNow(s)+365*86400000).toISOString()};s.workflows!.riskProfile=profile;add(s,'questionnaires',{id:uuid('risk'),level,answers,createdAt:ts,label:'合成三题演示问卷，非机构正式测评'});return {...profile,notice:'仅为沙箱问卷评分，不构成真实适当性资格'};});
  case 'IN08':return step(t,'I12','提交沙箱申购，资金与订单原子写入',()=>{const acc=account(s,p.accountId),c=cents(p.amount),product=getRow(s,'products',p.productId);acc.held=(acc.held||0)+c;const order=add(s,'orders',{id:uuid('order'),action:'subscribe',productId:product.id,name:product.name,accountId:acc.id,amount:c,held:true,status:'pending',createdAt:ts,cancelUntil:cancellationDeadline(businessNow(s)),cancellationPolicy:'演示按北京时间当日24:00；真实规则须机构确认',synthetic:true});return {...orderView(order),balance:acc.balance,available:availableBalance(acc),held:acc.held,message:'已受理，资金已占用、尚未扣款；份额待确认，不是已确认持仓'};});
  case 'IN09':return step(t,'I12','沙箱赎回受理，到账前不增加账户余额',()=>{const h=getRow(s,'holdings',p.holdingId),c=cents(p.amount),reservedCost=Math.round(num(h,'cost')*c/num(h,'value'));h.value=num(h,'value')-c;h.cost=num(h,'cost')-reservedCost;const o=add(s,'orders',{id:uuid('order'),action:'redeem',holdingId:h.id,productId:h.productId,accountId:p.accountId,amount:c,reservedCost,status:'pending',createdAt:ts,synthetic:true});return {...orderView(o),...redemptionQuote(s,p),message:'赎回已受理，资金尚未到账。可在沙箱推进结算后查询。'};});
  case 'IN12':return step(t,'I14','只撤销 pending 订单并恢复对应资金/持仓',()=>{const o=getRow(s,'orders',p.orderId);if(o.action==='subscribe'){const acc=account(s,o.accountId);if(o.held)acc.held=(acc.held||0)-num(o,'amount');else acc.balance+=num(o,'amount');}else{const h=getRow(s,'holdings',o.holdingId);h.value=num(h,'value')+num(o,'amount');h.cost=num(h,'cost')+num(o,'reservedCost');}o.status='cancelled';return o;});
  case 'IN16':return step(t,'I20','保存本人复盘笔记；不进入风险画像',()=>{const n=add(s,'reviewNotes',{id:uuid('note'),...reviewNote(p,ts)});return {...n,notice:'复盘笔记已保存，只供你自己回看，不改变风险测评或可购买范围。'};});
  case 'BI03':return step(t,'B04','默认仅更正本笔；未来规则另存',()=>{const r=getRow(s,'transactions',p.transactionId);r.category=p.category;r.classificationSource='user-confirmed';r.needsCategoryConfirmation=false;if(p.scope==='future'){const existing=rows(s,'categories').find(x=>x.merchant===r.merchant);if(existing){existing.category=p.category;existing.source='用户明确选择未来规则';}else add(s,'categories',{id:uuid('map'),merchant:r.merchant,category:p.category,source:'用户明确选择未来规则'});}return {transaction:r,scope:p.scope||'single'};});
  case 'BI08':if(a==='estimate')return step(t,'B09','保存用户估算的分项预算',()=>add(s,'budgets',{id:uuid('estimate'),kind:'estimate',name:p.category||'出行预算',...estimate(p.items as EstimateItem[]),createdAt:ts}));
   return step(t,'B09','保存用户确认的预算',()=>{let b=rows(s,'budgets').find(r=>r.period===p.period&&r.category===(p.category||'全部'));if(!b)b=add(s,'budgets',{id:uuid('budget'),period:p.period,category:p.category||'全部'});b.amount=cents(p.amount);return b;});
  case 'SU02':return step(t,'D03','人工确认订阅字段，不自动添加提醒',()=>{const r=a==='create'?add(s,'subscriptions',{id:uuid('sub'),status:'active',protected:false,confirmed:true}):getRow(s,'subscriptions',p.subscriptionId);for(const k of ['name','channel','cycle','nextChargeAt'])if(p[k]!=null)r[k]=p[k];if(p.amount!=null)r.amount=cents(p.amount);return r;});
  case 'SU04':{
   const sub=getRow(s,'subscriptions',p.subscriptionId);
   // Scenes may script the provider's answer; without one a bank mandate stops normally.
   const outcome=String(sub.cancelOutcome||'success');
   if(sub.channel!=='bank'||outcome==='redirect')return step(t,'D07','外部平台仅官方步骤指引，保持待核验',()=>{t.status='external';const c=add(s,'cancellations',{id:uuid('cancel'),subscriptionId:sub.id,status:'external_pending',createdAt:ts});return {...c,...subscriptionView(sub),guide:['打开服务商官方 App 或应用商店','进入账户/订阅管理','选择对应服务并由你本人确认关闭续费'],notice:'未自动登录、未取消、未核验；请完成后查询实际状态'};});
   if(outcome==='failure')throw new WorkflowError(`${sub.name}的取消请求被退回（模拟结果），后续续费仍然有效，余额和以前的扣款都没有变化。可以稍后重试，或到服务方处理。`);
   if(outcome==='pending')return step(t,'D06','取消请求已提交，结果未返回前不当作已取消',()=>{sub.cancellationPending=true;const c=add(s,'cancellations',{id:uuid('cancel'),subscriptionId:sub.id,status:'pending',createdAt:ts});return {...c,subscription:sub,notice:`${sub.name}的取消请求已提交，结果待核对；结果返回前续费仍可能发生，暂不能说已取消。`};});
   return step(t,'D06','仅解除沙箱银行代扣协议，不代表退款或商户合约取消',()=>{sub.status='cancelled';delete sub.cancellationPending;const c=add(s,'cancellations',{id:uuid('cancel'),subscriptionId:sub.id,status:'bank_cancelled',createdAt:ts});return {...c,...subscriptionView(sub),subscription:sub,notice:'已解除沙箱银行代扣；商户权益与退款需单独处理'};});
  }
  case 'SU06':return step(t,'D09','用户重新确认后恢复本沙箱银行协议',()=>{const sub=getRow(s,'subscriptions',p.subscriptionId);if(sub.channel!=='bank')throw new WorkflowError('外部平台不支持本沙箱代恢复。');sub.status='active';return sub;});
  case 'TR04':return step(t,'T10','管理周期资金指令；不立即扣款',()=>ruleView(manageRule(s,'transfer',p)));
  case 'IN13':return step(t,'I16','管理定投指令；不会立即成交',()=>manageRule(s,'investment',p));
  case 'SU03':return step(t,'D10','只建立站内提醒，不等于开启扣款',()=>manageReminder(s,p,'subscription'));
  case 'IN14':return step(t,'I17','用户自设提醒；不自动申购',()=>manageReminder(s,p,'investment'));
  case 'TR08':return step(t,'T14','用户确认的联系人字段',()=>manageSimple(s,'contacts','contactId',p));
  case 'TR09':return step(t,'T15','个人辅助记录，不构成借贷服务',()=>manageSimple(s,'relations','recordId',p));
  case 'TR05':return step(t,'T12','保存 AA 规则及明确的核销来源',()=>{
   if(a==='create'){const total=cents(p.total),plan=step(t,'T11','整数分分摊且总额守恒',()=>aaShares(total,p.participants as string[],(p.adjustments as AaItem[])||[]));return add(s,'aa',{id:uuid('aa'),total,participants:plan.shares,receivable:plan.receivable,received:0,outstanding:plan.receivable,rule:plan.rule,status:'awaiting_participants',notice:'收款单已建立；参与者确认和付款需对方操作，演示中由模拟响应推进',createdAt:ts});}
   const aa=getRow(s,'aa',p.sessionId);
   if(a==='remind'){
    const drafts=step(t,'T13','发送前重新读取付款状态，已付款的人不提醒',()=>reminderDrafts(aa));if(!drafts.length)throw new WorkflowError('名单里的人都已付款，没有需要提醒的对象。');
    const sent=drafts.map(d=>add(s,'reminders',{id:uuid('reminder'),kind:'aa',sessionId:aa.id,...d,channel:'模拟通道',status:'simulated_sent',createdAt:ts}));
    return {reminders:sent,notice:`已通过模拟通道发送${sent.length}条私密提醒（演示用，不是真实消息）；收款进度不变，对方付款后才会更新。`};
   }if(a==='update')throw new WorkflowError('已发出 AA 的复杂改算尚未接入。',501);if(a==='reconcile'){aa.status='manually_reconciled';aa.source='用户手动核销，非支付通道回调';}return aa;
  });
  case 'TR10':{
   const name=inviteeName(p.invitee),text=step(t,'T17','按用户点名的一位同学生成私密邀请文案；不读通讯录',()=>inviteText(name));
   return step(t,'T18','模拟通道发送一次；同一人不重复发送',()=>{const r=add(s,'invites',{id:uuid('invite'),invitee:name,text,perk:INVITE_PERK,channel:'模拟通道（演示）',status:'simulated_sent',createdAt:ts});return {...inviteView(r),notice:`已通过模拟通道把邀请发给${name}（演示，不是真实消息）。对方是否接受要由对方操作，演示里不会自动变化。`};});
  }
  case 'TR07':throw new WorkflowError('已提交转账的延迟撤销通道未接入；可取消未完成草稿。',501);
  case 'CA03':return step(t,'C02','仅模拟收件和申请跟踪，不审批发卡',()=>{if(a==='submit')return add(s,'applications',{id:uuid('application'),productType:p.productType,purpose:p.purpose,status:'received',createdAt:ts,notice:'沙箱收件，尚未审批'});const app=getRow(s,'applications',p.applicationId);if(a==='withdraw')app.status='withdrawn';if(a==='supplement')app.status='supplement_received';return app;});
  case 'CA04':return step(t,'C03','区分交易限额直接设置与授信申请',()=>{const c=getRow(s,'cards',p.cardId);if(p.limitType==='credit')return add(s,'applications',{id:uuid('limit'),cardId:c.id,amount:cents(p.amount),status:'received',kind:'credit_limit'});c.limit=cents(p.amount);return c;});
  case 'CA05':return step(t,'C04','强认证后解除可自助沙箱限制',()=>{const c=getRow(s,'cards',p.cardId);c.status='active';c.restriction='none';return c;});
  case 'CA06':return step(t,'C05','只更新实际沙箱卡状态及保护范围',()=>{const c=getRow(s,'cards',p.cardId);c.status=a==='freeze'?'frozen':'active';return {...c,protection:'仅演示卡状态，不承诺阻断任何真实支付或第三方扣费'};});
  case 'CA07':return step(t,'C06','用户明确确认并认证后正式挂失',()=>{const c=getRow(s,'cards',p.cardId);c.status='lost';c.lostAt=ts;return {...lossView(c),notice:'旧演示卡已正式挂失，不能临时解冻恢复；第三方绑定未自动迁移'};});
  case 'CA08':return step(t,'C07','模拟补卡办理和激活，不伪造快递',()=>{if(a==='request')return add(s,'replacements',{id:uuid('replacement'),cardId:p.cardId,status:'requested',createdAt:ts});const r=getRow(s,'replacements',p.replacementId);if(a==='activate'){r.status='activated';const old=getRow(s,'cards',r.cardId);return add(s,'cards',{...old,id:uuid('card'),name:String(old.name)+'补卡',status:'active',restriction:'none',tail:'0001'});}return r;});
  case 'CA09':return step(t,'C08','仅保存用户报告的换绑，不伪造平台核验',()=>{const b=getRow(s,'bindings',p.bindingId);b.cardId=p.newCardId;b.source='用户报告已换绑，外部未核验';return b;});
  default:throw new WorkflowError('该写操作适配器尚未接入。',501);
 }
}
function manageRule(s:BankState,kind:string,p:Params){
 const a=String(p.action);if(a==='create')return add(s,'rules',{id:uuid('rule'),...p,amount:p.amount!=null?cents(p.amount):0,kind,status:'active',authorizedAt:now(s),execution:'仅保存规则，尚未接入自动扣款调度'});
 const r=getRow(s,'rules',p.ruleId||p.planId);if(r.kind!==kind)throw new WorkflowError('规则类型不匹配。');
 if(a==='update'){for(const k of ['amount','schedule','accountId','productId','recipientId','note'])if(Object.hasOwn(p,k))r[k]=k==='amount'?cents(p[k]):p[k];}
 else r.status=({pause:'paused',resume:'active',delete:'cancelled'}as Record<string,string>)[a]||r.status;return r;
}
function manageReminder(s:BankState,p:Params,kind:string){
 const a=String(p.action);if(a==='create')return add(s,'reminders',{id:uuid('reminder'),...p,kind,status:'active',authorizedAt:now(s),delivery:'站内演示；外部推送尚未接入'});
 const list=rows(s,'reminders').filter(r=>p.reminderId?r.id===p.reminderId:r.subscriptionId===p.subscriptionId);if(!list.length)throw new WorkflowError('没有找到要修改的提醒。');for(const r of list){if(a==='delete')r.status='cancelled';else Object.assign(r,Object.fromEntries(Object.entries(p).filter(([k])=>!['action','reminderId'].includes(k))));}return list;
}
function manageSimple(s:BankState,kind:string,idField:string,p:Params){
 const a=String(p.action);if(a==='create')return add(s,kind,{...p,...(p.amount!=null?{amount:cents(p.amount)}:{}),id:uuid(kind),source:'用户主动录入'});
 const r=getRow(s,kind,p[idField]);if(a==='delete')s.workflows!.records[kind]=rows(s,kind).filter(x=>x.id!==r.id);else if(a==='reconcile')r.status='user_reconciled';else for(const[k,v]of Object.entries(p))if(!['action',idField].includes(k))r[k]=k==='amount'?cents(v):v;return r;
}

/** Explicit sandbox clock action only; never a model-authorized real settlement. */
export function settleOrders(s:BankState){
 const settled:Row[]=[];
 for(const o of rows(s,'orders').filter(r=>r.status==='pending')){
  if(o.action==='subscribe'){
   let h=rows(s,'holdings').find(r=>r.productId===o.productId&&r.accountId===o.accountId);
   if(!h)h=add(s,'holdings',{id:uuid('holding'),productId:o.productId,name:o.name,accountId:o.accountId,value:0,cost:0});
   h.value=num(h,'value')+num(o,'amount');h.cost=num(h,'cost')+num(o,'amount');
   // Settlement is when held money actually leaves the account.
   if(o.held){const acc=account(s,o.accountId);acc.held=(acc.held||0)-num(o,'amount');acc.balance-=num(o,'amount');record(s,num(o,'amount'),acc.id,'investment',String(o.name),o.id,'理财');}
  }else if(o.action==='redeem'){
   account(s,o.accountId).balance+=num(o,'amount');record(s,num(o,'amount'),String(o.accountId),'internal_transfer','沙箱赎回到账',o.id,'理财');
  }else throw new WorkflowError('未知订单类型，未结算。');
  o.status='settled';o.settledAt=now(s);settled.push(orderView(o));
 }
 return {orders:settled,count:settled.length,notice:'仅本会话合成订单按固定演示净值结算，不代表真实市场或机构确认。'};
}

