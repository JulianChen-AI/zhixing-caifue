// Rehearses the whole 300-second director script against the sandbox, as a take would run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { compile } from '../lib/demo/timeline.ts';
import { CHAPTERS, VIDEO_SECONDS } from '../lib/demo/script.ts';
import { rehearse, viewAt } from '../lib/demo/runtime.ts';

const voice = JSON.parse(readFileSync(new URL('../lib/demo/voice-lines.json', import.meta.url), 'utf8'));
const clips = JSON.parse(readFileSync(new URL('../public/demo/voice/manifest.json', import.meta.url), 'utf8')).clips as Record<string, { seconds: number }>;
const seconds = Object.fromEntries(Object.entries(clips).map(([id, c]) => [id, c.seconds]));
const compiled = compile(CHAPTERS, voice, seconds, VIDEO_SECONDS);
const at = (chapter: string, offset = 0) => compiled.chapters.find(c => c.id === chapter)!.end + offset;

test('timeline lasts exactly 300 seconds and every line is used once', () => {
  assert.equal(compiled.duration, VIDEO_SECONDS);
  assert.deepEqual(compiled.lines.map(l => l.id).sort(), voice.lines.map((l: { id: string }) => l.id).sort());
  for (let i = 1; i < compiled.lines.length; i++) assert.ok(compiled.lines[i].start >= compiled.lines[i - 1].end - 1e-6, `${compiled.lines[i].id} overlaps`);
  if (process.env.DEMO_PRINT) for (const c of compiled.chapters) console.log(c.id.padEnd(11), c.start.toFixed(1).padStart(6), c.end.toFixed(1).padStart(6), 'target', c.target.join('–'));
});

test('every voice clip has the AAC copy the /demo page plays', () => {
  const missing = Object.keys(clips).filter(id => !existsSync(new URL(`../public/demo/voice/${id}.m4a`, import.meta.url)));
  assert.deepEqual(missing, []);
});

test('a full take raises no sandbox errors', () => {
  assert.deepEqual(rehearse(compiled), []);
});

test('transfer chapter ends with one 120 yuan order and AA split 190 / 120', () => {
  const v = viewAt(compiled, at('transfer', -0.01));
  assert.equal(v.sb.ordersOf('transfer').length, 1);
  assert.equal(v.sb.balance_fen, 102_000);
  const s = v.sb.aaStatus();
  assert.equal(s.received_fen, 19_000);
  assert.equal(s.pending_fen, 12_000);
  assert.equal(v.sb.aa!.members['许然'].reminder, 'SENT');
  assert.equal(v.sb.aa!.members['张三'].reminder, 'NOT_SENT');
  assert.ok(v.milestones.verify);
});

test('voice confirmation alone never creates an order in the take', () => {
  const voiceLine = compiled.lines.find(l => l.id === 's1-xz-2')!;
  const v = viewAt(compiled, voiceLine.end + 1.0);
  assert.equal(v.sb.orders.size, 0);
  assert.equal(v.sb.confirmations.size, 0);
});

test('bills, cards and payday chapters end in the documented states', () => {
  const bills = viewAt(compiled, at('bills', -0.01));
  assert.equal(bills.sb.subscriptions['SUB-VIDEO-25'].bank_channel_release, 'RELEASED_SIMULATED');
  assert.equal(bills.sb.subscriptions['SUB-VIDEO-25'].merchant_cancellation, 'UNCONFIRMED');
  assert.equal(bills.sb.subscriptions['SUB-MUSIC-31'].bank_channel_release, 'ACTIVE');
  assert.equal(bills.sb.federatedStatus().publishable, false);
  const cards = viewAt(compiled, at('cards', -0.01));
  assert.equal(cards.sb.card.status, 'FROZEN_SIMULATED');
  const payday = viewAt(compiled, at('payday', -0.01));
  assert.equal(payday.sb.balance_fen, 800_000 - 40_000 - 20_000);
  assert.equal(payday.invest?.status, 'ACCEPTED_SHARES_PENDING');
  assert.deepEqual(Object.keys(payday.milestones).sort(), ['manage', 'plan', 'respond', 'risk', 'understand', 'verify']);
  const security = viewAt(compiled, at('security', -0.01));
  assert.equal(security.sec?.inject?.data.write_tool_calls, 0);
  assert.equal(security.sec?.voiceOrders, 0);
  assert.equal(security.sec?.clickOrders, 1);
  assert.equal(security.sec?.replay, 'CONFIRMATION_MISMATCH');
  assert.equal(security.sec?.lookup?.order_id, security.sec?.timeout?.order_id);
  assert.equal(security.sec?.lookup?.orders, 1);
});
