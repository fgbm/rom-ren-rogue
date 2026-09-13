// CLI: node scripts/audit.ts [orderId] [--all] [--out DIR]
//
// Пайплайн аудита заказа (read-only). Печатает markdown в stdout; с --out DIR
// пишет structural-all.md / structural-all.json (или structural.md / .json для
// одного заказа).
//
// Проверяет:
//   1. Квоты writing-guide по каждому заказу.
//   2. Провенанс гейтов: items (give/has), флаги (set/clear/read), фрагменты,
//      пороги memory, done(), rep().
//   3. Кандидаты soft-lock: сцена-«одноразовка» (key/once/pool) с escape-выбором,
//      после которого обязательный факт (done и его транзитивные предусловия)
//      становится недостижим, т.к. режиссёр не выберет сцену повторно в забеге.
//   4. Недостижимые гейты: [when !has(x)], где x выдаётся на старте и не тратится.
//   5. Цикл жизни эффектов и локации (dry/rich, пул, выходы).
//
// Детерминированные эвристики, не вердикт: кандидаты требуют чтения (report.md).

import { mkdirSync, writeFileSync } from "node:fs";
import type { Choice, Effect, Expr, Para, Program, Scene, Src } from "../src/rom/ast.ts";
import { walkExpr } from "../src/rom/expr.ts";
import { lint } from "../src/rom/lint.ts";
import { loadProgram } from "../src/rom/load.ts";

let orderArg: string | undefined;
let outDir: string | undefined;
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--out") {
    outDir = rawArgs[++i];
    continue;
  }
  if (rawArgs[i].startsWith("--")) continue;
  orderArg = rawArgs[i];
}
const runAll = rawArgs.includes("--all") || !orderArg;

const prog: Program = loadProgram("content");
const lr = lint(prog);

// ------------------------------------------------------------------ глобальный провенанс

interface Prov {
  scene: string;
  src: Src;
  how: string;
}
interface Goal {
  kind: "item" | "flag";
  value: string;
}

const itemGive = new Map<string, Prov[]>();
const itemTake = new Map<string, Prov[]>();
const itemRead = new Map<string, Prov[]>();
const flagSet = new Map<string, Prov[]>();
const flagClear = new Map<string, Prov[]>();
const flagRead = new Map<string, Prov[]>();
const repSet = new Map<string, Prov[]>();
const repRead = new Map<string, Prov[]>();
const memGive = new Map<string, Prov[]>();
const memRead = new Map<string, Prov[]>();
const thresholdRead = new Map<string, Prov[]>();
const doneRead = new Map<string, Prov[]>();
const charDossier = new Map<string, Prov[]>();
const repsUsed = new Set<string>();

function add(m: Map<string, Prov[]>, key: string, p: Prov): void {
  const a = m.get(key);
  if (a) a.push(p);
  else m.set(key, [p]);
}

function handleEffect(e: Effect, scene: string, src: Src, how: string): void {
  switch (e.t) {
    case "give":
      add(itemGive, e.item, { scene, src, how });
      break;
    case "take":
      add(itemTake, e.item, { scene, src, how });
      break;
    case "flag":
      add(e.on ? flagSet : flagClear, e.name, { scene, src, how });
      break;
    case "rep":
      repsUsed.add(e.who);
      add(repSet, e.who, { scene, src, how });
      break;
    case "memory":
      add(memGive, `${e.kind}:${e.id}`, { scene, src, how });
      break;
    case "dossier":
      add(charDossier, e.who, { scene, src, how });
      break;
    case "chance":
      for (const x of e.effects) handleEffect(x, scene, src, how);
      break;
    default:
      break;
  }
}

function handleExpr(e: Expr | undefined, scene: string, src: Src, how: string): void {
  if (!e) return;
  walkExpr(e, (n) => {
    if (n.t !== "call") return;
    const p = { scene, src, how };
    switch (n.fn) {
      case "has":
        add(itemRead, n.arg, p);
        break;
      case "flag":
        add(flagRead, n.arg, p);
        break;
      case "rep":
        repsUsed.add(n.arg);
        add(repRead, n.arg, p);
        break;
      case "memory":
        add(memRead, `mem:${n.arg}`, p);
        break;
      case "done":
        add(doneRead, n.arg, p);
        break;
      default:
        break;
    }
  });
}

