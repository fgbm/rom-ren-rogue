import type { ActConfig, Choice, GameState, Scene } from "./types";
import { has, memoryCount, saveMeta, useItem } from "./state";

/** Сцена пула уходит из ротации после стольких просмотров за всё время. */
const POOL_RETIRE_AFTER = 6;

export interface Renderer {
  render(scene: Scene, state: GameState, choices: Choice[]): void;
}

export interface GameConfig {
  acts: Record<1 | 2 | 3, ActConfig>;
  /** Сцена перехвата Тьюрингом при внимании 5. */
  intercept: string;
  /** Сцена выгрузки при целостности 0. */
  flatline: string;
}

export class Game {
  private scenes = new Map<string, Scene>();
  current!: Scene;

  constructor(
    scenes: Scene[],
    public state: GameState,
    private renderer: Renderer,
    private config: GameConfig,
  ) {
    for (const sc of scenes) {
      if (this.scenes.has(sc.id)) throw new Error(`duplicate scene ${sc.id}`);
      this.scenes.set(sc.id, sc);
    }
  }

  goto(id: string): void {
    if (id === "@next") id = this.director();
    const sc = this.scenes.get(id);
    if (!sc) throw new Error(`no scene ${id}`);
    this.current = sc;
    this.state.run.visited.push(id);
    this.state.meta.seenScenes[id] = (this.state.meta.seenScenes[id] ?? 0) + 1;
    if (sc.pool) this.state.run.poolShown += 1;
    sc.onEnter?.(this.state);
    saveMeta(this.state.meta);
    this.renderer.render(sc, this.state, this.visibleChoices(sc));
  }

  choose(choice: Choice): void {
    if (choice.item) useItem(this.state, choice.item);
    if (choice.cost) this.state.run.credit -= choice.cost;
    choice.effect?.(this.state);
    const next =
      typeof choice.next === "function" ? choice.next(this.state) : choice.next;
    this.goto(next);
  }

  private visibleChoices(sc: Scene): Choice[] {
    return sc.choices.filter((c) => {
      if (c.when && !c.when(this.state)) return false;
      if (c.item && !has(this.state, c.item)) return false;
      return true;
    });
  }

  /** Заблокирован ли выбор (память или деньги). */
  locked(c: Choice): "memory" | "credit" | null {
    if (c.memory !== undefined && memoryCount(this.state) < c.memory) return "memory";
    if (c.cost !== undefined && this.state.run.credit < c.cost) return "credit";
    return null;
  }

  /**
   * Режиссёр. Порядок:
   * 1. Целостность 0 → выгрузка. Внимание 5 → перехват.
   * 2. Ключевая сцена акта с выполненным триггером, не показанная в этом забеге.
   * 3. Если показано достаточно сцен пула → выход из акта.
   * 4. Случайная сцена пула акта, не показанная в этом забеге и виденная < 3 раз за всё время.
   * 5. Если пул пуст → выход из акта.
   */
  private director(): string {
    const s = this.state;
    const act = s.run.act;
    const cfg = this.config.acts[act];

    if (s.run.integrity <= 0) return this.config.flatline;
    if (s.run.attention >= 5 && !s.run.flags.has("intercepted")) return this.config.intercept;

    const inRun = new Set(s.run.visited);
    const keys = [...this.scenes.values()].filter(
      (sc) => sc.key && sc.act === act && !inRun.has(sc.id) && (!sc.when || sc.when(s)),
    );
    if (keys.length) return keys[0].id;

    if (s.run.poolShown >= cfg.poolLength) return cfg.exit;

    const pool = [...this.scenes.values()].filter(
      (sc) =>
        sc.pool &&
        sc.act === act &&
        !inRun.has(sc.id) &&
        (s.meta.seenScenes[sc.id] ?? 0) < POOL_RETIRE_AFTER &&
        (!sc.when || sc.when(s)),
    );
    if (!pool.length) return cfg.exit;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }
}
