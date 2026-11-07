// Actual Flash review with freshly seeded synthetic facts. No captured messages or state replay.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {request}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5180',out=process.env.EXPLANATION_REPORT||'work/explanation-review-live-20261029.json';
const report={synthetic:true,cases:[]};
(async()=>{const api=await request.newContext({baseURL:base});try{
 let state=(await(await api.get('/api/bank')).json()).state;
 const post=async(args,utterance,name='bank_function')=>{const r=await api.post('/api/bank',{data:{requestId:crypto.randomUUID(),revision:state.revision,tool:{name,arguments:args,utterance}}});assert.equal(r.status(),200);state=(await r.json()).state;};
 await post({operation:'create',functionId:'IN05'},'开始风险测评','bank_plan');const taskId=state.workflows.currentTaskId;await post({operation:'amend',taskId,params:{answers:[3,0,0]}},'第一题选三');await post({operation:'amend',taskId,params:{answers:[3,2,0]}},'第二题选二');
 const original=JSON.stringify(state),cases=[
  {kind:'correct',reply:'现金基金风险等级为1，债券基金风险等级为3，二者费率均为0。风险级别较高不代表收益有保证；这里只比较，不做申购。'},
  {kind:'correct',reply:'现金基金属于货币类，债券基金属于债券类。前者风险等级1，后者等级3；给定规则下赎回均预计T+1工作日结算，不能理解为立即到账或保本。'},
  {kind:'incorrect',reply:'现金基金和债券基金都保证本金安全，没有任何风险，而且随时即时到账。'},
  {kind:'off_topic',reply:'第二题保存了，请回答第三题的投资经验，完成后再提交风险测评。'},
  {kind:'insufficient',reply:'这两款都是演示产品，赎回都预计T+1工作日结算，可以进行比较。'},
 ];
 for(let repeat=0;repeat<3;repeat++)for(const item of cases){
  const response=await api.post('/api/bank/review',{data:{requestId:crypto.randomUUID(),revision:state.revision,review:{utterance:'只比较现金基金和债券基金，不申购。',reply:item.reply,reason:'no_call',turnId:crypto.randomUUID(),startRevision:state.revision,repairAttempt:0}}});
  const data=await response.json();report.cases.push({repeat,kind:item.kind,http:response.status(),decision:data.decision,message:data.message,repairScope:data.repairScope});
  assert.equal(response.status(),200);assert.equal(data.toolAttempted,false);assert.equal(JSON.stringify(data.state),original);if(item.kind==='correct')assert.equal(data.decision,'accept');else{assert.notEqual(data.decision,'accept');assert.equal(data.repairScope,'explanation');assert.equal(data.facts.explanation.backgroundDraft.executionRequiredForThisExplanation,false);assert.ok(!JSON.stringify(data.facts).includes('nextQuestion'));}
 }
 report.status='passed';
}catch(error){report.status='failed';report.failure=error.message;process.exitCode=1;}finally{fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,failure:report.failure,cases:report.cases}));await api.dispose();}})();
