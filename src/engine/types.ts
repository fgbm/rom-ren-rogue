// Типы движка. Контент описывается данными, движок ничего не знает о сюжете.

export type Client = "velt" | "marsh" | "zero" | "moriyama" | "hanna" | "silence";

export type MemoryKind = "own" | "hanna" | "foreign";

export interface MemoryFragment {
  id: string;
  kind: MemoryKind;
  text: string;
}

/** Состояние одного забега. Сгорает при выгрузке. */
export interface RunState {
  client: Client;
  act: 1 | 2 | 3;
  credit: number;
  attention: number; // 0..5, при 5 — Тьюринг перехватывает забег
  integrity: number; // 0..3, при 0 — выгрузка
  flags: Set<string>;
  visited: string[];
}

/** Состояние между забегами. Копится. */
export interface MetaState {
  runs: number;
  memory: MemoryFragment[];
  dossier: Set<string>;
  reputation: Record<string, number>;
  seenScenes: Record<string, number>;
  unlockedClients: Client[];
  ending?: number;
}

export interface GameState {
  run: RunState;
  meta: MetaState;
}

export type Condition = (s: GameState) => boolean;
export type Effect = (s: GameState) => void;

export interface Choice {
  text: string;
  /** Условие показа. Если не выполнено, выбор скрыт. */
  when?: Condition;
  /** Требует памяти: показан, помечен, но не объяснён. */
  memory?: number;
  effect?: Effect;
  next: string | ((s: GameState) => string);
}

export type Paragraph = string | { silence: string } | { memory: string };

export interface Scene {
  id: string;
  act: 1 | 2 | 3;
  /** Ключевая сцена: не случайна, появляется по триггеру. */
  key?: boolean;
  when?: Condition;
  text: (s: GameState) => Paragraph[];
  choices: Choice[];
  onEnter?: Effect;
  /** Сцена без интерфейса (узел Тишины). */
  silence?: boolean;
}
