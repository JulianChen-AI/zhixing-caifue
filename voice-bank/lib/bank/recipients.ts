import { CONTACTS, type BankState, type Contact } from './types.ts';

// Default aliases are separate from CONTACTS so the existing fixtures remain unchanged.
const defaults:Record<string,NonNullable<Contact['aliases']>>={
 'zhang-roommate':{names:['zhang san'],labels:['室友','roommate']},
 'zhang-landlord':{names:['zhang san'],labels:['房东','landlord']},
 'li-friend':{names:['李四','li si'],labels:['同学']},
};
export const contactsOf=(state?:Pick<BankState,'contacts'>):Contact[]=>state?.contacts??CONTACTS;
const includes=(text:string,word:string)=>!!word && text.toLowerCase().replace(/\s/g,'').includes(word.toLowerCase().replace(/\s/g,''));
const names=(c:Contact)=>[c.name,...(c.aliases?.names??defaults[c.id]?.names??[])];
const labels=(c:Contact)=>[c.label,...(c.aliases?.labels??defaults[c.id]?.labels??[])];
export function recipientNamesMentioned(text:string,contacts:readonly Contact[]=CONTACTS){return contacts.filter(c=>names(c).some(x=>includes(text,x)));}
export function recipientIdentityMentioned(text:string,accountTails:string[]=[],contacts:readonly Contact[]=CONTACTS){return contacts.some(c=>[...names(c),...labels(c)].some(x=>includes(text,x)))||hasRecipientTail(text,accountTails);}
export function recipientAliasQuote(text:string,contact:Contact){return [...labels(contact),...names(contact)].find(x=>includes(text,x))||text;}
export function hasRecipientTail(text:string,accountTails:string[]=[]){
 return [...text.replace(/\s/g,'').matchAll(/尾号(\d{1,4})(?!\d)/g)].some(m=>!accountTails.includes(m[1]));
}
/** All stated identity constraints must agree; own-account tails are not payees. */
export function recipientCandidates(text:string,accountTails:string[]=[],contacts:readonly Contact[]=CONTACTS){
 const named=contacts.filter(c=>labels(c).some(x=>includes(text,x)));
 const byName=recipientNamesMentioned(text,contacts);
 if(new Set(byName.map(c=>c.name)).size>1)return [];
 if(byName.length&&named.length&&!byName.some(c=>named.some(n=>n.id===c.id)))return [];
 const tails=[...text.replace(/\s/g,'').matchAll(/尾号(\d{1,4})(?!\d)/g)].map(m=>m[1]).filter(t=>!accountTails.includes(t));
 if(new Set(tails).size>1)return [];
 if(!tails.length){if(named.length)return byName.length?named.filter(c=>byName.some(n=>n.id===c.id)):named;return byName.length===1?byName:[];}
 const matched=contacts.filter(c=>tails.includes(c.tail)&&(!byName.length||byName.some(n=>n.id===c.id)));
 if(tails.some(t=>!contacts.some(c=>c.tail===t)))return [];
 return named.length?matched.filter(c=>named.some(n=>n.id===c.id)):matched;
}
/** A shared name with nothing to tell the contacts apart; the user must choose. */
export function ambiguousRecipients(text:string,accountTails:string[]=[],contacts:readonly Contact[]=CONTACTS){
 if(recipientCandidates(text,accountTails,contacts).length||hasRecipientTail(text,accountTails))return [];
 const byName=recipientNamesMentioned(text,contacts);
 return byName.length>1?byName:[];
}
export function recipientChoiceQuestion(candidates:readonly Contact[]){
 return `“${candidates[0].name}”有${['','一','两','三','四'][candidates.length]||candidates.length}位：${candidates.map(c=>`${c.label}${c.name}（${c.bank}尾号${c.tail}）`).join('、')}。请问要转给哪一位？`;
}
