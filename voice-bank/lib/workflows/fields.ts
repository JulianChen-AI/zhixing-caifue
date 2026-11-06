import {answerPatch} from './questionnaire.ts';
import type { BankState } from '../bank/types.ts';
import type { Params, FlowTask, Row } from './types.ts';
import { WorkflowError } from './types.ts';
import { cardCandidates } from '../bank/cards.ts';
import {isBillingQuery,parseBillingQuery,PERIOD} from './billing-query.ts';
import { normalizeAdjustments, type AaItem } from './aa.ts';

export const FIELDS: Record<string, string[]> = {
 TR01:['accountType'],TR02:['accountId'],TR03:['recipientId','accountId','amount','note','saveRecipient','receiptExport','archive'],
 TR04:['action','ruleId','recipientId','accountId','amount','schedule','note'],TR05:['action','sessionId','total','headcount','participants','adjustments','reminder'],
 TR06:['transferId','period','recipientId','receiptExport'],TR07:['transferId'],TR08:['action','contactId','name','alias','phone'],TR09:['action','recordId','person','amount','relatedTransactionId'],
 BI01:['period','accountId','merchant','category'],BI02:['period','accountId','merchant','category','baseline','cashOrNet'],BI03:['transactionId','category','scope'],BI04:['transactionId','period','prepareEvidence'],BI05:['period'],
 BI06:['period','narrative','peerComparison','share'],BI07:['source','file'],BI08:['action','period','category','amount','items'],BI09:['category','savePerPeriod','periodCount','interestAssumption'],BI10:['action','ledgerId','members'],
 SU01:['subscriptionId','channel','status'],SU02:['action','subscriptionId','name','channel','amount','cycle','nextChargeAt'],SU03:['action','subscriptionId','leadDays','notifyChannel'],
 SU04:['subscriptionId','verifyReminder','evidenceExport'],SU05:['subscriptionId','prepareEvidence'],SU06:['subscriptionId'],SU07:['period','includeProjected'],SU08:['period','incomeDates','reserveReminder'],
 IN01:['name','target','deadline','autoSave','accountId','amount','schedule'],IN02:['direction','goalId','accountId','amount','note'],IN03:['goalId','includeProjection'],IN04:['action','goalId','target','deadline','accountId','amount','schedule','ruleId'],
 IN05:['action','assessmentId','answers'],IN06:['productId','riskLevel','type'],IN07:['productIds'],IN08:['productId','accountId','amount'],IN09:['holdingId','amount','accountId'],IN10:['holdingId'],
 IN11:['orderId','period','receiptExport'],IN12:['orderId'],IN13:['action','planId','productId','accountId','amount','schedule'],IN14:['action','reminderId','productId','threshold','remindAt','notifyChannel'],IN15:['topic','choice'],IN16:['action','holdingId','note'],
 CA01:['status'],CA02:['cardId','includeSafetyHistory'],CA03:['action','applicationId','productType','purpose'],CA04:['action','cardId','limitType','amount'],CA05:['cardId','action'],CA06:['action','cardId'],
 CA07:['action','cardId','expiryReminder'],CA08:['action','cardId','replacementId'],CA09:['oldCardId','newCardId','bindingId','action'],CA10:['action','name'],CA11:['action','merchant','limit'],CA12:['action','cardId','amount'],
};
export const LABELS: Record<string,string> = {headcount:'人数（含你）',archive:'凭证归档到',accountId:'账户',recipientId:'收款人',amount:'金额（元）',note:'备注（可选）',name:'名称',target:'目标金额（元）',deadline:'截止日期',direction:'存入或取出',goalId:'目标储蓄',productId:'产品',productIds:'对比产品',holdingId:'持仓',orderId:'订单',cardId:'银行卡',subscriptionId:'订阅',transactionId:'交易',category:'类目',period:'统计期间',baseline:'比较期间',action:'操作',schedule:'周期说明',limitType:'额度类型',assessmentId:'问卷',answers:'演示问卷答案',scope:'更正范围',channel:'通道',cycle:'扣款周期',nextChargeAt:'下次扣款日',leadDays:'提前提醒天数',notifyChannel:'通知方式',ruleId:'资金规则',planId:'定投计划',reminderId:'提醒',transferId:'转账记录',sessionId:'AA 收款',total:'AA 总额（元）',participants:'参与者',adjustments:'分摊调整',incomeDates:'到账日',savePerPeriod:'每期节省（元）',periodCount:'期数',riskLevel:'最高产品风险级别',productType:'卡片类型',purpose:'用途',oldCardId:'旧卡',newCardId:'新卡',bindingId:'绑定项',contactId:'联系人',recordId:'往来记录',person:'往来对象',phone:'手机号',alias:'别名',remindAt:'提醒时间',threshold:'提醒阈值',topic:'学习主题'};
// Billing filters (merchant, category, period) have their own text check with a query-specific message.
const TEXT_KEYS=new Set(['archive','note','name','schedule','deadline','topic','narrative','file','label','query','reason']);
export function normalizedParams(id:string, input:Params):Params {
 const allowed=FIELDS[id]||[];const p:Params={};
 for(const [k,v]of Object.entries(input)){
  if(!allowed.includes(k))throw new WorkflowError('不支持的参数：'+k+'。不能通过参数跳过检查。');
  if(v===undefined)continue;
  if(k==='adjustments'){p[k]=normalizeAdjustments(v);continue;}
  if(k==='items'){p[k]=normalizeEstimate(v);continue;}
  // A model's false for a free-text field means “not given” (null still clears it); any other non-text value is rejected.
  if(TEXT_KEYS.has(k)&&typeof v!=='string'&&v!==null){if(v===false)continue;throw new WorkflowError('“'+(LABELS[k]||k)+'”只接受文字。',400,k);}
  if(k==='headcount'){const n=Number(v);if(!Number.isInteger(n)||n<2||n>20)throw new WorkflowError('AA人数须为 2 至 20 的整数（含你自己）。',400,'headcount');p[k]=n;continue;}
  if(k==='participants'){
   if(!Array.isArray(v)||v.length>20||!v.every(x=>typeof x==='string'&&x.trim()))throw new WorkflowError('AA参与者必须是用户明确给出的姓名或称呼字符串数组；只知道人数时省略participants并补问，不要猜联系人。');
   p[k]=v.map(x=>(x as string).trim());
  }
  else if(typeof v==='string'){if(v.length>500)throw new WorkflowError('字段过长。');p[k]=v.trim();}
  else if(v===null||typeof v==='boolean'||typeof v==='number'||Array.isArray(v)&&v.length<=20&&v.every(x=>typeof x==='string'||typeof x==='number'))p[k]=v;
  else throw new WorkflowError('字段格式不正确：'+k);
 }
 for(const key of ['amount','target','total','savePerPeriod','periodCount','leadDays','riskLevel','threshold'])if(p[key]!=null&&p[key]!==''){
  if(typeof p[key]!=='number'&&(typeof p[key]!=='string'||!/^\d+(?:\.\d+)?$/.test(String(p[key]))))throw new WorkflowError('数值字段格式不正确：'+key);
  const n=Number(p[key]);if(!Number.isFinite(n)||n<0)throw new WorkflowError('请输入有效的'+(LABELS[key]||key));p[key]=n;
 }
 for(const k of ['saveRecipient','autoSave','includeProjection','narrative','peerComparison','share','includeSafetyHistory','verifyReminder','prepareEvidence','includeProjected','reserveReminder','expiryReminder'])if(p[k]!=null&&typeof p[k]!=='boolean')throw new WorkflowError('可选开关必须是布尔值：'+k);
 if(id==='IN05'&&p.answers!=null&&(!Array.isArray(p.answers)||p.answers.length!==3||!p.answers.every(x=>Number.isInteger(x)&&Number(x)>=0&&Number(x)<=5)))throw new WorkflowError('问卷答案需三个0至5的整数，0仅表示未作答。');
 if(p.note!=null&&typeof p.note!=='string')throw new WorkflowError('备注必须是文本或明确清空。');
 if(Object.hasOwn(p,'note')){if(typeof p.note==='string'&&/密码|验证码|身份证|\d{6,}/.test(p.note))throw new WorkflowError('备注不能包含认证或身份信息。');if(p.note==='')p.note=null;}
 for(const k of ['deadline','nextChargeAt','remindAt'])if(p[k]&&!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}.*)?$/.test(String(p[k])))throw new WorkflowError('请使用明确日期，例如 2027-06-01。');
 for(const k of ['deadline','nextChargeAt','remindAt'])if(p[k]&&(!Number.isFinite(Date.parse(String(p[k])))||new Date(String(p[k])).toISOString().slice(0,10)!==String(p[k]).slice(0,10)))throw new WorkflowError('日期不存在或格式不正确。');
 // A review never takes a note: note text means the user asked to save one, so it is never silently dropped.
 if(id==='IN16'&&typeof p.note==='string'&&p.note)p.action='note';
 if(['BI01','BI02'].includes(id)){
  for(const key of ['period','baseline','accountId','merchant','category'])if(p[key]!=null&&typeof p[key]!=='string')throw new WorkflowError('查询条件需填写文本或选择具体选项。',400,key);
  for(const key of ['period','baseline'])if(p[key]&&!PERIOD.test(String(p[key])))throw new WorkflowError('统计期间请填写有效年份或月份，例如 2026-10。',400,key);
 }
 return p;
}
export const readAction=(p:Params)=>['list','get','query','status','guide'].includes(String(p.action));
export function requiredFields(id:string,p:Params):string[]{
 const a=String(p.action||'');
 const base:Record<string,string[]>={TR03:['recipientId','accountId','amount'],TR04:['action'],TR05:['action'],TR07:['transferId'],TR08:['action'],TR09:['action'],BI03:['transactionId','category'],BI08:['action'],BI09:['savePerPeriod','periodCount'],SU02:['action'],SU03:['action','subscriptionId'],SU04:['subscriptionId'],SU05:['subscriptionId'],SU06:['subscriptionId'],IN01:['name','target','deadline'],IN02:['direction','goalId','accountId','amount'],IN03:['goalId'],IN04:['action','goalId'],IN07:['productIds'],IN08:['productId','accountId','amount'],IN09:['holdingId','accountId','amount'],IN12:['orderId'],IN13:['action'],IN14:['action'],CA02:['cardId'],CA03:['action'],CA04:['action','cardId'],CA05:['cardId','action'],CA06:['action','cardId'],CA07:['cardId','action'],CA08:['action','cardId'],CA09:['oldCardId','action']};
 const r=[...(base[id]||[])];
 if(id==='TR04'&&a==='create')r.push('recipientId','accountId','amount','schedule');
 if(id==='TR04'&&!['create','list'].includes(a))r.push('ruleId');
 if(id==='TR05'&&a==='create')r.push('total','participants');if(id==='TR05'&&!['create','list'].includes(a))r.push('sessionId');
 if(id==='TR08'&&a==='create')r.push('name');if(id==='TR08'&&!['create','list'].includes(a))r.push('contactId');
 if(id==='TR09'&&a==='create')r.push('person','amount');if(id==='TR09'&&!['create','list'].includes(a))r.push('recordId');
 if(id==='BI08'&&a==='set')r.push('period','amount');if(id==='BI08'&&a==='estimate')r.push('items');
 if(id==='SU02'&&a==='create')r.push('name','channel','amount','cycle');if(id==='SU02'&&a==='update')r.push('subscriptionId');
 if(id==='SU03'&&a==='create')r.push('leadDays','notifyChannel');
 if(id==='IN01'&&p.autoSave===true)r.push('accountId','schedule');
 if(id==='IN05'&&p.action!=='status')r.push('answers');
 if(id==='IN16'&&a==='note')r.push('note');
 if(id==='IN13'&&a==='create')r.push('productId','accountId','amount','schedule');if(id==='IN13'&&!['create','list'].includes(a))r.push('planId');
 if(id==='IN14'&&a==='create')r.push('remindAt','notifyChannel');if(id==='IN14'&&!['create','list'].includes(a))r.push('reminderId');
 if(id==='CA03'&&a==='submit')r.push('productType','purpose');if(id==='CA03'&&!['submit','list','guide'].includes(a))r.push('applicationId');
 if(id==='CA04'&&['set','request'].includes(a))r.push('limitType','amount');
 if(id==='CA08'&&!['request','list'].includes(a))r.push('replacementId');
 if(id==='CA09'&&a==='mark_done')r.push('bindingId','newCardId');
 return [...new Set(r)];
}
export function choices(state:BankState,field:string):{value:string;label:string}[]{
 const r=state.workflows?.records||{};// Rules, reminders, applications and the like have no name of their own: describe them, never show the internal id.
 const describe=(x:Row)=>{const money=x.total??x.amount,card=r.cards?.find(c=>c.id===x.cardId);return [card?.name,x.person,x.productType,x.purpose,x.schedule,x.remindAt,typeof money==='number'?(money/100).toFixed(2)+'元':null].filter(Boolean).join(' · ');};
 const rowOptions=(rows:Row[])=>rows.map(x=>({value:x.id,label:String(x.name||x.merchant||x.title||describe(x)||x.id)+(x.tail?' · 尾号'+x.tail:'')}));
 const map:Record<string,Row[]>={subscriptionId:r.subscriptions,transactionId:r.transactions,productId:r.products,productIds:r.products,goalId:r.goals,holdingId:r.holdings,orderId:r.orders,cardId:r.cards,oldCardId:r.cards,newCardId:r.cards,ruleId:r.rules,planId:r.rules,reminderId:r.reminders,applicationId:r.applications,replacementId:r.replacements,contactId:r.contacts,recordId:r.relations,sessionId:r.aa,bindingId:r.bindings};
 if(field==='accountId')return state.accounts.map(a=>({value:a.id,label:a.name+' · 尾号'+a.tail}));
 if(field==='recipientId')return contactsOf(state).map(c=>({value:c.id,label:c.label+c.name+' · '+c.tail}));
 if(field==='transferId')return [...(state.task?[{value:state.task.id,label:'当前未完成转账'}]:[]),...(r.transfers||[]).filter(x=>x.status==='scheduled').map(x=>({value:x.id,label:'延迟到账中 …'+x.id.slice(-8)})),...state.receipts.map(r=>({value:r.id,label:'回执 …'+r.id.slice(-8)}))];
 if(map[field])return rowOptions(map[field]);
 const values:Record<string,string[]>={direction:['deposit','withdraw'],channel:['bank','platform'],notifyChannel:['in_app'],cycle:['monthly','yearly'],category:['餐饮','饮品','订阅','居住','人情往来','未分类'],scope:['single','future'],limitType:['transaction','credit']};
 return (values[field]||[]).map(value=>({value,label:({deposit:'存入',withdraw:'取出',bank:'银行直连',platform:'外部平台',monthly:'每月',yearly:'每年',in_app:'站内提醒',single:'仅这一笔',future:'以后同商户',transaction:'交易限额',credit:'授信额度'}as Record<string,string>)[value]||value}));
}
/** Parse only explicit, positive requests; never infer an authorization. */
export function familyBudgetAmount(text:string, contextual=false):number|undefined {
 const match=text.match(/^\s*(?:(?:加一个[，,\s]*)?(?:这周|本周)请爸妈吃饭[，,\s]*(?:先)?留\s*|(?:这周|本周)?\s*聚餐预算(?:设为|改为|改成|是|为)?\s*)(\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)?[。！!\s]*$/);
 const bare=contextual?text.match(/^\s*先留\s*(\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)?[。！!\s]*$/):null;
 const natural=text.match(/^\s*(?:给)?(?:这周|本周)聚餐(?:先)?留\s*(\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)?(?:的)?预算[。！!\s]*$/);
 // “再留400请爸妈吃饭”, the clause of the payday request.
 const reserve=text.match(/^\s*(?:再|先|另外)?留\s*(\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)?\s*请爸妈吃饭[。！!\s]*$/);
 const token=match?.[1]||natural?.[1]||bare?.[1]||reserve?.[1];if(!token)return;
 const parsed=amountFromText(token+'元');
 if(parsed.uncertain||parsed.amount==null||!Number.isSafeInteger(parsed.amount)||parsed.amount<=0)throw new WorkflowError('预算金额不正确。');
 return parsed.amount/100;
}
export function hasFamilyBudgetContext(s:BankState):boolean {
 return !!s.plan?.monthly&&s.plan.steps.some(x=>x.functionId==='BI08'&&x.params.category==='聚餐'&&x.params.period==='本周'&&x.status!=='cancelled'&&x.quote.split('\n').some(quote=>familyBudgetAmount(quote)!=null));
}
export function assertVoiceEvidence(state:BankState,task:Pick<FlowTask,'functionId'|'params'|'recipientChoices'>,params:Params,text:string){
 if(task.functionId==='CA06'&&['freeze','unfreeze'].includes(String(params.action??task.params.action))&&/不(?:要|用|必)?(?:再)?(?:冻结|冻住|锁住|解冻)|别(?:再)?(?:冻结|冻住|锁住|解冻)/.test(text))throw new WorkflowError('冻结或解冻的意图有否定，请先明确操作，不建立变更草稿。');
 for(const [key,value]of Object.entries(params)){
  if(value==null){if(key==='note'&&task.params.note&&!/清空|不.*备注|删除.*备注/.test(text))throw new WorkflowError('清空备注需要用户明确表达。');continue;}
  if(key==='recipientId'){
   const mentioned=recipientIdentityMentioned(text,state.accounts.map(a=>a.tail),contactsOf(state));
   if(task.params[key]===value&&!mentioned)continue;
   const matched=recipientCandidates(text,state.accounts.map(a=>a.tail),contactsOf(state));
   if(typeof value==='string'&&text.includes(value)||matched.length===1&&matched[0].id===value)continue;
   // "第二个" only refers to the candidate list this task last showed.
   const ordinal=text.match(/第\s*([一二两三四五1-5])\s*(?:个|位)/)?.[1],index=ordinal?'一二三四五'.indexOf(ordinal.replace('两','二'))+1||Number(ordinal):0;
   if(index&&!mentioned&&task.recipientChoices?.[index-1]===value)continue;
   const same=ambiguousRecipients(text,state.accounts.map(a=>a.tail),contactsOf(state));
   if(same.length)throw new WorkflowError(recipientChoiceQuestion(same),400,'recipientChoice');
   throw new WorkflowError('收款人的称呼、姓名和完整尾号需一致，请明确选择。');
  }
  if(key==='accountId'){
   const matched=accountCandidates(text,state.accounts);
   if(task.params[key]===value&&!matched.length&&!/日常|储蓄|付款账户|尾号/.test(text))continue;
   if(matched.length===1&&matched[0].id===value)continue;
   throw new WorkflowError('付款账户的名称和完整尾号需一致，请明确选择。');
  }
  if(['cardId','oldCardId','newCardId'].includes(key)){
   const cards=state.workflows?.records.cards||[],matched=cardCandidates(text,cards);
   if(task.params[key]===value&&!matched.length&&!/尾号|日常|储蓄|司法|\d{3,}/.test(text))continue;
   if(matched.length===1&&matched[0].id===value)continue;
   throw new WorkflowError('银行卡的名称和完整尾号需一致，请明确选择哪张卡。');
  }
  if(monetaryFields.has(key)&&typeof value==='number'){
   if(task.functionId==='BI08'&&familyBudgetAmount(text,true)!=null&&familyBudgetAmount(text)==null&&!hasFamilyBudgetContext(state))throw new WorkflowError('请说明预算用途和周期，不能猜测。',400,key);
   const evidence=moneyEvidence(task,params,key,text),amount=evidence.amount;
   if(evidence.mismatch)throw new WorkflowError('AA总额与“每人金额×参与人数”不一致，请明确更正总额或人数。',400,key);
   if(task.params[key]===value&&amount==null&&!amountFromText(text).uncertain&&!unsupportedMoney.test(text)&&!evidence.perPersonMentioned)continue;
   if(amount===Math.round(value*100))continue;
   throw new WorkflowError('“'+(LABELS[key]||key)+'”与用户明确金额不一致，请询问准确金额。',400,key);
  }
  if(key==='items'){assertEstimateEvidence(value as {label:string;amount:number}[],task.params.items as {label:string;amount:number}[]|undefined,text);continue;}
  if(key==='adjustments'){if(JSON.stringify(task.params[key])!==JSON.stringify(value))assertItemEvidence(value as AaItem[],text);continue;}
  if(task.params[key]===value||key==='answers'&&JSON.stringify(task.params[key])===JSON.stringify(value))continue;
  if(key==='merchant'&&isBillingQuery(task.functionId)&&parseBillingQuery(text,state).params.merchant===value)continue;
  if(key==='answers'){
   const expected=answerPatch(text,task.params.answers);
   if(!expected||!Array.isArray(value)||value.length!==3||value.some((v,i)=>v!==expected[i]))throw new WorkflowError('测评答案必须来自本轮明确作答；保留其他题已保存的答案，不代答或清空。');
   continue;
  }
  // A head count is only taken from a number the user said next to 人/位.
  if(key==='headcount'){
   if(task.params[key]===value)continue;
   const said=[...text.matchAll(/(\d+|[一二两三四五六七八九十]+)\s*(?:个)?(?:人|位)/g)].map(m=>countNumber(m[1]));
   if(said.includes(Number(value)))continue;
   throw new WorkflowError('AA人数需要用户明确说出。',400,'headcount');
  }
  if(key==='participants'){
   const previous=Array.isArray(task.params.participants)?task.params.participants as string[]:[];
   const replacing=/换成|替换为|只(?:保留|留)|仅(?:保留|留)|(?:参与者|成员|名单).{0,6}(?:改|换|删|去掉|删除)/.test(text);
   const escape=(name:string)=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   const negated=(name:string)=>{const safe=escape(name);return new RegExp(`(?:不(?:要|用|选|算|含|包括)|别(?:要|选|算)|去掉|删掉|删除|排除|移除|取消|不再).{0,5}${safe}|${safe}.{0,5}(?:不参加|不加入|不算|退出|不含)|${safe}\\s*(?:换成|改为|改成)`).test(text);};
   // “我” is the payer the user speaks for; the rest must be named.
   const named=(name:string)=>(name==='我'||text.includes(name))&&!negated(name),carried=(name:string)=>previous.includes(name)&&!negated(name)&&!replacing;
   if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||!(named(v)||carried(v))))throw new WorkflowError('AA参与者只能使用本轮明确新增或已收集且未被否定的姓名/称呼；只知道人数时省略participants，不得猜联系人。',400,'participants');
   continue;
  }
  // Query filters and inferred routing have no external effect. Side-effect fields still need grounding.
  if(key==='action'){
   if(task.functionId==='BI08'&&value==='set'&&familyBudgetAmount(text,true)!=null)continue;
   if(task.functionId==='IN05'&&/测评|问卷/.test(text)&&(value==='status'&&/查|有没有|是否|做过|记录|结果/.test(text)||value==='assess'&&/开始|做|重新|更新|继续/.test(text)))continue;
   if(task.functionId==='TR05'&&value==='create'&&/A\s*A|分摊|分账/i.test(text))continue;
   const verbs:Record<string,RegExp>={review:/复盘|回顾|看看/,note:/笔记|记下|记一下|写下|记录/,estimate:/预算|估算|算一?下|加起来|合计|一共/,list:/查|哪些|列表|看看/,get:/查|多少|看看/,query:/查|为什么|怎么|看看/,status:/查|进度|成功|怎么样/,guide:/办.*卡|用途|推荐|适合|选.*卡|怎么/,create:/建|新增|添加|设置|设个|定投|记下/,update:/改|更新|调整/,set:/设|调|改/,request:/申请|补卡|提额/,submit:/申请|提交|办.*卡/,withdraw:/撤回|取消申请/,supplement:/补充|补件/,pause:/停|暂停/,resume:/恢复|继续/,delete:/删除|取消|终止|关闭/,close:/关闭|终止/,unlock:/解|恢复.*使用/,freeze:/冻结|冻住|锁住/,unfreeze:/解冻|解开/,report:/挂失/,activate:/激活/,mark_done:/已.*换绑|换绑.*好了/,remind:/提醒|催/,reconcile:/已.*还|已.*付|核销/};
   if(verbs[String(value)]?.test(text))continue;
   throw new WorkflowError('操作类型缺少用户依据，请明确是查询还是变更。');
  }
  if(key==='scope'&&value!=='single'&&!/以后|将来|所有.*商户/.test(text))throw new WorkflowError('扩大分类更正范围需要用户明确选择。');
  if(key==='direction'&&!((value==='deposit'&&/存|转入/.test(text))||(value==='withdraw'&&/取|转出/.test(text))))throw new WorkflowError('请明确存入还是取出。');
  if(['period','baseline','category','cashOrNet','status','riskLevel','type','scope','topic','channel','cycle','notifyChannel','leadDays','direction'].includes(key))continue;
  const label=choices(state,key).find(c=>c.value===value)?.label;
  if(label&&label.split(/ · /).some(s=>s.length>1&&text.includes(s.replace(/尾号/,''))))continue;
  if(typeof value==='string'&&text.includes(value))continue;
  if(typeof value==='number'&&([...text.matchAll(/[-−]?\d+(?:\.\d+)?/g)].some(m=>Number(m[0])===value)||chineseAmount(text)===Math.round(value*100)))continue;
  // A list of records (two products to compare) is grounded when each one was named.
  if(Array.isArray(value)&&value.every(v=>text.includes(String(v))||choices(state,key).find(c=>c.value===v)?.label.split(/ · /).some(s=>s.length>1&&text.includes(s))))continue;
  if(value===false&&/不|不用|不要|别/.test(text))continue;
  if(value===true&&((key==='saveRecipient'&&/保存|存为.*联系人/.test(text))||(key==='autoSave'&&/自动.*存|自动转/.test(text))||(key==='share'&&/分享|海报/.test(text))))continue;
  throw new WorkflowError('“'+(LABELS[key]||key)+'”缺少可核对的用户依据，请询问或在卡片中选择。');
 }
}
/** Drafts may contain semantic interpretations. Only explicit conflicts and separate opt-ins
 * stop drafting; lack of a literal substring is not evidence of a conflict. */
