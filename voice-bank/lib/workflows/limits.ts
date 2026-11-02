// Bounds of a standing goal transfer, decided here and never by the model: a stated run count
// (“连续三个月”) or the default, and never longer than 90 days, so one confirmation cannot grow into open-ended debits.
export const MAX_STANDING_DAYS = 90;
const DIGITS = '一二三四五六七八九十';

function count(word: string) {
  if (/^\d+$/.test(word)) return Number(word);
  if (word === '两') return 2;
  if (word === '十') return 10;
  if (word.startsWith('十')) return 10 + DIGITS.indexOf(word[1]) + 1;
  return DIGITS.indexOf(word) + 1 || undefined;
}

export type StandingLimits = { runs: number; perRun: number; cap: number; days: number; capped: boolean };
/** perRun and cap are in cents. A schedule that asks for more than 90 days is cut to fit, and says so. */
export function standingLimits(amountCents: number, schedule: unknown): StandingLimits {
  const text = String(schedule || '');
  const weekly = /每周|每星期/.test(text), daily = /每天|每日/.test(text);
  const stated = text.match(/(?:连续|共|一共)?\s*([\d两一二三四五六七八九十]+)\s*(?:个月|次|期|周|天)/)?.[1];
  const step = daily ? 1 : weekly ? 7 : 30, max = Math.floor(MAX_STANDING_DAYS / step);
  const wanted = (stated && count(stated)) || max, runs = Math.min(wanted, max);
  return { runs, perRun: amountCents, cap: amountCents * runs, days: Math.min(runs * step, MAX_STANDING_DAYS), capped: wanted > max };
}
