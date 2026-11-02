import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import type {BankState} from '../lib/bank/types.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
const act=(s:BankState,a:any)=>reduceBank(s,a,crypto.randomUUID());
function pending(){
 let s=act(initialState(),{type:'load_scene',sceneId:'S08-U'});
 s=act(s,{type:'plan',command:{operation:'create',source:'voice',utterance:'工资到了，老规矩'}});
 s=act(s,{type:'plan',command:{operation:'resume',source:'card'}});const t=currentWorkflow(s)!;
 return act(s,{type:'workflow',command:{operation:'confirm',source:'card',taskId:t.id,token:t.reviewToken}});
}
function unknown(){let s=pending();const legacy=structuredClone(s.task!),t=structuredClone(currentWorkflow(s)!);s=act(s,{type:'workflow',command:{operation:'authenticate',source:'card',taskId:t.id,token:t.verificationId,code:'123456'}});return{s,legacy,t};}
test('修复1 S08-U保留未知原单但撤销旧转账认证草稿，切到S01及重置均可',()=>{
 const {s}=unknown();assert.equal(s.task,null);assert.equal(s.checklist,null);assert.equal(s.workflows!.records.transfers.length,1);assert.equal(s.workflows!.records.transfers[0].status,'unknown');assert.equal(s.accounts[0].balance,800000);assert.equal(s.receipts.length,0);
 const loaded=act(s,{type:'load_scene',sceneId:'S01'});assert.equal(loaded.sceneId,'S01');assert.equal(loaded.accounts[0].balance,28660);assert.equal(loaded.task,null);assert.notEqual(loaded.sceneEpoch,s.sceneEpoch);assert.equal(loaded.workflows!.records.transfers?.length||0,0);
 const reset=act(s,{type:'reset'});assert.equal(reset.sceneId,'default');assert.equal(reset.accounts[0].balance,1286500);assert.equal(reset.task,null);assert.notEqual(reset.sceneEpoch,s.sceneEpoch);assert.equal(reset.workflows!.records.transfers?.length||0,0);
});
test('修复1 旧版卡片及旧工作流认证令牌不能在未知后或切换重置后付款',()=>{
 const {s,legacy,t}=unknown();
 for(const state of [s,{...s,plan:null},act(s,{type:'load_scene',sceneId:'S01'}),act(s,{type:'reset'})]){
  const before=JSON.stringify(state);assert.throws(()=>act(state,{type:'authenticate',verificationId:legacy.verificationId,code:'123456'}));assert.throws(()=>act(state,{type:'workflow',command:{operation:'authenticate',source:'card',taskId:t.id,token:t.verificationId,code:'123456'}}));assert.equal(JSON.stringify(state),before);
 }
});
test('修复1 未知原单不能重复付款，真正尚在认证的业务仍禁止切场景与重置',()=>{
 const s=pending();assert.equal(s.task!.step,'authenticate');for(const action of [{type:'load_scene',sceneId:'S01'},{type:'reset'}])assert.throws(()=>act(s,action),(e:any)=>e.status===409);
 const {s:u}=unknown();assert.throws(()=>act(u,{type:'plan',command:{operation:'resume',source:'card'}}));assert.throws(()=>act(u,{type:'plan',command:{operation:'cancel',source:'card'}}));assert.equal(u.workflows!.records.transfers.length,1);assert.equal(u.accounts[0].balance,800000);assert.equal(u.receipts.length,0);
});
