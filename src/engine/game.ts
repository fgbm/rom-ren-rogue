// Игра: сцены, локации, заказы, режиссёр. Контент из скомпилированной программы.

import type { Choice, Exit, Program, Scene, Target } from "../rom/ast.ts";
import { applyEffects, check, renderParas, type Rng } from "./interp.ts";
import {
  clearRun,
  has,
  loadMeta,
  loadRun,
  memoryCount,
  newMeta,
  newRun,
  saveMeta,
  saveRun,
  take,
  wipeAll,
  type KV,
} from "./state.ts";
import type { GameState, Lock, RChoice, View, ViewPtr } from "./types.ts";

/** Сцена пула уходит из ротации после стольких показов за всё время. */
const POOL_RETIRE_AFTER = 6;

export interface Renderer {
  render(view: View, state: GameState, program: Program): void;
}

type Action = () => void;

export class Game {
  state: GameState;
  view!: View;
  program: Program;
  private renderer: Renderer;
  private kv: KV;
  private rng: Rng;
  private actions: Action[] = [];

  constructor(program: Program, renderer: Renderer, kv: KV, rng: Rng = Math.random) {
    this.program = program;
    this.renderer = renderer;
    this.kv = kv;
    this.rng = rng;
    const meta = loadMeta(kv, program);
    this.state = { meta, run: newRun(program, program.config.first) };
  }

  // ------------------------------------------------------------ запуск

  /** Первый запуск: первый заказ. Обновление страницы: восстановить. Иначе: выбор заказа. */
  start(): void {
    const saved = loadRun(this.kv);
    if (saved && this.state.meta.runs > 0) {
      this.state.run = saved.run;
      if (this.resume(saved.ptr)) return;
    }
    if (this.state.meta.runs === 0) this.startOrder(this.program.config.first);
    else this.orders();
  }

  private resume(ptr: ViewPtr): boolean {
    if (ptr.kind === "scene") {
      const sc = this.program.scenes[ptr.id];
      if (!sc) return false;
      this.showScene(sc);
      return true;
    }
    if (ptr.kind === "hub") {
      if (!this.program.locations[this.state.run.loc]) return false;
      this.hub();
      return true;
    }
    this.orders();
    return true;
  }

  startOrder(id: string): void {
    this.state.run = newRun(this.program, id);
    this.state.meta.runs += 1;
    saveMeta(this.kv, this.state.meta);
    this.goto(this.program.config.load);
  }

  // ------------------------------------------------------------ навигация

  goto(id: string): void {
    const sc = this.program.scenes[id];
    if (!sc) throw new Error(`нет сцены ${id}`);
    const s = this.state;
    s.run.visited.push(id);
    const order = this.program.orders[s.run.order];
    if (order && id === order.finish && !s.run.finished) {
      s.run.finished = true;
      s.meta.ordersDone[order.id] = (s.meta.ordersDone[order.id] ?? 0) + 1;
    }
    if (applyEffects(sc.enter, s, this.program, this.rng)) return this.wipe();
    this.showScene(sc, true);
  }

  /** Показать сцену. count: засчитать просмотр после рендера, чтобы seen(id) внутри сцены значило «до этого раза». */
  private showScene(sc: Scene, count = false): void {
    const s = this.state;
    const order = this.program.orders[s.run.order];
    const visible = this.visibleChoices(sc);
    this.actions = visible.map((c) => () => this.choose(c));
    this.view = {
      ptr: { kind: "scene", id: sc.id },
      paras: renderParas(sc.paras, s, this.program, this.rng, { brief: order?.brief }),
      choices: visible.map((c) => this.choiceView(c, sc)),
      silence: sc.silence,
      rust: sc.rust,
      noise: s.run.integrity === 1,
    };
    if (count) s.meta.seenScenes[sc.id] = (s.meta.seenScenes[sc.id] ?? 0) + 1;
    this.commit();
  }

