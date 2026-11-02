import {answerPatch} from '../workflows/questionnaire.ts';
import type { BankState } from '../bank/types.ts';
import { contactsOf, recipientCandidates } from '../bank/recipients.ts';
import { accountCandidates } from '../bank/accounts.ts';
import { cardCandidates } from '../bank/cards.ts';
import { amountFromText } from '../checklists/routing.ts';
import { offlineWorkflow } from '../workflows/offline.ts';
import { functionById } from '../workflows/catalog.ts';
import { choices, normalizedParams } from '../workflows/fields.ts';
import { WorkflowError, type Params } from '../workflows/types.ts';
import type { BalanceFormula, PlanProposal, PlanStep, TaskPlan } from './types.ts';

export function clauses(text:string){
 return text.split(/(?:[，,。；;]?\s*(?:(?:然后|接着|随后|之后|最后)(?!\s*转余额)|再(?=给|从|用|向|转|查|看|拿|把|存|买|冻结|取消|整理))\s*|[；;])/).map(s=>s.trim().replace(/[，,。]+$/g,'')).filter(Boolean);
}
function integer(s:string){return /^\d+$/.test(s)?Number(s):(amountFromText(s+'元').amount??NaN)/100;}
export function balanceFormula(text:string,state:BankState):BalanceFormula|undefined{
 if(!/余额/.test(text))return;
 // Validate whole numeric terms before extracting supported forms; never accept a suffix.
 const number='[-−+负]?\\s*(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+−-]?\\d+)?';
 const numericTerms=[...text.matchAll(new RegExp(number+'\\s*(?:/\\s*'+number+'|%)','g'))];
 const chineseTerms=[...text.matchAll(/([一二两三四五六七八九十百\d.点负+−-]+)分之([一二两三四五六七八九十百\d.点负+−-]+)/g)];
 if(numericTerms.some(m=>! /^(?:\d+\s*\/\s*\d+|\d+(?:\.\d{1,2})?\s*%)$/.test(m[0].trim()))||chineseTerms.some(m=>/[.点负+−-]/.test(m[0]))||/[-−负]\s*一半/.test(text))throw new WorkflowError('比例请使用正整数分数或最多两位小数的百分比，不能截取负号或小数的一部分。');
 let numerator=0,denominator=0;
 const fraction=text.match(/(\d+)\s*\/\s*(\d+)/),chinese=text.match(/([一二两三四五六七八九十百\d]+)分之([一二两三四五六七八九十百\d]+)/);
 if(fraction){numerator=Number(fraction[1]);denominator=Number(fraction[2]);}
 else if(chinese){numerator=integer(chinese[2]);denominator=integer(chinese[1]);}
 else if(/一半/.test(text)){numerator=1;denominator=2;}
 else {const percent=text.match(/(\d+(?:\.\d{1,2})?)\s*%/);if(percent){numerator=Math.round(Number(percent[1])*100);denominator=10000;}else if(/全部|全额/.test(text)){numerator=1;denominator=1;}}
 if(!numerator&&!denominator){if(fraction||chinese||/%/.test(text))throw new WorkflowError('余额比例必须大于0且分母不为0。');return;}
 if(/大概|大约|左右|或者|还是|美元|港币|欧元|日元|USD|HKD|EUR|JPY/i.test(text)||[...text.matchAll(/\d+\s*\/\s*\d+|[一二两三四五六七八九十百\d]+分之[一二两三四五六七八九十百\d]+|一半|全部|全额|\d+(?:\.\d{1,2})?\s*%/g)].length>1)throw new WorkflowError('比例或币种有歧义，请先明确一个人民币余额比例。');
 if(!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)||numerator<=0||denominator<=0||numerator>denominator||denominator>10000)throw new WorkflowError('余额比例必须明确且大于0、不超过全部余额。');
 const account=accountIds(text,state);
 const selector=/余额.{0,7}(?:小|少|低)/.test(text)?'lowest':/余额.{0,7}(?:大|多|高)/.test(text)?'highest':'explicit';
 if(account.length>1)throw new WorkflowError('比例计算涉及多个指定账户，请先明确使用哪一个。');
 return {selector,...(account.length===1?{accountId:account[0]}:{}),numerator,denominator};
}
export function isComplexRequest(text:string,state:BankState){
 const parts=clauses(text);if(parts.length>1&&!parts.slice(1).every(s=>/^(?:不对|改成|改为|改口|应该是)/.test(s)))return true;
 return !!(/转|付款/.test(text)&&balanceFormula(text,state));
}
function accountIds(text:string,s:BankState){return accountCandidates(text,s.accounts).map(a=>a.id);}
export function inferFunction(text:string):string|undefined{
 // Prohibitions constrain the request; they are not a second positive business.
 // Keep the original text for parameter/evidence validation and Plan quotes.
 text=text.split(/[，,。；;]/).filter(part=>!/^(?:先|暂时|现在)?\s*(?:不要|别|不(?:执行|确认|提交|做|是|再))/.test(part.trim())).join('，');
 if(/存入|转入|存进|取出|取钱|转出/.test(text)&&/目标|小金库/.test(text))return 'IN02';
 if(/转账|给.+转|(?:转|付款)\s*[\d零〇一二两三四五六七八九十百千万]/.test(text))return 'TR03';
 if(/余额|哪些账户|账户列表/.test(text))return 'TR02';
 return offlineWorkflow(text)?.functionId;
}
export function hasFunctionScope(text:string,id:string){
 const domains:Record<string,RegExp>={TR:/转|汇|账户|余额|收款|联系人|AA|平摊/,BI:/账单|支出|收入|收支|扣款|消费|流水|交易|预算/,SU:/订阅|会员|续费|代扣/,IN:/目标|小金库|储蓄|基金|理财|投资|测评|申购|赎回|持仓|定投/,CA:/卡|额度|挂失|冻结|解冻/};
 return domains[id.slice(0,2)]?.test(text)||false;
}
export function extractParams(text:string,id:string,state:BankState):Params{
 const parsed=offlineWorkflow(text,state);
 const p:Params={...(parsed?.functionId===id?parsed.params:{})};
 if(id==='IN01'){
  const name=text.match(/(?:名称|命名为|名字叫)[：:\s]*([^，,。；;\s]{1,40})/),target=text.match(/(?:目标|金额)(?:是|为|改成|改为|调整为)?\s*(\d+(?:\.\d{1,2})?)\s*元/),deadline=text.match(/(?:截止|到期)(?:日期|时间)?(?:是|为)?[：:\s]*(20\d{2}-\d{2}-\d{2})/);
  if(name)p.name=name[1];if(target)p.target=Number(target[1]);if(deadline)p.deadline=deadline[1];if(/不要自动存钱|不自动存钱|不要自动转存/.test(text))p.autoSave=false;
 }
 const fields:Record<string,string[]>={TR03:['recipientId','accountId','amount'],IN02:['direction','goalId','accountId','amount'],CA06:['action','cardId'],CA07:['action','cardId'],SU04:['subscriptionId']};
 if(id==='IN05'&&/有没有|做过|记录|结果|查询|查一下/.test(text)&&/测评/.test(text))p.action='status';
 if(id==='IN05'){const task=state.workflows?.tasks.find(t=>t.id===state.workflows?.currentTaskId&&t.functionId==='IN05'),answers=answerPatch(text,task?.params.answers);if(answers)p.answers=answers;}
 const supported=fields[id]||[];
 if(supported.includes('accountId')){const ids=accountIds(text,state);if(ids.length===1)p.accountId=ids[0];}
 if(supported.includes('recipientId')){const contacts=recipientCandidates(text,state.accounts.map(a=>a.tail),contactsOf(state));if(contacts.length===1)p.recipientId=contacts[0].id;}
 if(supported.includes('amount')){
  const clean=text.replace(/尾号\s*\d+/g,'').trim().replace(/[。！!？?，,]+$/g,'');
  const parsed=amountFromText(/^[零〇一二两三四五六七八九十百千万]+$/.test(clean)?clean+'元':clean);
  if(parsed.amount!=null&&!parsed.uncertain&&!/美元|港币|欧元|日元|USD|HKD|EUR|JPY/i.test(text))p.amount=parsed.amount/100;
 }
 if(id==='IN02'&&/存入|转入|存进/.test(text))p.direction='deposit';
 if(id==='IN02'&&/取出|取钱|转出/.test(text))p.direction='withdraw';
 for(const key of supported.filter(k=>['goalId','cardId','subscriptionId'].includes(k))){
  const matched=key==='cardId'?cardCandidates(text,state.workflows?.records.cards||[]):choices(state,key).filter(c=>text.includes(c.value)||c.label.split(' · ').some(label=>label.length>1&&text.includes(label.replace('尾号',''))));
  if(matched.length===1)p[key]='value'in matched[0]?matched[0].value:matched[0].id;
 }
 return normalizedParams(id,p);
}
export function decompose(text:string,state:BankState,proposals?:PlanProposal[]):TaskPlan{
 if(!text.trim()||text.length>2000||/密码|验证码|身份证/.test(text)&&/\d{4,}/.test(text))throw new WorkflowError('请只描述业务步骤，认证信息通过页面输入。');
 // A model split is accepted when its quotes tile the whole sentence in order (punctuation aside);
 // the keyword splitter only knows a few connectives, so it is the fallback, not the judge.
 const bare=(s:string)=>s.replace(/[\s，,。；;：:！!？?、]/g,'');
 const tiled=!!proposals?.length&&proposals.every(p=>bare(p.quote))&&proposals.map(p=>bare(p.quote)).join('')===bare(text);
 const parts=tiled?proposals!.map(p=>p.quote.trim().replace(/^[，,。；;：:\s]+|[，,。；;：:\s]+$/g,'')):clauses(text);if(parts.length>6)throw new WorkflowError('一次最多拆成6项业务，请分批办理。');
 const canonical=(s:string)=>s.trim().replace(/^(?:我要|我想|先|然后|接着|随后|之后|最后|再)+/,'').replace(/^[，,。；;\s]+|[，,。；;\s]+$/g,'');
 if(proposals&&!tiled&&(proposals.length!==parts.length||proposals.some((p,i)=>canonical(p.quote)!==canonical(parts[i]))))throw new WorkflowError('拆解必须按顺序覆盖全部原话，不能删掉不明确的步骤；也可省略tasks让后台拆解。');
 const steps:PlanStep[]=[];
 const append=(step:Omit<PlanStep,'id'|'dependsOn'|'status'>)=>{const next={...step,id:crypto.randomUUID(),dependsOn:steps.length?[steps.at(-1)!.id]:[],status:'pending' as const};steps.push(next);return next;};
 parts.forEach((quote,i)=>{
  const proposal=proposals?.[i],inferred=inferFunction(quote);
  const functionId=proposal&&!inferred&&!tiled&&!hasFunctionScope(quote,proposal.functionId)?undefined:proposal?.functionId||inferred;
  // With a whole-sentence split from the model, its choice stands; keyword inference only guards the fallback.
  if(proposal&&inferred&&proposal.functionId!==inferred&&!tiled)throw new WorkflowError('拆解中的业务与该步骤原话不一致，请澄清用途。',400,'functionId');
  if(/不要(?:再)?(?:从|给|转|付款)|别(?:再)?(?:给|转|从)|不用转/.test(quote))throw new WorkflowError('该步骤是否定转账，请先澄清，不建立付款草稿。');
  if(functionId&&!functionById(functionId))throw new WorkflowError('拆解引用了不存在的用户功能。');
  const params=functionId?normalizedParams(functionId,{...extractParams(quote,functionId,state),...proposal?.params}):{};
  const formula=functionId==='TR03'?balanceFormula(quote,state):undefined;
  let binding:string|undefined;
  if(formula){
   if(proposal?.params?.amount!=null||proposal?.params?.accountId!=null)throw new WorkflowError('比例金额及比较账户由后台计算，不能由模型预填结果。');
   append({kind:'workflow',title:'读取计算所需的账户余额',quote,functionId:'TR02',params:{}});
   const calc=append({kind:'calculation',title:'比较账户并计算比例金额',quote,formula,params:{}});binding=calc.id;delete params.amount;delete params.accountId;
  }
  append({kind:functionId?'workflow':'clarify',title:functionId?functionById(functionId)!.title:'需要明确这一步的用途',quote,functionId,params,...(binding?{binding}:{}),...(!functionId?{question:'“'+quote+'”具体要办理什么？请说明用途、对象和准确金额。'}:{})});
 });
 if(steps.length>12)throw new WorkflowError('拆解后的步骤过多，请缩小本次任务范围。');
 return {id:crypto.randomUUID(),layer:'double',status:'collecting',steps,message:'正在核对步骤及依赖。',createdAt:new Date().toISOString(),log:[]};
}

