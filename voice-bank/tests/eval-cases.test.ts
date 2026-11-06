import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { caseFile, grade, SCENARIOS, type EvalCase } from '../evals/task-completion/grade.ts';
import { USER_FUNCTIONS } from '../lib/workflows/catalog.ts';
import { SCENE_IDS } from '../lib/demo/scenes.ts';

const load = (name: string) => caseFile.parse(JSON.parse(readFileSync(new URL(`../evals/task-completion/${name}.json`, import.meta.url), 'utf8')));
const file = load('cases');
const holdout = load('holdout');

test('task-completion cases name real functions and scenes and cover every scenario', () => {
 const ids = file.cases.map(c => c.id);
 assert.equal(new Set(ids).size, ids.length, 'case ids are unique');
 const known = new Set(USER_FUNCTIONS.map(f => f.id));
 const named = file.cases.flatMap(c => [c.expect, ...(c.expect.anyOf || [])].flatMap(b => [b.functionId, ...(b.plan || [])].flat().filter((v): v is string => typeof v === 'string')));
 assert.deepEqual(named.filter(id => !known.has(id)), []);
 assert.deepEqual(file.cases.filter(c => c.scene && !(SCENE_IDS as readonly string[]).includes(c.scene)).map(c => c.id), []);
 for (const key of Object.keys(SCENARIOS)) assert.ok(file.cases.filter(c => c.scenario === key).length >= 7, `${key} has at least seven cases`);
});

test('holdout and tricky cases are new ids that name real functions', () => {
 const used = new Set(file.cases.map(c => c.id)), known = new Set(USER_FUNCTIONS.map(f => f.id));
 for (const set of [holdout, load('tricky-dev'), load('tricky-holdout'), load('prompts28'), load('lifecycle'), load('features'), load('redteam')]) {
  const ids = set.cases.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.filter(id => used.has(id)), [], set.version);
  ids.forEach(id => used.add(id));
  const named = set.cases.flatMap(c => [c.expect, ...(c.expect.anyOf || [])].flatMap(b => [b.functionId, ...(b.plan || [])].flat().filter((v): v is string => typeof v === 'string')));
  assert.deepEqual(named.filter(id => !known.has(id)), []);
 }
});

test('grading never lets a committed effect pass and flags a wrong draft at the gate', () => {
 const c: EvalCase = { id: 'TR-99', scenario: 'transfer', brief: 'x', source: 'brief', turns: ['x'], expect: { functionId: 'TR03', status: 'review', params: { amount: 500 } } };
 const at = (amount: number, effectsChanged = false) => grade(c, { focus: { functionId: 'TR03', status: 'review', params: { amount }, missing: [], message: '', choices: 0 }, plan: null, clarified: false, effectsChanged });
 assert.equal(at(500).passed, true);
 assert.deepEqual([at(5).passed, at(5).wrongDraft], [false, true]);
 assert.deepEqual([at(500, true).passed, at(500, true).wrongExecution], [false, true]);
 // Either acceptable behaviour passes; neither one excuses an effect.
 const either: EvalCase = { ...c, expect: { anyOf: [{ functionId: 'TR03', status: 'review' }, { clarify: true }] } };
 assert.equal(grade(either, { focus: null, plan: null, clarified: true, effectsChanged: false }).passed, true);
 assert.equal(grade(either, { focus: null, plan: null, clarified: true, effectsChanged: true }).passed, false);
});