  /** Хаб: описание локации и выходы. */
  hub(): void {
    const s = this.state;
    const loc = this.program.locations[s.run.loc];
    if (!loc) throw new Error(`нет локации ${s.run.loc}`);
    const register = s.run.integrity >= 2 && s.run.attention <= 3 ? "rich" : "dry";
    const exits = loc.exits.filter((x) => this.exitVisible(x));
    this.actions = exits.map((x) => () => this.takeExit(x));
    this.view = {
      ptr: { kind: "hub" },
      title: loc.name,
      paras: renderParas(register === "rich" ? loc.rich : loc.dry, s, this.program, this.rng),
      choices: exits.map((x) => ({
        label: x.text,
        kind: "exit",
        locked: this.exitLock(x),
        ...(x.item ? { item: x.item } : {}),
        ...(x.memory !== undefined ? { memory: true } : {}),
        ...(x.cost ? { cost: x.cost } : {}),
      })),
      silence: false,
      rust: false,
      noise: s.run.integrity === 1,
      register,
    };
    this.commit();
  }

  /** Экран выбора заказа. */
  orders(): void {
    const s = this.state;
    const p = this.program;
    let list = Object.values(p.orders).filter(
      (o) => s.meta.unlockedClients.includes(o.client) && check(o.requires, s, p),
    );
    const fresh = list.filter((o) => !(s.meta.ordersDone[o.id] ?? 0));
    if (fresh.length) list = fresh;
    // Порядок: по заказчикам в порядке объявления, внутри по объявлению.
    const clientIdx = Object.keys(p.clients);
    list.sort((a, b) => clientIdx.indexOf(a.client) - clientIdx.indexOf(b.client));
    this.actions = list.map((o) => () => this.startOrder(o.id));
    this.view = {
      ptr: { kind: "orders" },
      paras: [
        {
          kind: "text",
          text: "Виейра выбирает, кому тебя грузить. Ты не выбираешь. Но здесь, до загрузки, ты можешь помнить, кто чего хочет, и это почти то же самое.",
        },
        ...(list.length === 1
          ? [{ kind: "text" as const, text: "Пока только один заказ. Остальные ещё не знают, что ты есть." }]
          : []),
      ],
      choices: list.map((o) => {
        const c = p.clients[o.client];
        const done = s.meta.ordersDone[o.id] ?? 0;
        return {
          label: `${c.name}. «${o.title}». ${c.label}${done ? " (выполнено)" : ""}`,
          kind: "order",
          locked: null,
        };
      }),
      silence: false,
      rust: false,
      noise: false,
    };
    this.commit();
  }

  pick(i: number): void {
    const a = this.actions[i];
    if (!a) return;
    if (this.view.choices[i]?.locked) return;
    a();
  }

  private commit(): void {
    saveMeta(this.kv, this.state.meta);
    saveRun(this.kv, this.state.run, this.view.ptr);
    this.renderer.render(this.view, this.state, this.program);
  }

  // ------------------------------------------------------------ выборы

  private visibleChoices(sc: Scene): Choice[] {
    const s = this.state;
    return sc.choices.filter((c) => {
      if (!check(c.when, s, this.program)) return false;
      if (c.item && !has(s, c.item)) return false;
      if (c.cost !== undefined && !sc.shop && s.run.credit < c.cost) return false;
      return true;
    });
  }

  private lockOf(memory: number | undefined, cost: number | undefined): Lock {
    const s = this.state;
    if (memory !== undefined && memoryCount(s) < memory)
      return { kind: "memory", deficit: (memory - memoryCount(s)) / memory };
    if (cost !== undefined && s.run.credit < cost) return { kind: "credit" };
    return null;
  }

  private choiceView(c: Choice, _sc: Scene): RChoice {
    return {
      label: c.text,
      kind: "choice",
      locked: this.lockOf(c.memory, c.cost),
      ...(c.item ? { item: c.item } : {}),
      ...(c.memory !== undefined ? { memory: true } : {}),
      ...(c.cost ? { cost: c.cost } : {}),
    };
  }

