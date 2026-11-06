// “张三下个月18号生日，帮我留1000，提前两天提醒我订蛋糕” is three things in the user's own order: put money aside for a
// birthday goal, remind before the day, and order from a merchant. The first two are bank cards to confirm one by one; the
// last is guidance to the merchant's official channel and never an order. Parsed here because the sentence is regular and a
// model has dropped the goal step; anything this does not recognise goes to the model as before.
import type { BankState } from '../bank/types.ts';
import { businessDay } from '../demo/clock.ts';
import { amountFromText } from '../checklists/routing.ts';
import type { Params } from '../workflows/types.ts';

const DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 1 to 31, in digits or words (十八, 二十, 三十一). */
function small(word: string): number {
 if (/^\d+$/.test(word)) return Number(word);
 const [tens, ones] = word.includes('十') ? word.split('十') : ['', word];
 return word.includes('十') ? (tens ? DIGIT[tens] : 1) * 10 + (ones ? DIGIT[ones] : 0) : DIGIT[ones];
}
const pad = (n: number) => String(n).padStart(2, '0');
const N = '(\\d{1,2}|[一二两三四五六七八九十]{1,3})';

function birthdayDate(s: BankState, text: string): string | undefined {
 const today = businessDay(s), [y, m] = today.split('-').map(Number);
 let year = y, month: number, day: number;
 const next = text.match(new RegExp(`下个?月${N}[号日]`)), current = text.match(new RegExp(`(?:这个?月|本月)${N}[号日]`)), named = text.match(new RegExp(`${N}月${N}[号日]`));
 if (next) { month = m === 12 ? 1 : m + 1; year = m === 12 ? y + 1 : y; day = small(next[1]); }
 else if (current) { month = m; day = small(current[1]); }
 else if (named) { month = small(named[1]); day = small(named[2]); if (`${y}-${pad(month)}-${pad(day)}` < today) year = y + 1; }
 else return undefined;
 const iso = `${year}-${pad(month)}-${pad(day)}`, d = new Date(iso + 'T00:00:00Z');
 return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso >= today ? iso : undefined;
}
const minus = (iso: string, days: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };

export type BirthdayTask = { quote: string; functionId: string; params: Params };

/** The plan for a birthday sentence with a date and an amount to put aside, or undefined to leave it to the model. */
export function birthdayPlan(s: BankState, text: string): BirthdayTask[] | undefined {
 if (!/生日/.test(text)) return;
 const date = birthdayDate(s, text);
 const money = text.match(/(?:留|存|预留|攒|准备|放)\s*(?:出)?\s*(\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)?/);
 const parsed = money ? amountFromText(money[1] + '元') : undefined;
 if (!date || !parsed || parsed.amount == null || parsed.uncertain || parsed.amount <= 0) return;
 const who = text.match(/^(?:帮我|我)?(?:的)?([一-龥]{1,6}?)(?:的)?(?:下个?月|这个?月|本月|\d{1,2}月|[一二三四五六七八九十]{1,2}月)/)?.[1];
 const tasks: BirthdayTask[] = [{ quote: '', functionId: 'IN01', params: { name: `${who && !/^(?:帮我|我)$/.test(who) ? who : ''}生日`, target: parsed.amount / 100, deadline: date } }];
 const cuts = [0];
 const remind = text.search(/(?:提前|到时候|当天|前一天|前两天).{0,8}提醒|提醒我/);
 if (remind > 0) {
  const ahead = text.slice(remind).match(new RegExp(`提前${N}天`)), days = ahead ? small(ahead[1]) : /前一天/.test(text) ? 1 : /前两天/.test(text) ? 2 : 0;
  tasks.push({ quote: '', functionId: 'IN14', params: { action: 'create', remindAt: minus(date, days) } }); cuts.push(remind);
 }
 const order = text.search(/(?:订|买|叫|点)(?:个|一个|份)?(?:生日)?(?:蛋糕|鲜花|花|礼物|外卖)/);
 if (order > cuts.at(-1)!) { tasks.push({ quote: '', functionId: 'TR11', params: { item: text.slice(order).replace(/^(?:订|买|叫|点)(?:个|一个|份)?/, '').replace(/[。！!，,\s]+$/, '') } }); cuts.push(order); }
 if (tasks.length < 2) return;
 // Quotes tile the user's sentence exactly, cut where each step starts.
 tasks.forEach((t, i) => { t.quote = text.slice(cuts[i], cuts[i + 1] ?? text.length); });
 return tasks;
}
