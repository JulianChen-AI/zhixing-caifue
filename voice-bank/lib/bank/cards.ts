import type { Row } from '../workflows/types.ts';

/** Names, common aliases and every stated tail must refer to the same card. */
export function cardCandidates(text:string,cards:Row[]){
 const compact=text.replace(/\s/g,''),tails=[...compact.matchAll(/尾号(\d+)(?!\d)/g)].map(m=>m[1]);
 if(/^\d+$/.test(compact))tails.push(compact);
 const named=cards.filter(c=>text.includes(c.id)||text.includes(String(c.name))||
  new RegExp(String(c.name).replace(/借记卡$/, '')+'(?:卡|那张|这张|那个|吧|[。！!\\s]*$)').test(text));
 if(tails.some(t=>t.length!==4||!cards.some(c=>c.tail===t)))return [];
 const matches=tails.length?cards.filter(c=>tails.every(t=>c.tail===t)):cards;
 return named.length?matches.filter(c=>named.some(n=>n.id===c.id)):tails.length?matches:[];
}
