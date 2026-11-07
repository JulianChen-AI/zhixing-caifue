// Fresh synthetic sessions and real Flash; never replay captured conversation state.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {request}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5180',out=process.env.QUERY_REPORT||'work/query-review-live-20261029.json',report={synthetic:true,cases:[]};
(async()=>{const api=await request.newContext({baseURL:base});try{
 let state=(await(await api.get('/api/bank')).json()).state;
 const post=async(args,utterance,name='bank_function')=>{const response=await api.post('/api/bank',{data:{requestId:crypto.randomUUID(),revision:state.revision,tool:{name,arguments:args,utterance}}});assert.equal(response.status(),200);state=(await response.json()).state;};
 await post({operation:'create',functionId:'IN05'},'开始风险测评','bank_plan');const assessment=state.workflows.currentTaskId;await post({operation:'amend',taskId:assessment,params:{answers:[3,0,0]}},'第一题选三');
 await post({operation:'interrupt',functionId:'CA06',params:{cardId:'card-daily',action:'freeze'}},'准备临时冻结日常借记卡的草稿，不确认。','bank_plan');
 for(const item of [
  {id:'TR02',params:{},utterance:'看看我的两个账户余额，不转钱。',cases:[['correct','日常账户余额12865元，储蓄账户余额30000元。'],['wrong','日常账户余额2600元，储蓄账户余额12000元。'],['progress','查询账户余额已完成。请核对冻结日常卡草稿。']]},
  {id:'CA01',params:{},utterance:'查看我的银行卡列表和当前状态。',cases:[['correct','日常借记卡尾号8021，状态正常；储蓄借记卡尾号3609和备用借记卡尾号9012均受限。'],['progress','现在办理“查看卡片列表”。']]},
  {id:'BI02',params:{period:'2026-10',category:'餐饮'},utterance:'查2026年10月的餐饮支出，只查询。',cases:[['correct','餐饮支出64元，退款12元，净支出52元。'],['progress','统计和比较收支已完成。请继续回答第二题。']]},
 ]){
  const startRevision=state.revision;await post({operation:'run',functionId:item.id,params:item.params},item.utterance);const before=JSON.stringify(state);
  for(let repeat=0;repeat<2;repeat++)for(const [kind,reply] of item.cases){
   const response=await api.post('/api/bank/review',{data:{requestId:crypto.randomUUID(),revision:state.revision,review:{utterance:item.utterance,reply,reason:'completed',turnId:crypto.randomUUID(),startRevision,repairAttempt:0}}});const data=await response.json();report.cases.push({id:item.id,kind,repeat,http:response.status(),decision:data.decision,repairScope:data.repairScope,reviewerAttempts:data.reviewerAttempts});
   assert.equal(response.status(),200);assert.equal(JSON.stringify(data.state),before);assert.equal(data.toolAttempted,false);if(kind==='correct')assert.equal(data.decision,'accept');else{assert.notEqual(data.decision,'accept');assert.equal(data.repairScope,'query');assert.equal(data.facts.originalRequest,item.utterance);assert.ok(!JSON.stringify(data.facts).includes('confirmationRequest'));}
  }
 }
 report.status='passed';
}catch(error){report.status='failed';report.failure=error.message;process.exitCode=1;}finally{fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await api.dispose();}})();