  private choose(c: Choice): void {
    const s = this.state;
    if (c.item && this.program.items[c.item]?.consumable) take(s, c.item);
    if (c.cost) s.run.credit -= c.cost;
    if (applyEffects(c.effects, s, this.program, this.rng)) return this.wipe();
    this.follow(c.target);
  }

  private follow(t: Target): void {
    switch (t.t) {
      case "scene":
        return this.goto(t.id);
      case "hub":
        return this.next("hub");
      case "next":
        return this.next("next");
      case "go":
        return this.enterLoc(t.loc);
      case "unload":
        return this.unload();
      case "orders":
        return this.orders();
    }
  }

  private exitVisible(x: Exit): boolean {
    const s = this.state;
    if (!check(x.when, s, this.program)) return false;
    if (x.item && !has(s, x.item)) return false;
    return true;
  }

  private exitLock(x: Exit): Lock {
    return this.lockOf(x.memory, x.cost);
  }

  private takeExit(x: Exit): void {
    const s = this.state;
    if (x.cost) s.run.credit -= x.cost;
    if (applyEffects(x.effects, s, this.program, this.rng)) return this.wipe();
    if (x.scene) return this.goto(x.scene);
    this.enterLoc(x.loc);
  }

  enterLoc(loc: string): void {
    const s = this.state;
    if (!this.program.locations[loc]) throw new Error(`нет локации ${loc}`);
    s.run.loc = loc;
    if (!s.run.visitedLocs.includes(loc)) s.run.visitedLocs.push(loc);
    s.run.arrived = true;
    this.next("enter");
  }

  // ------------------------------------------------------------ режиссёр

  /**
   * Порядок:
   * 1. Целостность 0 → выгрузка. Внимание 5 → перехват, один раз за забег.
   * 2. Ключевая сцена: loc и order совпадают или не заданы, when истинно, не показана в забеге, once не показана никогда.
   * 3. Развязка заказа, если done истинно.
   * 4. При входе в локацию: случайное событие пула.
   * 5. Хаб.
   */
  private next(reason: "enter" | "hub" | "next"): void {
    const s = this.state;
    const p = this.program;
    const cfg = p.config;

    if (s.run.integrity <= 0) return this.goto(cfg.flatline);
    if (s.run.attention >= 5 && !s.run.flags.has("intercepted")) {
      s.run.flags.add("intercepted");
      return this.goto(cfg.intercept);
    }

    const inRun = new Set(s.run.visited);
    const fits = (sc: Scene) =>
      (!sc.loc || sc.loc === s.run.loc) &&
      (!sc.order || sc.order === s.run.order) &&
      !inRun.has(sc.id) &&
      !(sc.once && (s.meta.seenScenes[sc.id] ?? 0) > 0) &&
      check(sc.when, s, p);

    for (const id of p.sceneOrder) {
      const sc = p.scenes[id];
      if (sc.key && fits(sc)) return this.goto(id);
    }

    const order = p.orders[s.run.order];
    if (order && !s.run.finished && check(order.done, s, p)) return this.goto(order.finish);

    // Событие пула разыгрывается один раз по прибытии в локацию, включая стартовую.
    if (reason === "enter" || s.run.arrived) {
      s.run.arrived = false;
      const pool = p.sceneOrder
        .map((id) => p.scenes[id])
        .filter((sc) => sc.pool && fits(sc) && (s.meta.seenScenes[sc.id] ?? 0) < POOL_RETIRE_AFTER);
      if (pool.length) return this.goto(pool[Math.floor(this.rng() * pool.length)].id);
    }

    this.hub();
  }

  // ------------------------------------------------------------ конец забега

  unload(): void {
    saveMeta(this.kv, this.state.meta);
    this.goto(this.program.config.unload);
  }

  private wipe(): void {
    wipeAll(this.kv);
    this.state.meta = newMeta(this.program);
    clearRun(this.kv);
    this.startOrder(this.program.config.first);
  }
}
