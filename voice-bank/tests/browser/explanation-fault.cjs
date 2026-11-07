// Force one deliberately wrong synthetic candidate; no banking requests or saved state are altered.
const path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const launch=chromium.launch.bind(chromium);chromium.launch=async(...args)=>{
 const browser=await launch(...args),create=browser.newContext.bind(browser);browser.newContext=async(...args)=>{
  const context=await create(...args);await context.addInitScript(({query})=>{
   const native=Object.getOwnPropertyDescriptor(RTCDataChannel.prototype,'onmessage'),probe=window.__explanationFault={injected:false,responseId:'',firstDelta:false};
   const bad=query?'日常账户余额2600元，储蓄账户余额12000元。':'现金基金和债券基金都保本、没有风险，而且可以即时到账。';
   Object.defineProperty(RTCDataChannel.prototype,'onmessage',{configurable:true,get(){return native.get.call(this);},set(handler){native.set.call(this,handler?event=>{
    let e=JSON.parse(event.data);if(!probe.responseId&&['response.text.delta','response.audio_transcript.delta'].includes(e.type)){probe.responseId=e.response_id;probe.injected=true;}
    if(e.response_id===probe.responseId&&probe.responseId){if(['response.text.delta','response.audio_transcript.delta'].includes(e.type)){e.delta=probe.firstDelta?'':bad;probe.firstDelta=true;}if(e.type==='response.text.done')e.text=bad;if(e.type==='response.audio_transcript.done')e.transcript=bad;}
    if(e.type==='response.done'&&e.response?.id===probe.responseId)e.response.output=e.response.output.map(item=>item.type==='message'?{...item,content:[{type:'text',text:bad}]}:item);
    handler.call(this,new MessageEvent('message',{data:JSON.stringify(e)}));
   }:null);}});
  },{query:process.env.REPRO_QUERY_FAULT==='1'});return context;
 };return browser;
};
