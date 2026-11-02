import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import type { BankState } from '../lib/bank/types.ts';
import { mascotCue, type MascotAction, type MascotContext } from '../lib/mascot/scenario.ts';
import { advancePlayback, createPlayback, frameId, requestPlayback, type Clips } from '../lib/mascot/sequence.ts';

const context = (bank: BankState | null = null, extra: Partial<MascotContext> = {}): MascotContext => ({ bank, phase: 'idle', mode: 'demo', muted: false, busy: false, connecting: false, closing: false, recovering: false, error: '', ...extra });
const run = (s: BankState, functionId: string, params = {}) => reduceBank(s, { type: 'workflow', command: { operation: 'run', functionId, params, source: 'card' } }, crypto.randomUUID());
function finish(s: BankState) {
  let task = currentWorkflow(s)!;
  assert.equal(task.status, 'review', task.message);
  s = reduceBank(s, { type: 'workflow', command: { operation: 'confirm', taskId: task.id, token: task.reviewToken!, source: 'card' } }, crypto.randomUUID());
  task = currentWorkflow(s)!;
  if (task.status === 'authenticate') s = reduceBank(s, { type: 'workflow', command: { operation: 'authenticate', taskId: task.id, token: task.verificationId!, code: '123456', source: 'card' } }, crypto.randomUUID());
  assert.equal(currentWorkflow(s)!.status, 'complete');
  return s;
}
test('voice, mute, tool processing and reply checking select the matching activity', () => {
  assert.equal(mascotCue(context(null, { mode: 'live', phase: 'listening' })).action, 'listening');
  assert.equal(mascotCue(context(null, { mode: 'live', phase: 'listening', muted: true })).action, 'idle');
  assert.equal(mascotCue(context(null, { phase: 'speaking' })).action, 'speaking');
  assert.equal(mascotCue(context(null, { phase: 'checking' })).action, 'thinking');
  assert.equal(mascotCue(context(null, { busy: true })).action, 'processing');
  assert.equal(mascotCue(context(null, { recovering: true })).action, 'umbrella');
});
test('a balance read or a prose claim cannot celebrate a transaction', () => {
  const s = run(initialState(), 'TR02', { accountId: 'daily' });
  s.lastReply = '存钱成功！';
  assert.equal(mascotCue(context(s)).action, 'idle');
});
test('deposit waits through review and authentication and celebrates only after funds move', () => {
  let s = run(initialState(), 'IN02', { goalId: 'goal-travel', accountId: 'daily', direction: 'deposit', amount: 100 });
  assert.equal(mascotCue(context(s)).action, 'waiting');
  const task = currentWorkflow(s)!;
  s = reduceBank(s, { type: 'workflow', command: { operation: 'confirm', taskId: task.id, token: task.reviewToken!, source: 'card' } }, crypto.randomUUID());
  assert.equal(mascotCue(context(s)).action, 'waiting');
  const auth = currentWorkflow(s)!;
  s = reduceBank(s, { type: 'workflow', command: { operation: 'authenticate', taskId: auth.id, token: auth.verificationId!, code: '123456', source: 'card' } }, crypto.randomUUID());
  assert.equal(mascotCue(context(s)).action, 'savings');
  assert.equal(s.workflows!.records.goals[0].balance, 10000);
  assert.equal(mascotCue(context(s, { error: '结果需要重新核对' })).action, 'comfort');
});
test('withdrawals do not play the deposit gesture; confirmed freezing uses a shield', () => {
  const deposited = finish(run(initialState(), 'IN02', { goalId: 'goal-travel', accountId: 'daily', direction: 'deposit', amount: 100 }));
  const withdrawn = finish(run(deposited, 'IN02', { goalId: 'goal-travel', accountId: 'daily', direction: 'withdraw', amount: 50 }));
  assert.equal(mascotCue(context(withdrawn)).action, 'success');
  const frozen = finish(run(initialState(), 'CA06', { cardId: 'card-daily', action: 'freeze' }));
  assert.equal(mascotCue(context(frozen)).action, 'guard');
});
test('server risk stops take priority over narration and processing', () => {
  const s = run(initialState(), 'TR03', { recipientId: 'zhang-roommate', accountId: 'daily', amount: 100, note: '刷单解冻费' });
  assert.equal(currentWorkflow(s)!.status, 'blocked');
  assert.equal(mascotCue(context(s, { phase: 'speaking', busy: true })).action, 'blocked');
});

