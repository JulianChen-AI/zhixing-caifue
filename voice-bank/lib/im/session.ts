import { runtimeEnv, type DemoSession } from '../bank/server';
import { BankError, liveInitialState, normalizeState } from '../bank/engine';
import type { BankState } from '../bank/types';

/** IM sessions: one per IM user, keyed by a stable id derived from the owner. Not linked to an App login in this sandbox. */
export async function loadImSession(owner: string): Promise<DemoSession> {
  const db = runtimeEnv().DB;
  if (!db) throw new BankError("演示数据库尚未初始化，请按 README 应用本地迁移。", 503);
  const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(owner)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  const row = await db.prepare("SELECT state FROM demo_sessions WHERE id = ? AND owner = ?").bind(id, owner).first<{ state: string }>();
  if (row) return { id, user: owner, state: normalizeState(JSON.parse(row.state) as BankState), fresh: false };
  const state = liveInitialState();
  await db.prepare("INSERT INTO demo_sessions (id, owner, revision, state, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, owner, 0, JSON.stringify(state), Date.now()).run();
  return { id, user: owner, state, fresh: true };
}