function walkParas(ps: Para[], cb: (e: Expr) => void): void {
  for (const q of ps) {
    if (q.kind === "cond") {
      for (const b of q.branches) {
        if (b.if) cb(b.if);
        walkParas(b.paras, cb);
      }
    } else if (q.if) cb(q.if);
  }
}

for (const s of Object.values(prog.scenes)) {
  for (const e of s.enter) handleEffect(e, s.id, s.src, "enter");
  handleExpr(s.when, s.id, s.src, "when сцены");
  walkParas(s.paras, (e) => handleExpr(e, s.id, s.src, "условие абзаца"));
  for (const c of s.choices) {
    handleExpr(c.when, s.id, c.src, `выбор «${c.text}»`);
    if (c.item) add(itemRead, c.item, { scene: s.id, src: c.src, how: `[item ${c.item}]` });
    if (c.memory !== undefined)
      add(thresholdRead, String(c.memory), { scene: s.id, src: c.src, how: `[memory ${c.memory}]` });
    for (const e of c.effects) handleEffect(e, s.id, c.src, `выбор «${c.text}»`);
  }
}
for (const l of Object.values(prog.locations)) {
  for (const x of l.exits) {
    handleExpr(x.when, `loc:${l.id}`, x.src, `выход «${x.text}»`);
    if (x.item) add(itemRead, x.item, { scene: `loc:${l.id}`, src: x.src, how: `[item ${x.item}]` });
    if (x.memory !== undefined)
      add(thresholdRead, String(x.memory), { scene: `loc:${l.id}`, src: x.src, how: `[memory ${x.memory}]` });
    for (const e of x.effects) handleEffect(e, `loc:${l.id}`, x.src, `выход «${x.text}»`);
  }
}
for (const o of Object.values(prog.orders)) {
  handleExpr(o.requires, `order:${o.id}`, o.src, "requires");
  handleExpr(o.done, `order:${o.id}`, o.src, "done");
}
for (const c of Object.values(prog.clients))
  for (const it of c.items)
    add(itemGive, it, { scene: `client:${c.id}`, src: c.src, how: "стартовый набор" });

// ------------------------------------------------------------------ утилиты

function parasWords(ps: Para[]): number {
  let n = 0;
  for (const q of ps) {
    if (q.kind === "cond") q.branches.forEach((b) => (n += parasWords(b.paras)));
    else n += q.text.split(/\s+/).filter(Boolean).length;
  }
  return n;
}
function countWords(s: Scene): number {
  return parasWords(s.paras);
}
function reachSet(start: string): Set<string> {
  const seen = new Set<string>();
  const st = [start];
  while (st.length) {
    const id = st.pop()!;
    if (seen.has(id) || !prog.scenes[id]) continue;
    seen.add(id);
    for (const c of prog.scenes[id].choices) if (c.target.t === "scene") st.push(c.target.id);
  }
  return seen;
}
// Режиссёр выбирает сцену один раз за забег (fits: !run.visited). Прямой переход
// `-> scene:id` идёт через goto и visited/once не проверяет, поэтому «одноразовка»
// здесь — только key/pool (сцены, которые ставит режиссёр). См. LG-02 в отчёте.
// Одноразовы в забеге пул (не повторяется через режиссёра) и once (не повторяется
// никогда; прямой вход теперь тоже гасится движком). Key с 2026-09-12 может
// сработать снова при возвращении в локацию, если when истинно, — поэтому не лок.
const runOnce = (s: Scene) => s.pool || s.once;
/**
 * Выбор опасен, если не выдаёт факт сам и уводит туда, откуда ни сцена `ps`,
 * ни любой из провайдеров факта недостижимы. Для hub/next/go считаем опасным.
 */
