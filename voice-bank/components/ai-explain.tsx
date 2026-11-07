'use client';
import {useRef,useState} from 'react';
import {Sparkles,RotateCw,ChevronUp} from 'lucide-react';

const cache=new Map<string,string>();
type State={kind:'idle'}|{kind:'loading'}|{kind:'done';text:string}|{kind:'error';message:string};

/** One tap asks the model to explain what this card already shows; the same card and data are explained once. */
export function AiExplain({functionId,value}:{functionId:string;value:unknown}){
 const key=functionId+':'+JSON.stringify(value);
 const [state,setState]=useState<State>(()=>cache.has(key)?{kind:'done',text:cache.get(key)!}:{kind:'idle'});
 const [open,setOpen]=useState(true);
 const abort=useRef<AbortController|null>(null);
 async function ask(){
  if(cache.has(key)){setState({kind:'done',text:cache.get(key)!});setOpen(true);return;}
  abort.current?.abort();const controller=new AbortController();abort.current=controller;
  setState({kind:'loading'});setOpen(true);
  try{
   const response=await fetch('/api/explain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({functionId,value}),signal:controller.signal});
   const data=await response.json() as {text?:string|null;message?:string;error?:string};
   if(data.text){cache.set(key,data.text);setState({kind:'done',text:data.text});}
   else setState({kind:'error',message:data.message||data.error||'暂时讲不了，稍后再试。'});
  }catch(error){if(!controller.signal.aborted)setState({kind:'error',message:'网络不稳，稍后再试。'});}
 }
 if(state.kind==='idle')return <button type="button" className="ai-explain-trigger" onClick={ask}><Sparkles aria-hidden size={15}/>AI 讲解</button>;
 return <section className={`ai-explain is-${state.kind}`} aria-live="polite" aria-label="AI 讲解">
  <header><span className="ai-explain-title"><Sparkles aria-hidden size={14}/>AI 讲解</span>
   {state.kind==='done'&&<button type="button" className="ai-explain-icon" aria-label={open?'收起':'展开'} onClick={()=>setOpen(!open)}><ChevronUp aria-hidden size={16} style={{transform:open?'none':'rotate(180deg)'}}/></button>}
   {state.kind==='error'&&<button type="button" className="ai-explain-icon" aria-label="重试" onClick={ask}><RotateCw aria-hidden size={15}/></button>}
  </header>
  {state.kind==='loading'&&<div className="ai-explain-skeleton" aria-label="正在讲解"><i/><i/><i/></div>}
  {state.kind==='done'&&open&&<p>{state.text}</p>}
  {state.kind==='error'&&<p className="ai-explain-error">{state.message}</p>}
 </section>;
}
