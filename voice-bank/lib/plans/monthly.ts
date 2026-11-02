import type { BankAction, BankState } from '../bank/types.ts';
import { businessDay, businessISO } from '../demo/clock.ts';
import { WorkflowError, type FlowTask } from '../workflows/types.ts';
import { assertVoiceEvidence, validateVoiceDraft, familyBudgetAmount, hasFamilyBudgetContext } from '../workflows/fields.ts';
import { materialize } from './materialize.ts';
import type { PlanStep, TaskPlan } from './types.ts';

/** Only an explicit request selects the saved plan; it is never an authorization. */
export const isMonthlyRequest = (text:string) => /老规矩|(?:本月|这个月|这月|月度)的?(?:安排|计划)/.test(text) && !/不要|别|不按|不是|取消|如果|假设|[?？]/.test(text);
/** Discovery facts let the model select a saved plan without a magic phrase.
 * A saved template is a preference, never salary verification or permission. */
export function savedMonthlyPlans(s:BankState){
 const period=businessDay(s).slice(0,7),saved=s.plan?.monthly?.period===period?s.plan:s.monthlyHistory?.[period];
 const template=s.workflows?.records.rules?.find(r=>r.kind==='monthly_template'&&r.status==='template');
 return saved||template?[{kind:'monthly',period,title:'已保存的月度安排',source:saved?'本月已保存的安排与进度':'已保存的月度模板',notice:'可查看金额、对象、依据和进度；展示不授权付款，不证明工资已到账。',openRequest:{name:'bank_plan',arguments:{operation:'open_saved'}}}]:[];
}
export function openMonthlyPlan(previous:BankState, requestId:string):BankState {
 if(previous.recentRequestIds.includes(requestId))return previous;
 const s=structuredClone(previous), period=businessDay(s).slice(0,7);
 if(s.plan?.monthly?.period!==period&&s.monthlyHistory?.[period]){
  if(s.plan&&!['complete','cancelled'].includes(s.plan.status))throw new WorkflowError('已有未完成任务清单，请先处理后再打开月度计划。');
  if(s.plan?.monthly)s.monthlyHistory[s.plan.monthly.period]=structuredClone(s.plan);
  s.plan=structuredClone(s.monthlyHistory[period]);
 }
 if(s.plan?.monthly?.period===period){
  const own=s.plan.currentTaskId||s.plan.steps.find(x=>!['complete','cancelled'].includes(x.status))?.taskId||s.plan.steps.at(-1)?.taskId;if(own&&s.workflows)s.workflows.currentTaskId=own;
  s.lastReply='这是本月已有的月度计划及进度，不会再创建一套。';s.view='workflow';s.revision++;s.recentRequestIds=[...s.recentRequestIds.slice(-63),requestId];return s;
 }
 const template=s.workflows?.records.rules?.find(r=>r.kind==='monthly_template'&&r.status==='template');
 if(!template){s.lastReply='没找到已保存的月度计划。你想先安排房租、储蓄，还是其他支出？';if(!s.plan||['complete','cancelled'].includes(s.plan.status))s.view='home';s.revision++;s.recentRequestIds=[...s.recentRequestIds.slice(-63),requestId];return s;}
 if(s.plan&&!['complete','cancelled'].includes(s.plan.status))throw new WorkflowError('已有未完成任务清单，请先处理后再打开月度计划。');
 const {accountId,recipientId,goalId,productId}=template;
 if(![accountId,recipientId,goalId,productId].every(x=>typeof x==='string'&&x) || ![template.rent,template.savings,template.investment].every(x=>Number.isSafeInteger(x)&&Number(x)>0))throw new WorkflowError('月度模板信息不完整，请先补齐；没有建立计划。');
 const entry=(title:string,functionId:string,params:Record<string,unknown>,dependsOn:string[]=[]):PlanStep=>({id:crypto.randomUUID(),kind:'workflow',title,quote:'来自已保存月度模板，尚未授权',functionId,params,dependsOn,status:'pending'});
 const rent=entry('房租转账','TR03',{accountId,recipientId,amount:Number(template.rent)/100,note:'房租'});
 const savings=entry('目标储蓄内部划款','IN02',{accountId,goalId,direction:'deposit',amount:Number(template.savings)/100},[rent.id]);
 const investment=entry('模拟投资申请','IN08',{accountId,productId,amount:Number(template.investment)/100},[savings.id]);
 const steps=[rent,savings,investment];if(template.report===true)steps.push(entry('账单报告查询','BI06',{period}));
 if(s.plan?.monthly){s.monthlyHistory||={};s.monthlyHistory[s.plan.monthly.period]=structuredClone(s.plan);}
 const p:TaskPlan={id:crypto.randomUUID(),layer:'double',status:'paused',steps,message:'已读取月度模板，可逐项修改；尚未扣款或授权。请逐项核对并确认。',createdAt:businessISO(s),monthly:{period,templateId:template.id},log:[]};
 s.plan=p;materialize(s,p);
 for(const t of s.workflows!.tasks.filter(t=>p.taskIds?.includes(t.id)))for(const field of Object.keys(t.params))(t.fieldEvidence||={})[field]={source:'saved-template',quote:'来自已保存月度模板，仅供核对，不是执行授权'};
 s.view='workflow';s.lastReply=p.message;s.revision++;s.recentRequestIds=[...s.recentRequestIds.slice(-63),requestId];return s;
}

