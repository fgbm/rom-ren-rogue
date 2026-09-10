import type { Choice, GameState, Scene } from "./types";
import { memoryCount, saveMeta } from "./state";

export interface Renderer {
  render(scene: Scene, state: GameState, choices: Choice[]): void;
}

export class Game {
  private scenes = new Map<string, Scene>();
  current!: Scene;

  constructor(
    scenes: Scene[],
    public state: GameState,
    private renderer: Renderer,
  ) {
    for (const sc of scenes) {
      if (this.scenes.has(sc.id)) throw new Error(`duplicate scene ${sc.id}`);
      this.scenes.set(sc.id, sc);
    }
  }

  goto(id: string): void {
    const sc = this.scenes.get(id);
    if (!sc) throw new Error(`no scene ${id}`);
    this.current = sc;
    this.state.run.visited.push(id);
    this.state.meta.seenScenes[id] = (this.state.meta.seenScenes[id] ?? 0) + 1;
    sc.onEnter?.(this.state);
    saveMeta(this.state.meta);
    this.renderer.render(sc, this.state, this.visibleChoices(sc));
  }

  choose(choice: Choice): void {
    choice.effect?.(this.state);
    const next =
      typeof choice.next === "function" ? choice.next(this.state) : choice.next;
    this.goto(next);
  }

  private visibleChoices(sc: Scene): Choice[] {
    return sc.choices.filter((c) => !c.when || c.when(this.state));
  }

  /** Достаточно ли памяти для выбора. Выбор показан, но заблокирован. */
  canAfford(c: Choice): boolean {
    return c.memory === undefined || memoryCount(this.state) >= c.memory;
  }
}
