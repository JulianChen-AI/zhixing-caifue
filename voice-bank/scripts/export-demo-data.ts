// Writes the default demo dataset as CSV for review: npm run data:export [-- 2026-11-03]
import { mkdirSync, writeFileSync } from 'node:fs';
import { demoDataset, signed } from '../lib/demo/dataset.ts';
import { businessDay } from '../lib/demo/clock.ts';

const anchor = process.argv[2] || businessDay();
const d = demoDataset(anchor), out = new URL(`../outputs/demo-data-${anchor}/`, import.meta.url);
mkdirSync(out, { recursive: true });
const csv = (rows: Record<string, unknown>[], keys: string[]) => '﻿' + [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n') + '\n';
const balances: Record<string, number> = Object.fromEntries(d.accounts.map(a => [a.id, a.opening!.amount]));
const ledger = d.records.transactions.map(t => { balances[String(t.accountId)] += signed(t); return { ...t, amount: Number(t.amount) / 100, balanceAfter: balances[String(t.accountId)] / 100 }; });
writeFileSync(new URL('transactions.csv', out), csv(ledger, ['date', 'accountId', 'kind', 'merchant', 'category', 'amount', 'balanceAfter', 'id', 'note']));
writeFileSync(new URL('transfers.csv', out), csv(d.records.transferHistory.map(r => ({ ...r, amount: Number(r.amount) / 100 })), ['createdAt', 'recipientId', 'amount', 'note', 'id']));
writeFileSync(new URL('subscriptions.csv', out), csv(d.records.subscriptions.map(r => ({ ...r, amount: Number(r.amount) / 100 })), ['name', 'channel', 'amount', 'nextChargeAt', 'status', 'protected']));
console.log(`${anchor}：流水 ${ledger.length} 笔，转账 ${d.records.transferHistory.length} 笔；期末余额 ${d.accounts.map(a => `${a.name} ${a.balance / 100}`).join('，')}（与逐笔累计一致：${d.accounts.every(a => Math.round(balances[a.id]) === a.balance)}）`);
console.log(new URL(out).pathname);
