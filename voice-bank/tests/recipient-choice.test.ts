import test from 'node:test';
import assert from 'node:assert/strict';
import { ambiguousRecipients, recipientChoiceQuestion } from '../lib/bank/recipients.ts';
import { assertVoiceEvidence } from '../lib/workflows/fields.ts';
import { initialState } from '../lib/bank/engine.ts';
import { WorkflowError } from '../lib/workflows/types.ts';
import { BankRequestError } from '../lib/bank/request-error.ts';
import { QwenConversation } from '../lib/voice/qwen-protocol.ts';

const tails = initialState().accounts.map(a => a.tail);
const transfer = { functionId: 'TR03', params: {} };

test('a bare shared name lists every matching contact instead of guessing one', () => {
  const same = ambiguousRecipients('给张三转五百元', tails);
  assert.deepEqual(same.map(c => c.id), ['zhang-roommate', 'zhang-landlord']);
  assert.equal(recipientChoiceQuestion(same), '“张三”有两位：室友张三（招商银行尾号6688）、房东张三（工商银行尾号2910）。请问要转给哪一位？');
  for (const text of ['给室友张三转五百元', '转给尾号6688的张三', '给李四转500', '给尾号0000的张三转500']) assert.deepEqual(ambiguousRecipients(text, tails), [], text);
});

test('a voice guess between same-name payees is rejected as a question for the user', () => {
  let error: unknown;
  try { assertVoiceEvidence(initialState(), transfer, { recipientId: 'zhang-roommate' }, '给张三转五百元'); } catch (e) { error = e; }
  assert.ok(error instanceof WorkflowError);
  assert.equal(error.field, 'recipientChoice');
  assert.match(error.message, /请问要转给哪一位/);
  assert.doesNotThrow(() => assertVoiceEvidence(initialState(), transfer, { recipientId: 'zhang-roommate' }, '给室友张三转五百元'));
  assert.throws(() => assertVoiceEvidence(initialState(), transfer, { recipientId: 'zhang-roommate' }, '给尾号2910的张三转五百元'), (e: unknown) => e instanceof WorkflowError && e.field !== 'recipientChoice');
});

test('after a needed choice the model is told to ask, and a further guess ends the turn with the question', async () => {
  const question = '“张三”有两位：室友张三（招商银行尾号6688）、房东张三（工商银行尾号2910）。请问要转给哪一位？';
  const sent: any[] = [], issues: string[] = [], transcripts: any[] = []; let tools = 0;
  const q = new QwenConversation((type, extra) => sent.push({ type, ...extra }), {
    onTranscript: (...args) => transcripts.push(args), onInterrupt: () => {}, onToolIssue: message => issues.push(message),
    onTool: async () => { tools++; throw new BankRequestError(question, 400, 'needs_user_choice'); },
  });
  const tick = () => new Promise(r => setTimeout(r, 0));
  await q.handle({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
  await q.handle({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
  await q.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: '给张三转五百元' });
  const call = (id: string) => ({ type: 'response.function_call_arguments.done', name: 'bank_function', call_id: id, arguments: '{"operation":"amend","params":{"recipientId":"zhang-roommate"}}' });
  await q.handle({ type: 'response.created', response: { id: 'r1' } });
  await q.handle({ ...call('c1'), response_id: 'r1' }); await tick();
  const first = JSON.parse(sent.find(e => e.item?.type === 'function_call_output').item.output);
  assert.equal(first.status, 'needs_user'); assert.equal(first.rejectionCode, 'needs_user_choice');
  assert.equal(first.message, question); assert.match(first.instruction, /不要再调用任何工具/);
  await q.handle({ type: 'response.done', response: { id: 'r1' } });
  await q.handle({ type: 'response.created', response: { id: 'r2' } });
  await q.handle({ ...call('c2'), response_id: 'r2' }); await tick();
  assert.equal(tools, 1, 'the retry must not reach the backend');
  assert.equal(issues.at(-1), question);
  assert.equal(transcripts.at(-1)[1], question);
});
