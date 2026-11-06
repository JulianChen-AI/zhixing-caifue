// Amounts read back in words so a misheard 300 / 3000 is caught on the review card. Input is always integer cents.
const UPPER = '零壹贰叁肆伍陆柒捌玖', LOWER = '零一二三四五六七八九';

/** Digits 0–9999 in one group, with the given digit and unit characters; zeros collapse to one 零. */
function group(n: number, digits: string, units: string[]): string {
 let out = '', zero = false;
 for (let i = 3; i >= 0; i--) {
  const d = Math.floor(n / 10 ** i) % 10;
  if (d === 0) { if (out) zero = true; continue; }
  if (zero) { out += digits[0]; zero = false; }
  out += digits[d] + units[i];
 }
 return out;
}
/** Whole yuan in words up to 9999,9999,9999; 万 and 亿 groups, with 零 where a group is short. */
function integer(n: number, digits: string, units: string[]): string {
 if (n === 0) return digits[0];
 const parts = [n % 10000, Math.floor(n / 10000) % 10000, Math.floor(n / 1e8)], big = ['', '万', '亿'];
 let out = '';
 for (let i = 2; i >= 0; i--) {
  if (!parts[i]) continue;
  if (out && parts[i] < 1000) out += digits[0];
  out += group(parts[i], digits, units) + big[i];
 }
 return out.replace(new RegExp(`${digits[0]}+`, 'g'), digits[0]);
}

/** Financial capitals: 300000 → 叁仟元整, 120050 → 壹仟贰佰元零伍角, 1 → 壹分. */
export function upperAmount(cents: number): string {
 if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('金额须为非负整数分');
 const yuan = Math.floor(cents / 100), jiao = Math.floor(cents / 10) % 10, fen = cents % 10;
 const head = yuan ? integer(yuan, UPPER, ['', '拾', '佰', '仟']) + '元' : '';
 if (!jiao && !fen) return (head || '零元') + '整';
 return head + (jiao ? UPPER[jiao] + '角' : yuan ? '零' : '') + (fen ? UPPER[fen] + '分' : '');
}

/** Spoken words for a question: 300 → 三百, 3000 → 三千, 12000 → 一万二千; with cents falls back to digits. */
export function spokenYuan(cents: number): string {
 if (cents % 100) return `${(cents / 100).toFixed(2).replace(/0$/, '')}元`;
 const words = integer(cents / 100, LOWER, ['', '十', '百', '千']);
 return words.replace(/^一十/, '十');
}