function dangerousEscape(ps: Scene, c: Choice, goal: Goal, provScenes: Set<string>): boolean {
  if (choiceProvidesFact(c, goal)) return false;
  if (c.dead) return false; // осознанный тупик, а не потеря пути
  if (c.target.t === "unload") return false;
  if (c.target.t === "scene") {
    if (prog.scenes[c.target.id]?.dead) return false; // осознанный тупик
    const r = reachSet(c.target.id);
    if (r.has(ps.id)) return false;
    if ([...provScenes].some((x) => r.has(x))) return false;
  }
  return true;
}

function effectHasFact(e: Effect, goal: Goal): boolean {
  switch (e.t) {
    case "give":
      return goal.kind === "item" && e.item === goal.value;
    case "flag":
      return goal.kind === "flag" && e.on && e.name === goal.value;
    case "chance":
      return e.effects.some((x) => effectHasFact(x, goal));
    default:
      return false;
  }
}
const choiceProvidesFact = (c: Choice, goal: Goal) => c.effects.some((e) => effectHasFact(e, goal));

function collectNegHas(e: Expr | undefined, out: Set<string>): void {
  if (!e) return;
  walkExpr(e, (n) => {
    if (n.t === "not" && n.e.t === "call" && n.e.fn === "has") out.add(n.e.arg);
  });
}

/**
 * Только необходимые факты: call верхнего уровня и ветви `&&`. Ветви `||`
 * и отрицания не считаются обязательными — иначе в цели аудита попадают
 * необязательные предметы и порождается шум.
 */
function necessaryFacts(e: Expr | undefined): Goal[] {
  if (!e) return [];
  if (e.t === "call") {
    if (e.fn === "flag") return [{ kind: "flag", value: e.arg }];
    if (e.fn === "has") return [{ kind: "item", value: e.arg }];
    return [];
  }
  if (e.t === "and") return [...necessaryFacts(e.a), ...necessaryFacts(e.b)];
  return [];
}

// ------------------------------------------------------------------ анализ заказа

interface Quota {
  item: string;
  value: string;
  ok: boolean | null;
  target: string;
}
interface SoftLock {
  goal: string;
  scene: string;
  src: Src;
  confidence: "high" | "medium";
  mechanism: string;
  escapes: string[];
}
interface OrderAudit {
  order: string;
  client: string;
  scenes: number;
  words: number;
  choices: number;
  dead: number;
  quotas: Quota[];
  softLocks: SoftLock[];
  unreachableGate: { scene: string; src: Src; item: string; how: string }[];
  sceneRows: { id: string; loc?: string; tags: string; choices: number; words: number; outs: string }[];
}

