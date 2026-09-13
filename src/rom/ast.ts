// Скомпилированное представление сценария. Чистые данные, сериализуются в JSON.
// Движок исполняет это, компилятор и линт производят.

export type Expr =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "var"; name: string }
  | { t: "call"; fn: string; arg: string }
  | { t: "not"; e: Expr }
  | { t: "and"; a: Expr; b: Expr }
  | { t: "or"; a: Expr; b: Expr }
  | { t: "cmp"; op: "==" | "!=" | "<" | "<=" | ">" | ">="; a: Expr; b: Expr };

export type MemoryKind = "own" | "hanna" | "foreign";

export type Effect =
  | { t: "give"; item: string }
  | { t: "take"; item: string }
  | { t: "flag"; name: string; on: boolean }
  | { t: "rep"; who: string; d: number }
  | { t: "attention"; d: number }
  | { t: "integrity"; d: number }
  | { t: "credit"; d: number }
  | { t: "memory"; kind: MemoryKind; id: string; text: string }
  | { t: "forget"; kind: MemoryKind; n: number }
  | { t: "unlock"; client: string }
  | { t: "dossier"; who: string }
  | { t: "move"; loc: string }
  | { t: "ending"; n: number }
  | { t: "wipe" }
  | { t: "chance"; p: number; effects: Effect[] };

export type ParaKind =
  | "text"
  | "silence"
  | "rust"
  | "memory"
  | "item"
  | "echo"
  | "dossier"
  | "intrusion"
  | "brief";

export type Para =
  | { kind: ParaKind; text: string; if?: Expr }
  | { kind: "cond"; branches: { if?: Expr; paras: Para[] }[] };

export type Target =
  | { t: "scene"; id: string }
  | { t: "hub" }
  | { t: "next" }
  | { t: "go"; loc: string }
  | { t: "unload" }
  | { t: "orders" };

export interface Src {
  file: string;
  line: number;
}

export interface Choice {
  text: string;
  cost?: number;
  memory?: number;
  item?: string;
  when?: Expr;
  dead?: boolean;
  back?: boolean;
  effects: Effect[];
  target: Target;
  src: Src;
}

export interface Scene {
  id: string;
  key: boolean;
  pool: boolean;
  once: boolean;
  silence: boolean;
  rust: boolean;
  shop: boolean;
  dead?: string;
  loc?: string;
  order?: string;
  when?: Expr;
  enter: Effect[];
  paras: Para[];
  choices: Choice[];
  src: Src;
}

export interface Exit {
  text: string;
  /** Целевая локация. Пусто, если выход ведёт в сцену. */
  loc: string;
  /** Целевая сцена (exit "…" -> scene:id): действие в локации. */
  scene?: string;
  when?: Expr;
  item?: string;
  memory?: number;
  cost?: number;
  effects: Effect[];
  src: Src;
}

export interface Location {
  id: string;
  act: number;
  name: string;
  dry: Para[];
  rich: Para[];
  exits: Exit[];
  terminal: boolean;
  src: Src;
}

export interface Order {
  id: string;
  client: string;
  title: string;
  requires?: Expr;
  start: string;
  finish: string;
  /** Сцена провала: показывается, когда заказ стал невыполним (см. dead:refusal). */
  fail?: string;
  done: Expr;
  brief: Para[];
  src: Src;
}

export interface ClientDef {
  id: string;
  name: string;
  label: string;
  credit: number;
  attention: number;
  items: string[];
  unlocked: boolean;
  src: Src;
}

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  consumable: boolean;
  src: Src;
}

export interface CharacterDef {
  id: string;
  name: string;
  aliases: string[];
  src: Src;
}

export interface FlagDef {
  id: string;
  desc: string;
  src: Src;
}

export interface Config {
  intercept: string;
  flatline: string;
  unload: string;
  load: string;
  first: string;
  /** Общая сцена провала; заказ может переопределить полем fail. */
  fail: string;
  /** Сцена GAME OVER: владелец продаёт носитель после серии провалов. Опциональна. */
  sold: string;
}

export interface Program {
  config: Config;
  ladder: number[];
  items: Record<string, ItemDef>;
  characters: Record<string, CharacterDef>;
  flags: Record<string, FlagDef>;
  factions: string[];
  clients: Record<string, ClientDef>;
  locations: Record<string, Location>;
  orders: Record<string, Order>;
  scenes: Record<string, Scene>;
  /** Порядок объявления сцен: режиссёр берёт первый подходящий ключ. */
  sceneOrder: string[];
}

export class RomError extends Error {
  src: Src | undefined;
  constructor(message: string, src?: Src) {
    super(src ? `${src.file}:${src.line}: ${message}` : message);
    this.src = src;
  }
}
