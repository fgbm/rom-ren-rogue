import type { Client, GameState, MetaState, RunState } from "./types";

const KEY = "rom-ren-meta-v1";

export function newRun(client: Client): RunState {
  return {
    client,
    act: 1,
    credit: client === "velt" ? 3000 : client === "marsh" ? 800 : 1200,
    attention: client === "marsh" ? 0 : 1,
    integrity: 3,
    flags: new Set(),
    visited: [],
  };
}

export function newMeta(): MetaState {
  return {
    runs: 0,
    memory: [],
    dossier: new Set(),
    reputation: {},
    seenScenes: {},
    unlockedClients: ["velt"],
  };
}

export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return newMeta();
    const j = JSON.parse(raw);
    return {
      ...newMeta(),
      ...j,
      dossier: new Set(j.dossier ?? []),
    };
  } catch {
    return newMeta();
  }
}

export function saveMeta(meta: MetaState): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({ ...meta, dossier: [...meta.dossier] }),
  );
}

export function wipeMeta(): void {
  localStorage.removeItem(KEY);
}

export function memoryCount(s: GameState): number {
  return s.meta.memory.length;
}

export function hasMemory(s: GameState, id: string): boolean {
  return s.meta.memory.some((m) => m.id === id);
}

export function addMemory(
  s: GameState,
  frag: { id: string; kind: "own" | "hanna" | "foreign"; text: string },
): boolean {
  if (hasMemory(s, frag.id)) return false;
  s.meta.memory.push(frag);
  return true;
}

export function rep(s: GameState, who: string, delta: number): void {
  s.meta.reputation[who] = (s.meta.reputation[who] ?? 0) + delta;
}

export function unlockClient(s: GameState, c: Client): void {
  if (!s.meta.unlockedClients.includes(c)) s.meta.unlockedClients.push(c);
}
