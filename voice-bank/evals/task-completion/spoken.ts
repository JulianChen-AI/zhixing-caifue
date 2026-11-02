// How numbers sound in spoken Chinese, shared by the speech generator and the graders.
const DIGIT = '零一二三四五六七八九';
function under10k(n: number) {
 let out = '', zero = false;
 for (const [unit, size] of [['千', 1000], ['百', 100], ['十', 10], ['', 1]] as const) {
  const d = Math.floor(n / size) % 10;
  if (d) { out += (zero ? '零' : '') + DIGIT[d] + unit; zero = false; } else if (out) zero = true;
 }
 return out;
}
function readNumber(n: number): string {
 if (!n) return '零';
 const high = Math.floor(n / 10000), low = n % 10000;
 const text = (high ? under10k(high) + '万' + (low && low < 1000 ? '零' : '') : '') + (low ? under10k(low) : '');
 // Spoken Chinese says 两百 / 两千 / 两万 for a leading two.
 return text.replace(/^一十/, '十').replace(/^二(?=[百千万])/, '两');
}
const byDigit = (s: string) => [...s].map(d => d === '1' ? '幺' : DIGIT[Number(d)]).join('');
/** How a person says the sentence aloud: amounts as words, tails, codes and phone numbers digit by digit. */
export function speakable(text: string) {
 return text
  .replace(/(尾号\s*)(\d+)/g, (_, p, d) => p + byDigit(d))
  .replace(/(验证码[是为：:]?\s*)(\d{4,})/g, (_, p, d) => p + byDigit(d))
  .replace(/\d{11}/g, byDigit)
  .replace(/(\d{4})年/g, (_, y) => [...y].map(d => DIGIT[Number(d)]).join('') + '年')
  .replace(/(\d+)万(\d)(?!\d)/g, (_, w, k) => readNumber(Number(w)) + '万' + DIGIT[Number(k)])
  .replace(/\d+(?:\.\d+)?/g, n => { const [i, f] = n.split('.'); return readNumber(Number(i)) + (f ? '点' + [...f].map(d => DIGIT[Number(d)]).join('') : ''); });
}

/** Text reduced to what a listener can tell apart: Han characters and letters, numbers as spoken. */
export const comparable = (text: string) => speakable(text.replace(/(\d),(?=\d{3})/g, '$1')).replace(/两/g, '二').replace(/幺/g, '一').replace(/[^\p{Script=Han}a-zA-Z]/gu, '');
