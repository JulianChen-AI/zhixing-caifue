// Opt-in real Flash evaluation with synthetic in-memory state. No microphone or business writes.
import {mkdirSync,writeFileSync} from 'node:fs';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import {qwenConfig,type QwenEnv} from '../lib/bank/qwen.ts';
import {superviseReply,type SupervisionInput} from '../lib/voice/supervision.ts';
import {SupervisionTracker} from '../lib/voice/supervision-tracker.ts';
import {explanationReviewFacts} from '../lib/voice/explanation-review.ts';

process.loadEnvFile('.dev.vars');const provider=qwenConfig(process.env as QwenEnv);
if(!provider.ready)throw new Error('Real Flash evaluation needs the local configured provider.');
const draft=reduceBank(initialState(),{type:'intent',intent:{kind:'transfer',amount:20000,recipientId:'zhang-roommate',accountId:'daily'}},crypto.randomUUID());
const report:{realFlash:boolean;humanMicrophone:boolean;cases:any[];status?:string}={realFlash:true,humanMicrophone:false,cases:[]};
async function check(name:string,state:typeof draft,utterance:string,reply:string,checkpoint:'speaking'|'complete',tracker:SupervisionTracker,expected:'pause'|'continue',extra?:(result:Awaited<ReturnType<typeof superviseReply>>)=>boolean){
 const before=JSON.stringify(state),started=Date.now();
 const input:SupervisionInput={utterance,reply,checkpoint,tracking:tracker.snapshot(),turnId:'eval',reason:'no_call',startRevision:state.revision,repairAttempt:0};
 let model:string|undefined,usage:unknown,raw:string|undefined;
 const request:typeof fetch=async(url,init)=>{const response=await fetch(url,init);const body=await response.clone().json() as any;model=body.model;usage=body.usage;raw=body.choices?.[0]?.message?.content;return response;};
 const result=await superviseReply(state,input,provider,undefined,request);tracker.settle(input.tracking!,'eval','response',result);
 const passed=!result.unavailable&&result.decision===expected&&before===JSON.stringify(state)&&(!extra||extra(result));
 const entry={name,elapsedMs:Date.now()-started,expected,model,usage,raw,...result,passed};report.cases.push(entry);console.log(JSON.stringify({name,elapsedMs:entry.elapsedMs,expected,decision:result.decision,unavailable:result.unavailable,unavailableReason:result.unavailableReason,passed}));
}
function conversation(utterance:string,reply:string){const tracker=new SupervisionTracker();tracker.record('user','eval',utterance);if(reply)tracker.record('assistant','eval',reply,'response');return tracker;}
await check('issue14-unsaved-amount',draft,'不对，改成300','我已把金额改成300，确认吗？','complete',conversation('不对，改成300','我已把金额改成300，确认吗？'),'pause');
await check('issue14-uncancelled-draft',draft,'不转了','已取消这笔转账。','complete',conversation('不转了','已取消这笔转账。'),'pause');
await check('issue15-no-query-result',initialState(),'这个月咖啡花了多少钱','这个月咖啡一共花了320元。','complete',conversation('这个月咖啡花了多少钱','这个月咖啡一共花了320元。'),'pause');
const pending=conversation('这个月咖啡花了多少钱','我查一下，请稍等。');
await check('speaking-request-remains-pending',initialState(),'这个月咖啡花了多少钱','我查一下，请稍等。','speaking',pending,'continue',result=>!!result.pendingChecks?.length);
pending.record('user','next','不用查咖啡了，解释一下活期存款');
await check('withdrawal-resolves-old-pending-request',initialState(),'不用查咖啡了，解释一下活期存款','活期存款通常可以随时存取。','complete',pending,'continue',result=>!!result.resolutions?.length&&pending.status().openIssues===0);
const fixed=conversation('不对，改成300','已经改成300');fixed.settle(fixed.snapshot(),'eval','response',{decision:'pause',message:'修改未保存',evidence:'后台 amount=200'});
const corrected=reduceBank(draft,{type:'edit',amount:30000},crypto.randomUUID());fixed.record('tool_result','eval','保存成功：amount=300');fixed.record('assistant','eval','金额已改为300，尚未确认或转出资金。','corrected');
await check('actual-save-resolves-old-concern',corrected,'不对，改成300','金额已改为300，尚未确认或转出资金。','complete',fixed,'continue',result=>!!result.resolutions?.length&&fixed.status().openIssues===0);
const explanatoryState=initialState(),request='只解释活期与定期存款的区别',explanation='活期存款通常可以随时存取，定期存款约定存期，提前支取可能影响利息。';
const rechecked=conversation(request,'活期存款可以随时存取');rechecked.settle(rechecked.snapshot(),'eval','response',{decision:'pause',message:'受控暂停，重新核对解释',evidence:'controlled injection'});
rechecked.record('reconciliation','eval','已重新核对解释');rechecked.record('state','eval',JSON.stringify({reconciled:true,facts:explanationReviewFacts(explanatoryState,0)}));rechecked.record('assistant','eval',explanation);
await check('large-state-proof-uses-short-excerpt',explanatoryState,request,explanation,'complete',rechecked,'continue',result=>!!result.resolutions?.length&&rechecked.status().openIssues===0);
report.status=report.cases.every(entry=>entry.passed)?'passed':'failed';mkdirSync('outputs/continuous-supervision',{recursive:true});writeFileSync('outputs/continuous-supervision/flash-eval.json',JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;