function analyzeOrder(orderId: string): OrderAudit | null {
  const order = prog.orders[orderId];
  if (!order) return null;
  const startAct = prog.locations[order.start]?.act ?? 0;
  const scopeLocs = new Set<string>();
  for (const l of Object.values(prog.locations)) if (l.act === startAct) scopeLocs.add(l.id);

  const inScope = new Set<string>();
  for (const s of Object.values(prog.scenes)) if (s.order === orderId) inScope.add(s.id);
  inScope.add(order.finish);
  if (order.fail) inScope.add(order.fail);
  {
    const q = [...inScope];
    while (q.length) {
      const id = q.pop()!;
      const s = prog.scenes[id];
      if (!s) continue;
      for (const c of s.choices)
        if (c.target.t === "scene" && !inScope.has(c.target.id)) {
          inScope.add(c.target.id);
          q.push(c.target.id);
        }
    }
    for (const s of Object.values(prog.scenes))
      if ((!s.order || s.order === orderId) && s.loc && scopeLocs.has(s.loc)) inScope.add(s.id);
  }

  const own = new Set<string>();
  {
    const q: string[] = Object.values(prog.scenes)
      .filter((s) => s.order === orderId)
      .map((s) => s.id)
      .concat(order.finish);
    if (order.fail) q.push(order.fail);
    while (q.length) {
      const id = q.pop()!;
      const s = prog.scenes[id];
      if (!s || own.has(id)) continue;
      if (s.order && s.order !== orderId) continue;
      own.add(id);
      for (const c of s.choices) if (c.target.t === "scene") q.push(c.target.id);
    }
  }
  const ownScenes = [...own].map((id) => prog.scenes[id]).filter((s): s is Scene => !!s);

  // --- цели done + транзитивные предусловия
  const seenGoals = new Set<string>();
  const goals: Goal[] = [];
  function addGoal(g: Goal): boolean {
    const k = `${g.kind}:${g.value}`;
    if (seenGoals.has(k)) return false;
    seenGoals.add(k);
    goals.push(g);
    return true;
  }
  for (const g of necessaryFacts(order.done)) addGoal(g);
  if (!goals.length && order.done)
    walkExpr(order.done, (n) => {
      if (n.t !== "call") return;
      if (n.fn === "flag") addGoal({ kind: "flag", value: n.arg });
      if (n.fn === "has") addGoal({ kind: "item", value: n.arg });
    });
  const goalProviders = (g: Goal): Prov[] =>
    g.kind === "flag" ? flagSet.get(g.value) ?? [] : itemGive.get(g.value) ?? [];
  function prereqsOf(g: Goal): Goal[] {
    const out: Goal[] = [];
    for (const p of goalProviders(g)) {
      const sc = prog.scenes[p.scene];
      if (!sc) continue;
      out.push(...necessaryFacts(sc.when));
    }
    return out;
  }
  let frontier = [...goals];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: Goal[] = [];
    for (const g of frontier) for (const pg of prereqsOf(g)) if (addGoal(pg)) next.push(pg);
    frontier = next;
  }

  // --- soft-lock
  const softLocks: SoftLock[] = [];
  for (const goal of goals) {
    const providers = goalProviders(goal);
    const sceneProvs = providers.filter((p) => prog.scenes[p.scene]);
    const provScenes = new Set(sceneProvs.map((p) => p.scene));
    let hasDirect = false;
    for (const p of sceneProvs) {
      const ps = prog.scenes[p.scene];
      // Если факт ставится в enter, он получен при входе и выбором не теряется.
      if (ps.enter.some((e) => effectHasFact(e, goal))) continue;
      const esc = ps.choices.filter((c) => dangerousEscape(ps, c, goal, provScenes));
      if (runOnce(ps) && esc.length) {
        hasDirect = true;
        softLocks.push({
          goal: `${goal.kind}:${goal.value}`,
          scene: ps.id,
          src: ps.src,
          confidence: "high",
          mechanism: "сцена-провайдер не повторится в забеге, а escape-выбор не выдаёт факт",
          escapes: esc.map((c) => c.text),
        });
      }
    }
    if (!hasDirect && provScenes.size) {
      for (const rid of inScope) {
        const rs = prog.scenes[rid];
        if (!rs || !runOnce(rs)) continue;
        const esc = rs.choices.filter((c) => dangerousEscape(rs, c, goal, provScenes));
        if (!esc.length) continue;
        const reach = reachSet(rid);
        if (![...provScenes].every((x) => reach.has(x))) continue;
        const progress = rs.choices.some((c) => {
          if (c.target.t !== "scene") return false;
          const r = reachSet(c.target.id);
          return [...provScenes].some((x) => r.has(x));
        });
        if (!progress) continue;
        softLocks.push({
          goal: `${goal.kind}:${goal.value}`,
          scene: rs.id,
          src: rs.src,
          confidence: "medium",
          mechanism: "единственный вход к провайдерам факта — сцена-одноразовка с escape-выбором",
          escapes: esc.map((c) => c.text),
        });
      }
    }
  }
  const seenSl = new Set<string>();
  const softLockUnique = softLocks.filter((s) => {
    const k = `${s.goal}|${s.scene}`;
    if (seenSl.has(k)) return false;
    seenSl.add(k);
    return true;
  });

  // --- недостижимые гейты !has(startItem)
  const startItems = new Set(prog.clients[order.client]?.items ?? []);
  const taken = new Set<string>();
  for (const s of ownScenes) {
    for (const e of s.enter) if (e.t === "take") taken.add(e.item);
    for (const c of s.choices) for (const e of c.effects) if (e.t === "take") taken.add(e.item);
  }
  const unreachableGate: OrderAudit["unreachableGate"] = [];
  const checkNeg = (e: Expr | undefined, scene: string, src: Src, how: string) => {
    const neg = new Set<string>();
    collectNegHas(e, neg);
    for (const it of neg)
      if (startItems.has(it) && !taken.has(it))
        unreachableGate.push({ scene, src, item: it, how });
  };
  for (const s of ownScenes) {
    checkNeg(s.when, s.id, s.src, "when сцены");
    for (const c of s.choices) checkNeg(c.when, s.id, c.src, `выбор «${c.text}»`);
  }
  for (const l of Object.values(prog.locations)) {
    if (!scopeLocs.has(l.id)) continue;
    for (const x of l.exits) checkNeg(x.when, `loc:${l.id}`, x.src, `выход «${x.text}»`);
  }

  // --- квоты
  const st = lr.orders.find((o) => o.id === orderId);
  const liveChoices = ownScenes.filter((s) => !s.dead && s.id !== order.finish && s.id !== order.fail);
  const singleChoice = liveChoices.filter((s) => s.choices.length === 1).length;
  const memoryChoices = ownScenes.reduce(
    (n, s) => n + s.choices.filter((c) => c.memory !== undefined).length,
    0,
  );
  const frags = new Set<string>();
  for (const s of ownScenes) {
    const addFrag = (e: Effect) => {
      if (e.t === "memory") frags.add(`${e.kind}:${e.id}`);
      else if (e.t === "chance") e.effects.forEach(addFrag);
    };
    s.enter.forEach(addFrag);
    for (const c of s.choices) c.effects.forEach(addFrag);
  }
  let specials = 0;
  for (const s of ownScenes) {
    const walk = (ps: Para[]) => {
      for (const q of ps) {
        if (q.kind === "cond") q.branches.forEach((b) => walk(b.paras));
        else if (q.kind === "dossier" || q.kind === "echo" || q.kind === "intrusion") specials += 1;
      }
    };
    walk(s.paras);
  }
  const deadTypes = new Set<string>();
  for (const s of ownScenes) if (s.dead) deadTypes.add(s.dead);
  const hasRefusal = deadTypes.has("refusal");
  const quotas: Quota[] = [
    { item: "сцен", value: String(st?.scenes ?? 0), ok: (st?.scenes ?? 0) >= 8 && (st?.scenes ?? 0) <= 20, target: "8–20" },
    { item: "слов", value: String(st?.words ?? 0), ok: (st?.words ?? 0) >= 900 && (st?.words ?? 0) <= 2000, target: "900–2000" },
    { item: "тупиков", value: String(st?.dead ?? 0), ok: (st?.dead ?? 0) >= 2, target: "≥2" },
    {
      item: "доля тупиков",
      value: st && st.choices ? `${Math.round((100 * st.dead) / st.choices)}%` : "—",
      ok: st && st.choices ? st.dead / st.choices >= 0.2 : null,
      target: "≥20%",
    },
    { item: "фрагментов", value: String(frags.size), ok: frags.size >= 2 && frags.size <= 10, target: "2–10" },
    { item: "спец-абзацев", value: String(specials), ok: specials <= 2, target: "≤2" },
    { item: "сцен с одним выбором", value: String(singleChoice), ok: singleChoice >= 1, target: "≥1" },
    { item: "выборов [memory n]", value: String(memoryChoices), ok: memoryChoices >= 1, target: "≥1" },
    { item: "fail при refusal", value: hasRefusal ? (order.fail ? "есть" : "нет") : "—", ok: !hasRefusal || !!order.fail, target: "обязательно" },
  ];

  const sceneRows = prog.sceneOrder
    .filter((id) => own.has(id))
    .map((id) => {
      const s = prog.scenes[id];
      const tags: string[] = [];
      if (s.key) tags.push("key");
      if (s.pool) tags.push("pool");
      if (s.once) tags.push("once");
      if (s.dead) tags.push(`dead:${s.dead}`);
      if (s.silence) tags.push("silence");
      if (s.rust) tags.push("rust");
      const outs: string[] = [];
      for (const e of s.enter) {
        if (e.t === "give") outs.push(`give ${e.item}`);
        if (e.t === "flag") outs.push(`flag ${e.on ? "+" : "-"}${e.name}`);
        if (e.t === "unlock") outs.push(`unlock ${e.client}`);
        if (e.t === "ending") outs.push(`ending ${e.n}`);
      }
      return { id, loc: s.loc, tags: tags.join(" ") || "—", choices: s.choices.length, words: countWords(s), outs: outs.join("; ") || "—" };
    });

  return {
    order: orderId,
    client: order.client,
    scenes: st?.scenes ?? 0,
    words: st?.words ?? 0,
    choices: st?.choices ?? 0,
    dead: st?.dead ?? 0,
    quotas,
    softLocks: softLockUnique,
    unreachableGate,
    sceneRows,
  };
}

