// Типы движка. Контент описывается данными, движок ничего не знает о сюжете.

export type Client = "velt" | "marsh" | "zero" | "moriyama" | "hanna" | "silence";

export type MemoryKind = "own" | "hanna" | "foreign";

export interface MemoryFragment {
  id: string;
  kind: MemoryKind;
  text: string;
}

export type ItemId =
  | "ice_old" // старый ледокол
  | "ice_kuang" // «Куан» одиннадцатой марки, китайский
  | "mask" // маска-имитатор: сбрасывает внимание
  | "patch" // патч носителя: чинит целостность
  | "manifest" // маршрутный лист на Фрисайд
  | "simstim" // симстим-канал к Виейре
  | "dub" // даб-запись Дзиона, пропуск в доки
  | "marsh_paper" // бумага Марш: охранная грамота Тьюринга
  | "shard" // осколок чужого конструкта
  | "lobotomy"; // лоботомирующий софт Марш

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  /** Сгорает при применении. */
  consumable: boolean;
}

/** Состояние одного забега. Сгорает при выгрузке. */
export interface RunState {
  client: Client;
  act: 1 | 2 | 3;
  credit: number;
  attention: number; // 0..5, при 5 — Тьюринг перехватывает забег
  integrity: number; // 0..3, при 0 — выгрузка
  items: ItemId[];
  flags: Set<string>;
  visited: string[];
  /** Сколько сцен из пула показано в текущем акте. */
  poolShown: number;
}

/** Состояние между забегами. Копится. */
export interface MetaState {
  runs: number;
  memory: MemoryFragment[];
  dossier: Set<string>;
  reputation: Record<string, number>;
  seenScenes: Record<string, number>;
  unlockedClients: Client[];
  endings: number[];
}

export interface GameState {
  run: RunState;
  meta: MetaState;
}

export type Condition = (s: GameState) => boolean;
export type Effect = (s: GameState) => void;

/** "@next" — отдать решение режиссёру. */
export type Next = string | ((s: GameState) => string);

export interface Choice {
  text: string;
  /** Условие показа. Если не выполнено, выбор скрыт. */
  when?: Condition;
  /** Требует памяти: показан, помечен, но заблокирован. */
  memory?: number;
  /** Требует предмет. Показан только если предмет есть. Расходники сгорают. */
  item?: ItemId;
  /** Стоимость в кредитах. Показан всегда, заблокирован без денег. */
  cost?: number;
  effect?: Effect;
  next: Next;
}

export type Paragraph =
  | string
  | { silence: string }
  | { memory: string }
  | { item: string };

export interface Scene {
  id: string;
  act: 1 | 2 | 3;
  /** Ключевая сцена: появляется по триггеру, приоритет над пулом. */
  key?: boolean;
  /** Сцена из пула: выбирается случайно между ключами. */
  pool?: boolean;
  when?: Condition;
  text: (s: GameState) => Paragraph[];
  choices: Choice[];
  onEnter?: Effect;
  /** Сцена без интерфейса (узел Тишины). */
  silence?: boolean;
}

export interface ActConfig {
  /** Сколько сцен пула показать до выхода из акта. */
  poolLength: number;
  /** Сцена выхода из акта. */
  exit: string;
}
