// Headless случайный проходчик: node scripts/simulate.ts [забегов=200] [seed=1]
//
// Играет случайно, предпочитая непосещённые выходы. Печатает: длину забегов,
// причины выгрузок, достигнутые концовки, выполненные заказы, непосещённые сцены.

import type { Program } from "../src/rom/ast.ts";
import { Game, type Renderer } from "../src/engine/game.ts";
import { memoryKV } from "../src/engine/state.ts";
import type { GameState, View } from "../src/engine/types.ts";
import { lint } from "../src/rom/lint.ts";
import { loadProgram } from "../src/rom/load.ts";

const RUNS = Number(process.argv[2] ?? 200);
let seed = Number(process.argv[3] ?? 1);
const rng = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const prog: Program = loadProgram("content");
const lr = lint(prog);
if (!lr.ok) {
  console.error("сценарий не проходит линт, симуляция отменена");
  process.exit(1);
}

let view!: View;
let state!: GameState;
const renderer: Renderer = {
  render(v, s) {
    view = v;
    state = s;
  },
};
const game = new Game(prog, renderer, memoryKV(), rng);

const stats = {
  runs: 0,
  steps: [] as number[],
  unloadBy: new Map<string, number>(),
  endings: new Set<number>(),
  ordersDone: new Map<string, number>(),
  scenesSeen: new Set<string>(),
  locsSeen: new Set<string>(),
  stuck: 0,
};

game.start();
let steps = 0;
let lastDead: string | null = null;
const MAX_STEPS = 400;

for (let guard = 0; guard < RUNS * MAX_STEPS * 2; guard++) {
  if (view.ptr.kind === "scene") {
    const sc = prog.scenes[view.ptr.id];
    stats.scenesSeen.add(sc.id);
    if (sc.dead) lastDead = sc.dead;
    if (sc.id === prog.config.unload) {
      stats.runs += 1;
      stats.steps.push(steps);
      const by = state.run.finished ? "развязка" : lastDead ?? "прочее";
      stats.unloadBy.set(by, (stats.unloadBy.get(by) ?? 0) + 1);
      steps = 0;
      lastDead = null;
      if (stats.runs >= RUNS) break;
    }
  }
  if (view.ptr.kind === "hub") stats.locsSeen.add(state.run.loc);
  for (const e of state.meta.endings) stats.endings.add(e);
  for (const [k, v] of Object.entries(state.meta.ordersDone)) stats.ordersDone.set(k, v);

  let open = view.choices.map((c, i) => ({ c, i })).filter((x) => !x.c.locked);
  // На экране выгрузки не стирать память: иначе статистика обнуляется.
  if (view.ptr.kind === "scene" && view.ptr.id === prog.config.unload) open = open.slice(0, 1);
  if (!open.length) {
    stats.stuck += 1;
    console.error(`застряли: ${JSON.stringify(view.ptr)} в ${state.run.loc}`);
    break;
  }
  // Предпочитать выходы в непосещённые локации, чтобы покрывать карту.
  let pick = open[Math.floor(rng() * open.length)];
  if (view.ptr.kind === "hub") {
    const loc = prog.locations[state.run.loc];
    const fresh = open.filter((x) => {
      const ex = loc.exits.filter((e) => e.text === view.choices[x.i].label)[0];
      return ex && !ex.scene && !state.run.visitedLocs.includes(ex.loc);
    });
    if (fresh.length && rng() < 0.7) pick = fresh[Math.floor(rng() * fresh.length)];
  }
  steps += 1;
  if (steps > MAX_STEPS) {
    console.error(`забег длиннее ${MAX_STEPS} шагов: заказ ${state.run.order}, локация ${state.run.loc}`);
    game.unload();
    continue;
  }
  game.pick(pick.i);
}

const avg = stats.steps.length ? stats.steps.reduce((a, b) => a + b, 0) / stats.steps.length : 0;
console.log(`забегов ${stats.runs}, средняя длина ${avg.toFixed(1)} шагов, мин ${Math.min(...stats.steps)}, макс ${Math.max(...stats.steps)}`);
console.log("выгрузки по причинам:");
for (const [k, v] of [...stats.unloadBy].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${v}`);
console.log(`концовки: ${[...stats.endings].sort().join(", ") || "нет"}`);
console.log("заказы выполнены:");
for (const [k, v] of [...stats.ordersDone].sort()) console.log(`  ${k.padEnd(12)} ${v}`);
const allScenes = Object.keys(prog.scenes);
const unseen = allScenes.filter((id) => !stats.scenesSeen.has(id));
console.log(`сцен посещено ${stats.scenesSeen.size} из ${allScenes.length}`);
if (unseen.length) console.log("  не посещены: " + unseen.join(", "));
const allLocs = Object.keys(prog.locations);
const unseenLocs = allLocs.filter((id) => !stats.locsSeen.has(id));
console.log(`локаций посещено ${stats.locsSeen.size} из ${allLocs.length}`);
if (unseenLocs.length) console.log("  не посещены: " + unseenLocs.join(", "));
console.log(`память в конце: ${state.meta.memory.length}`);
