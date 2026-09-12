// Линт скомпилированной программы. Ошибки ломают сборку, предупреждения печатаются.

import type { Choice, Effect, Expr, Program, Scene, Src, Target } from "./ast.ts";
import { walkExpr } from "./expr.ts";
import { allEffects, allExprs, allParas } from "./parser.ts";

export interface Diag {
  level: "error" | "warn";
  msg: string;
  src?: Src;
}

export interface OrderStats {
  id: string;
  scenes: number;
  choices: number;
  dead: number;
  words: number;
}

export interface LintResult {
  diags: Diag[];
  orders: OrderStats[];
  ok: boolean;
}

export const SPEAKER_RE = /^([^:\n]{1,32}): — /;

export function lint(p: Program): LintResult {
  const diags: Diag[] = [];
  const err = (msg: string, src?: Src) => diags.push({ level: "error", msg, src });
  const warn = (msg: string, src?: Src) => diags.push({ level: "warn", msg, src });

  const scenes = p.scenes;
  const locs = p.locations;

  // ---------------------------------------------------------- ссылки: config
  for (const k of ["intercept", "flatline", "unload", "load"] as const)
    if (!scenes[p.config[k]]) err(`config ${k}= ссылается на несуществующую сцену ${p.config[k]}`);
  if (!p.orders[p.config.first]) err(`config first= ссылается на несуществующий заказ ${p.config.first}`);

  // ---------------------------------------------------------- ссылки: заказчики
  for (const c of Object.values(p.clients))
    for (const it of c.items) if (!p.items[it]) err(`заказчик ${c.id}: неизвестный предмет ${it}`, c.src);

  // ---------------------------------------------------------- ссылки: заказы
  for (const o of Object.values(p.orders)) {
    if (!p.clients[o.client]) err(`заказ ${o.id}: неизвестный заказчик ${o.client}`, o.src);
    if (!locs[o.start]) err(`заказ ${o.id}: неизвестная стартовая локация ${o.start}`, o.src);
    if (!scenes[o.finish]) err(`заказ ${o.id}: неизвестная сцена развязки ${o.finish}`, o.src);
  }

  // ---------------------------------------------------------- ссылки: сцены
  const targetOf = (t: Target, src: Src, ctx: string) => {
    if (t.t === "scene" && !scenes[t.id]) err(`${ctx}: переход на несуществующую сцену ${t.id}`, src);
    if (t.t === "go" && !locs[t.loc]) err(`${ctx}: @go в несуществующую локацию ${t.loc}`, src);
  };
  for (const s of Object.values(scenes)) {
    const ctx = `сцена ${s.id}`;
    if (s.loc && !locs[s.loc]) err(`${ctx}: неизвестная локация ${s.loc}`, s.src);
    if (s.order && !p.orders[s.order]) err(`${ctx}: неизвестный заказ ${s.order}`, s.src);
    if (s.pool && !s.loc) err(`${ctx}: pool без loc=`, s.src);
    for (const c of s.choices) {
      targetOf(c.target, c.src, ctx);
      if (c.item && !p.items[c.item]) err(`${ctx}: неизвестный предмет в [item ${c.item}]`, c.src);
      if (c.memory !== undefined && !p.ladder.includes(c.memory))
        err(`${ctx}: порог [memory ${c.memory}] вне ladder`, c.src);
    }
  }

  // ---------------------------------------------------------- ссылки: локации
  for (const l of Object.values(locs)) {
    const ctx = `локация ${l.id}`;
    if (!l.dry.length) err(`${ctx}: нет описания dry`, l.src);
    if (!l.rich.length) err(`${ctx}: нет описания rich`, l.src);
    if (!l.exits.length && !l.terminal) err(`${ctx}: нет выходов (или пометьте [terminal])`, l.src);
    for (const x of l.exits) {
      if (x.scene && !scenes[x.scene]) err(`${ctx}: выход в несуществующую сцену ${x.scene}`, x.src);
      if (!x.scene && !locs[x.loc]) err(`${ctx}: выход в несуществующую локацию ${x.loc}`, x.src);
      if (x.item && !p.items[x.item]) err(`${ctx}: неизвестный предмет в [item ${x.item}]`, x.src);
      if (x.memory !== undefined && !p.ladder.includes(x.memory))
        err(`${ctx}: порог [memory ${x.memory}] вне ladder`, x.src);
    }
  }

  // ---------------------------------------------------------- ссылки: эффекты
  const flagsSet = new Set<string>();
  const itemsGiven = new Set<string>();
  const memoryIds = new Set<string>();
  for (const c of Object.values(p.clients)) c.items.forEach((i) => itemsGiven.add(i));
  for (const { e, src, ctx } of allEffects(p)) checkEffect(e, src, ctx);
  function checkEffect(e: Effect, src: Src, ctx: string) {
    switch (e.t) {
      case "give":
        itemsGiven.add(e.item);
        if (!p.items[e.item]) err(`${ctx}: give неизвестного предмета ${e.item}`, src);
        break;
      case "take":
        if (!p.items[e.item]) err(`${ctx}: take неизвестного предмета ${e.item}`, src);
        break;
      case "flag":
        if (e.on) flagsSet.add(e.name);
        if (!p.flags[e.name]) err(`${ctx}: необъявленный флаг ${e.name}`, src);
        break;
      case "rep":
        if (!p.factions.includes(e.who)) err(`${ctx}: неизвестная фракция ${e.who}`, src);
        break;
      case "memory":
        memoryIds.add(e.id);
        break;
      case "unlock":
        if (!p.clients[e.client]) err(`${ctx}: unlock неизвестного заказчика ${e.client}`, src);
        break;
      case "dossier":
        if (!p.characters[e.who]) err(`${ctx}: dossier неизвестного персонажа ${e.who}`, src);
        break;
      case "move":
        if (!locs[e.loc]) err(`${ctx}: move в несуществующую локацию ${e.loc}`, src);
        break;
      case "ending":
        if (e.n < 1 || e.n > 5) err(`${ctx}: ending ${e.n} вне 1..5`, src);
        break;
    }
  }

  // ---------------------------------------------------------- ссылки: выражения
  const flagsChecked = new Map<string, Src>();
  for (const { e, src, ctx } of allExprs(p)) {
    walkExpr(e, (n: Expr) => {
      if (n.t === "call") {
        switch (n.fn) {
          case "has":
            if (!p.items[n.arg]) err(`${ctx}: has(${n.arg}): неизвестный предмет`, src);
            break;
          case "flag":
            if (!p.flags[n.arg]) err(`${ctx}: flag(${n.arg}): необъявленный флаг`, src);
            flagsChecked.set(n.arg, src);
            break;
          case "rep":
            if (!p.factions.includes(n.arg)) err(`${ctx}: rep(${n.arg}): неизвестная фракция`, src);
            break;
          case "seen":
            if (!scenes[n.arg]) err(`${ctx}: seen(${n.arg}): неизвестная сцена`, src);
            break;
          case "visited":
            if (!scenes[n.arg] && !locs[n.arg]) err(`${ctx}: visited(${n.arg}): ни сцена, ни локация`, src);
            break;
          case "done":
            if (!p.orders[n.arg]) err(`${ctx}: done(${n.arg}): неизвестный заказ`, src);
            break;
          case "memory":
            if (!memoryIds.has(n.arg)) warn(`${ctx}: memory(${n.arg}): такой фрагмент нигде не выдаётся`, src);
            break;
          case "ending":
            if (!/^[1-5]$/.test(n.arg)) err(`${ctx}: ending(${n.arg}) вне 1..5`, src);
            break;
        }
      }
      if (n.t === "cmp") {
        const [a, b] = [n.a, n.b];
        const isMem = (x: Expr) => x.t === "var" && x.name === "memory";
        const num = a.t === "num" ? a.v : b.t === "num" ? b.v : undefined;
        if ((isMem(a) || isMem(b)) && num !== undefined && !p.ladder.includes(num))
          err(`${ctx}: порог памяти ${num} вне ladder`, src);
        const isClient = (x: Expr) => x.t === "var" && x.name === "client";
        const str = a.t === "str" ? a.v : b.t === "str" ? b.v : undefined;
        if ((isClient(a) || isClient(b)) && str !== undefined && !p.clients[str])
          err(`${ctx}: client == ${str}: неизвестный заказчик`, src);
        const isLoc = (x: Expr) => x.t === "var" && x.name === "loc";
        if ((isLoc(a) || isLoc(b)) && str !== undefined && !locs[str])
          err(`${ctx}: loc == ${str}: неизвестная локация`, src);
        const isOrder = (x: Expr) => x.t === "var" && x.name === "order";
        if ((isOrder(a) || isOrder(b)) && str !== undefined && !p.orders[str])
          err(`${ctx}: order == ${str}: неизвестный заказ`, src);
      }
    });
  }
  for (const [f, src] of flagsChecked)
    if (!flagsSet.has(f)) warn(`флаг ${f} проверяется, но нигде не ставится`, src);
  for (const it of Object.values(p.items))
    if (!itemsGiven.has(it.id)) warn(`предмет ${it.id} объявлен, но никогда не выдаётся`, it.src);

  // ---------------------------------------------------------- говорящие
  const names = new Set<string>();
  for (const c of Object.values(p.characters)) {
    names.add(c.name);
    c.aliases.forEach((a) => names.add(a));
  }
  const EFFECT_LIKE = /^(give|take|flag|rep|attention|integrity|credit|memory|forget|unlock|dossier|move|ending|wipe|chance)\s/;
  for (const { q, src, ctx } of allParas(p)) {
    if (q.kind !== "text" && q.kind !== "echo") continue;
    const m = SPEAKER_RE.exec(q.text);
    if (m && !names.has(m[1]))
      err(`${ctx}: неизвестный говорящий «${m[1]}» (объявите character)`, src);
    if (EFFECT_LIKE.test(q.text)) warn(`${ctx}: абзац похож на эффект вне enter/выбора: «${q.text.slice(0, 40)}»`, src);
  }

  // ---------------------------------------------------------- граф сцен
  const edges = new Map<string, { to: string; back: boolean }[]>();
  for (const s of Object.values(scenes)) {
    edges.set(
      s.id,
      s.choices
        .filter((c) => c.target.t === "scene")
        .map((c) => ({ to: (c.target as { id: string }).id, back: !!c.back })),
    );
  }

  // достижимость
  const roots = new Set<string>();
  for (const s of Object.values(scenes)) if (s.key || (s.loc && s.pool)) roots.add(s.id);
  for (const o of Object.values(p.orders)) roots.add(o.finish);
  for (const k of ["intercept", "flatline", "unload", "load"] as const) roots.add(p.config[k]);
  for (const l of Object.values(locs)) for (const x of l.exits) if (x.scene) roots.add(x.scene);
  const reach = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id) || !scenes[id]) continue;
    reach.add(id);
    for (const e of edges.get(id) ?? []) stack.push(e.to);
  }
  for (const s of Object.values(scenes))
    if (!reach.has(s.id)) err(`сцена ${s.id} недостижима: ни key, ни pool с loc, ни развязка, ни exit, ни ссылка`, s.src);

  // циклы без [back]
  const color = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const dfs = (id: string) => {
    color.set(id, 1);
    path.push(id);
    for (const e of edges.get(id) ?? []) {
      if (e.back || !scenes[e.to]) continue;
      const c = color.get(e.to) ?? 0;
      if (c === 1) {
        const cyc = path.slice(path.indexOf(e.to)).concat(e.to);
        err(`цикл в графе сцен без [back]: ${cyc.join(" -> ")}`, scenes[id].src);
      } else if (c === 0) dfs(e.to);
    }
    path.pop();
    color.set(id, 2);
  };
  for (const id of Object.keys(scenes)) if (!color.get(id)) dfs(id);

  // тупики
  const isDeadTarget = (c: Choice) =>
    c.target.t === "unload" || (c.target.t === "scene" && !!scenes[c.target.id]?.dead);
  for (const s of Object.values(scenes)) {
    if (!s.choices.length && !s.dead) err(`сцена ${s.id} без выборов не помечена dead:*`, s.src);
    for (const c of s.choices) {
      if (c.dead && !isDeadTarget(c))
        err(`сцена ${s.id}: выбор «${c.text}» помечен [dead], но ведёт не в тупик`, c.src);
    }
    // Тупики unload/intercept/silent заканчивают забег. loss/refusal необратимы, но забег продолжается.
    if (s.dead && ["unload", "intercept", "silent"].includes(s.dead)) {
      for (const c of s.choices)
        if (!isDeadTarget(c) && c.target.t !== "unload")
          err(`тупик ${s.id} (${s.dead}): выбор «${c.text}» ведёт дальше (${describeTarget(c.target)}); такой тупик ведёт только в @unload или другой тупик`, c.src);
    }
  }

  // развязка заказа ведёт только к выгрузке
  for (const o of Object.values(p.orders)) {
    const fin = scenes[o.finish];
    if (!fin) continue;
    const seen = new Set<string>();
    const st = [fin.id];
    let hasUnload = false;
    while (st.length) {
      const id = st.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const c of scenes[id].choices) {
        if (c.target.t === "unload") hasUnload = true;
        else if (c.target.t === "scene") st.push(c.target.id);
        else err(`развязка ${o.finish} заказа ${o.id} ведёт в ${describeTarget(c.target)}; после развязки только @unload`, c.src);
      }
    }
    if (!hasUnload) err(`развязка ${o.finish} заказа ${o.id} не доходит до @unload`, fin.src);
  }

  // ---------------------------------------------------------- граф локаций
  const locReach = new Set<string>();
  const ls = Object.values(p.orders).map((o) => o.start);
  for (const { e } of allEffects(p)) if (e.t === "move") ls.push(e.loc);
  for (const s of Object.values(scenes))
    for (const c of s.choices) if (c.target.t === "go") ls.push(c.target.loc);
  while (ls.length) {
    const id = ls.pop()!;
    if (locReach.has(id) || !locs[id]) continue;
    locReach.add(id);
    for (const x of locs[id].exits) if (!x.scene) ls.push(x.loc);
  }
  for (const l of Object.values(locs))
    if (!locReach.has(l.id)) err(`локация ${l.id} недостижима ни из старта заказа, ни по выходам, ни через @go/move`, l.src);

  // ---------------------------------------------------------- статистика заказов
  const orders: OrderStats[] = [];
  for (const o of Object.values(p.orders)) {
    const own = new Set<string>();
    const st = Object.values(scenes)
      .filter((s) => s.order === o.id)
      .map((s) => s.id)
      .concat(o.finish);
    while (st.length) {
      const id = st.pop()!;
      if (own.has(id) || !scenes[id]) continue;
      const s = scenes[id];
      if (s.order && s.order !== o.id) continue;
      own.add(id);
      for (const e of edges.get(id) ?? []) st.push(e.to);
    }
    let choices = 0;
    let dead = 0;
    let words = 0;
    for (const id of own) {
      const s = scenes[id];
      words += countWords(s);
      // Считаем только входы в тупик: выборы из живых сцен (не тупиков и не развязки).
      if (s.dead || id === o.finish) continue;
      choices += s.choices.length;
      dead += s.choices.filter((c) => c.dead || isDeadTarget(c)).length;
    }
    orders.push({ id: o.id, scenes: own.size, choices, dead, words });
    if (choices && dead / choices < 0.2)
      warn(`заказ ${o.id}: в тупик ведут ${dead} из ${choices} выборов (${Math.round((100 * dead) / choices)}%), нужно не меньше 20%`, o.src);
  }

  return { diags, orders, ok: !diags.some((d) => d.level === "error") };
}

function describeTarget(t: Target): string {
  switch (t.t) {
    case "scene":
      return t.id;
    case "go":
      return `@go ${t.loc}`;
    default:
      return `@${t.t}`;
  }
}

function countWords(s: Scene): number {
  let n = 0;
  const walk = (ps: Scene["paras"]) => {
    for (const q of ps) {
      if (q.kind === "cond") q.branches.forEach((b) => walk(b.paras));
      else n += q.text.split(/\s+/).filter(Boolean).length;
    }
  };
  walk(s.paras);
  return n;
}

export function formatDiag(d: Diag): string {
  const where = d.src ? `${d.src.file}:${d.src.line}: ` : "";
  return `${d.level === "error" ? "ОШИБКА" : "предупреждение"}: ${where}${d.msg}`;
}