const manifest = JSON.parse(readFileSync(new URL('../public/mascot/manifest.json', import.meta.url), 'utf8'));
const clips = {} as Clips;
for (const id of Object.keys(manifest.actions) as MascotAction[]) { const c = manifest.actions[id]; clips[id] = { ...c, loop: c.cyclic, loopFrames: c.loop }; }
test('all fifteen actions reference shipped atlas cells with valid safe exits', () => {
  assert.equal(Object.keys(clips).length, 15);
  for (const sheet of manifest.sheets) assert.ok(existsSync(new URL(`../public/mascot/${sheet}`, import.meta.url)));
  for (const clip of Object.values(clips)) {
    for (const id of [...clip.enter, ...clip.loopFrames, ...clip.exit]) assert.ok(id >= 0 && id < manifest.sheets.length * manifest.framesPerSheet);
    for (const safe of clip.safeExitFrames) assert.ok(safe >= 0 && safe < clip.loopFrames.length);
  }
});
test('one-shot feedback plays once then resumes listening without repeating on rerender', () => {
  let s = createPlayback({ action: 'success', key: 'receipt-1', fallback: 'listening' });
  let loops = 0;
  for (let i = 0; i < 500; i++) {
    if (s.action === 'success' && s.phase === 'loop') loops++;
    assert.notEqual(frameId(s, clips), undefined);
    s = advancePlayback(s, clips);
  }
  assert.equal(loops, clips.success.loopFrames.length);
  assert.equal(s.action, 'listening');
  s = requestPlayback(s, { action: 'success', key: 'receipt-2', fallback: 'listening' });
  for (let i = 0; i < 120; i++) s = advancePlayback(s, clips);
  assert.equal(s.consumed, 'receipt-2');
});
test('rapid requests keep the latest destination and return through neutral', () => {
  let s = createPlayback({ action: 'listening', key: 'listening' });
  for (let i = 0; i < 10; i++) s = advancePlayback(s, clips);
  s = requestPlayback(s, { action: 'thinking', key: 'thinking' });
  s = advancePlayback(s, clips);
  assert.equal(s.phase, 'reverse');
  s = requestPlayback(s, { action: 'speaking', key: 'speaking' });
  let visitedNeutral = false;
  for (let i = 0; i < 100; i++) {
    if (s.action === 'listening' && s.phase === 'reverse' && s.frame === 0) visitedNeutral = true;
    s = advancePlayback(s, clips);
    assert.notEqual(s.action, 'thinking');
  }
  assert.ok(visitedNeutral);
  assert.equal(s.action, 'speaking');
});
test('a completed deposit is never reversed or looped even if the next cue arrives', () => {
  let s = createPlayback({ action: 'savings', key: 'deposit-1' });
  const hold: number[] = [];
  for (let i = 0; i < 200; i++) {
    if (i === 8) s = requestPlayback(s, { action: 'listening', key: 'listen' });
    if (s.action === 'savings' && s.phase === 'loop') hold.push(s.frame);
    assert.notEqual(s.phase, 'reverse');
    s = advancePlayback(s, clips);
  }
  assert.deepEqual(hold, Array.from({ length: clips.savings.loopFrames.length }, (_, i) => i));
  assert.equal(s.action, 'listening');
});
test('continuous states exit only at authored pause frames', () => {
  let s = createPlayback({ action: 'processing', key: 'process' });
  while (s.phase !== 'loop' || s.frame !== 5) s = advancePlayback(s, clips);
  s = requestPlayback(s, { action: 'waiting', key: 'wait' });
  let last = s;
  while (s.phase === 'loop') { last = s; s = advancePlayback(s, clips); }
  assert.ok(clips.processing.safeExitFrames.includes(last.frame));
  assert.equal(s.phase, 'exit');
});
