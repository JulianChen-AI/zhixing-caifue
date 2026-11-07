import { z } from 'zod';
import { checkOrigin, loadSession, reloadSession, sessionHeaders, provider, errorResponse } from '@/lib/bank/server';
import { explainSavedCard } from '@/lib/bank/card-explanation';
import { WorkflowError } from '@/lib/workflows/types';
import { assertSceneEpoch } from '@/lib/demo/control';

const schema = z.object({ taskId: z.string().min(1).max(200), key: z.string().max(60000), sceneEpoch: z.string().uuid().optional() }).strict();
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const reader = req.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (reader) try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 96000) throw new WorkflowError('卡片数据过长，请直接查看卡片。', 413);
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success) throw new WorkflowError('讲解请求不完整，请在卡片重新点击。', 400);
    const body = parsed.data, session = await loadSession(req); let first = true;
    const text = await explainSavedCard(async () => {
      const current = first ? session : await reloadSession(session); first = false;
      assertSceneEpoch(current.state, body.sceneEpoch); return current.state;
    }, body.taskId, body.key, provider(), fetch, req.signal);
    return Response.json({ text }, { headers: sessionHeaders(session, req) });
  } catch (error) { return errorResponse(error); }
}
