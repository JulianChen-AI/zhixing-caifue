// What a function may do and which of its actions change anything; pages need this without the business adapters.
import type { FlowTask } from './types.ts';

export const ACTIONS:Record<string,string[]>={IN05:['status','assess'],TR04:['list','create','update','pause','resume','delete'],TR05:['list','create','update','status','remind','reconcile'],TR08:['list','create','update','delete'],TR09:['list','create','update','reconcile','delete'],BI08:['get','set','estimate'],SU02:['create','update'],SU03:['list','create','update','delete'],IN04:['update','pause','resume','close'],IN13:['list','create','update','pause','resume','delete'],IN14:['list','create','update','delete'],CA03:['list','guide','submit','status','supplement','withdraw'],CA04:['get','set','request'],CA05:['query','unlock'],CA06:['freeze','unfreeze'],CA07:['report','status'],CA08:['list','request','status','activate'],CA09:['list','mark_done'],IN16:['review','note'],TR10:['create','status']};
export function isWrite(t:Pick<FlowTask,'functionId'|'params'>):boolean{
 const a=String(t.params.action||'');
 // A portfolio review only reads; saving the user's own review note is the one write.
 if(t.functionId==='IN16')return t.params.action==='note';
 if(['TR04','TR05','TR08','TR09','TR10','BI08','SU03','IN05','IN13','IN14','CA03','CA04','CA05','CA07','CA08','CA09'].includes(t.functionId)&&['list','get','query','status','guide'].includes(a))return false;
 return ['TR03','TR04','TR05','TR07','TR08','TR09','TR10','BI03','BI08','SU02','SU03','SU04','SU06','IN01','IN02','IN04','IN05','IN08','IN09','IN12','IN13','IN14','CA03','CA04','CA05','CA06','CA07','CA08','CA09'].includes(t.functionId);
}
export function needsAuth(t:FlowTask){return isWrite(t)&&(t.functionId==='IN01'&&t.params.autoSave===true||['TR03','TR04','SU04','SU06','IN02','IN08','IN09','IN12','IN13','CA03','CA04','CA05','CA06','CA07','CA08','CA09'].includes(t.functionId));}
