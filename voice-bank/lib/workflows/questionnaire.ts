/** The card, voice checklist and answer validation share this questionnaire. */
export const RISK_QUESTIONS = [
 {key:'holdingPeriod',title:'你计划多久后使用这笔钱？',labels:['一个月内','半年内','一年内','三年内','三年以上']},
 {key:'volatility',title:'面对本金波动，你能接受多大程度？',labels:['不接受波动','较小波动','中等波动','较大波动','较高波动']},
 {key:'experience',title:'你有多少投资经验？',labels:['没有经验','了解基础','少量实践','有一定经验','较多经验']},
] as const;
export const completeAnswers=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isInteger(x)&&x>=1&&x<=5);
export function questionnaire(answers:unknown){
 const values=Array.isArray(answers)?answers:[];
 return RISK_QUESTIONS.map((q,index)=>({key:q.key,index:index+1,title:q.title,required:true,value:values[index]||null,status:values[index]?'filled':'missing',choices:q.labels.map((label,i)=>({value:i+1,label}))}));
}
/** Parse only explicit questionnaire answers, never amounts or dates. Zero is an unfilled slot. */
export function answerPatch(text:string,previous:unknown):number[]|undefined{
 const cn:Record<string,number>={一:1,二:2,三:3,四:4,五:5};
 const number=(s:string)=>cn[s]||Number(s),old=Array.isArray(previous)?previous:[],next=[0,1,2].map(i=>Number(old[i])||0);
 let found=false;
 const clean=text.replace(/[\s，,。！!？?、：:]/g,'');
 // Exact option text is evidence too. Resolve it before numeric parsing: “一年内” is option 3, not 1.
 const prefix=/^(?:我)?(?:选(?:择)?|改成|改为|是|答案是)?/;
 for(let i=0;i<3;i++){
  const named=clean.match(new RegExp(`^第[${i+1}${['一','二','三'][i]}]题(.*)$`));
  const option=named?named[1].replace(prefix,''):next.findIndex(v=>!v)===i?clean.replace(prefix,''):'';
  const choice=(RISK_QUESTIONS[i].labels as readonly string[]).indexOf(option);
  if(choice>=0&&!/[?？]/.test(text)){next[i]=choice+1;return next;}
 }
 if(/不|别|还是|或者|或是|取消|[?？]/.test(text))return undefined;
 for(const m of clean.matchAll(/第([一二三123])题(?:我)?(?:选(?:择)?|改成|改为|是|答案是)(?:第)?([一二三四五1-5])(?:项|个)?(?=第[一二三123]题|$)/g)){next[number(m[1])-1]=number(m[2]);found=true;}
 if(found)return next;
 const all=clean.match(/^(?:我的)?(?:测评|问卷)?(?:三题)?答案(?:分别)?(?:是|为)?([一二三四五1-5])([一二三四五1-5])([一二三四五1-5])$/);
 if(all)return all.slice(1).map(number);
 const same=clean.match(/^(?:三题|三个)(?:答案)?都(?:选|是)?([一二三四五1-5])$/);
 if(same)return Array(3).fill(number(same[1]));
 const single=clean.match(/^(?:我)?(?:选(?:择)?|第)?([一二三四五1-5])(?:项|个)?$/),index=next.findIndex(v=>!v);
 if(single&&index>=0){next[index]=number(single[1]);return next;}
 return undefined;
}