export function validateVoiceDraft(state:BankState,task:FlowTask,params:Params,text:string){
 if(!text.trim())throw new WorkflowError('没有用户发言，不能建立变更草稿。');
 if(task.functionId==='CA06'&&/不(?:要|用|必)?(?:再)?(?:冻结|冻住|锁住|解冻)|别(?:再)?(?:冻结|冻住|锁住|解冻)/.test(text))assertVoiceEvidence(state,task,params,text);
 if(task.functionId==='TR05'&&Object.hasOwn(params,'participants'))assertVoiceEvidence(state,task,{participants:params.participants},text);
 if(task.functionId==='BI08'&&Array.isArray(params.items))assertEstimateEvidence(params.items as {label:string;amount:number}[],task.params.items as {label:string;amount:number}[]|undefined,text);
 if(task.functionId==='TR05'&&Array.isArray(params.adjustments)&&JSON.stringify(params.adjustments)!==JSON.stringify(task.params.adjustments))assertItemEvidence(params.adjustments as AaItem[],text);
 const strict:Params={};
 for(const [key,value]of Object.entries(params)){
  const identity=key==='recipientId'?recipientIdentityMentioned(text,state.accounts.map(a=>a.tail),contactsOf(state))||!!task.recipientChoices?.length&&/第\s*[一二两三四五1-5]\s*(?:个|位)/.test(text):key==='accountId'?/日常|储蓄/.test(text)||state.accounts.some(a=>text.includes(a.tail)):['cardId','oldCardId','newCardId'].includes(key)?/日常|储蓄|尾号/.test(text):false;
  const arithmetic=/减(?:少|去)?|加(?:上)?|多(?:转)?|少(?:转)?|降低|增加/.test(text);
  const evidence=monetaryFields.has(key)?moneyEvidence(task,params,key,text):null;
  const explicitMoney=monetaryFields.has(key)&&(!arithmetic&&evidence?.amount!=null||unsupportedMoney.test(text)||amountFromText(text).uncertain||evidence?.perPersonMentioned===true);
  const optIn=value===true&&['saveRecipient','autoSave','share'].includes(key);
  if(identity||explicitMoney||optIn||key==='answers')strict[key]=value;
 }
 assertVoiceEvidence(state,task,strict,text);
}
function normalizeEstimate(value:unknown){
 if(!Array.isArray(value)||!value.length||value.length>12)throw new WorkflowError('预算分项需为1至12项。');
 return value.map(item=>{
  const {label,amount,...rest}=(item&&typeof item==='object'?item:{}) as Record<string,unknown>,n=Number(amount);
  if(Object.keys(rest).length||typeof label!=='string'||!label.trim()||label.length>20||!Number.isFinite(n)||n<=0||Math.abs(Math.round(n*100)/100-n)>1e-8)throw new WorkflowError('每个预算分项需有名称和大于0的金额。');
  return {label:label.trim(),amount:n};
 });
}
/** Every new or changed estimate line needs its amount in the user's words; unchanged lines carry over. */
function assertEstimateEvidence(items:{label:string;amount:number}[],previous:{label:string;amount:number}[]|undefined,text:string){
 const spoken=[...text.matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0])),chinese=[...text.matchAll(/[零〇一二两三四五六七八九十百千]+/g)].map(m=>countNumber(m[0]));
 for(const item of items)if(!previous?.some(p=>p.label===item.label&&p.amount===item.amount)&&!spoken.includes(item.amount)&&!chinese.includes(item.amount))throw new WorkflowError(`“${item.label}”的金额需要用户明确说出。`,400,'items');
}
/** A carve-out needs its amount and every sharer's name in the user's own words; a head count is not a list. */
function assertItemEvidence(items:AaItem[],text:string){
 const spoken=[...text.matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0])),chinese=[...text.matchAll(/[零〇一二两三四五六七八九十百千]+/g)].map(m=>countNumber(m[0]));
 for(const item of items){
  if(!spoken.includes(item.amount)&&!chinese.includes(item.amount))throw new WorkflowError(`“${item.label}”的金额需要用户明确说出。`,400,'adjustments');
  if(!item.participants.length||item.participants.some(name=>!text.includes(name)))throw new WorkflowError(`请说明“${item.label}”具体是哪几位分摊，不能按人数猜名单。`,400,'adjustments');
 }
}
// Numeric grounding shares the existing Chinese amount parser without changing conversational routing.
import { amountFromText } from '../checklists/routing.ts';
import { contactsOf, recipientCandidates, recipientIdentityMentioned, ambiguousRecipients, recipientChoiceQuestion } from '../bank/recipients.ts';
import { accountCandidates } from '../bank/accounts.ts';
const monetaryFields=new Set(['amount','target','total','savePerPeriod']);
const unsupportedMoney=/美元|港币|港元|欧元|日元|美金|USD|HKD|EUR|JPY|分之|\d\s*\/\s*\d/i;
function monetaryAmount(text:string){
 if(unsupportedMoney.test(text))return null;
 const s=text.replace(/尾号\s*\d+/g,'').replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?/g,'').trim().replace(/[。！!？?，,]+$/g,'');
 const parsed=amountFromText(s);if(parsed.uncertain)return null;if(parsed.amount!=null)return parsed.amount;
 if(/^[零〇一二两三四五六七八九十百千万]+$/.test(s))return amountFromText(s+'元').amount;
 const numbers=[...s.matchAll(/[-−]?\d+(?:\.\d+)?/g)];
 return numbers.length===1&&Number(numbers[0][0])>=0?Math.round(Number(numbers[0][0])*100):null;
}
function countNumber(value:string){
 if(/^\d+$/.test(value))return Number(value);
 const digits:Record<string,number>={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};let section=0,current=0;
 for(const char of value){if(char in digits)current=digits[char];else if(char==='十'){section+=(current||1)*10;current=0;}else if(char==='百'){section+=(current||1)*100;current=0;}else return null;}
 return section+current;
}
function moneyEvidence(task:Pick<FlowTask,'functionId'|'params'>,params:Params,key:string,text:string){
 if(task.functionId==='BI08'&&key==='amount'){const budget=familyBudgetAmount(text,true);if(budget!=null)return{amount:Math.round(budget*100),perPersonMentioned:false,mismatch:false};}
 if(task.functionId!=='TR05'||key!=='total')return{amount:monetaryAmount(text),perPersonMentioned:false,mismatch:false};
 const pattern=/(?:每人|人均|每位|每个(?:人)?|每名)(?:是|为)?\s*[¥￥]?\s*(?:\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)?/g;
 const matches=[...text.matchAll(pattern)],perPersonMentioned=matches.length>0,perPerson=perPersonMentioned?monetaryAmount(matches.at(-1)![0]):null;
 let participantCount:number|null=null;const people=Array.isArray(params.participants)?params.participants:task.params.participants;
 if(Array.isArray(people)&&people.length)participantCount=people.length;
 else {const count=text.match(/(?:^|[^\d])(\d{1,2}|[零〇一二两三四五六七八九十百]+)\s*个?人/)?.[1];if(count)participantCount=countNumber(count);}
 const countPattern=/(?:^|[^\d])(\d{1,2}|[零〇一二两三四五六七八九十百]+)\s*个?人/g;
 const explicitTotal=monetaryAmount(text.replace(pattern,' ').replace(countPattern,' '));
 return{amount:explicitTotal??(perPerson!=null&&participantCount!=null?perPerson*participantCount:null),perPersonMentioned,mismatch:explicitTotal!=null&&perPerson!=null&&participantCount!=null&&explicitTotal!==perPerson*participantCount};
}
function chineseAmount(s:string){const direct=amountFromText(s).amount;if(direct!=null)return direct;return /^[零〇一二两三四五六七八九十百千万]+[。！!？?\s]*$/.test(s)?amountFromText(s.replace(/[。！!？?\s]/g,'')+'元').amount:null;}