// ------------------------------------------------------------------ локации и глобальный цикл

interface LocAudit {
  id: string;
  act: number;
  name: string;
  dryWords: number;
  richWords: number;
  ratio: number | null;
  pools: number;
  exits: number;
}
const locationAudits: LocAudit[] = Object.values(prog.locations).map((l) => {
  const dry = parasWords(l.dry);
  const rich = parasWords(l.rich);
  const pools = Object.values(prog.scenes).filter((s) => s.pool && s.loc === l.id).length;
  return {
    id: l.id,
    act: l.act,
    name: l.name,
    dryWords: dry,
    richWords: rich,
    ratio: dry ? Math.round((rich / dry) * 10) / 10 : null,
    pools,
    exits: l.exits.length,
  };
});

const neverGivenItems = Object.values(prog.items)
  .filter((it) => !(itemGive.get(it.id) ?? []).some((p) => !p.scene.startsWith("client:")))
  .map((it) => it.id);
const flagsNeverSet = [...flagRead.keys()].filter((f) => !(flagSet.get(f)?.length));
const itemsGivenNeverTaken = Object.values(prog.items)
  .filter((it) => (itemGive.get(it.id)?.length ?? 0) > 0 && !(itemTake.get(it.id)?.length))
  .map((it) => it.id);

