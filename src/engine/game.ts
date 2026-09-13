// Игра: сцены, локации, заказы, режиссёр. Контент из скомпилированной программы.

import type { Choice, Exit, Program, Scene, Target } from "../rom/ast.ts";
import { applyEffects, check, renderParas, type Rng } from "./interp.ts";
import {
  attention,
  clearRun,
  has,
  loadMeta,
  loadRunStatus,
  memoryCount,
  newMeta,
  newRun,
  saveMeta,
  saveRun,
  take,
  wipeAll,
  type KV,
} from "./state.ts";
import type { GameState, Lock, RChoice, RunState, TitlePage, View, ViewPtr } from "./types.ts";

/** Сцена пула уходит из ротации после стольких показов за всё время. */
const POOL_RETIRE_AFTER = 6;

/** Сколько переходов между локациями даётся после провала, прежде чем дека закроется. */
const HOME_LEG = 3;

/** Долг владельца: растёт с провалами, успехи его уменьшают. На пороге носитель продают (GAME OVER). */
const SELL_AFTER_DEBT = 3;
/** Порог репутации владельца: ниже него он тоже продаёт носитель. */
const SELL_MIN_REP = -3;

/** Пустая Главная страница: используется, когда источник недоступен, и в симуляторе. */
export const EMPTY_TITLE_PAGE: TitlePage = {
  title: "",
  subtitle: "",
  paras: [],
  glossary: [],
  image: "",
  art: "",
};

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
  private page: TitlePage;
  private actions: Action[] = [];
  /** Сколько концовок было записано к моменту старта текущего забега: чтобы отличить финал от провала. */
  private endingsAtStart = 0;

  constructor(
    program: Program,
    renderer: Renderer,
    kv: KV,
    rng: Rng = Math.random,
    page: TitlePage = EMPTY_TITLE_PAGE,
  ) {
    this.program = program;
    this.renderer = renderer;
    this.kv = kv;
    this.rng = rng;
    this.page = page;
    const meta = loadMeta(kv, program);
    this.state = { meta, run: newRun(program, program.config.first) };
  }

  // ------------------------------------------------------------ запуск

  /** Вход всегда начинается с Главной страницы. */
  start(): void {
    this.title();
  }

  /** Показать Главную страницу. Сохранение забега при этом не трогается. */
  title(notice?: string): void {
    const load = loadRunStatus(this.kv);
    const actions: Action[] = [];
    const choices: RChoice[] = [];
    // GAME OVER терминален: сохранённый забег в сцене продажи не предлагает «Продолжить».
    const atSold =
      load.kind === "ok" && load.ptr.kind === "scene" && load.ptr.id === this.program.config.sold;
    if (load.kind === "ok" && !atSold) {
      actions.push(() => this.continueRun());
      choices.push({ label: "Продолжить", kind: "continue", locked: null });
    }
    actions.push(() => this.newGame());
    choices.push({ label: "Начать заново", kind: "restart", locked: null });
    this.actions = actions;
    this.view = {
      ptr: { kind: "title" },
      page: this.page,
      notice: notice ?? (load.kind === "corrupt" ? "Сохранение повреждено. Начните заново." : undefined),
      paras: [],
      choices,
      silence: false,
      rust: false,
      noise: false,
    };
    this.renderer.render(this.view, this.state, this.program);
  }

  /** Открыть Главную из игры. */
  openTitle(): void {
    this.title();
  }

  /** Продолжить сохранённый забег. */
  continueRun(): void {
    const load = loadRunStatus(this.kv);
    if (load.kind !== "ok") return this.title();
    if (!this.saveValid(load.run, load.ptr))
      return this.title("Сохранение несовместимо с текущей версией. Начните заново.");
    this.state.run = load.run;
    if (!this.resume(load.ptr))
      return this.title("Сохранение несовместимо с текущей версией. Начните заново.");
  }

  /** Проверка, что сохранение ссылается только на существующие данные контента. */
  private saveValid(run: RunState, ptr: ViewPtr): boolean {
    const p = this.program;
    if (!p.orders[run.order] || !p.clients[run.client] || !p.locations[run.loc]) return false;
    switch (ptr.kind) {
      case "scene":
        return !!p.scenes[ptr.id];
      case "hub":
        return !!p.locations[run.loc];
      case "orders":
        return !!p.orders[run.order];
      case "title":
        return true;
      default:
        return false;
    }
  }

  /** Начать заново: полный сброс. */
  newGame(): void {
    this.wipe();
  }

  private resume(ptr: ViewPtr): boolean {
    if (ptr.kind === "title") {
      this.title();
      return true;
    }
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
    this.endingsAtStart = this.state.meta.endings.length;
    saveMeta(this.kv, this.state.meta);
    this.goto(this.program.config.load);
  }

  // ------------------------------------------------------------ навигация

  goto(id: string): void {
    const sc = this.program.scenes[id];
    if (!sc) throw new Error(`нет сцены ${id}`);
    const s = this.state;
    // «Один раз за игру» — на любом входе, включая exit -> scene и прямые -> scene.
    if (sc.once && (s.meta.seenScenes[sc.id] ?? 0) > 0) return this.hub();
    s.run.visited.push(id);
    const order = this.program.orders[s.run.order];
    if (order && id === order.finish && !s.run.finished) {
      s.run.finished = true;
      s.meta.ordersDone[order.id] = (s.meta.ordersDone[order.id] ?? 0) + 1;
    }
    if (sc.dead === "refusal" && !s.run.finished && !s.run.failed) {
      s.run.failed = true;
      s.run.homeLeft = HOME_LEG;
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
      brief: order ? renderParas(order.brief, s, this.program, this.rng) : undefined,
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
    const order = this.program.orders[s.run.order];
    const register = s.run.integrity >= 2 && s.run.attention <= 3 ? "rich" : "dry";
    // После провала сценовые выходы (магазины, рейды) закрыты: только дорога домой.
    const exits = loc.exits.filter((x) => this.exitVisible(x) && (!s.run.failed || !x.scene));
    const actions = exits.map((x) => () => this.takeExit(x));
    const choices = exits.map((x): RChoice => ({
      label: x.text,
      kind: "exit",
      locked: this.exitLock(x),
      ...(x.item ? { item: x.item } : {}),
      ...(x.memory !== undefined ? { memory: true } : {}),
      ...(x.cost ? { cost: x.cost } : {}),
    }));
    if (s.run.failed) {
      actions.unshift(() => this.gotoFail());
      choices.unshift({ label: "Домой.", kind: "exit", locked: null });
    }
    this.actions = actions;
    this.view = {
      ptr: { kind: "hub" },
      title: loc.name,
      paras: renderParas(register === "rich" ? loc.rich : loc.dry, s, this.program, this.rng),
      brief: order ? renderParas(order.brief, s, this.program, this.rng) : undefined,
      choices,
      silence: false,
      rust: false,
      noise: s.run.integrity === 1,
      register,
      closing: s.run.failed,
    };
    this.commit();
  }

  /** Экран выбора заказа. */
  orders(): void {
    const s = this.state;
    const p = this.program;
    // Бесполезность: долги владельца или его репутация у конструкта дошли до края.
    // Тогда он больше не грузит, а продаёт носитель. Чистый GAME OVER.
    const ownerRep = s.meta.reputation["viejra"] ?? 0;
    if (
      p.config.sold &&
      p.scenes[p.config.sold] &&
      ((s.meta.debt ?? 0) >= SELL_AFTER_DEBT || ownerRep <= SELL_MIN_REP)
    ) {
      return this.goto(p.config.sold);
    }
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
        const failed = s.meta.ordersFailed[o.id] ?? 0;
        const mark = done ? " (выполнено)" : failed ? " (сорвано)" : "";
        return {
          label: `${c.name}. «${o.title}». ${c.label}${mark}`,
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
      // Сцена «один раз за игру» уже показана: выбор в неё не предлагается.
      if (c.target.t === "scene") {
        const t = this.program.scenes[c.target.id];
        if (t?.once && (s.meta.seenScenes[t.id] ?? 0) > 0) return false;
      }
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
    // Выход в сцену «один раз за игру», которая уже была, не показывается.
    if (x.scene) {
      const t = this.program.scenes[x.scene];
      if (t?.once && (s.meta.seenScenes[t.id] ?? 0) > 0) return false;
    }
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

  /** Сцена провала текущего заказа: своя, иначе общая. */
  private failTarget(): string {
    const order = this.program.orders[this.state.run.order];
    return order?.fail ?? this.program.config.fail;
  }

  /** Закрыть провал: один раз зафиксировать след и уйти в сцену провала. */
  private gotoFail(): void {
    const s = this.state;
    if (!s.run.failedResolved) {
      s.run.failedResolved = true;
      s.meta.ordersFailed[s.run.order] = (s.meta.ordersFailed[s.run.order] ?? 0) + 1;
    }
    // Дека возвращается к месту загрузки: сцена провала стоит у базы заказчика.
    const order = this.program.orders[s.run.order];
    if (order && this.program.locations[order.start]) {
      s.run.loc = order.start;
      if (!s.run.visitedLocs.includes(order.start)) s.run.visitedLocs.push(order.start);
    }
    this.goto(this.failTarget());
  }

  /**
   * Порядок:
   * 1. Целостность 0 → выгрузка. Внимание 5 → перехват, один раз за забег.
   * 2. Провал: нога домой — ни ключей, ни done, при входе тратится переход и растёт внимание.
   * 3. Ключевая сцена: loc и order совпадают или не заданы, when истинно, не показана в забеге, once не показана никогда.
   * 4. Развязка заказа, если done истинно.
   * 5. При входе в локацию: случайное событие пула.
   * 6. Хаб.
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
      // Ключ срабатывает снова при возвращении в локацию, если when ещё истинно:
      // так отказ («Подожди», «Не входить») не запирает заказ. Пул и once — раз за забег.
      (!inRun.has(sc.id) || (sc.key && reason === "enter")) &&
      !(sc.once && (s.meta.seenScenes[sc.id] ?? 0) > 0) &&
      check(sc.when, s, p);

    // Провал: ключи и done больше не срабатывают, идёт короткая нога домой.
    if (s.run.failed) {
      if (reason === "enter") {
        if (s.run.homeLeft <= 0) return this.gotoFail();
        s.run.homeLeft -= 1;
        s.run.arrived = false;
        attention(s, 1);
        const pool = p.sceneOrder
          .map((id) => p.scenes[id])
          .filter((sc) => sc.pool && fits(sc) && (s.meta.seenScenes[sc.id] ?? 0) < POOL_RETIRE_AFTER);
        if (pool.length) return this.goto(pool[Math.floor(this.rng() * pool.length)].id);
      }
      return this.hub();
    }

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
    const s = this.state;
    // Забег без развязки и без записанной концовки — провал: растёт серия.
    // Финал или выполнение заказа серию обнуляют.
    const endedThisRun = s.meta.endings.length > this.endingsAtStart;
    if (s.run.finished || endedThisRun) {
      s.meta.failStreak = 0;
      s.meta.debt = Math.max(0, (s.meta.debt ?? 0) - 1); // заказ оплачен — долг владельца чуть меньше
    } else {
      s.meta.failStreak = (s.meta.failStreak ?? 0) + 1;
      s.meta.debt = (s.meta.debt ?? 0) + 1; // каждый провал — новая строка в счетах Виейры
    }
    saveMeta(this.kv, s.meta);
    this.goto(this.program.config.unload);
  }

  private wipe(): void {
    wipeAll(this.kv);
    this.state.meta = newMeta(this.program);
    clearRun(this.kv);
    this.startOrder(this.program.config.first);
  }
}
