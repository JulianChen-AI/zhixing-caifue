/** Covers actual navigation/close and mobile backgrounding, without auto-reconnect. */
export function stopOnPageExit(stop:()=>void,page:EventTarget=window,visibility:EventTarget & {visibilityState:string}=document){
 const hidden=()=>{if(visibility.visibilityState==='hidden')stop()};
 page.addEventListener('pagehide',stop);visibility.addEventListener('visibilitychange',hidden);
 return()=>{page.removeEventListener('pagehide',stop);visibility.removeEventListener('visibilitychange',hidden)};
}
