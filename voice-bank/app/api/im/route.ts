import { loadImSession } from '@/lib/im/session';
import { handleIm } from '@/lib/im/handler';
import { imDeps, imSession } from '@/lib/im/deps';

export const dynamic = 'force-dynamic';
/** Signed IM webhook: { channel, userId, text, messageId? } with x-im-timestamp and x-im-signature (see lib/im/handler.ts). */
export async function POST(req: Request) {
 try { return await handleIm(req, imDeps(req, async owner => imSession(await loadImSession(owner)))); }
 catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'IM 处理失败。' }, { status: 500 }); }
}
