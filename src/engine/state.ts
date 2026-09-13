import type { Program } from "../rom/ast.ts";
import type { GameState, MemoryFragment, MetaState, RunState, ViewPtr } from "./types.ts";

// ---- хранилище. В браузере localStorage, в симуляторе память.

export interface KV {
  get(k: string): string | null;
  set(k: string, v: string): void;
  del(k: string): void;
}

export function browserKV(): KV {
  return {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
    del: (k) => localStorage.removeItem(k),
  };
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    del: (k) => void m.delete(k),
  };
}

const META_KEY = "rom-ren-meta-v3";
const RUN_KEY = "rom-ren-run-v3";

// ---- забег

export function newRun(p: Program, orderId: string): RunState {
  const o = p.orders[orderId];
  const c = p.clients[o.client];
  return {
    order: orderId,
    client: c.id,
    loc: o.start,
    credit: c.credit,
    attention: c.attention,
    integrity: 3,
    items: [...c.items],
    flags: new Set(),
    visited: [],
    visitedLocs: [o.start],
    finished: false,
    failed: false,
    homeLeft: 0,
    failedResolved: false,
    arrived: true,
  };
}

interface SavedRun {
  run: Omit<RunState, "flags"> & { flags: string[] };
  ptr: ViewPtr;
}

export function saveRun(kv: KV, run: RunState, ptr: ViewPtr): void {
  const saved: SavedRun = { run: { ...run, flags: [...run.flags] }, ptr };
  kv.set(RUN_KEY, JSON.stringify(saved));
}

export type RunLoad =
  | { kind: "none" }
  | { kind: "corrupt" }
  | { kind: "ok"; run: RunState; ptr: ViewPtr };

/** Разбор сохранённого забега с различением «нет», «повреждено» и «ок». */
export function loadRunStatus(kv: KV): RunLoad {
  const raw = kv.get(RUN_KEY);
  if (!raw) return { kind: "none" };
  try {
    const j = JSON.parse(raw) as SavedRun;
    if (!j || typeof j !== "object" || !j.run || !j.ptr) return { kind: "corrupt" };
    const r = j.run;
    if (typeof r.order !== "string" || typeof r.client !== "string" || typeof r.loc !== "string")
      return { kind: "corrupt" };
    if (
      !Number.isFinite(r.credit) ||
      !Number.isFinite(r.attention) ||
      !Number.isFinite(r.integrity)
    )
      return { kind: "corrupt" };
    if (r.attention < 0 || r.attention > 5 || r.integrity < 0 || r.integrity > 3)
      return { kind: "corrupt" };
    if (!Array.isArray(r.items) || !Array.isArray(r.visited) || !Array.isArray(r.visitedLocs))
      return { kind: "corrupt" };
    if (!j.ptr || typeof j.ptr !== "object" || typeof j.ptr.kind !== "string" || !j.ptr.kind)
      return { kind: "corrupt" };
    return {
      kind: "ok",
      run: {
        ...r,
        flags: new Set(r.flags ?? []),
        failed: !!r.failed,
        homeLeft: r.homeLeft ?? 0,
        failedResolved: !!r.failedResolved,
      },
      ptr: j.ptr,
    };
  } catch {
    return { kind: "corrupt" };
  }
}

export function loadRun(kv: KV): { run: RunState; ptr: ViewPtr } | null {
  const load = loadRunStatus(kv);
  return load.kind === "ok" ? { run: load.run, ptr: load.ptr } : null;
}

export function clearRun(kv: KV): void {
  kv.del(RUN_KEY);
}

// ---- мета

export function newMeta(p: Program): MetaState {
  return {
    runs: 0,
    memory: [],
    dossier: new Set(),
    reputation: {},
    seenScenes: {},
    unlockedClients: Object.values(p.clients)
      .filter((c) => c.unlocked)
      .map((c) => c.id),
    endings: [],
    ordersDone: {},
    ordersFailed: {},
    failStreak: 0,
    debt: 0,
  };
}

export function loadMeta(kv: KV, p: Program): MetaState {
  try {
    const raw = kv.get(META_KEY);
    if (!raw) return newMeta(p);
    const j = JSON.parse(raw);
    return { ...newMeta(p), ...j, dossier: new Set(j.dossier ?? []) };
  } catch {
    return newMeta(p);
  }
}

export function saveMeta(kv: KV, meta: MetaState): void {
  kv.set(META_KEY, JSON.stringify({ ...meta, dossier: [...meta.dossier] }));
}

export function wipeAll(kv: KV): void {
  kv.del(META_KEY);
  kv.del(RUN_KEY);
}

// ---- память

export function memoryCount(s: GameState): number {
  return s.meta.memory.length;
}

export function memoryOf(s: GameState, kind: MemoryFragment["kind"]): number {
  return s.meta.memory.filter((m) => m.kind === kind).length;
}

export function hasMemory(s: GameState, id: string): boolean {
  return s.meta.memory.some((m) => m.id === id);
}

export function addMemory(s: GameState, frag: MemoryFragment): boolean {
  if (hasMemory(s, frag.id)) return false;
  s.meta.memory.push(frag);
  return true;
}

// ---- предметы, флаги, счётчики

export function has(s: GameState, item: string): boolean {
  return s.run.items.includes(item);
}

export function give(s: GameState, item: string): void {
  if (!has(s, item)) s.run.items.push(item);
}

export function take(s: GameState, item: string): void {
  const i = s.run.items.indexOf(item);
  if (i >= 0) s.run.items.splice(i, 1);
}

export function rep(s: GameState, who: string, delta: number): void {
  s.meta.reputation[who] = (s.meta.reputation[who] ?? 0) + delta;
}

export function repOf(s: GameState, who: string): number {
  return s.meta.reputation[who] ?? 0;
}

export function unlockClient(s: GameState, c: string): void {
  if (!s.meta.unlockedClients.includes(c)) s.meta.unlockedClients.push(c);
}

export function attention(s: GameState, delta: number): void {
  s.run.attention = Math.max(0, Math.min(5, s.run.attention + delta));
}

export function integrity(s: GameState, delta: number): void {
  s.run.integrity = Math.max(0, Math.min(3, s.run.integrity + delta));
}
