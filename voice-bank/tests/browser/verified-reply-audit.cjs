// Observes real playback and review order without altering prompts, tools or business requests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const output=process.env.VERIFIED_AUDIT||'work/verified-reply-audit.json',entries=[];
const save=()=>fs.writeFileSync(output,JSON.stringify(entries,null,2));
const launch=chromium.launch.bind(chromium);chromium.launch=async(...args)=>{
 const browser=await launch(...args),newContext=browser.newContext.bind(browser);
 browser.newContext=async(...args)=>{
  const context=await newContext(...args),entry={startedAt:new Date().toISOString(),reviews:[],tools:[]};entries.push(entry);
  await context.addInitScript(()=>{
   const t=window.__verifiedAudit={playback:[],verdicts:[]},play=HTMLMediaElement.prototype.play;
   const fetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await fetch(...args);if(new URL(response.url).pathname==='/api/bank/review'){const json=response.json.bind(response);response.json=async()=>{const data=await json();t.verdicts.push({at:Date.now(),decision:data.decision,revision:data.state?.revision,http:response.status});return data;};}return response;};
   HTMLMediaElement.prototype.play=function(...args){t.playback.push({at:Date.now(),muted:this.muted,kind:this.srcObject?'remote-stream':this.src.startsWith('blob:')?'verified-blob':'other'});return play.apply(this,args)};
  });
  context.on('page',page=>page.on('response',async res=>{
   const url=new URL(res.url());
   if(url.pathname==='/api/bank/review'){
    try{const b=await res.json(),input=res.request().postDataJSON().review;entry.reviews.push({at:Date.now(),http:res.status(),decision:b.decision,message:b.message,repairScope:b.repairScope,reviewerAttempts:b.reviewerAttempts,reply:input.reply,repairAttempt:input.repairAttempt,utterance:input.utterance,revision:b.state?.revision});save();}catch{}
   }else if(url.pathname==='/api/bank'&&res.request().method()==='POST'){
    try{const input=res.request().postDataJSON(),b=await res.json(),receipt=b.toolResult?.operationResult;if(input.tool)entry.tools.push({at:Date.now(),http:res.status(),name:input.tool.name,operation:input.tool.arguments.operation,result:receipt&&{operation:receipt.operation,status:receipt.workflow?.status,functionId:receipt.workflow?.functionId}});}catch{}
   }
  }));
  const close=context.close.bind(context);context.close=async(...args)=>{entry.pages=await Promise.all(context.pages().map(async page=>{try{return await page.evaluate(()=>window.__verifiedAudit)}catch{return null}}));entry.playbackOrderPassed=entry.pages.filter(Boolean).every(p=>p.playback.every(play=>play.kind==='remote-stream'?play.muted:play.kind!=='verified-blob'||p.verdicts.filter(v=>v.at<=play.at).at(-1)?.decision==='accept'));if(!entry.playbackOrderPassed)process.exitCode=1;entry.finishedAt=new Date().toISOString();save();return close(...args)};return context;
 };return browser;
};
