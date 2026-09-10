import type { Client, GameState, ItemId, MetaState, RunState } from "./types";
import { ITEMS } from "./items";

const KEY = "rom-ren-meta-v2";

export function newRun(client: Client): RunState {
  const base: RunState = {
    client,
    act: 1,
    credit: 1200,
    attention: 1,
    integrity: 3,
    items: ["ice_old"],
    flags: new Set(),
    visited: [],
    poolShown: 0,
  };
  switch (client) {
    case "velt":
      base.credit = 3000;
      break;
    case "marsh":
      base.credit = 800;
      base.attention = 0;
      base.items.push("marsh_paper");
      break;
    case "zero":
      base.credit = 600;
      base.items.push("dub");
      break;
    case "moriyama":
      base.credit = 900;
      base.items.push("patch");
      break;
    case "hanna":
      base.credit = 2000;
      base.attention = 2;
      break;
    case "silence":
      base.credit = 0;
      base.items = [];
      break;
  }
  return base;
}

export function newMeta(): MetaState {
  return {
    runs: 0,
    memory: [],
    dossier: new Set(),
    reputation: {},
    seenScenes: {},
    unlockedClients: ["velt"],
    endings: [],
  };
}

export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return newMeta();
    const j = JSON.parse(raw);
    return { ...newMeta(), ...j, dossier: new Set(j.dossier ?? []) };
  } catch {
    return newMeta();
  }
}

export function saveMeta(meta: MetaState): void {
  localStorage.setItem(KEY, JSON.stringify({ ...meta, dossier: [...meta.dossier] }));
}

export function wipeMeta(): void {
  localStorage.removeItem(KEY);
}

// ---- память

export function memoryCount(s: GameState): number {
  return s.meta.memory.length;
}

export function hasMemory(s: GameState, id: string): boolean {
  return s.meta.memory.some((m) => m.id === id);
}

export function memoryOf(s: GameState, kind: "own" | "hanna" | "foreign"): number {
  return s.meta.memory.filter((m) => m.kind === kind).length;
}

export function addMemory(
  s: GameState,
  frag: { id: string; kind: "own" | "hanna" | "foreign"; text: string },
): boolean {
  if (hasMemory(s, frag.id)) return false;
  s.meta.memory.push(frag);
  return true;
}

// ---- предметы

export function has(s: GameState, item: ItemId): boolean {
  return s.run.items.includes(item);
}

export function give(s: GameState, item: ItemId): void {
  if (!has(s, item)) s.run.items.push(item);
}

export function take(s: GameState, item: ItemId): void {
  const i = s.run.items.indexOf(item);
  if (i >= 0) s.run.items.splice(i, 1);
}

export function useItem(s: GameState, item: ItemId): void {
  if (ITEMS[item].consumable) take(s, item);
}

// ---- прочее

export function flag(s: GameState, f: string): boolean {
  return s.run.flags.has(f);
}

/** Сцена ещё ни разу не показывалась за всё время игры. */
export function neverSeen(s: GameState, sceneId: string): boolean {
  return (s.meta.seenScenes[sceneId] ?? 0) === 0;
}

export function rep(s: GameState, who: string, delta: number): void {
  s.meta.reputation[who] = (s.meta.reputation[who] ?? 0) + delta;
}

export function repOf(s: GameState, who: string): number {
  return s.meta.reputation[who] ?? 0;
}

export function unlockClient(s: GameState, c: Client): void {
  if (!s.meta.unlockedClients.includes(c)) s.meta.unlockedClients.push(c);
}

export function attention(s: GameState, delta: number): void {
  s.run.attention = Math.max(0, Math.min(5, s.run.attention + delta));
}

export function integrity(s: GameState, delta: number): void {
  s.run.integrity = Math.max(0, Math.min(3, s.run.integrity + delta));
}
