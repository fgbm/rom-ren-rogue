// Интерпретатор: выражения в контексте состояния, эффекты, рендер абзацев.

import type { Effect, Para, Program } from "../rom/ast.ts";
import { evalExpr, test, type EvalCtx } from "../rom/expr.ts";
import {
  addMemory,
  attention,
  give,
  has,
  hasMemory,
  integrity,
  memoryCount,
  memoryOf,
  rep,
  repOf,
  take,
  unlockClient,
} from "./state.ts";
import type { GameState, RPara } from "./types.ts";

export type Rng = () => number;

export function ctxOf(s: GameState, p: Program): EvalCtx {
  return {
    vars(name) {
      switch (name) {
        case "memory":
          return memoryCount(s);
        case "memory.own":
          return memoryOf(s, "own");
        case "memory.hanna":
          return memoryOf(s, "hanna");
        case "memory.foreign":
          return memoryOf(s, "foreign");
        case "credit":
          return s.run.credit;
        case "attention":
          return s.run.attention;
        case "integrity":
          return s.run.integrity;
        case "runs":
          return s.meta.runs;
        case "debt":
          return s.meta.debt ?? 0;
        case "client":
          return s.run.client;
        case "act":
          return p.locations[s.run.loc]?.act ?? 0;
        case "loc":
          return s.run.loc;
        case "order":
          return s.run.order;
      }
      throw new Error(`неизвестная переменная ${name}`);
    },
    call(fn, arg) {
      switch (fn) {
        case "has":
          return has(s, arg);
        case "flag":
          return s.run.flags.has(arg);
        case "rep":
          return repOf(s, arg);
        case "seen":
          return s.meta.seenScenes[arg] ?? 0;
        case "visited":
          return s.run.visited.includes(arg) || s.run.visitedLocs.includes(arg);
        case "done":
          return s.meta.ordersDone[arg] ?? 0;
        case "failed":
          return s.meta.ordersFailed[arg] ?? 0;
        case "memory":
          return hasMemory(s, arg);
        case "ending":
          return s.meta.endings.includes(Number(arg));
      }
      throw new Error(`неизвестная функция ${fn}`);
    },
  };
}

export function check(e: Para extends never ? never : Parameters<typeof test>[0], s: GameState, p: Program): boolean {
  return test(e, ctxOf(s, p));
}

/** Применить эффект. Возвращает true, если эффект wipe: вызывающий обязан перезапустить игру. */
export function applyEffect(e: Effect, s: GameState, p: Program, rng: Rng): boolean {
  switch (e.t) {
    case "give":
      give(s, e.item);
      return false;
    case "take":
      take(s, e.item);
      return false;
    case "flag":
      if (e.on) s.run.flags.add(e.name);
      else s.run.flags.delete(e.name);
      return false;
    case "rep":
      rep(s, e.who, e.d);
      return false;
    case "attention":
      attention(s, e.d);
      return false;
    case "integrity":
      integrity(s, e.d);
      return false;
    case "credit":
      s.run.credit = Math.max(0, s.run.credit + e.d);
      return false;
    case "memory":
      addMemory(s, { id: e.id.replace("{runs}", String(s.meta.runs)), kind: e.kind, text: e.text });
      return false;
    case "forget": {
      // Ржа забирает: последние n фрагментов вида.
      let n = e.n;
      for (let i = s.meta.memory.length - 1; i >= 0 && n > 0; i--) {
        if (s.meta.memory[i].kind === e.kind) {
          s.meta.memory.splice(i, 1);
          n--;
        }
      }
      return false;
    }
    case "unlock":
      unlockClient(s, e.client);
      return false;
    case "dossier":
      s.meta.dossier.add(e.who);
      return false;
    case "move":
      s.run.loc = e.loc;
      if (!s.run.visitedLocs.includes(e.loc)) s.run.visitedLocs.push(e.loc);
      s.run.arrived = true;
      return false;
    case "ending": {
      if (!s.meta.endings.includes(e.n)) s.meta.endings.push(e.n);
      // Концовка засчитывает заказ выполненным, даже если сцена finish не показана.
      const o = p.orders[s.run.order];
      if (o && !s.run.finished) {
        s.run.finished = true;
        s.meta.ordersDone[o.id] = (s.meta.ordersDone[o.id] ?? 0) + 1;
      }
      return false;
    }
    case "wipe":
      return true;
    case "chance": {
      let wipe = false;
      if (rng() < e.p) for (const x of e.effects) wipe = applyEffect(x, s, p, rng) || wipe;
      return wipe;
    }
  }
}

export function applyEffects(es: Effect[], s: GameState, p: Program, rng: Rng): boolean {
  let wipe = false;
  for (const e of es) wipe = applyEffect(e, s, p, rng) || wipe;
  return wipe;
}

export function interpolate(text: string, s: GameState, p: Program): string {
  return text.replace(/\{(credit|memory|runs|attention|integrity|client|order)\}/g, (_, k) => {
    switch (k) {
      case "credit":
        return String(s.run.credit);
      case "memory":
        return String(memoryCount(s));
      case "runs":
        return String(s.meta.runs);
      case "attention":
        return String(s.run.attention);
      case "integrity":
        return String(s.run.integrity);
      case "client":
        return p.clients[s.run.client]?.name ?? s.run.client;
      case "order":
        return p.orders[s.run.order]?.title ?? s.run.order;
    }
    return "";
  });
}

export interface RenderOpts {
  /** Что вставить вместо ~brief. */
  brief?: Para[];
}

export function renderParas(paras: Para[], s: GameState, p: Program, rng: Rng, opts: RenderOpts = {}): RPara[] {
  const ctx = ctxOf(s, p);
  const out: RPara[] = [];
  const walk = (ps: Para[]) => {
    for (const q of ps) {
      if (q.kind === "cond") {
        for (const b of q.branches) {
          if (test(b.if, ctx)) {
            walk(b.paras);
            break;
          }
        }
        continue;
      }
      if (!test(q.if, ctx)) continue;
      if (q.kind === "brief") {
        if (opts.brief) walk(opts.brief);
        continue;
      }
      if ((q.kind === "echo" || q.kind === "intrusion") && !q.text) {
        const kind = q.kind === "echo" ? "own" : "foreign";
        const pool = s.meta.memory.filter((m) => m.kind === kind);
        if (!pool.length) continue;
        const m = pool[Math.floor(rng() * pool.length)];
        out.push({ kind: q.kind, text: m.text });
        continue;
      }
      out.push({ kind: q.kind, text: interpolate(q.text, s, p) });
    }
  };
  walk(paras);
  return out;
}

export { evalExpr };
