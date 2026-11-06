import type { BankState } from '../bank/types.ts';
import type { Row } from './types.ts';
import { WorkflowError } from './types.ts';

/** The perk is a demo, unrelated to any transaction: no account opening, deposit, transfer or purchase earns it. */
export const INVITE_PERK = '注册后我们俩各得一次抽奖机会';

/** One person the user named. A list, a group or “everyone” is a mass send, which this never does. */
export function inviteeName(value: unknown): string {
 const name = String(value ?? '').trim();
 if (!name) throw new WorkflowError('请说一下要邀请谁。', 400, 'invitee');
 if (/[、，,;；/]|和|及|跟|与|以及|大家|所有|全部|全班|全宿舍|群|们$/.test(name) || name.length > 12)
  throw new WorkflowError('邀请一次发给一位同学，请说一个人的称呼。', 400, 'invitee');
 return name;
}

/** Private invitation text, written by the program from the name alone; no contact data is read. */
export function inviteText(name: string) {
 return `${name}，我在用知行银行的“财富鹅”记账攒钱，挺好用的，你也来试试？${INVITE_PERK}。`;
}

/** An invitation already sent to the same person is not sent again. */
export function existingInvite(s: BankState, name: string): Row | undefined {
 return ((s.workflows?.records.invites || []) as Row[]).find(r => r.invitee === name && r.status !== 'withdrawn');
}

export const inviteView = (r: Row) => ({ ...r, statusText: r.status === 'simulated_sent' ? '已发送，等待回应' : String(r.status) });