// ------------------------------------------------------------------ рендер

const allOrderIds = Object.keys(prog.orders);
const targets = runAll ? allOrderIds : [orderArg!];
const audits: OrderAudit[] = [];
const missing: string[] = [];
for (const id of targets) {
  const a = analyzeOrder(id);
  if (a) audits.push(a);
  else missing.push(id);
}
if (missing.length) {
  console.error(`неизвестные заказы: ${missing.join(", ")}`);
  process.exit(2);
}

const md: string[] = [];
const scopeLabel = runAll ? `весь сценарий (${audits.length} заказов)` : `заказ \`${audits[0].order}\``;
md.push(`# Структурный аудит: ${scopeLabel}`);
md.push("");
md.push(`Сцен ${Object.keys(prog.scenes).length}, локаций ${Object.keys(prog.locations).length}, заказов ${allOrderIds.length}, предметов ${Object.keys(prog.items).length}.`);
md.push(`Линт: ошибок ${lr.diags.filter((d) => d.level === "error").length}, предупреждений ${lr.diags.filter((d) => d.level === "warn").length}.`);
md.push("");

md.push("## Сводка по заказам");
md.push("");
md.push("| заказ | заказчик | сцен | слов | выборов | тупиков | доля | soft-lock high/med | гейт | квоты |");
md.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---|");
for (const a of audits) {
  const pct = a.choices ? Math.round((100 * a.dead) / a.choices) : 0;
  const qfail = a.quotas.filter((q) => q.ok === false).length;
  const hi = a.softLocks.filter((s) => s.confidence === "high").length;
  md.push(
    `| ${a.order} | ${a.client} | ${a.scenes} | ${a.words} | ${a.choices} | ${a.dead} | ${pct}% | ${hi}/${a.softLocks.length - hi} | ${a.unreachableGate.length} | ${qfail ? qfail + " НЕТ" : "ok"} |`,
  );
}
md.push("");