/** Faults are selected only by the loaded scene, after the ordinary confirmation and authentication checks. */
export function interceptMonthlyAction(previous:BankState,action:BankAction,requestId:string):BankState|null {
 const p=previous.plan;if(!p?.monthly||action.type!=='workflow'||action.command.operation!=='authenticate')return null;
 const t=previous.workflows?.tasks.find(t=>t.id===action.command.taskId),e=p.steps.find(x=>x.taskId===t?.id);
 if(!t||!e||!((previous.sceneId==='S08-F'&&t.functionId==='IN02'&&!p.monthly.savingsFailed)||(previous.sceneId==='S08-U'&&t.functionId==='TR03'&&!p.monthly.rentUnknown)))return null;
 const c=action.command;if(c.source!=='card')throw new WorkflowError('认证只能通过专门页面完成。',403);
 if(t.status!=='authenticate'||!t.verificationId||c.token!==t.verificationId||t.confirmedToken!==t.reviewToken)throw new WorkflowError('认证已失效，请重新核对当前摘要。',409);
 if(c.code!=='123456')throw new WorkflowError('演示验证码是 123456，请勿输入真实密码。');
 const s=structuredClone(previous),plan=s.plan!,task=s.workflows!.tasks.find(x=>x.id===t.id)!,step=plan.steps.find(x=>x.id===e.id)!;
 const unknown=t.functionId==='TR03';if(unknown)plan.monthly!.rentUnknown=true;else plan.monthly!.savingsFailed=true;
 task.status='blocked';task.verificationId=null;task.reviewToken=null;task.confirmedToken=null;task.message=unknown?'模拟房租订单结果待核对，请回查原订单，不能重新付款。':'模拟储蓄失败：演练通道暂不可用，未划款；可重试此项。';
 // The unknown order survives; only the obsolete legacy authentication draft is revoked.
 if(unknown&&s.task?.id===t.legacyTaskId){s.task=null;s.checklist=null;s.routing=null;}
 if(unknown){const transferId=t.legacyTaskId!;(s.workflows!.records.transfers||=[]).push({id:transferId,taskId:t.id,status:'unknown',accountId:t.params.accountId,recipientId:t.params.recipientId,amount:Number(t.params.amount)*100,synthetic:true,notice:'演练原订单结果待回查，未确认扣款'});}
 task.result=unknown?{status:'unknown',originalTaskId:t.id,originalTransferId:t.legacyTaskId,synthetic:true}: {status:'failed',reason:'演练通道暂不可用',synthetic:true};step.status='blocked';step.result=task.result;
 plan.status='blocked';plan.message=task.message+'依赖资金的步骤未执行；预算和报告可单独办理。';s.lastReply=plan.message;s.view='workflow';s.revision++;s.recentRequestIds=[...s.recentRequestIds.slice(-63),requestId];return s;
}

export {familyBudgetAmount,hasFamilyBudgetContext} from '../workflows/fields.ts';
export function appendFamilyBudget(previous:BankState,text:string,requestId:string):BankState|null {
 const amount=familyBudgetAmount(text,hasFamilyBudgetContext(previous));if(!previous.plan?.monthly||amount==null)return null;
 const s=structuredClone(previous),p=s.plan!;
 const existing=p.steps.find(x=>x.functionId==='BI08'&&x.params.category==='聚餐'&&x.params.period==='本周'&&!['complete','cancelled'].includes(x.status));
 if(existing){if(existing.params.amount!==amount)throw new WorkflowError('已有待确认的聚餐预算，请修改原预算，不要新建。');s.lastReply='已有相同的待核对聚餐预算，不会重复创建。';s.revision++;s.recentRequestIds=[...s.recentRequestIds.slice(-63),requestId];return s;}
 const params={action:'set',period:'本周',category:'聚餐',amount};
 const draft={functionId:'BI08',params:{}} as FlowTask;
 assertVoiceEvidence(previous,draft,params,text);validateVoiceDraft(previous,draft,params,text);
 const step:PlanStep={id:crypto.randomUUID(),kind:'workflow',title:'本周聚餐预算标记',quote:text,functionId:'BI08',params:{action:'set',period:'本周',category:'聚餐',amount},dependsOn:[],status:'pending'};
 p.steps.push(step);materialize(s,p,'voice',[step]);if(['complete','cancelled'].includes(p.status))p.status='paused';p.message='已追加待确认的本周聚餐预算，不扣款、不冻结；请选择该项核对后保存。';s.lastReply=p.message;s.view='workflow';s.revision++;s.recentRequestIds=[...s.recentRequestIds.slice(-63),requestId];return s;
}

/** Latest non-cancelled budget per period/category; planned only, never a hold. */
export function monthlyBudgetTotal(plan:TaskPlan):number {
 const latest=new Map<string,number>();
 for(const step of plan.steps){
  if(step.functionId!=='BI08'||step.params.action!=='set'||step.status==='cancelled'||(step.result as {status?:string}|null)?.status==='failed')continue;
  const amount=Number(step.params.amount),cents=Math.round(amount*100);
  if(!Number.isFinite(amount)||!Number.isSafeInteger(cents)||amount<=0)continue;
  latest.set(JSON.stringify([step.params.period,step.params.category]),cents);
 }
 return [...latest.values()].reduce((total,amount)=>total+amount,0);
}
