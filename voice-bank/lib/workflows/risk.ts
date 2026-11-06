// Transfer risk for the confirmation channel. It only ever adds a requirement: with elevated risk a spoken “确认” no
// longer counts and the user must press the card's confirm button. Low risk removes nothing — review, confirmation and page
// authentication all stay. Thresholds are conservative because users most dislike being interrupted.
import type { BankState } from '../bank/types.ts';
import { contactsOf } from '../bank/recipients.ts';
import { businessNow } from '../demo/clock.ts';

export const LARGE_AMOUNT = 500000; // ¥5,000 in cents
export const SPLIT_WINDOW_MS = 24 * 3600 * 1000;
export const SPLIT_COUNT = 2; // earlier transfers to the same payee inside the window
export const ELEVATED_AT = 2;

export type TransferRisk = { score: number; elevated: boolean; reasons: string[] };
type Draft = { recipientId: string | null; amount: number | null };

/** Beijing-time hour on the business clock. */
export const businessHour = (s: BankState) => new Date(businessNow(s) + 8 * 3600 * 1000).getUTCHours();

/** Earlier transfers to this payee: receipts of this session plus the synthetic history. */
function earlier(s: BankState, recipientId: string) {
 const history = (s.workflows?.records.transferHistory || []) as { recipientId?: unknown; createdAt?: unknown }[];
 return [...s.receipts, ...history].filter(r => r.recipientId === recipientId).map(r => Date.parse(String(r.createdAt))).filter(Number.isFinite);
}

/**
 * Pure: amount (≥¥5,000 scores 2), first transfer to this payee (1), business clock between 23:00 and 06:00 (1), and two or
 * more transfers to the same payee in the last 24 hours, the shape of a split-up payment (2). Elevated from 2.
 */
export function transferRisk(s: BankState, draft: Draft): TransferRisk {
 const reasons: string[] = []; let score = 0;
 if (draft.amount != null && draft.amount >= LARGE_AMOUNT) { score += 2; reasons.push('金额较大（5,000元及以上）'); }
 if (draft.recipientId) {
  const contact = contactsOf(s).find(c => c.id === draft.recipientId), past = earlier(s, draft.recipientId), now = businessNow(s);
  if (contact && !contact.previouslyUsed && !past.length) { score += 1; reasons.push('第一次给这个收款人转账'); }
  if (past.filter(at => at <= now && now - at < SPLIT_WINDOW_MS).length >= SPLIT_COUNT) { score += 2; reasons.push('24小时内已多次转给同一人'); }
 }
 const hour = businessHour(s);
 if (hour >= 23 || hour < 6) { score += 1; reasons.push('深夜（23:00—06:00）'); }
 return { score, elevated: score >= ELEVATED_AT, reasons };
}

/** The sentence that opens the review card when the card button is required. */
export const elevatedNotice = (risk: TransferRisk) => `这笔转账需要你在卡片上点“确认”，语音说“确认”不算数（原因：${risk.reasons.join('、')}）。`;
export const VOICE_REFUSED = (risk: TransferRisk) => `这笔转账风险较高（${risk.reasons.join('、')}），语音确认不算数，请核对卡片后点“确认”按钮。`;
