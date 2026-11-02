import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../lib/bank/engine.ts';
import { ACTIONS } from '../lib/workflows/adapters.ts';
import { choices } from '../lib/workflows/fields.ts';
import { ACTION_LABELS } from '../lib/workflows/review.ts';

test('every card action has a readable label', () => {
 assert.deepEqual(Object.values(ACTIONS).flat().filter(action => !ACTION_LABELS[action]), []);
});

test('record options describe nameless records instead of showing their id', () => {
 const s = initialState();
 s.workflows!.records.rules = [{ id: 'rule-1', amount: 120000, schedule: '每月5日' }];
 s.workflows!.records.replacements = [{ id: 'replacement-1', cardId: 'card-daily' }];
 assert.equal(choices(s, 'ruleId')[0].label, '每月5日 · 1200.00元');
 assert.equal(choices(s, 'replacementId')[0].label, '日常借记卡');
});
