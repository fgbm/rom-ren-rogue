// Состояние игры и модель представления. Движок ничего не знает о сюжете:
// весь контент приходит из скомпилированной программы (src/rom/ast.ts).

import type { MemoryKind, ParaKind } from "../rom/ast.ts";

export interface MemoryFragment {
  id: string;
  kind: MemoryKind;
  text: string;
}

/** Состояние одного забега. Сгорает при выгрузке. */
export interface RunState {
  order: string;
  client: string;
  loc: string;
  credit: number;
  attention: number; // 0..5
  integrity: number; // 0..3
  items: string[];
  flags: Set<string>;
  /** Сцены, показанные в этом забеге. */
  visited: string[];
  /** Локации в порядке первого посещения. */
  visitedLocs: string[];
  /** Развязка заказа показана. */
  finished: boolean;
  /** В текущую локацию только что пришли: событие пула ещё не разыграно. */
  arrived: boolean;
}

/** Состояние между забегами. Копится. */
export interface MetaState {
  runs: number;
  memory: MemoryFragment[];
  dossier: Set<string>;
  reputation: Record<string, number>;
  seenScenes: Record<string, number>;
  unlockedClients: string[];
  endings: number[];
  ordersDone: Record<string, number>;
}

export interface GameState {
  run: RunState;
  meta: MetaState;
}

export type ViewPtr = { kind: "scene"; id: string } | { kind: "hub" } | { kind: "orders" };

export interface RPara {
  kind: ParaKind;
  text: string;
}

export type Lock = { kind: "memory"; deficit: number } | { kind: "credit" } | null;

export interface RChoice {
  label: string;
  kind: "choice" | "exit" | "order";
  locked: Lock;
  item?: string;
  memory?: boolean;
  cost?: number;
}

export interface View {
  ptr: ViewPtr;
  /** Название локации для хаба. */
  title?: string;
  paras: RPara[];
  choices: RChoice[];
  silence: boolean;
  rust: boolean;
  /** Целостность 1: текст рвётся. */
  noise: boolean;
  register?: "dry" | "rich";
}