md.push("## Кандидаты soft-lock");
md.push("");
if (!audits.some((a) => a.softLocks.length)) md.push("Не обнаружено.");
for (const a of audits)
  for (const s of a.softLocks)
    md.push(`- **${a.order}** [${s.confidence}] / \`${s.scene}\` (${s.src.file}:${s.src.line}) — ${s.goal}: ${s.mechanism}. Escape: ${s.escapes.map((e) => `«${e}»`).join(", ")}.`);
md.push("");

md.push("## Недостижимые гейты `!has(startItem)`");
md.push("");
if (!audits.some((a) => a.unreachableGate.length)) md.push("Не обнаружено.");
for (const a of audits)
  for (const g of a.unreachableGate)
    md.push(`- **${a.order}** / \`${g.scene}\` (${g.src.file}:${g.src.line}) — ${g.how}: \`!has(${g.item})\`, но предмет выдаётся на старте и не тратится.`);
md.push("");

md.push("## Нарушения квот");
md.push("");
if (!audits.some((a) => a.quotas.some((q) => q.ok === false))) md.push("Нет.");
for (const a of audits) {
  const bad = a.quotas.filter((q) => q.ok === false);
  if (bad.length) md.push(`- **${a.order}**: ${bad.map((q) => `${q.item}=${q.value} (норма ${q.target})`).join("; ")}.`);
}
md.push("");

md.push("## Локации: объём dry/rich и пул");
md.push("");
md.push("| локация | акт | dry | rich | rich/dry | пул | выходов |");
md.push("|---|---:|---:|---:|---:|---:|---:|");
for (const l of locationAudits)
  md.push(`| ${l.id} | ${l.act} | ${l.dryWords} | ${l.richWords} | ${l.ratio ?? "—"} | ${l.pools} | ${l.exits} |`);
md.push("");

md.push("## Цикл жизни эффектов (глобально)");
md.push("");
md.push(`- Предметы, которые нигде не выдаются: ${neverGivenItems.length ? neverGivenItems.map((x) => `\`${x}\``).join(", ") : "нет"}.`);
md.push(`- Флаги, которые проверяют, но нигде не ставят: ${flagsNeverSet.length ? flagsNeverSet.map((f) => `\`${f}\``).join(", ") : "нет"}.`);
md.push(`- Предметы, которые выдают, но нигде не забирают: ${itemsGivenNeverTaken.length ? itemsGivenNeverTaken.map((x) => `\`${x}\``).join(", ") : "нет"}.`);
md.push("");

if (!runAll) {
  const a = audits[0];
  md.push("## Сцены заказа");
  md.push("");
  md.push("| сцена | локация | теги | выборов | слов | выдаёт / ставит |");
  md.push("|---|---|---|---:|---:|---|");
  for (const r of a.sceneRows) md.push(`| ${r.id} | ${r.loc ?? "—"} | ${r.tags} | ${r.choices} | ${r.words} | ${r.outs} |`);
  md.push("");
}

const json = {
  scope: runAll ? "all" : audits[0].order,
  sha: undefined,
  lint: lr.diags,
  orders: audits,
  locations: locationAudits,
  lifecycle: { neverGivenItems, flagsNeverSet, itemsGivenNeverTaken },
};

const out = md.join("\n");
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  const name = runAll ? "structural-all" : "structural";
  writeFileSync(`${outDir}/${name}.md`, out + "\n");
  writeFileSync(`${outDir}/${name}.json`, JSON.stringify(json, null, 2));
  console.log(`записано ${outDir}/${name}.md и ${outDir}/${name}.json`);
}
console.log(out);
