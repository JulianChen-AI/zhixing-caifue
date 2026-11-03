import test from 'node:test';
import assert from 'node:assert/strict';
import { demoDataset, signed, lastWeekFriday, addDays, DEFAULT_ANCHOR, SCRIPTED_TRANSACTION_IDS } from '../lib/demo/dataset.ts';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import type { BankAction, BankState } from '../lib/bank/types.ts';
import type { Row } from '../lib/workflows/types.ts';

const ANCHORS = [DEFAULT_ANCHOR, '2026-11-03', '2026-11-30', '2027-01-01', '2028-02-29', '2026-12-31'];
const act = (s: BankState, a: BankAction) => reduceBank(s, a, crypto.randomUUID());
const ledger = (s: BankState) => s.workflows!.records.transactions;
const reconciles = (s: BankState) => s.accounts.every(a => a.opening!.amount + ledger(s).filter(t => t.accountId === a.id).reduce((n, t) => n + signed(t), 0) === a.balance);

test('every anchor yields books that reconcile, nothing dated after the anchor, and future charge dates', () => {
  for (const anchor of ANCHORS) {
    const d = demoDataset(anchor), s = initialState(anchor);
    assert.ok(reconciles(s), anchor);
    assert.ok(s.accounts.every(a => a.opening!.amount > 0), anchor);
    const rows = d.records.transactions;
    assert.equal(new Set(rows.map(r => r.id)).size, rows.length, anchor);
    assert.ok(rows.every(r => String(r.date) <= anchor && String(r.date) >= d.accounts[0].opening!.date), anchor);
    assert.deepEqual(rows.map(r => r.date), [...rows.map(r => r.date)].sort(), anchor);
    for (const sub of d.records.subscriptions) {
      assert.ok(String(sub.nextChargeAt) > anchor, `${anchor} ${sub.id}`);
      const merchant = sub.name, charged = rows.filter(r => r.merchant === merchant && r.kind === 'expense');
      assert.ok(charged.length >= 2 && charged.every(r => r.amount === sub.amount), `${anchor} ${sub.id}`);
    }
    for (const h of d.records.transferHistory) assert.ok(rows.some(r => r.id === h.id && r.amount === h.amount && r.kind === 'expense' && r.category === '转账'), anchor);
    for (const id of SCRIPTED_TRANSACTION_IDS) assert.equal(rows.filter(r => r.id === id).length, 1, `${anchor} ${id}`);
  }
});

test('the data covers the current and two previous months with income and ordinary spending each month', () => {
  for (const anchor of ['2026-11-18', '2026-10-25']) {
    const rows = demoDataset(anchor).records.transactions, month = (back: number) => { const d = new Date(anchor.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 7); };
    for (const back of [0, 1, 2]) {
      const m = rows.filter(r => String(r.date).startsWith(month(back)));
      assert.ok(m.some(r => r.kind === 'income'), `${anchor} ${month(back)} income`);
      assert.ok(new Set(m.filter(r => r.kind === 'expense').map(r => r.category)).size >= 5, `${anchor} ${month(back)} categories`);
    }
  }
});

test('history is stable: a calendar day has the same rows whichever anchor generated it', () => {
  const a = demoDataset('2026-10-25').records.transactions, b = demoDataset('2026-11-03').records.transactions;
  const day = (rows: Row[]) => JSON.stringify(rows.filter(r => r.date === '2026-10-02' && !String(r.id).startsWith('txn-video')));
  assert.equal(day(a), day(b));
  assert.deepEqual(demoDataset('2026-11-03'), demoDataset('2026-11-03'));
});

test('the scripted rows keep their original dates at the default anchor', () => {
  const rows = demoDataset().records.transactions, date = (id: string) => rows.find(r => r.id === id)!.date;
  assert.deepEqual(SCRIPTED_TRANSACTION_IDS.map(date), ['2026-10-20', '2026-10-18', '2026-10-15', '2026-09-15', '2026-10-21', '2026-10-20']);
  assert.equal(addDays('2026-10-25', -7), '2026-10-18');
});

test('a transfer made last Friday can be found by date and names the payee', () => {
  for (const anchor of ['2026-11-03', '2026-11-08', DEFAULT_ANCHOR]) {
    const friday = lastWeekFriday(anchor);
    assert.equal(new Date(friday + 'T00:00:00Z').getUTCDay(), 5);
    const s = act(initialState(anchor), { type: 'workflow', command: { operation: 'run', functionId: 'TR06', params: { period: friday }, source: 'card' } });
    const result = currentWorkflow(s)!.result as { recipient?: string; amount: number }[];
    assert.ok(result.some(r => r.recipient === '同学李四' && r.amount === 3600), anchor);
  }
  const all = currentWorkflow(act(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'TR06', params: {}, source: 'card' } }))!.result as { createdAt: string }[];
  assert.ok(all.length >= 6);
  assert.deepEqual(all.map(r => r.createdAt), [...all.map(r => r.createdAt)].sort().reverse());
});

test('seeded history is not shown as this session\'s receipts', () => {
  assert.deepEqual(initialState('2026-11-03').receipts, []);
});

test('a completed transfer debits the balance, adds one ledger row, and the books still reconcile', () => {
  let s = act(initialState(), { type: 'intent', intent: { kind: 'transfer', amount: 5000 } });
  s = act(s, { type: 'select_recipient', recipientId: 'zhang-roommate' });
  s = act(s, { type: 'edit', accountId: 'daily' });
  s = act(s, { type: 'confirm' });
  const before = ledger(s).length;
  s = act(s, { type: 'authenticate', code: '123456', verificationId: s.task!.verificationId! });
  assert.equal(s.accounts[0].balance, 1286500 - 5000);
  assert.equal(ledger(s).length, before + 1);
  assert.ok(reconciles(s));
});
