import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { dispatchAction } from '../lib/plans/dispatch.ts';
import { familyBudgetAmount } from '../lib/plans/monthly.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';

const act=(s:any,a:any)=>reduceBank(s,a,crypto.randomUUID());
const open=()=>{let s=act(initialState(),{type:'load_scene',sceneId:'S08'});return act(s,{type:'plan',command:{operation:'create',source:'voice',utterance:'老规矩'}});};

test('预算原话仅解析明确正金额和可精确表示的分币',()=>{
 for(const text of ['加一个，这周请爸妈吃饭，先留400。','加一个，这周请爸妈吃饭，先留四百。','给这周聚餐留400元预算','本周聚餐先留四百元的预算'])assert.equal(familyBudgetAmount(text),400);
 for(const text of ['不要留400','如果留400','聚餐预算-400','聚餐预算400或500','聚餐预算1.234','聚餐预算四百点五','聚餐预算400，另留500','不给这周聚餐留400元预算','如果给这周聚餐留400元预算','给这周聚餐留400元预算吗？','给这周聚餐留400或500元预算'])assert.equal(familyBudgetAmount(text),undefined,text);
 assert.equal(familyBudgetAmount('聚餐预算0.01'),0.01);
});

test('原话经模型工具入口建立预算，核对保存不扣款',()=>{
 let s=open();const text='加一个，这周请爸妈吃饭，先留400。';
 s=act(s,dispatchAction(s,{type:'workflow',command:{operation:'run',source:'voice',functionId:'BI08',params:{amount:99999},utterance:text}},text));
 const entry=s.plan!.steps.find(x=>x.functionId==='BI08')!;assert.equal(entry.params.amount,400);assert.equal(s.accounts[0].balance,800000);
 s=act(s,{type:'plan',command:{operation:'resume',source:'card',taskId:entry.id}});let task=currentWorkflow(s)!;assert.equal(task.status,'review');
 s=act(s,{type:'workflow',command:{operation:'confirm',source:'card',taskId:task.id,token:task.reviewToken}});
 assert.equal(s.workflows!.records.budgets[0].amount,40000);assert.equal(s.accounts[0].balance,800000);assert.equal(s.accounts[0].held,undefined);
});

test('中文金额经两层校验，保存已确认上下文后才允许省略用途',()=>{
 let s=open();const full='加一个，这周请爸妈吃饭，先留四百。';
 const call=(state:any,text:string)=>act(state,dispatchAction(state,{type:'workflow',command:{operation:'run',source:'voice',functionId:'BI08',params:{amount:99999,category:'聚餐',period:'本周',action:'set'},utterance:text}},text));
 s=call(s,full);let entry=s.plan!.steps.find(x=>x.functionId==='BI08')!;assert.equal(entry.params.amount,400);
 s=act(s,{type:'plan',command:{operation:'resume',source:'card',taskId:entry.id}});let t=currentWorkflow(s)!;assert.equal(t.status,'review');
 s=act(s,{type:'workflow',command:{operation:'confirm',source:'card',taskId:t.id,token:t.reviewToken}});
 s=call(s,'先留四百');entry=s.plan!.steps.filter(x=>x.functionId==='BI08').at(-1)!;assert.equal(entry.params.amount,400);
 s=act(s,{type:'plan',command:{operation:'resume',source:'card',taskId:entry.id}});t=currentWorkflow(s)!;assert.equal(t.status,'review');
 s=act(s,{type:'workflow',command:{operation:'confirm',source:'card',taskId:t.id,token:t.reviewToken}});assert.equal(s.workflows!.records.budgets[0].amount,40000);assert.equal(s.accounts[0].balance,800000);
 assert.throws(()=>call(open(),'先留四百'));assert.throws(()=>call(initialState(),'先留四百'));
});

test('金额更新走两层语音校验并拒绝模型猜测',()=>{
 let s=open();const create='聚餐预算400';s=act(s,dispatchAction(s,{type:'workflow',command:{operation:'run',source:'voice',functionId:'BI08',params:{amount:99999},utterance:create}},create));
 let entry=s.plan!.steps.find(x=>x.functionId==='BI08')!;s=act(s,{type:'plan',command:{operation:'resume',source:'card',taskId:entry.id}});const token=currentWorkflow(s)!.reviewToken;
 const change='先留四百五十';s=act(s,dispatchAction(s,{type:'workflow',command:{operation:'run',source:'voice',functionId:'BI08',params:{amount:99999},utterance:change}},change));
 const task=currentWorkflow(s)!;assert.equal(task.params.amount,450);assert.notEqual(task.reviewToken,token);assert.equal(s.accounts[0].balance,800000);
});

test('连续中文改口保留原聚餐上下文，排队和核对状态均只取本轮金额',()=>{
 const call=(s:any,text:string)=>act(s,dispatchAction(s,{type:'workflow',command:{operation:'run',source:'voice',functionId:'BI08',params:{amount:99999},utterance:text}},text));
 for(const activate of [false,true]){
  let s=call(open(),'加一个，这周请爸妈吃饭，先留400。');const entry=s.plan!.steps.find(x=>x.functionId==='BI08')!;
  if(activate)s=act(s,{type:'plan',command:{operation:'resume',source:'card',taskId:entry.id}});
  for(const [text,amount] of [['先留四百五十',450],['先留四百',400]] as const){s=call(s,text);assert.equal(s.plan!.steps.find(x=>x.id===entry.id)!.params.amount,amount);assert.equal(s.accounts[0].balance,800000);assert.equal(s.accounts[0].held||0,0);}
 }
});
