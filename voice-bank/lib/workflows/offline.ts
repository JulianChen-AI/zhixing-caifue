import {FIELDS} from './fields.ts';
import type { WorkflowCommand } from './types.ts';
import type { BankState } from '../bank/types.ts';
import { cardCandidates } from '../bank/cards.ts';
import { accountCandidates } from '../bank/accounts.ts';
import { amountFromText } from '../checklists/routing.ts';
import { WorkflowError } from './types.ts';
import {parseBillingQuery,isBillingQuery} from './billing-query.ts';
import { acknowledgesReview } from './review.ts';
type VoiceCommand=Omit<WorkflowCommand,'source'>&{source:'voice'};

/** Only literal acknowledgement of the currently visible, complete review. */
export function explicitWorkflowConfirmation(state:BankState,text:string){
 const task=state.view==='workflow'?state.workflows?.tasks.find(t=>t.id===state.workflows?.currentTaskId):undefined;
 if(!task||task.status!=='review'||!task.reviewToken)return undefined;
 const clean=text.trim().replace(/[。！!\s]+$/,'');
 const generic=/^(?:确认|确定|好的|没问题|可以|确认当前信息|确认当前这项|确定当前这项|信息没错[，,]?就按这份办理|按卡片上的办吧|就按这份办理)$/.test(clean);
 const transfer=task.functionId==='TR03'&&/^(?:确认|确定)(?:(?:当前)?这笔)?转账$/.test(clean);
 const freeze=task.functionId==='CA06'&&(task.params.action==='freeze'&&/^(?:确认|确定)冻结$/.test(clean)||task.params.action==='unfreeze'&&/^(?:确认|确定)解冻$/.test(clean));
 const purchase=task.functionId==='IN08'&&/^(?:确认|确定)(?:申购|购买)$/.test(clean);
 const assessment=task.functionId==='IN05'&&/^(?:确认|确定)当前风险测评信息[，,]?请提交这份测评$/.test(clean);
 return generic||transfer||freeze||purchase||assessment?{operation:'confirm' as const,taskId:task.id,token:task.reviewToken}:undefined;
}

/** Literal withdrawal of the visible unexecuted draft, optionally bound to its original task. */
export function explicitWorkflowCancellation(state:BankState,text:string,targetTaskId?:string){
 const task=state.view==='workflow'?state.workflows?.tasks.find(t=>t.id===state.workflows?.currentTaskId):undefined;
 if(!task||(targetTaskId!==undefined&&targetTaskId!==task.id)||!['collecting','review','authenticate','blocked'].includes(task.status))return;
 const clean=text.trim().replace(/[。！!\s]+$/,'');
 if(task.functionId==='TR03'){
  if(!/^(?:(?:这笔|当前这笔)?转账)?不转了(?:[，,]取消(?:当前)?(?:这笔)?(?:转账)?)?$/.test(clean)&&!/^取消(?:当前)?(?:这笔)?转账(?:草稿)?$/.test(clean))return;
  return {operation:'cancel' as const,taskId:task.id};
 }
 if(task.functionId!=='CA06'||task.params.action!=='freeze')return;
 if(!/^取消(?:这份|这个)(?:还未执行|尚未执行|未执行|还没有执行|尚未确认|未确认|还没有确认|未提交|尚未提交|还没有提交|还没提交)?的?(?:日常卡)?冻结草稿$/.test(clean))return;
 if(clean.includes('日常卡')&&task.params.cardId!=='card-daily')return;
 return {operation:'cancel' as const,taskId:task.id};
}

/** Exact UI-equivalent commands; free-form dialogue and drafts remain model-owned. */
export function explicitLiveCommand(state:BankState,text:string){
 const confirmation=explicitWorkflowConfirmation(state,text);
 // Questionnaire confirmation needs a native tool result so voice can read the completed assessment.
 if(confirmation&&state.workflows?.tasks.find(t=>t.id===confirmation.taskId)?.functionId!=='IN05')return confirmation;
 const clean=text.trim().replace(/[。！!\s]+$/,'');
 if(/^(?:我)?有哪些银行卡[？?，,]?请显示列表$/.test(clean)||/^先(?:查看|查询)(?:我的)?(?:银行卡|卡片)列表[，,]查完继续(?:原来的)?测评$/.test(clean))return {operation:'run' as const,functionId:'CA01',params:{}};
 if(/^(?:查看|查询|查|看看|看一下)(?:我的)?(?:银行卡|卡片)(?:列表)?(?:和当前状态|当前状态|状态)?[？?]?$/.test(clean)||/^(?:我)?有哪些银行卡[？?]?$/.test(clean))return {operation:'run' as const,functionId:'CA01',params:{}};
 return undefined;
}

function selectedParams(text:string,id:string,state:BankState){
 const params:Record<string,unknown>={};
 if(['CA06','CA07'].includes(id)){
  const matched=cardCandidates(text,state.workflows?.records.cards||[]);
  if(matched.length===1)params.cardId=matched[0].id;
  else if(/尾号\s*\d/.test(text))throw new WorkflowError('银行卡信息有歧义，请明确卡名和完整尾号。');
 }
 if(id==='IN07'){
  const products=state.workflows?.records.products.filter(p=>text.includes(String(p.name)))||[];
  if(products.length>=2)params.productIds=products.map(p=>p.id);
 }
 if(id==='IN06'){
  const products=state.workflows?.records.products.filter(p=>text.includes(String(p.name))||text.includes(String(p.name).replace(/^演示/,'')))||[];
  if(products.length===1)params.productId=products[0].id;
 }
 if(id==='IN08'){
  const products=state.workflows?.records.products.filter(p=>text.includes(String(p.name))||text.includes(String(p.name).replace(/^演示/,'')))||[];
  if(products.length===1)params.productId=products[0].id;
  const accounts=accountCandidates(text,state.accounts);if(accounts.length===1)params.accountId=accounts[0].id;
  const parsed=amountFromText(text);if(parsed.amount!=null&&!parsed.uncertain&&!/美元|港币|欧元|日元|USD|HKD|EUR|JPY/i.test(text))params.amount=parsed.amount/100;
 }
 return params;
}

