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

/**
 * Заказы, к которым квота dead% не применяется: развязки линий и «откровения»,
 * где по брифу тупиков нет или их мало (docs/writing-guide.md). Финальные заказы
 * ведут к концовкам, а не в тупики.
 */
const DEAD_EXEMPT = new Set([
  "velt_12",
  "marsh_04",
  "hanna_03",
  "silence_01",
  "mori_03",
  "mori_04",
  "sato_04",
  "koenig_03",
  "koenig_04",
  "zero_04",
]);

export function lint(p: Program): LintResult {
  const diags: Diag[] = [];
  const err = (msg: string, src?: Src) => diags.push({ level: "error", msg, src });
  const warn = (msg: string, src?: Src) => diags.push({ level: "warn", msg, src });

  const scenes = p.scenes;
  const locs = p.locations;

  // ---------------------------------------------------------- ссылки: config
  for (const k of ["intercept", "flatline", "unload", "load", "fail"] as const)
    if (!scenes[p.config[k]]) err(`config ${k}= ссылается на несуществующую сцену ${p.config[k]}`);
  if (p.config.sold && !scenes[p.config.sold])
    err(`config sold= ссылается на несуществующую сцену ${p.config.sold}`);
  if (!p.orders[p.config.first]) err(`config first= ссылается на несуществующий заказ ${p.config.first}`);

  // ---------------------------------------------------------- ссылки: заказчики
  for (const c of Object.values(p.clients))
    for (const it of c.items) if (!p.items[it]) err(`заказчик ${c.id}: неизвестный предмет ${it}`, c.src);

  // ---------------------------------------------------------- ссылки: заказы
  for (const o of Object.values(p.orders)) {
    if (!p.clients[o.client]) err(`заказ ${o.id}: неизвестный заказчик ${o.client}`, o.src);
    if (!locs[o.start]) err(`заказ ${o.id}: неизвестная стартовая локация ${o.start}`, o.src);
    if (!scenes[o.finish]) err(`заказ ${o.id}: неизвестная сцена развязки ${o.finish}`, o.src);
    if (o.fail && !scenes[o.fail]) err(`заказ ${o.id}: неизвестная сцена провала ${o.fail}`, o.src);
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
  /** В каких заказах ставится флаг: чтобы поймать ссылки на чужой забег. */
  const flagSetOrders = new Map<string, Set<string>>();
  const orderOfScene = (id: string): string => {
    const sc = scenes[id];
    if (!sc) return "";
    if (sc.order) return sc.order;
    // Сцены внутри файла заказа обычно не несут order=: атрибутируем по имени файла.
    const m = /\/([^/]+)\.rom$/.exec(sc.src.file);
    return m && p.orders[m[1]] ? m[1] : "";
  };
  const orderOfCtx = (ctx: string): string => {
    const m = /^scene (\S+)$/.exec(ctx);
    return m ? orderOfScene(m[1]) : "";
  };
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
        if (e.on) {
          flagsSet.add(e.name);
          const o = orderOfCtx(ctx);
          const set = flagSetOrders.get(e.name) ?? new Set<string>();
          set.add(o);
          flagSetOrders.set(e.name, set);
        }
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
  const flagsChecked = new Map<string, { src: Src; order: string }[]>();
  for (const { e, src, ctx } of allExprs(p)) {
    walkExpr(e, (n: Expr) => {
      if (n.t === "call") {
        switch (n.fn) {
          case "has":
            if (!p.items[n.arg]) err(`${ctx}: has(${n.arg}): неизвестный предмет`, src);
            break;
          case "flag":
            if (!p.flags[n.arg]) err(`${ctx}: flag(${n.arg}): необъявленный флаг`, src);
            {
              const reads = flagsChecked.get(n.arg) ?? [];
              reads.push({ src, order: orderOfCtx(ctx) });
              flagsChecked.set(n.arg, reads);
            }
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
          case "failed":
            if (!p.orders[n.arg]) err(`${ctx}: failed(${n.arg}): неизвестный заказ`, src);
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
  for (const [f, reads] of flagsChecked) {
    if (!flagsSet.has(f)) {
      warn(`флаг ${f} проверяется, но нигде не ставится`, reads[0].src);
      continue;
    }
    const setOrders = flagSetOrders.get(f) ?? new Set<string>();
    const inOrders = [...setOrders].filter(Boolean);
    for (const r of reads)
      if (r.order && inOrders.length && !setOrders.has(r.order) && !setOrders.has(""))
        err(
          `флаг ${f} ставится только в заказах ${inOrders.join(", ")}; в заказе ${r.order} он не выставится (флаги живут один забег)`,
          r.src,
        );
  }
  for (const it of Object.values(p.items))
    if (!itemsGiven.has(it.id)) warn(`предмет ${it.id} объявлен, но никогда не выдаётся`, it.src);

  // ---------------------------------------------------------- soft-lock
  // Key/pool-сцена, которая ЕДИНСТВЕННАЯ выдаёт обязательный для done факт, но
  // даёт escape-выбор (-> @hub/@next/@go) без него: заказ можно загнать в
  // состояние, где развязка недостижима, а провал не запущен.
  const giveByFact = new Map<string, Set<string>>();
  const setByFact = new Map<string, Set<string>>();
  const noteFact = (m: Map<string, Set<string>>, key: string, scene: string) => {
    const s = m.get(key) ?? new Set<string>();
    s.add(scene);
    m.set(key, s);
  };
  const noteEffect = (e: Effect, scene: string) => {
    if (e.t === "give") noteFact(giveByFact, e.item, scene);
    else if (e.t === "flag" && e.on) noteFact(setByFact, e.name, scene);
    else if (e.t === "chance") for (const x of e.effects) noteEffect(x, scene);
  };
  for (const s of Object.values(scenes)) {
    for (const e of s.enter) noteEffect(e, s.id);
    for (const c of s.choices) for (const e of c.effects) noteEffect(e, s.id);
  }
  type Goal = { kind: "item" | "flag"; value: string };
  const necessary = (e: Expr | undefined): Goal[] => {
    if (!e) return [];
    if (e.t === "call") {
      if (e.fn === "flag") return [{ kind: "flag", value: e.arg }];
      if (e.fn === "has") return [{ kind: "item", value: e.arg }];
      return [];
    }
    if (e.t === "and") return [...necessary(e.a), ...necessary(e.b)];
    return [];
  };
  const effectProvides = (e: Effect, g: Goal): boolean => {
    if (e.t === "give") return g.kind === "item" && e.item === g.value;
    if (e.t === "flag") return g.kind === "flag" && e.on && e.name === g.value;
    if (e.t === "chance") return e.effects.some((x) => effectProvides(x, g));
    return false;
  };
  const provides = (c: Choice, g: Goal): boolean => c.effects.some((e) => effectProvides(e, g));
  for (const o of Object.values(p.orders)) {
    const goals = necessary(o.done);
    const seenGoals = new Set(goals.map((g) => `${g.kind}:${g.value}`));
    for (let depth = 0; depth < 3; depth++) {
      const next: Goal[] = [];
      for (const g of [...goals]) {
        const provs = g.kind === "item" ? giveByFact.get(g.value) : setByFact.get(g.value);
        for (const sid of provs ?? []) {
          for (const pg of necessary(scenes[sid]?.when)) {
            const k = `${pg.kind}:${pg.value}`;
            if (!seenGoals.has(k)) {
              seenGoals.add(k);
              next.push(pg);
            }
          }
        }
      }
      goals.push(...next);
      if (!next.length) break;
    }
    for (const g of goals) {
      const provs = g.kind === "item" ? giveByFact.get(g.value) : setByFact.get(g.value);
      if (!provs || provs.size !== 1) continue; // только единственный провайдер
      const sid = [...provs][0];
      const ps = scenes[sid];
      // Key повторно срабатывает при входе в локацию; одноразовы только pool и once.
      if (!ps || !(ps.pool || ps.once)) continue;
      // Факт, который ставится уже при входе в сцену, выбором не теряется.
      if (ps.enter.some((e) => effectProvides(e, g))) continue;
      const esc = ps.choices.find(
        (c) => (c.target.t === "hub" || c.target.t === "next" || c.target.t === "go") && !provides(c, g),
      );
      if (esc)
        err(
          `pool/once-сцена ${sid} — единственный источник факта ${g.kind === "item" ? "предмет" : "флаг"} ${g.value} для done заказа ${o.id}, но предлагает уход без него («${esc.text}»): заказ можно загнать в тупик`,
          ps.src,
        );
    }
  }

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
  for (const o of Object.values(p.orders)) {
    roots.add(o.finish);
    if (o.fail) roots.add(o.fail);
  }
  for (const k of ["intercept", "flatline", "unload", "load", "fail"] as const) roots.add(p.config[k]);
  if (p.config.sold) roots.add(p.config.sold);
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

  // развязка (finish) и сцена провала (fail) ведут только к выгрузке
  const checkTerminal = (sceneId: string, label: string) => {
    const sc = scenes[sceneId];
    if (!sc) return;
    const seen = new Set<string>();
    const st = [sc.id];
    let hasUnload = false;
    while (st.length) {
      const id = st.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const c of scenes[id].choices) {
        if (c.target.t === "unload") hasUnload = true;
        else if (c.target.t === "scene") st.push(c.target.id);
        else err(`${label} ведёт в ${describeTarget(c.target)}; после неё только @unload`, c.src);
      }
    }
    if (!hasUnload) err(`${label} не доходит до @unload`, sc.src);
  };
  for (const o of Object.values(p.orders)) {
    checkTerminal(o.finish, `развязка ${o.finish} заказа ${o.id}`);
    if (o.fail) checkTerminal(o.fail, `сцена провала ${o.fail} заказа ${o.id}`);
  }
  checkTerminal(p.config.fail, `config fail=${p.config.fail}`);

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
    if (o.fail) st.push(o.fail);
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
    let hasRefusal = false;
    for (const id of own) {
      const s = scenes[id];
      words += countWords(s);
      if (s.dead === "refusal") hasRefusal = true;
      // Считаем только входы в тупик: выборы из живых сцен (не тупиков, не развязки, не сцены провала).
      if (s.dead || id === o.finish || id === o.fail) continue;
      choices += s.choices.length;
      dead += s.choices.filter((c) => c.dead || isDeadTarget(c)).length;
    }
    orders.push({ id: o.id, scenes: own.size, choices, dead, words });
    if (choices && dead / choices < 0.2 && !DEAD_EXEMPT.has(o.id))
      warn(`заказ ${o.id}: в тупик ведут ${dead} из ${choices} выборов (${Math.round((100 * dead) / choices)}%), нужно не меньше 20%`, o.src);
    if (hasRefusal && !o.fail)
      warn(`заказ ${o.id}: есть сцена отказа (dead:refusal), но нет поля fail; сработает общий config fail`, o.src);
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
