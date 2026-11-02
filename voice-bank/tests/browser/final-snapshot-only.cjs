// Drop transient text events only; the provider's actual response.done snapshot is untouched.
const path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const launch=chromium.launch.bind(chromium);chromium.launch=async(...args)=>{
 const browser=await launch(...args),create=browser.newContext.bind(browser);browser.newContext=async(...args)=>{
  const context=await create(...args);await context.addInitScript(({dropArguments})=>{
   const native=Object.getOwnPropertyDescriptor(RTCDataChannel.prototype,'onmessage');
   Object.defineProperty(RTCDataChannel.prototype,'onmessage',{configurable:true,get(){return native.get.call(this);},set(handler){native.set.call(this,handler?event=>{const e=JSON.parse(event.data);if(/^response\.(text|audio_transcript)\.(delta|done)$/.test(e.type)||dropArguments&&e.type==='response.function_call_arguments.done')return;handler.call(this,event);}:null);}});
  },{dropArguments:process.env.SNAPSHOT_DROP_ARGUMENTS==='1'});return context;
 };return browser;
};
