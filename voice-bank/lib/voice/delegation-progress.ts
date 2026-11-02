import type {BankState} from '../bank/types.ts';
import {inferFunction,extractParams} from '../plans/decompose.ts';
import {familyBudgetAmount,hasFamilyBudgetContext} from '../plans/monthly.ts';

/** Feedback for the executing model, never an action or execution permission. */
export function delegationGaps(state:BankState,text:string){
 const task=state.workflows?.tasks.find(t=>t.id===state.workflows?.currentTaskId),gaps:string[]=[],id=inferFunction(text);
 const budget=familyBudgetAmount(text,hasFamilyBudgetContext(state));
 if(task&&(!id||id===task.functionId)&&budget==null&&['collecting','review','blocked'].includes(task.status)){
  const patch=extractParams(text,task.functionId,state);
  const unsaved=Object.keys(patch).filter(key=>JSON.stringify(patch[key])!==JSON.stringify(task.params[key]));
  if(unsaved.length)gaps.push('用户本轮明确字段尚未保存到原任务：'+JSON.stringify({taskId:task.id,params:patch,unsaved})+'。通过amend保存，不能只复述或重复追问。');
  if(task.status==='review'&&/确认|确定|就这样|没问题|按(?:这|当前|卡片|上面).*办/.test(text)&&!/不要|别|取消|修改|改成|改为|如果|假设|[?？]|吗/.test(text))gaps.push('用户要求确认，但当前任务仍为review，尚未进入页面认证或返回确认结果。依照当前confirmationRequest提交；用户本轮原话仍须后端校验，不能口头说已确认。');
  if(/取消|不转了|不办了/.test(text)&&!/不要取消|别取消|不用取消|如果|假设|[?？]|吗/.test(text))gaps.push('用户要求取消，但当前任务仍未取消。应让工具处理并以实际结果说明，不能声称草稿已清除。');
 }
 if(state.plan?.status==='paused'&&/继续|开始|办理|核对/.test(text)&&!/不|别|如果|假设|[?？]|吗/.test(text))gaps.push('用户要求开始办理，但Plan仍为paused，尚未激活任何步骤。应先resume，再展示当前review；不能把模板字段当成已激活的认证卡。');
 const monthlyContext=!!state.plan?.monthly&&/工资|月度|安排|老规矩/.test(text);
 if(id&&!monthlyContext&&!state.workflows?.tasks.some(t=>t.functionId===id)&&!/解释|为什么|区别|如果|假设|原订单|回查/.test(text))gaps.push('原请求对应业务尚未建立或查询：'+id+'。余额或其他业务结果不能代替该业务；应使用原请求创建缺项草稿或执行正确查询。');
 if(state.plan?.monthly&&budget!=null&&!state.plan.steps.some(s=>s.functionId==='BI08'&&s.params.amount===budget))gaps.push('本轮聚餐预算尚未加入当前计划。通过interrupt保留原计划、追加独立预算；不扣款、不占用，不重付未知房租。');
 return gaps;
}
