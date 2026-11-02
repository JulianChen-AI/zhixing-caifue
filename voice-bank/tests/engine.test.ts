import test from "node:test";
import assert from "node:assert/strict";
import { initialState, reduceBank, demoIntent } from "../lib/bank/engine.ts";
import type { BankAction, BankState } from "../lib/bank/types.ts";
const act = (s: BankState, a: BankAction, id: string = crypto.randomUUID()) => reduceBank(s, a, id);
function prepared() {
  let s = act(initialState(), { type: "intent", intent: { kind: "transfer", amount: 5000 } });
  s = act(s, { type: "select_recipient", recipientId: "zhang-roommate" });
  return act(s, { type: "edit", accountId: "daily" });
}
test("ambiguous recipients are not guessed", () => {
  const s = initialState(); const intent = demoIntent("给张三转五百元", s);
  assert.equal(intent.amount, 50000); assert.equal(intent.recipientId, null);
  assert.equal(act(s, { type: "intent", intent }).task?.step, "recipient");
});
test("correction cancels the old authorization and requires new confirmation", () => {
  const confirmed = act(prepared(), { type: "confirm" }); const old = confirmed.task!.verificationId!;
  const edited = act(confirmed, { type: "edit", amount: 3000 });
  assert.equal(edited.task?.step, "review"); assert.equal(edited.task?.confirmedRevision, null);
  assert.throws(() => act(edited, { type: "authenticate", code: "123456", verificationId: old }));
  const again = act(edited, { type: "confirm" });
  assert.notEqual(again.task!.verificationId, old);
  const done = act(again, { type: "authenticate", code: "123456", verificationId: again.task!.verificationId! });
  assert.equal(done.accounts[0].balance, 1283500); assert.equal(done.receipts[0].amount, 3000);
});
test("authentication cannot be skipped or guessed", () => {
  const s = prepared(); assert.throws(() => act(s, { type: "authenticate", code: "123456", verificationId: "bad" }));
  const confirmed = act(s, { type: "confirm" });
  assert.throws(() => act(confirmed, { type: "authenticate", code: "654321", verificationId: confirmed.task!.verificationId! }));
  assert.equal(s.accounts[0].balance, 1286500);
});
test("duplicate submissions only debit once", () => {
  const s = act(prepared(), { type: "confirm" });
  const a: BankAction = { type: "authenticate", code: "123456", verificationId: s.task!.verificationId! };
  const done = act(s, a, "same-request"); const duplicate = act(done, a, "same-request");
  assert.deepEqual(duplicate, done); assert.equal(done.receipts.length, 1); assert.equal(done.accounts[0].balance, 1281500);
  assert.throws(() => act(done, a));
});
test("cancel preserves balances and completed receipts", () => {
  const s = act(prepared(), { type: "cancel" }); assert.equal(s.task?.step, "cancelled"); assert.equal(s.accounts[0].balance, 1286500);
  assert.throws(() => act(s, { type: "confirm" }));
});
test("amounts use integer cents and insufficient funds are blocked", () => {
  assert.throws(() => act(prepared(), { type: "edit", amount: 0 }));
  assert.throws(() => act(prepared(), { type: "edit", amount: 12.3 }));
  const large = act(prepared(), { type: "edit", amount: 5000000 }); assert.throws(() => act(large, { type: "confirm" }));
});
test("changing funding accounts invalidates confirmation", () => {
  let s = act(prepared(), { type: "confirm" }); s = act(s, { type: "edit", accountId: "savings" });
  assert.equal(s.task!.verificationId, null); assert.equal(s.task!.accountId, "savings");
});
test("unrelated balance queries do not lose the transaction authorization", () => {
  let s = act(prepared(), { type: "confirm" }); const verificationId = s.task!.verificationId!;
  s = act(s, { type: "intent", intent: { kind: "balance" } });
  const done = act(s, { type: "authenticate", code: "123456", verificationId });
  assert.equal(done.receipts.length, 1);
});
test("demo commands handle Chinese numbers and keep small talk separate", () => {
  assert.equal(demoIntent("改成三百元", prepared()).amount, 30000);
  assert.equal(demoIntent("转一千二百三十四元", prepared()).amount, 123400);
  assert.equal(demoIntent("看看余额", prepared()).kind, "balance");
  assert.equal(demoIntent("确认", prepared()).kind, "help");
});