/** Continue the visible business checklist; an acknowledgement never enters an unrelated transfer. */
export function workflowTextAction(state:BankState,text:string):VoiceCommand|null{
 const task=state.view==='workflow'?state.workflows?.tasks.find(t=>t.id===state.workflows?.currentTaskId):undefined;
 if(!task||['complete','cancelled','unsupported','external'].includes(task.status))return null;
 const clean=text.trim().replace(/[。！!\s]+$/,'');
 const base={taskId:task.id,source:'voice' as const,utterance:text,turnId:crypto.randomUUID()};
 if(['review','authenticate'].includes(task.status)&&acknowledgesReview(clean)&&!/(?:冻结|解冻)/.test(clean))return {operation:'confirm',token:task.reviewToken||undefined,...base};
 if(task.functionId==='CA06'&&/^(?:确认|确定)(?:冻结|解冻)$/.test(clean)){
  if(clean.endsWith('解冻')!==(task.params.action==='unfreeze'))throw new WorkflowError('确认的操作与当前摘要不一致，请先修改后重新核对。');
  return {operation:'confirm',token:task.reviewToken||undefined,...base};
 }
 if(/^(?:取消(?:当前任务|这次办理)?|不办了|算了)$/.test(clean))return {operation:'cancel',...base};
 if(/^(?:继续|恢复|继续办理)$/.test(clean))return {operation:'resume',...base};
 if(task.status==='authenticate'&&(/^[\d\s]{4,8}$/.test(clean)||/验证码|密码/.test(clean)))throw new WorkflowError('请在下方专门卡片填写演示验证码，聊天输入不会完成认证或修改金额。');
 if(!['CA06','CA07','IN08'].includes(task.functionId))return null;
 const selected=selectedParams(text,task.functionId,state),routed=offlineWorkflow(text);
 const productReply=task.functionId==='IN08'&&selected.productId&&!/查|看|了解|风险|介绍/.test(text);
 if(routed&&routed.functionId!==task.functionId&&!productReply)return null;
 const params={...(routed?.functionId===task.functionId?routed.params:{}),...selected};
 return Object.keys(params).length?{operation:'amend',params,...base}:null;
}

/** Explicit offline demo convenience only. Native Omni remains the live conversational router. */
export function offlineWorkflow(text:string,state?:BankState):VoiceCommand|null{
 let id:string|undefined;const params:Record<string,unknown>={};
 if(/账单|收支|支出|花了|花费|收入|(?:花|消费).*多少/.test(text)&&!/取消|退订|创建|开通/.test(text))id=/明细|哪笔|最大/.test(text)?'BI01':'BI02';
 else if(/订阅|自动续费|会员/.test(text))id=/取消|退订/.test(text)?'SU04':/提醒/.test(text)?'SU03':'SU01';
 else if(/挂失/.test(text)){id='CA07';params.action=/状态|进度/.test(text)?'status':'report';}
 else if(/解冻|冻住|冻结.*卡|卡.*冻结/.test(text)){id='CA06';params.action=/解冻/.test(text)?'unfreeze':'freeze';}
 else if(/卡片|银行卡|哪些卡|(?:借记卡|信用卡)(?:的)?(?:当前状态|状态|列表)/.test(text))id='CA01';
 else if(/风险测评/.test(text))id='IN05';
 else if(/建.*目标|创建.*储蓄|小金库/.test(text))id='IN01';
 else if(/复盘/.test(text)&&/理财|基金|持仓|投资|笔记/.test(text)){id='IN16';const note=text.match(/笔记[：:]\s*(.+)$/)?.[1]?.trim();if(note){params.action='note';params.note=note;}}
 else if(/对比|比较/.test(text)&&/基金|理财|产品/.test(text))id='IN07';
 else if(/底层|投向|投了什么|买了什么资产/.test(text)&&/基金|理财|产品/.test(text))id='IN06';
 else if(/持仓|赚了|亏了/.test(text))id='IN10';
 else if(/基金|理财产品/.test(text))id=/买|申购/.test(text)?'IN08':'IN06';
 else if(/账单|支出|花了|收入/.test(text))id=/明细|哪笔|最大/.test(text)?'BI01':'BI02';
 if(!id)return null;
 const month=text.match(/(20\d{2})[年-](\d{1,2})月?/);if(month&&FIELDS[id]?.includes('period'))params.period=month[1]+'-'+month[2].padStart(2,'0');
 if(/餐饮/.test(text)&&id.startsWith('BI'))params.category='餐饮';
 if(isBillingQuery(id))Object.assign(params,parseBillingQuery(text,state).params);
 if(/提醒/.test(text)&&id==='SU03')params.action='create';
 if(state)Object.assign(params,selectedParams(text,id,state));
 return {operation:'run',functionId:id,params,source:'voice',utterance:text};
}

