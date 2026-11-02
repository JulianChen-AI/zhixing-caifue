import { z } from "zod";
import { CONTACTS, type Contact } from "./types.ts";

export type QwenEnv = { DASHSCOPE_API_KEY?: string; DASHSCOPE_WORKSPACE_ID?: string; DASHSCOPE_REGION?: string; QWEN_REALTIME_MODEL?: string; QWEN_PLANNER_MODEL?: string; QWEN_VOICE?: string; QWEN_DELEGATION?: string; QWEN_INTENT?: string };
export function qwenConfig(e: QwenEnv) {
  const workspace = e.DASHSCOPE_WORKSPACE_ID || "";
  const region = e.DASHSCOPE_REGION || "beijing";
  const valid = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(workspace) && ["beijing", "singapore"].includes(region);
  const host = region === "singapore" ? "ap-southeast-1" : "cn-beijing";
  return {
    ready: Boolean(e.DASHSCOPE_API_KEY && valid), key: e.DASHSCOPE_API_KEY,
    base: valid ? `https://${workspace}.${host}.maas.aliyuncs.com` : "",
    realtime: e.QWEN_REALTIME_MODEL || "qwen3.8-omni-flash-realtime",
    planner: e.QWEN_PLANNER_MODEL || "qwen-plus", voice: e.QWEN_VOICE || "Tina",
    delegation: e.QWEN_DELEGATION === "responses",
    // json (default): one model call decides intent and parameters; rules only validate (lib/voice/intent-json.ts).
    // tools restores the earlier tool-loop path.
    intent: e.QWEN_INTENT === "tools" ? "tools" as const : "json" as const,
  };
}
export const parsedIntentFor = (contacts: readonly Contact[]) => z.object({
  kind: z.enum(["transfer", "amend", "cancel", "balance", "help"]),
  amount: z.number().int().safe().positive().nullable(),
  recipientId: z.string().max(60).refine(id => contacts.some(c => c.id === id)).nullable(),
  accountId: z.enum(["daily", "savings"]).nullable(), note: z.string().max(60).nullable(),
}).strict();

export const parsedIntent = parsedIntentFor(CONTACTS);
