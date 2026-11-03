import { env } from "cloudflare:workers";
import { liveInitialState, BankError, reduceBank, normalizeState } from "./engine";
import { type BankAction, type BankState, type Contact, type Intent } from "./types";
import { contactsOf } from "./recipients";
import { assertSceneEpoch, demoControlReplay, isDemoControl } from '../demo/control';
import { qwenConfig, parsedIntentFor, type QwenEnv } from "./qwen";
import { routeRequest, type RoutingDecision } from "../checklists/routing";
import { WorkflowError } from '../workflows/types';
import { serveIdentity } from './tailscale';

export const runtimeEnv = () => env as Cloudflare.Env & QwenEnv;
export const provider = () => qwenConfig({ ...process.env, ...runtimeEnv() });
export const configured = () => provider().ready;
export function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const expected = serveIdentity(req, runtimeEnv().TAILSCALE_SERVE_ORIGIN)?.origin ?? new URL(req.url).origin;
  if (origin && origin !== expected) throw new BankError("请求来源不匹配。", 403);
}
function owner(req: Request) {
  const serveOrigin = runtimeEnv().TAILSCALE_SERVE_ORIGIN;
  if (serveOrigin) {
    const identity = serveIdentity(req, serveOrigin);
    if (identity) return identity.owner;
    if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(req.url).hostname)) return "local-demo";
    throw new BankError("请使用已登录的 Tailscale 设备访问私人演示。", 401);
  }
  const id = req.headers.get("oai-authenticated-user-id");
  if (id) return id;
  if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(req.url).hostname)) return "local-demo";
  throw new BankError("请先登录后使用私人演示。", 401);
}
export async function loadSession(req: Request) {
  const db = runtimeEnv().DB;
  if (!db) throw new BankError("演示数据库尚未初始化，请按 README 应用本地迁移。", 503);
  const user = owner(req);
  const candidate = req.headers.get("cookie")?.match(/(?:^|;\s*)zx_demo=([\w-]{36})/)?.[1];
  if (candidate) {
    const row = await db.prepare("SELECT state, revision FROM demo_sessions WHERE id = ? AND owner = ?").bind(candidate, user).first<{ state: string; revision: number }>();
    const saved = row && JSON.parse(row.state) as BankState;
    // Sessions created before the generated dataset hold the old October-only ledger; start them over.
    if (saved && (saved.dataVersion || saved.sceneId)) return { id: candidate, user, state: normalizeState(saved), fresh: false };
  }
  const id = crypto.randomUUID(), state = liveInitialState();
  await db.prepare("INSERT INTO demo_sessions (id, owner, revision, state, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, user, 0, JSON.stringify(state), Date.now()).run();
  return { id, user, state, fresh: true };
}
export type DemoSession = Awaited<ReturnType<typeof loadSession>>;
export async function reloadSession(session:DemoSession):Promise<DemoSession> {
  const row=await runtimeEnv().DB!.prepare("SELECT state FROM demo_sessions WHERE id = ? AND owner = ?").bind(session.id,session.user).first<{state:string}>();
  if(!row)throw new BankError("演示会话已失效，请刷新后重试。",409);
  return {...session,state:normalizeState(JSON.parse(row.state) as BankState)};
}
export function sessionHeaders(s: DemoSession, req: Request) {
  const secure = new URL(req.url).protocol === "https:" || Boolean(serveIdentity(req, runtimeEnv().TAILSCALE_SERVE_ORIGIN));
  return { "Cache-Control": "no-store", ...(s.fresh ? { "Set-Cookie": `zx_demo=${s.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}` } : {}) };
}
export async function commit(session: DemoSession, action: BankAction, expectedRevision: number, requestId: string, expectedEpoch = session.state.sceneEpoch) {
  if (isDemoControl(session.state,action) && demoControlReplay(session.state,action,requestId,expectedEpoch)) return session.state;
  assertSceneEpoch(session.state,expectedEpoch);
  if (session.state.recentRequestIds.includes(requestId)) {
    if (isDemoControl(session.state,action)) throw new BankError("控制请求编号已使用，请刷新后重试。",409);
    return session.state;
  }
  if (session.state.revision !== expectedRevision) throw new BankError("办理内容已经更新，已刷新卡片，请重试。", 409);
  const next = reduceBank(session.state, action, requestId);
  const result = await runtimeEnv().DB!.prepare("UPDATE demo_sessions SET state = ?, revision = ?, updated_at = ? WHERE id = ? AND owner = ? AND revision = ?")
    .bind(JSON.stringify(next), next.revision, Date.now(), session.id, session.user, expectedRevision).run();
  if (result.meta.changes !== 1) {
    if (isDemoControl(session.state,action)) {
      const row = await runtimeEnv().DB!.prepare("SELECT state FROM demo_sessions WHERE id = ? AND owner = ?").bind(session.id,session.user).first<{state:string}>();
      if (row) { const latest=normalizeState(JSON.parse(row.state) as BankState); if (demoControlReplay(latest,action,requestId,expectedEpoch)) return latest; }
    }
    throw new BankError("另一项操作已更新办理内容，请重试。", 409);
  }
  return next;
}

const intentSchema = (contacts: readonly Contact[]) => ({
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["transfer", "amend", "cancel", "balance", "help"] },
    amount: { type: ["integer", "null"], description: "金额，以分为单位。五百元=50000。未提及则null。" },
    recipientId: { type: ["string", "null"], enum: [...contacts.map(c => c.id), null] },
    accountId: { type: ["string", "null"], enum: ["daily", "savings", null] },
    note: { type: ["string", "null"] },
  }, required: ["kind", "amount", "recipientId", "accountId", "note"],
});
export async function plan(text: string, state: BankState, mode: string, signal?: AbortSignal): Promise<RoutingDecision> {
  const baseline = routeRequest(text,state);
  if (mode === "demo" || baseline.workflowId !== "TF-T01" || !baseline.draft || !["transfer","amend"].includes(baseline.draft.kind) || baseline.riskSignals.length) return baseline;
  const contacts = contactsOf(state);
  const p = provider();
  if (!p.ready) throw new BankError("Qwen 尚未配置，请在服务端填写百炼 API Key 和业务空间 ID，可先使用交互演示。", 503);
  const response = await fetch(`${p.base}/compatible-mode/v1/chat/completions`, {
    method: "POST", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: p.planner, enable_thinking: false, max_tokens: 400,
      messages: [
        { role: "system", content: "你是语音银行原型的意图解析器。只返回符合以下 schema 的 JSON，所有字段必填，未提及用null：" + JSON.stringify(intentSchema(contacts)) + "。只解析用户明确说出的信息，不代替用户选择。重名且没有足够信息区分时recipientId必须null。改口以最后一个明确金额为准，金额换算整数分。用户说确认或密码不能由模型授权资金操作，返回help。取消和停止说话要区分：单说停一下/等一下返回help，明确取消业务才cancel。当前有未完成任务时补充信息用amend。所有字段只来自用户明确表达。" },
        { role: "user", content: JSON.stringify({ contacts, task: state.task, accounts: state.accounts.map(a => ({ id: a.id, name: a.name })), utterance: text }) },
      ], response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) throw new BankError(`后台模型暂时无法处理（${response.status}），可以重试或使用交互演示。`, 502);
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const output = data.choices?.[0]?.message?.content;
  if (!output) throw new BankError("后台没有返回可用的办理信息，请再说一次。", 502);
  try { return routeRequest(text,state,parsedIntentFor(contacts).parse(JSON.parse(output))); }
  catch { return { ...baseline, checks: [...baseline.checks, { id: "ROUTE.model_format", title: "校验解析结果结构", status: "clarify", reason: "模型结果未通过预设格式校验", sources: baseline.checks[0]?.sources || [] }], draft: undefined, outcome: "clarify", unresolved: ["intent"], question: "解析结果不符合预设业务结构，请明确收款人、金额和付款账户。" }; }
}
export function errorResponse(error: unknown) {
  const known=error instanceof BankError||error instanceof WorkflowError;
  return Response.json({ error: known ? error.message : "暂时无法完成这次操作，请重试。",...((error as {field?:string})?.field==='sceneEpoch'?{code:'scene_changed'}:error instanceof WorkflowError&&error.field==='functionId'?{code:'business_mismatch'}:error instanceof WorkflowError&&error.field==='recipientChoice'?{code:'needs_user_choice'}:{}) }, { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}
