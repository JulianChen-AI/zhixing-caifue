import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankState } from '../lib/bank/types.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { workflowToolArguments, workflowToolResult } from '../lib/workflows/realtime.ts';
import type { Params, WorkflowCommand } from '../lib/workflows/types.ts';
import { BANK_TOOLS, QwenConversation } from '../lib/voice/qwen-protocol.ts';
import { BankRequestError } from '../lib/bank/request-error.ts';

const people = ['我', '室友张三', '房东张三'];
const act = (
  state: BankState,
  command: Omit<WorkflowCommand, 'source'> & { source?: 'card' | 'voice' },
) => reduceBank(state, {
  type: 'workflow',
  command: { source: 'voice', ...command },
}, crypto.randomUUID());

function callVoice(state: BankState, args: unknown, utterance: string): BankState {
  const parsed = workflowToolArguments.parse(args);
  return act(state, { ...parsed, utterance });
}

function runVoice(state: BankState, functionId: string, params: Params, utterance: string) {
  return callVoice(state, { operation: 'run', functionId, params }, utterance);
}

async function rejectedVoiceTool(state: BankState, args: unknown, utterance: string) {
  const sent: Record<string, any>[] = [];
  const q = new QwenConversation((type, extra) => sent.push({ type, ...extra }), {
    onTranscript: () => {}, onInterrupt: () => {},
    onTool: async (_name, toolArgs, context) => {
      try {
        const parsed = workflowToolArguments.parse(toolArgs);
        state = reduceBank(state, {
          type: 'workflow', command: { ...parsed, source: 'voice', utterance: context.utterance },
        }, context.requestId);
        return workflowToolResult(state);
      } catch (error) {
        throw new BankRequestError(error instanceof Error ? error.message : '请求被拒绝。', 400);
      }
    },
  });
  const itemId = 'aa-contract-user';
  await q.handle({ type: 'input_audio_buffer.speech_started', item_id: itemId });
  await q.handle({ type: 'input_audio_buffer.speech_stopped', item_id: itemId });
  await q.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, transcript: utterance });
  await q.handle({ type: 'response.created', response: { id: 'aa-contract-response' } });
  await q.handle({
    type: 'response.function_call_arguments.done', name: 'bank_function', response_id: 'aa-contract-response',
    call_id: 'aa-contract-call', arguments: JSON.stringify(args),
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  q.stop();
  const output = sent.find(event => event.item?.type === 'function_call_output')?.item?.output;
  assert.equal(typeof output, 'string', 'Qwen function call should receive a concrete rejection result');
  return JSON.parse(output as string) as { status: string; code: string; effectCommitted: boolean; message: string; instruction: string };
}

test('TR05 corrects a total with an explicit per-person split, keeps review open, and commits once after voice confirmation', () => {
  let state = runVoice(initialState(), 'TR05', {
    action: 'create', total: 100, participants: people,
  }, '三个人AA一百块钱，我、室友张三、房东张三');
  const beforeCorrection = workflowToolResult(state)!;
  assert.equal(beforeCorrection.status, 'review', beforeCorrection.message);
  assert.match(beforeCorrection.review!.spokenSummary, /AA 总额.*人民币100\.00元/);
  assert.equal(state.workflows!.records.aa.length, 0, 'run must only create a review draft');

  state = callVoice(state, {
    operation: 'amend', taskId: beforeCorrection.taskId, params: { total: 120 },
  }, '改成总额120元，每人40元');
  const corrected = workflowToolResult(state)!;
  assert.equal(corrected.status, 'review', corrected.message);
  assert.equal(corrected.params.total, 120);
  assert.notEqual(corrected.confirmationToken, beforeCorrection.confirmationToken);
  assert.equal(state.workflows!.records.aa.length, 0);

  assert.throws(() => callVoice(state, {
    operation: 'confirm', taskId: corrected.taskId, token: beforeCorrection.confirmationToken,
  }, '确认'), /摘要已过期/);
  assert.equal(workflowToolResult(state)!.confirmationToken, corrected.confirmationToken);

  state = callVoice(state, {
    operation: 'confirm', taskId: corrected.taskId, token: corrected.confirmationToken,
  }, '确认');
  const committed = workflowToolResult(state)!;
  assert.equal(committed.status, 'complete', committed.message);
  assert.equal(committed.effectCommitted, true);
  assert.equal(state.workflows!.records.aa.length, 1);
  assert.equal(state.workflows!.records.aa[0].total, 12000);
  assert.deepEqual(
    (state.workflows!.records.aa[0].participants as { name: string; amount: number }[])
      .map(({ name, amount }) => [name, amount]),
    [['我', 4000], ['室友张三', 4000], ['房东张三', 4000]],
  );
});

test('three people with only an explicit group total remain collecting until identities are supplied', () => {
  const state = runVoice(initialState(), 'TR05', { action: 'create', total: 100 }, '我们三个人总共100元做AA');
  const result = workflowToolResult(state)!;
  assert.equal(result.status, 'collecting');
  assert.ok(result.missing.includes('participants'));
  assert.equal(state.workflows!.records.aa.length, 0);
  assert.deepEqual(result.params.participants, undefined);
});

test('the historical three-person AA100 request keeps the total but asks for names instead of treating count as participants', () => {
  const state = runVoice(initialState(), 'TR05', {
    action: 'create', total: 100,
  }, '三个人AA一百块钱，先把卡片给我看');
  const result = workflowToolResult(state)!;
  assert.equal(result.status, 'collecting');
  assert.equal(result.params.total, 100);
  assert.ok(result.missing.includes('participants'));
  assert.equal(result.params.participants, undefined);
  assert.equal(state.workflows!.records.aa.length, 0);
});

test('TR05 parses a participant count separately from money and keeps group total distinct from per-person amount', () => {
  const perPerson = runVoice(initialState(), 'TR05', {
    action: 'create', total: 300, participants: people,
  }, '我们3个人每人100元，我、室友张三、房东张三做AA');
  const perPersonResult = workflowToolResult(perPerson)!;
  assert.equal(perPersonResult.status, 'review', perPersonResult.message);
  assert.equal(perPersonResult.params.total, 300);
  assert.match(perPersonResult.review!.spokenSummary, /AA 总额.*人民币300\.00元/);
  assert.equal(perPerson.workflows!.records.aa.length, 0);

  const groupTotal = runVoice(initialState(), 'TR05', {
    action: 'create', total: 100, participants: people,
  }, '我们3个人AA100元，我、室友张三、房东张三做AA');
  const groupResult = workflowToolResult(groupTotal)!;
  assert.equal(groupResult.status, 'review', groupResult.message);
  assert.equal(groupResult.params.total, 100);
  assert.match(groupResult.review!.spokenSummary, /AA 总额.*人民币100\.00元/);
  assert.equal(groupTotal.workflows!.records.aa.length, 0);
});

test('an explicit per-person amount cannot be mistaken for the AA group total', () => {
  const state = initialState();
  let mismatch: BankState | undefined;
  let error: Error | undefined;
  try { mismatch = runVoice(state, 'TR05', {
    action: 'create', total: 100, participants: people,
  }, '我们三个人每人100元，我、室友张三、房东张三做AA'); }
  catch (cause) { error = cause as Error; }
  const outcome = mismatch ? workflowToolResult(mismatch)! : undefined;
  assert.ok(error || outcome && ['blocked', 'collecting'].includes(outcome.status), 'mismatched total must reject or ask, never become review');
  assert.match(error?.message || outcome!.message, /总额|合计|每人/);
  const consistent = runVoice(initialState(), 'TR05', {
    action: 'create', total: 300, participants: people,
  }, '我们三个人每人100元，我、室友张三、房东张三做AA');
  assert.equal(workflowToolResult(consistent)!.status, 'review');
  assert.equal(state.workflows!.records.aa.length, 0);
});

test('TR05 may resend unchanged participants but downgrades unspoken additions and negated members', () => {
  let state = runVoice(initialState(), 'TR05', {
    action: 'create', total: 100, participants: people,
  }, '三个人AA一百块钱，我、室友张三、房东张三');
  const original = workflowToolResult(state)!;
  assert.equal(original.status, 'review', original.message);

  state = callVoice(state, {
    operation: 'amend', taskId: original.taskId,
    params: { total: 120, participants: people },
  }, '改成总额120元，每人40元');
  const corrected = workflowToolResult(state)!;
  assert.equal(corrected.status, 'review', corrected.message);
  assert.equal(corrected.params.total, 120);
  assert.deepEqual(corrected.params.participants, people);
  assert.notEqual(corrected.confirmationToken, original.confirmationToken);
  assert.equal(state.workflows!.records.aa.length, 0);

  const unspoken = callVoice(state, {
    operation: 'amend', taskId: corrected.taskId,
    params: { total: 120, participants: [...people, '王五'] },
  }, '改成总额120元，每人40元');
  assert.equal(workflowToolResult(unspoken)!.status, 'collecting');
  assert.equal(workflowToolResult(unspoken)!.params.total, 120);
  assert.ok(workflowToolResult(unspoken)!.missing.includes('participants'));
  assert.deepEqual(workflowToolResult(unspoken)!.params.participants, []);
  assert.equal(workflowToolResult(unspoken)!.confirmationToken, null);
  assert.equal(unspoken.workflows!.records.aa.length, 0);

  const negated = callVoice(state, {
    operation: 'amend', taskId: corrected.taskId,
    params: { total: 120, participants: people },
  }, '我们3个人总共120元，每人40元；我和室友张三参加，房东张三不参加');
  assert.equal(workflowToolResult(negated)!.status, 'collecting');
  assert.equal(workflowToolResult(negated)!.params.total, 120);
  assert.ok(workflowToolResult(negated)!.missing.includes('participants'));
  assert.deepEqual(workflowToolResult(negated)!.params.participants, []);
  assert.equal(workflowToolResult(negated)!.confirmationToken, null);
  assert.equal(negated.workflows!.records.aa.length, 0);

  const repaired = callVoice(negated, {
    operation: 'amend', taskId: corrected.taskId, params: { participants: people },
  }, '参与者是我、室友张三、房东张三，三个人都参加');
  const repairedResult = workflowToolResult(repaired)!;
  assert.equal(repairedResult.status, 'review', repairedResult.message);
  assert.deepEqual(repairedResult.params.participants, people);
  assert.notEqual(repairedResult.confirmationToken, corrected.confirmationToken);
  assert.throws(() => callVoice(repaired, {
    operation: 'confirm', taskId: repairedResult.taskId, token: corrected.confirmationToken,
  }, '确认'), /摘要已过期/);
  assert.equal(repaired.workflows!.records.aa.length, 0);
});

test('ASR uncertainty clears an unverified TR05 list and keeps the verified total collecting until names are explicit', () => {
  let state = runVoice(initialState(), 'TR05', {
    action: 'create', total: 120, participants: people,
  }, '我们三个人AA，总共一百二十元，每人四十元。参与者是我是由张三，房东张三，先把卡片给我看，不要提交。');
  const collecting = workflowToolResult(state)!;
  assert.equal(collecting.status, 'collecting');
  assert.equal(collecting.params.total, 120);
  assert.deepEqual(collecting.params.participants, []);
  assert.ok(collecting.missing.includes('participants'));
  assert.equal(collecting.confirmationToken, null);
  assert.equal(collecting.effectCommitted, false);
  assert.equal(state.workflows!.records.aa.length, 0);

  state = callVoice(state, {
    operation: 'amend', taskId: collecting.taskId, params: { participants: people },
  }, '参与者是我、室友张三、房东张三，三个人都参加');
  const repaired = workflowToolResult(state)!;
  assert.equal(repaired.status, 'review', repaired.message);
  assert.equal(repaired.params.total, 120);
  assert.deepEqual(repaired.params.participants, people);
  assert.ok(repaired.confirmationToken);
  assert.equal(state.workflows!.records.aa.length, 0);
});

test('TR05 list is read-only, needs no sessionId, and returns AA records rather than transfer receipts', () => {
  const state = initialState();
  const aa = {
    id: 'aa-existing', total: 12000,
    participants: [{ name: '我', amount: 4000, status: 'unpaid' }],
    status: 'awaiting_participants',
  };
  state.workflows!.records.aa.push(aa);
  state.receipts.push({
    id: 'transfer-receipt', taskId: 'transfer-task', recipientId: 'zhang-roommate',
    accountId: 'daily', amount: 4000, note: '', createdAt: new Date().toISOString(),
  });

  const queried = callVoice(state, { operation: 'run', functionId: 'TR05', params: { action: 'list' } }, '查AA记录');
  const result = workflowToolResult(queried)!;
  assert.equal(result.status, 'complete', result.message);
  assert.equal(currentWorkflow(queried)!.params.sessionId, undefined);
  assert.deepEqual((result.result as { id: string }[]).map(({ id }) => id), ['aa-existing']);
  assert.deepEqual(currentWorkflow(queried)!.result, [aa]);
  assert.equal(queried.receipts.length, 1, 'a read-only AA query must not alter transfer receipts');
});

test('TR05 describe returns its executable field/action contract', () => {
  const described = callVoice(initialState(), { operation: 'describe', functionId: 'TR05' }, '查AA功能说明');
  const contract = workflowToolResult(described)!.result as { acceptedFields: string[]; actions: string[] };
  assert.ok(contract.acceptedFields.includes('participants'));
  assert.ok(contract.acceptedFields.includes('total'));
  assert.ok(contract.actions.includes('create'));
  assert.ok(contract.actions.includes('list'));
});

test('bank_function documents typed TR05 fields and rejected legacy-shaped payload gets a usable contract hint', async () => {
  const functionTool = BANK_TOOLS.find(tool => tool.function.name === 'bank_function')!;
  const parameters = functionTool.function.parameters as any;
  const aaParams = parameters.properties.params.properties;
  assert.equal(aaParams.total.type, 'number');
  assert.equal(aaParams.participants.type, 'array');
  assert.equal(aaParams.participants.items.type, 'string');
  assert.ok(aaParams.action.enum?.includes('create') && aaParams.action.enum?.includes('list')
    || /create/.test(aaParams.action.description || '') && /list/.test(aaParams.action.description || ''));
  assert.equal(parameters.additionalProperties, false);
  assert.equal(workflowToolArguments.safeParse({
    operation: 'run', functionId: 'TR05', params: { action: 'create', total: 120, participants: people },
  }).success, true);

  const state = initialState();
  const bad = { operation: 'run', functionId: 'TR05', params: { amount: 100, participants: 3 } };
  const output = await rejectedVoiceTool(state, bad, '三个人AA100元');
  assert.equal(output.status, 'error');
  assert.equal(output.code, 'tool_request_rejected');
  assert.equal(output.effectCommitted, false);
  assert.match(output.instruction, /total/);
  assert.match(output.instruction, /participants/);
  assert.match(output.instruction, /action=/);
  assert.equal(state.workflows!.records.aa.length, 0);
  assert.equal(state.workflows!.tasks.length, 0, 'invalid parameters must not leave an unlinked task/card');

  const noBypass = initialState();
  const skipAuth = workflowToolArguments.safeParse({
    operation: 'run', functionId: 'TR05', params: { action: 'create', total: 100, participants: people, skipAuth: true },
  });
  if (skipAuth.success) assert.throws(() => callVoice(noBypass, skipAuth.data, '三个人总共100元做AA'));
  assert.equal(noBypass.workflows!.records.aa.length, 0);
  assert.equal(noBypass.workflows!.tasks.length, 0);
  assert.equal(workflowToolArguments.safeParse({ operation: 'authenticate', code: '123456' }).success, false);
});

test('voice cannot authenticate or skip the explicit review gate', () => {
  const state = runVoice(initialState(), 'TR05', {
    action: 'create', total: 120, participants: people,
  }, '我们三个人总共120元，室友张三、房东张三和我做AA');
  const review = workflowToolResult(state)!;
  assert.equal(review.status, 'review', review.message);
  assert.equal(state.workflows!.records.aa.length, 0);
  assert.equal(workflowToolArguments.safeParse({
    operation: 'authenticate', taskId: review.taskId, token: crypto.randomUUID(), code: '123456',
  }).success, false);
  assert.throws(() => reduceBank(state, {
    type: 'workflow', command: {
      operation: 'authenticate', taskId: review.taskId, token: crypto.randomUUID(),
      code: '123456', source: 'voice', utterance: '验证码123456',
    },
  }, crypto.randomUUID()), /认证只能通过专门页面/);
  assert.equal(workflowToolResult(state)!.status, 'review');
  assert.equal(state.workflows!.records.aa.length, 0);
});

test('AA total above 5000 yuan and the sixth same-day request are blocked without writes', () => {
  const over = runVoice(initialState(), 'TR05', {
    action: 'create', total: 5001, participants: people,
  }, '我们三个人总共5001元，室友张三、房东张三和我做AA');
  assert.equal(workflowToolResult(over)!.status, 'blocked');
  assert.match(workflowToolResult(over)!.message, /5000/);
  assert.equal(over.workflows!.records.aa.length, 0);

  const capped = initialState();
  for (let i = 0; i < 5; i++) capped.workflows!.records.aa.push({
    id: `aa-today-${i}`, total: 10000, participants: [], status: 'complete',
    createdAt: new Date().toISOString(),
  });
  const sixth = runVoice(capped, 'TR05', {
    action: 'create', total: 100, participants: people,
  }, '我们三个人总共100元，室友张三、房东张三和我做AA');
  assert.equal(workflowToolResult(sixth)!.status, 'blocked');
  assert.match(workflowToolResult(sixth)!.message, /5次/);
  assert.equal(capped.workflows!.records.aa.length, 5);
  assert.equal(sixth.workflows!.records.aa.length, 5);
});

test('voice runs for investment, billing, subscription, and card functions return their matching cards', () => {
  const cases: [string, Params, string][] = [
    ['IN07', { productIds: ['fund-cash', 'fund-bond'] }, '比较演示现金基金和演示债券基金'],
    ['BI02', { period: '2026-10' }, '查看2026年10月收支统计'],
    ['SU01', {}, '查看订阅清单'],
    ['CA01', {}, '查看银行卡列表'],
    ['IN03', { goalId: 'goal-travel' }, '查看旅行目标进度'],
  ];
  for (const [functionId, params, utterance] of cases) {
    const state = runVoice(initialState(), functionId, params, utterance);
    const result = workflowToolResult(state)!;
    assert.equal(result.functionId, functionId, `${functionId} routed to the wrong function`);
    assert.equal(result.status, 'complete', `${functionId}: ${result.message}`);
    assert.ok(result.result, `${functionId} did not return a public result/card`);
  }
});
