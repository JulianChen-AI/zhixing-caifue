import {questionnaire} from './questionnaire.ts';
import type { BankState } from '../bank/types.ts';
import type { FlowTask } from './types.ts';
import { choices, LABELS } from './fields.ts';

export const ACTION_LABELS:Record<string,string>={review:'复盘持仓',note:'保存复盘笔记',assess:'开始测评',estimate:'分项估算',guide:'按用途选择办卡路径',list:'查看列表',get:'查询',query:'查询',status:'查询进度',create:'创建',update:'修改',pause:'暂停',resume:'恢复',delete:'删除/终止',set:'设置',request:'提交申请',submit:'提交申请',withdraw:'撤回申请',supplement:'补充材料',unlock:'申请解除',freeze:'临时冻结',unfreeze:'解冻',report:'正式挂失',activate:'激活',mark_done:'标记已换绑',remind:'请求提醒',reconcile:'手动核销',close:'关闭'};
const money=new Set(['amount','target','total','savePerPeriod']);
const labels:Record<string,string>={saveRecipient:'保存收款人',autoSave:'自动转存',share:'分享',receiptExport:'导出回执',interestAssumption:'利率假设',incomeDates:'到账日',includeProjection:'附带进度估算',narrative:'附带简述',peerComparison:'群体参照',includeSafetyHistory:'附带守护记录',verifyReminder:'建立核验提醒',prepareEvidence:'整理核对材料',includeProjected:'包含未来估算',reserveReminder:'资金预留提醒',expiryReminder:'到期提醒',cashOrNet:'统计口径',file:'文件'};
/** One representation for the visible card and the model's spoken review. Params use yuan. */
export function workflowReview(state:BankState,task:Pick<FlowTask,'title'|'functionId'|'params'>){
 const entries=Object.entries(task.params).map(([key,value])=>{
  const render=(v:unknown):string=>{
   if(v==null||v==='')return '未填写';
   if(typeof v==='boolean')return v?'是':'否';
   if(key==='action')return ACTION_LABELS[String(v)]||String(v);
   if(money.has(key))return '¥'+Number(v).toFixed(2);
   if(key==='adjustments'&&v&&typeof v==='object'){const item=v as {label?:unknown;amount?:unknown;participants?:unknown};return `${String(item.label??'分项')} ¥${Number(item.amount).toFixed(2)}：${Array.isArray(item.participants)?item.participants.join('、'):''}分摊`;}
   return choices(state,key).find(c=>c.value===v)?.label||String(v);
  };
  return {key,label:(LABELS[key]||labels[key]||key).replace('（可选）',''),value:key==='answers'?questionnaire(value).map(q=>q.title+'：'+(q.choices.find(c=>c.value===q.value)?.label||'未填写')).join('；'):Array.isArray(value)?value.map(render).join('、'):render(value)};
 });
 if(['TR03','TR04','IN02'].includes(task.functionId)&&!task.params.note)entries.push({key:'note',label:'备注',value:'无'});
 if(task.functionId==='TR03'&&!Object.hasOwn(task.params,'saveRecipient'))entries.push({key:'saveRecipient',label:'保存收款人',value:'否'});
 if(task.functionId==='IN01'&&!Object.hasOwn(task.params,'autoSave'))entries.push({key:'autoSave',label:'自动转存',value:'否'});
 const spokenSummary=task.title+'。'+entries.map(e=>e.label+'：'+e.value.replace(/¥/g,'人民币')+(money.has(e.key)?'元':'')).join('；')+'。请核对卡片，信息正确可直接确认，有修改也可以告诉我。';
 return {entries,spokenSummary};
}

/** Natural acknowledgement, with edits and questions kept out of the execution gate. */
export function acknowledgesReview(text:string){
 const s=text.trim();
 if(/吗|么|[？?]|等等|等一下|先别|暂不|取消|改成|改为|改口|修改|换成|换张|换个|少转|多转|减去|加上|但是|不过|重新|再看|不要|不能|不行|不对|不确认|不(?:转|冻|买|办|提交)|别(?:转|冻|买|办|提交|确认)/.test(s))return false;
 return /确认|确定|没问题|没错|就这样|好的|可以|按(?:这|当前|卡片|上面).*(?:办|执行|提交|继续)|信息.*(?:正确|都对)|^(?:好|对|是的|办吧|转吧|继续办理)[。！!\s]*$/.test(s);
}

