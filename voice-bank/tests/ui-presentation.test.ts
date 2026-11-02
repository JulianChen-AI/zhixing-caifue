import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import type { BankState } from '../lib/bank/types.ts';
import type { Params, WorkflowCommand } from '../lib/workflows/types.ts';
import { cardCaption, replyForState, resultMessage, userMessage, workflowMessage } from '../lib/ui/presentation.ts';

const act = (state: BankState, command: Omit<WorkflowCommand, 'source'>) => reduceBank(state, {
  type: 'workflow', command: { ...command, source: 'card' },
}, crypto.randomUUID());
const run = (id: string, params: Params = {}, state = initialState()) => act(state, { operation: 'run', functionId: id, params });

test('balance summaries use returned cents without changing business state', () => {
  const state = run('TR02');
  const before = structuredClone(state);
  const text = replyForState(state);
  assert.match(text, /日常账户余额 ¥12,865\.00/);
  assert.match(text, /储蓄账户余额 ¥30,000\.00/);
  assert.doesNotMatch(text, /查询完成|合成|沙箱/);
  assert.deepEqual(state, before);
});

test('a failed balance query cannot become an empty successful query', () => {
  const state = run('TR02', { accountId: 'missing' });
  assert.equal(currentWorkflow(state)!.status, 'blocked');
  assert.doesNotMatch(replyForState(state), /没有查到可用账户|共 0/);
});

test('authentication presentation preserves the current review and authentication tokens', () => {
  let state = run('CA06', { action: 'freeze', cardId: 'card-daily' });
  const review = currentWorkflow(state)!;
  assert.equal(workflowMessage(review), '');
  state = act(state, { operation: 'confirm', taskId: review.id, token: review.reviewToken! });
  const before = structuredClone(state);
  assert.equal(currentWorkflow(state)!.status, 'authenticate');
  assert.equal(replyForState(state), '请输入验证码。');
  assert.match(currentWorkflow(state)!.message, /模型不能代填/);
  assert.deepEqual(state, before);
  assert.equal(state.workflows!.records.cards.find(card => card.id === 'card-daily')!.status, 'active');
});

test('purchase summaries distinguish accepted orders from confirmed holdings', () => {
  const fixture = initialState();
  fixture.workflows!.riskProfile = { level: 5, answers: [5, 5, 5], validUntil: '2027-10-29T00:00:00Z' };
  let state = run('IN08', { productId: 'fund-cash', accountId: 'daily', amount: 100 }, fixture);
  let task = currentWorkflow(state)!;
  state = act(state, { operation: 'confirm', taskId: task.id, token: task.reviewToken! });
  task = currentWorkflow(state)!;
  state = act(state, { operation: 'authenticate', taskId: task.id, token: task.verificationId!, code: '123456' });
  assert.equal(currentWorkflow(state)!.status, 'complete');
  assert.match(replyForState(state), /已受理.*等待份额确认/);
  assert.doesNotMatch(replyForState(state), /已到账|份额已确认/);
});

test('rule deletion is not described as saving an active rule', () => {
  let state = run('TR04', { action: 'create', recipientId: 'zs-roommate', accountId: 'daily', amount: 100, schedule: '每月1日' });
  // The rule fixture is a saved record; no authentication or live scheduling is invoked.
  state.workflows!.records.rules.push({ id: 'saved-rule', kind: 'transfer', status: 'active', amount: 10000 });
  state = run('TR04', { action: 'delete', ruleId: 'saved-rule' }, state);
  let task = currentWorkflow(state)!;
  state = act(state, { operation: 'confirm', taskId: task.id, token: task.reviewToken! });
  task = currentWorkflow(state)!;
  state = act(state, { operation: 'authenticate', taskId: task.id, token: task.verificationId!, code: '123456' });
  assert.equal(replyForState(state), '规则已删除。');
});

test('display errors retain uncertain transaction outcomes and meaningful business reasons', () => {
  assert.match(userMessage('办理请求超时，结果尚未确认。不要重复提交。'), /未能确认结果/);
  assert.doesNotMatch(userMessage('办理请求超时，结果尚未确认。不要重复提交。'), /办理失败|已取消|成功/);
  const restriction = '司法限制不能通过自助操作解除，请联系开户机构核实官方程序。';
  assert.equal(userMessage(restriction), restriction);
  assert.equal(userMessage('可用余额不足，请修改金额。'), '可用余额不足，请修改金额。');
});

test('maintenance instructions are replaced without changing the raw error', () => {
  const raw = 'Qwen 连接失败（502）。请检查密钥、业务空间所属地域、模型权限和额度。';
  assert.equal(userMessage(raw), '语音暂不可用，可以使用文字输入。');
  assert.match(raw, /业务空间/);
  assert.doesNotMatch(userMessage('AA参与者必须是用户明确给出的姓名或称呼字符串数组'), /数组|模型|参数/);
});

test('blocked presentation explains the restriction without exposing implementation instructions',()=>{
 const raw='命中转账风险信号；升级核验尚未接入，已暂停，不以口头安全确认绕过。';
 assert.equal(userMessage(raw),'这笔转账存在风险，暂时无法继续。请核对收款信息。');
 const bank=run('TR03',{recipientId:'zhang-roommate',accountId:'daily',amount:50});
 assert.equal(cardCaption(bank,'请核对本次办理信息。'),'');
 assert.equal(cardCaption(bank,'这个账户暂时无法使用，请选择另一个账户。'),'这个账户暂时无法使用，请选择另一个账户。');
});

test('saved scheduling and estimated arrival limits remain visible', () => {
  assert.match(resultMessage('execution', '仅保存规则，尚未接入自动扣款调度'), /自动执行尚未启用/);
  assert.match(resultMessage('calendarNotice', '未接入法定节假日日历'), /未计入法定节假日/);
  assert.equal(resultMessage('notice', '查询已成功；以上仅反映当前沙箱会话保存的记录，不代表其他机构或历史账户情况。'), '');
});
