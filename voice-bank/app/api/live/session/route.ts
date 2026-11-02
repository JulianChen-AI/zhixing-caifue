import { provider, loadSession, reloadSession, sessionHeaders, checkOrigin, errorResponse } from "@/lib/bank/server";
import { BankError } from "@/lib/bank/engine";
import { assertSceneEpoch } from "@/lib/demo/control";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const session = await loadSession(req);
    const body = await req.json() as {sdp?:unknown;sceneEpoch?:unknown;revision?:unknown};
    const metadata=z.object({sceneEpoch:z.string().uuid().optional(),revision:z.number().int().nonnegative().optional()}).safeParse(body);
    if(!metadata.success)throw new BankError("语音连接信息无效。");
    assertSceneEpoch(session.state,metadata.data.sceneEpoch);
    if(metadata.data.revision!==undefined&&session.state.revision!==metadata.data.revision)throw new BankError("办理内容已更新，请核对最新卡片。",409);
    const p = provider();
    if (!p.ready) throw new BankError("Qwen 尚未配置。请在服务端设置百炼 API Key 和业务空间 ID，或先体验交互演示。", 503);
    const { sdp } = body;
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 64000) throw new BankError("语音连接信息无效。");
    const upstream = await fetch(`${p.base}/api/v1/webrtc/realtime?model=${encodeURIComponent(p.realtime)}`, {
      method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/sdp" },
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(25000)]), body: sdp,
    });
    if (!upstream.ok) throw new BankError(`Qwen 连接失败（${upstream.status}）。请检查密钥、业务空间所属地域、模型权限和额度。`, 502);
    const answer = await upstream.text();
    if (!answer.trimStart().startsWith("v=0")) throw new BankError("Qwen 返回的语音连接信息无效。", 502);
    const latest=await reloadSession(session);assertSceneEpoch(latest.state,metadata.data.sceneEpoch);
    if((session.state.sceneEpoch || latest.state.sceneEpoch || metadata.data.revision!==undefined)&&latest.state.revision!==session.state.revision)throw new BankError("办理内容已更新，请核对最新卡片。",409);
    return Response.json({ sdp: answer, voice: p.voice, delegation: p.delegation }, { status: 201, headers: sessionHeaders(session, req) });
  } catch (e) { return errorResponse(e); }
}
