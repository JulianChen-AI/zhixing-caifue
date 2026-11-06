import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { dispatchAction } from '../lib/plans/dispatch.ts';
import { KEPT_STATEMENTS, trimOldStatements } from '../lib/workflows/retention.ts';
import type { BankAction, BankState } from '../lib/bank/types.ts';

const start = () => ({ ...initialState(), demoClock: '2026-10-25T04:00:00.000Z' }) as BankState;
const query = (s: BankState, functionId = 'BI01', params: Record<string, unknown> = {}) => {
 const action = { type: 'workflow', command: { operation: 'run', functionId, params, source: 'card' } } as BankAction;
 return reduceBank(s, dispatchAction(s, action, ''), crypto.randomUUID());
};
const bytes = (s: BankState) => Buffer.byteLength(JSON.stringify(s));
type Statement = { transactions: unknown[]; transactionsTrimmed?: number; summary?: { expenseCount?: number } };
const statements = (s: BankState) => s.workflows!.tasks.filter(t => ['BI01', 'BI02'].includes(t.functionId)).map(t => t.result as Statement);

test('only the latest statements keep their rows, older ones keep their totals', () => {
 let s = start();
 for (let i = 0; i < 8; i++) s = query(s);
 const all = statements(s), full = all.filter(r => r.transactions.length);
 assert.equal(all.length, 8);
 assert.equal(full.length, KEPT_STATEMENTS);
 assert.deepEqual(all.slice(-KEPT_STATEMENTS).map(r => r.transactions.length > 0), Array(KEPT_STATEMENTS).fill(true));
 const old = all[0];
 assert.equal(old.transactions.length, 0);
 assert.equal(old.transactionsTrimmed, full[0].transactions.length);
 assert.equal(old.summary?.expenseCount, full[0].summary?.expenseCount);
});

test('thirty queries no longer grow the session by the whole ledger each time', () => {
 let s = start();
 const base = bytes(s);
 for (let i = 0; i < 30; i++) s = query(s, i % 2 ? 'BI01' : 'BI02');
 assert.ok(bytes(s) < 500 * 1024, `session is ${Math.round(bytes(s) / 1024)}KB`);
 assert.ok(bytes(s) > base);
});

test('trimming never changes the ledger, balances or task status', () => {
 let s = start();
 const ledger = JSON.stringify(s.workflows!.records.transactions), balances = JSON.stringify(s.accounts);
 for (let i = 0; i < 6; i++) s = query(s);
 assert.equal(JSON.stringify(s.workflows!.records.transactions), ledger);
 assert.equal(JSON.stringify(s.accounts), balances);
 assert.ok(s.workflows!.tasks.every(t => t.status === 'complete'));
});

test('a repeated question gets its rows back', () => {
 let s = start();
 for (let i = 0; i < 5; i++) s = query(s);
 s = query(s);
 const latest = s.workflows!.tasks.at(-1)!.result as Statement;
 assert.ok(latest.transactions.length > 0);
});

test('the current task and an unfinished plan keep their rows however many queries follow', () => {
 const s = start();
 const task = (id: string, at: number) => ({ id, functionId: 'BI01', title: '', params: {}, status: 'complete', missing: [], steps: [], reviewToken: null, verificationId: null, confirmedToken: null, message: '', createdAt: new Date(at).toISOString(), result: { transactions: [{ id: 'x' }] } });
 const tasks = ['plan-a', 'current', 'c', 'd', 'e', 'f'].map((id, i) => task(id, i * 1000));
 const state = { ...s, workflows: { ...s.workflows!, tasks, currentTaskId: 'current' }, plan: { status: 'running', steps: [{ id: 'step', taskId: 'plan-a', status: 'complete', result: { transactions: [{ id: 'x' }] } }] } } as unknown as BankState;
 const out = trimOldStatements(state);
 const rows = (id: string) => (out.workflows!.tasks.find(t => t.id === id)!.result as Statement).transactions.length;
 assert.equal(rows('plan-a'), 1);
 assert.equal(rows('current'), 1);
 assert.equal(rows('c'), 0);
 assert.equal((out.plan!.steps[0].result as Statement).transactions.length, 1);
 // Finished plans follow the normal rule, on the task and on its step copy.
 const done = trimOldStatements({ ...state, plan: { ...state.plan!, status: 'complete' } } as BankState);
 assert.equal((done.workflows!.tasks.find(t => t.id === 'plan-a')!.result as Statement).transactions.length, 0);
 assert.equal((done.plan!.steps[0].result as Statement).transactions.length, 0);
});

test('a state with nothing to trim comes back as the same object', () => {
 const s = start();
 assert.equal(trimOldStatements(s), s);
});
