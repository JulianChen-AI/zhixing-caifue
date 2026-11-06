// Reads one spoken or typed amount; self-contained so pages and field checks need not load the rule catalog.
export function amountFromText(text: string): { amount: number | null; quote: string; uncertain: boolean } {
  if (/一半|全部|全额|剩下/.test(text)) return { amount: null, quote: '', uncertain: true };
  if (/[-−]\s*\d+(?:\.\d+)?\s*(?:元|块|yuan)|\d+\.\d{3,}\s*(?:元|块|yuan)|\d{1,3}(?:,\d{3})+\s*(?:元|块|yuan)|[零〇一二两三四五六七八九十百千万]+点[零〇一二两三四五六七八九]+\s*(?:元|块)/i.test(text)) return { amount: null, quote: '', uncertain: true };
  const uncertain = /大概|大约|左右|差不多|几百|随便|roughly|about|approximately/i.test(text);
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const matches = [...text.matchAll(/(?:转(?:账|给)?|改成|改为|金额[是为]?|就转)?\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块|yuan)/gi)];
  const fallback = text.match(/(?:转(?:账)?|改成|改为|金额[是为]?)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)(?![\d.])/);
  // Only jiao or fen (五毛, 三角五分) with no yuan.
  const coins = !matches.length && text.match(/(?:转|给)?[^\d一二两三四五六七八九十百千万]*([一二两三四五六七八九\d])\s*(毛|角)\s*(?:([一二两三四五六七八九\d])\s*分?)?/);
  if (coins && !/[元块]/.test(text)) { const d = (c: string) => /\d/.test(c) ? Number(c) : digits[c]; return { amount: uncertain ? null : d(coins[1]) * 10 + (coins[3] ? d(coins[3]) : 0), quote: coins[0].trim(), uncertain }; }
  const last = matches.at(-1) || fallback || (/^\s*\d+(?:\.\d{1,2})?\s*$/.test(text) ? text.match(/(\d+(?:\.\d{1,2})?)/) : null);
  if (!last) return { amount: null, quote: '', uncertain };
  if (matches.length > 1 && !/改成|改为|不对|应该是|actually|instead/i.test(text)) return { amount: null, quote: '', uncertain: true };
  const token = last[1]; let total = 0, section = 0, number = 0;
  if (/^\d/.test(token)) total = Math.round(Number(token) * 100);
  // A trailing digit after a unit is the next unit down in speech: 一千二 = 1200, 两百五 = 250, 一万二 = 12000; 一千零二 stays 1002.
  else { let lastUnit = 0, zero = false; for (const char of token) { if (char === '零' || char === '〇') { zero = true; number = 0; } else if (char in digits) number = digits[char]; else if (char === '万') { total += (section + number || 1) * 10000; section = 0; number = 0; lastUnit = 10000; zero = false; } else if (char in units) { section += (number || 1) * units[char]; number = 0; lastUnit = units[char]; zero = false; } }
    if (number && !zero && lastUnit >= 100 && token.length > 1 && !/[十百千万]$/.test(token)) number *= lastUnit / 10; total = (total + section + number) * 100; }
  // Jiao and fen after the yuan: 五十块零五毛 = 50.50, 五十块五 = 50.50, 五十元零五分 = 50.05, 三块八毛五 = 3.85.
  const tail = matches.includes(last as RegExpExecArray) ? text.slice((last as RegExpExecArray).index! + last[0].length) : '';
  const digit = (c: string) => /\d/.test(c) ? Number(c) : digits[c];
  const small = tail.match(/^\s*(零)?\s*([一二两三四五六七八九\d])\s*(毛|角|分)?\s*(?:(零)?\s*([一二两三四五六七八九\d])\s*分?)?/);
  if (small && !/^\s*[\d一二两三四五六七八九十百千万]{2,}/.test(tail)) {
    const [, , first, unit, , second] = small;
    if (unit === '分') total += digit(first);
    // A bare digit after 块 is jiao only in speech like 五十块五, ending there; never 50块2个人.
    else if (unit || !small[1] && !/\d/.test(first) && !second && /^(?:\s*$|\s*[，,。！!？?；;])/.test(tail.slice(small[0].length))) { total += digit(first) * 10; if (second) total += digit(second); }
  }
  return { amount: uncertain ? null : total, quote: (last[0] + (small?.[0] || '')).trim(), uncertain };
}
