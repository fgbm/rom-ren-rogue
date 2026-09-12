// Парсер .rom. Строит дерево по отступам, затем интерпретирует узлы.
// Ничего не проверяет по смыслу (ссылки, достижимость): это делает lint.ts.

import type {
  CharacterDef,
  Choice,
  ClientDef,
  Effect,
  Exit,
  Expr,
  FlagDef,
  Location,
  MemoryKind,
  Order,
  Para,
  ParaKind,
  Program,
  Scene,
  Src,
  Target,
} from "./ast.ts";
import { RomError } from "./ast.ts";
import { parseExpr } from "./expr.ts";

interface Node {
  text: string;
  src: Src;
  children: Node[];
}

const PARA_KINDS: ParaKind[] = ["silence", "rust", "memory", "item", "echo", "dossier", "intrusion", "brief"];
const NO_TEXT_KINDS = new Set<ParaKind>(["echo", "intrusion", "brief"]);

// ---------------------------------------------------------------- дерево

function buildTree(file: string, source: string): Node[] {
  const root: Node = { text: "", src: { file, line: 0 }, children: [] };
  const stack: { node: Node; indent: number }[] = [{ node: root, indent: -1 }];
  const childIndent = new Map<Node, number>();
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\s+$/, "");
    if (!raw.trim()) continue;
    const src = { file, line: i + 1 };
    const m = /^( *)(.*)$/.exec(raw)!;
    if (/^\t/.test(raw)) throw new RomError("табуляция в отступе", src);
    if (m[1].length % 2) throw new RomError("отступ не кратен двум пробелам", src);
    const indent = m[1].length / 2;
    const text = m[2];
    if (text.startsWith("#")) continue;
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    const sib = parent.node.children[0];
    if (sib && sib.src.line && childIndent.get(parent.node) !== indent)
      throw new RomError(`отступ ${indent}, а соседние строки блока на ${childIndent.get(parent.node)}`, src);
    childIndent.set(parent.node, indent);
    const node: Node = { text, src, children: [] };
    parent.node.children.push(node);
    stack.push({ node, indent });
  }
  return root.children;
}

// ---------------------------------------------------------------- токены заголовков

type HTok = { t: "word" | "str" | "tag"; v: string };

function headTokens(s: string, src: Src): HTok[] {
  const out: HTok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") {
      i++;
      continue;
    }
    if (c === '"') {
      const j = s.indexOf('"', i + 1);
      if (j < 0) throw new RomError("незакрытая кавычка", src);
      out.push({ t: "str", v: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === "[") {
      const j = s.indexOf("]", i + 1);
      if (j < 0) throw new RomError("незакрытая скобка [", src);
      out.push({ t: "tag", v: s.slice(i + 1, j).trim() });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== " ") j++;
    out.push({ t: "word", v: s.slice(i, j) });
    i = j;
  }
  return out;
}

interface Head {
  words: string[];
  strs: string[];
  tags: string[];
  params: Record<string, string>;
}

function parseHead(s: string, src: Src): Head {
  const h: Head = { words: [], strs: [], tags: [], params: {} };
  for (const t of headTokens(s, src)) {
    if (t.t === "str") h.strs.push(t.v);
    else if (t.t === "tag") h.tags.push(t.v);
    else if (t.v.includes("=")) {
      const [k, v] = t.v.split("=", 2);
      h.params[k] = v;
    } else h.words.push(t.v);
  }
  return h;
}

function ident(s: string | undefined, what: string, src: Src): string {
  if (!s || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(s))
    throw new RomError(`ожидался идентификатор ${what}, получено «${s ?? ""}»`, src);
  return s;
}

function int(s: string | undefined, what: string, src: Src): number {
  if (s === undefined || !/^[+-]?\d+$/.test(s))
    throw new RomError(`ожидалось число ${what}, получено «${s ?? ""}»`, src);
  return Number(s);
}

// ---------------------------------------------------------------- теги выбора/выхода

interface ChoiceTags {
  cost?: number;
  memory?: number;
  item?: string;
  when?: Expr;
  dead?: boolean;
  back?: boolean;
  once?: boolean;
}

/** Снимает хвостовые [теги] и "-> цель" со строки выбора. */
function splitChoiceLine(line: string, _src: Src): { text: string; tags: string[]; target?: string } {
  let s = line;
  let target: string | undefined;
  const arrow = s.lastIndexOf(" -> ");
  if (arrow >= 0) {
    target = s.slice(arrow + 4).trim();
    s = s.slice(0, arrow);
    // Цель может быть с тегами после: "-> id [dead]". Разрешаем теги и там.
    const tm = /^(\S+)\s+(\[.*\])$/.exec(target);
    if (tm) {
      target = tm[1];
      s = s + " " + tm[2];
    }
  }
  const tags: string[] = [];
  for (;;) {
    const m = /\s\[([^\]]*)\]$/.exec(s);
    if (!m) break;
    tags.unshift(m[1].trim());
    s = s.slice(0, m.index);
  }
  if (target === undefined) return { text: s.trim(), tags };
  return { text: s.trim(), tags, target };
}

function parseChoiceTags(tags: string[], src: Src): ChoiceTags {
  const out: ChoiceTags = {};
  for (const t of tags) {
    const [k, ...rest] = t.split(/\s+/);
    const v = rest.join(" ");
    switch (k) {
      case "cost":
        out.cost = int(v, "в [cost]", src);
        break;
      case "memory":
        out.memory = int(v, "в [memory]", src);
        break;
      case "item":
        out.item = ident(v, "в [item]", src);
        break;
      case "when":
        out.when = parseExpr(v, src);
        break;
      case "dead":
      case "dead:unload":
      case "dead:intercept":
      case "dead:loss":
      case "dead:refusal":
      case "dead:silent":
        out.dead = true;
        break;
      case "back":
        out.back = true;
        break;
      default:
        throw new RomError(`неизвестный тег [${t}]`, src);
    }
  }
  return out;
}

function parseTarget(s: string | undefined, src: Src): Target {
  if (!s) throw new RomError("у выбора нет цели (-> …)", src);
  if (s === "@hub") return { t: "hub" };
  if (s === "@next") return { t: "next" };
  if (s === "@unload") return { t: "unload" };
  if (s === "@orders") return { t: "orders" };
  if (s.startsWith("@go ")) return { t: "go", loc: ident(s.slice(4).trim(), "локации в @go", src) };
  if (s.startsWith("@")) throw new RomError(`неизвестная служебная цель ${s}`, src);
  return { t: "scene", id: ident(s, "сцены", src) };
}

// ---------------------------------------------------------------- эффекты

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const c of s) {
    if (c === '"') q = !q;
    if (c === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function signed(s: string | undefined, what: string, src: Src): number {
  if (s === undefined || !/^[+-]\d+$/.test(s))
    throw new RomError(`ожидалось число со знаком ${what}, получено «${s ?? ""}»`, src);
  return Number(s);
}

export function parseEffect(s: string, src: Src): Effect {
  const cm = /^chance\s+([0-9.]+)\s*:\s*(.+)$/.exec(s);
  if (cm) {
    const p = Number(cm[1]);
    if (!(p > 0 && p < 1)) throw new RomError("chance ожидает вероятность в (0,1)", src);
    return { t: "chance", p, effects: splitTop(cm[2], ";").map((e) => parseEffect(e, src)) };
  }
  const h = parseHead(s, src);
  const [op, a, b] = h.words;
  switch (op) {
    case "give":
      return { t: "give", item: ident(a, "предмета", src) };
    case "take":
      return { t: "take", item: ident(a, "предмета", src) };
    case "flag": {
      if (!a) throw new RomError("flag ожидает имя", src);
      const on = !a.startsWith("-");
      return { t: "flag", name: ident(a.replace(/^[+-]/, ""), "флага", src), on };
    }
    case "rep":
      return { t: "rep", who: ident(a, "фракции", src), d: signed(b, "в rep", src) };
    case "attention":
    case "integrity":
    case "credit":
      return { t: op, d: signed(a, `в ${op}`, src) };
    case "memory": {
      if (!["own", "hanna", "foreign"].includes(a ?? ""))
        throw new RomError("memory ожидает вид own|hanna|foreign", src);
      const text = h.strs[0];
      if (!text) throw new RomError("memory ожидает текст в кавычках", src);
      if (!b || !/^[A-Za-z_][A-Za-z0-9_.]*(\{runs\})?[A-Za-z0-9_.]*$/.test(b))
        throw new RomError(`ожидался идентификатор фрагмента (допустимо {runs}), получено «${b ?? ""}»`, src);
      return { t: "memory", kind: a as MemoryKind, id: b, text };
    }
    case "forget": {
      if (!["own", "hanna", "foreign"].includes(a ?? ""))
        throw new RomError("forget ожидает вид own|hanna|foreign", src);
      return { t: "forget", kind: a as MemoryKind, n: int(b, "в forget", src) };
    }
    case "unlock":
      return { t: "unlock", client: ident(a, "заказчика", src) };
    case "dossier":
      return { t: "dossier", who: ident(a, "персонажа", src) };
    case "move":
      return { t: "move", loc: ident(a, "локации", src) };
    case "ending":
      return { t: "ending", n: int(a, "в ending", src) };
    case "wipe":
      return { t: "wipe" };
    default:
      throw new RomError(`неизвестный эффект «${op}»`, src);
  }
}

function parseEffects(line: string, children: Node[], src: Src): Effect[] {
  const out: Effect[] = [];
  const inline = line.trim();
  if (inline) out.push(...splitTop(inline, ";").map((e) => parseEffect(e, src)));
  for (const c of children) {
    if (c.children.length) throw new RomError("эффект не может иметь вложенных строк", c.src);
    out.push(...splitTop(c.text, ";").map((e) => parseEffect(e, c.src)));
  }
  return out;
}

// ---------------------------------------------------------------- абзацы

function paraWithIf(kind: ParaKind, text: string, src: Src): Para {
  const m = /^(.*?)\s*\[if (.+)\]$/.exec(text);
  if (m) return { kind, text: m[1].trim(), if: parseExpr(m[2], src) };
  return { kind, text: text.trim() };
}

/** Разбирает узлы как абзацы. Узлы, начинающиеся с "* ", возвращаются отдельно (выборы). */
function parseParas(nodes: Node[], allowChoices: boolean): { paras: Para[]; choices: Node[] } {
  const paras: Para[] = [];
  const choices: Node[] = [];
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i];
    const t = n.text;
    if (t.startsWith("* ")) {
      if (!allowChoices) throw new RomError("выбор здесь не допускается", n.src);
      choices.push(n);
      i++;
      continue;
    }
    if (t.startsWith("? ")) {
      // группа ? if / ? elif / ? else
      const branches: { if?: Expr; paras: Para[] }[] = [];
      let closed = false;
      while (i < nodes.length && nodes[i].text.startsWith("? ")) {
        const q = nodes[i];
        const m = /^\?\s+(if|elif|else)\b\s*(.*)$/.exec(q.text);
        if (!m) throw new RomError("ожидалось ? if | ? elif | ? else", q.src);
        if (m[1] === "if" && branches.length) break; // новая группа
        if (closed) throw new RomError("ветка после ? else", q.src);
        if (m[1] !== "if" && !branches.length) throw new RomError(`${m[1]} без if`, q.src);
        const inner = parseParas(q.children, false).paras;
        if (m[1] === "else") {
          if (m[2]) throw new RomError("? else не принимает условие", q.src);
          branches.push({ paras: inner });
          closed = true;
        } else {
          if (!m[2]) throw new RomError(`? ${m[1]} без условия`, q.src);
          branches.push({ if: parseExpr(m[2], q.src), paras: inner });
        }
        i++;
      }
      paras.push({ kind: "cond", branches });
      continue;
    }
    if (t.startsWith("~")) {
      const m = /^~([a-z]+)\b\s*(.*)$/.exec(t);
      if (!m || !PARA_KINDS.includes(m[1] as ParaKind))
        throw new RomError(`неизвестный вид абзаца «${t.split(" ")[0]}»`, n.src);
      const kind = m[1] as ParaKind;
      const onlyIf = /^\[if (.+)\]$/.exec(m[2]);
      if (m[2] && !onlyIf) {
        if (n.children.length) throw new RomError("~вид с текстом не может иметь блок", n.src);
        paras.push(paraWithIf(kind, m[2], n.src));
      } else {
        const blockIf = onlyIf ? parseExpr(onlyIf[1], n.src) : undefined;
        if (!n.children.length && !NO_TEXT_KINDS.has(kind))
          throw new RomError(`~${kind} без текста`, n.src);
        if (!n.children.length) {
          const q: Para = { kind, text: "" };
          if (blockIf) q.if = blockIf;
          paras.push(q);
        }
        for (const c of n.children) {
          if (c.children.length) throw new RomError("вложенность внутри ~блока", c.src);
          const q = paraWithIf(kind, c.text, c.src);
          if (blockIf && q.kind !== "cond") q.if = q.if ? { t: "and", a: blockIf, b: q.if } : blockIf;
          paras.push(q);
        }
      }
      i++;
      continue;
    }
    if (n.children.length) throw new RomError("абзац не может иметь вложенных строк", n.src);
    paras.push(paraWithIf("text", t, n.src));
    i++;
  }
  return { paras, choices };
}

function parseChoice(n: Node): Choice {
  const { text, tags, target } = splitChoiceLine(n.text.slice(2), n.src);
  let tgt = target;
  const effLines: Node[] = [];
  for (const c of n.children) {
    if (c.text.startsWith("-> ")) {
      if (tgt !== undefined) throw new RomError("у выбора две цели", c.src);
      // "-> цель [теги]": теги после цели относятся к выбору.
      const sub = splitChoiceLine(" " + c.text, c.src);
      tgt = sub.target;
      tags.push(...sub.tags);
    } else effLines.push(c);
  }
  const ct = parseChoiceTags(tags, n.src);
  if (!text) throw new RomError("пустой текст выбора", n.src);
  const ch: Choice = {
    text,
    effects: parseEffects("", effLines, n.src),
    target: parseTarget(tgt, n.src),
    src: n.src,
  };
  if (ct.cost !== undefined) ch.cost = ct.cost;
  if (ct.memory !== undefined) ch.memory = ct.memory;
  if (ct.item !== undefined) ch.item = ct.item;
  if (ct.when !== undefined) ch.when = ct.when;
  if (ct.dead) ch.dead = true;
  if (ct.back) ch.back = true;
  return ch;
}

// ---------------------------------------------------------------- декларации

const SCENE_TAGS = new Set(["key", "pool", "once", "silence", "rust", "shop"]);

function parseScene(n: Node, h: Head): Scene {
  const id = ident(h.words[1], "сцены", n.src);
  const sc: Scene = {
    id,
    key: false,
    pool: false,
    once: false,
    silence: false,
    rust: false,
    shop: false,
    enter: [],
    paras: [],
    choices: [],
    src: n.src,
  };
  for (const raw of h.tags) {
    for (const t of raw.split(/\s+/)) {
      if (t.startsWith("dead:")) {
        const kind = t.slice(5);
        if (!["unload", "intercept", "loss", "refusal", "silent"].includes(kind))
          throw new RomError(`неизвестный тип тупика dead:${kind}`, n.src);
        sc.dead = kind;
      } else if (SCENE_TAGS.has(t)) (sc as unknown as Record<string, boolean>)[t] = true;
      else throw new RomError(`неизвестный тег сцены [${t}]`, n.src);
    }
  }
  for (const [k, v] of Object.entries(h.params)) {
    if (k === "loc") sc.loc = ident(v, "локации", n.src);
    else if (k === "order") sc.order = ident(v, "заказа", n.src);
    else throw new RomError(`неизвестный параметр сцены ${k}=`, n.src);
  }
  const body: Node[] = [];
  for (const c of n.children) {
    if (c.text.startsWith("when ")) {
      if (sc.when) throw new RomError("второй when", c.src);
      sc.when = parseExpr(c.text.slice(5), c.src);
    } else if (c.text === "enter" || c.text.startsWith("enter ")) {
      sc.enter.push(...parseEffects(c.text.slice(5), c.children, c.src));
    } else body.push(c);
  }
  const { paras, choices } = parseParas(body, true);
  sc.paras = paras;
  sc.choices = choices.map(parseChoice);
  if (sc.key && sc.pool) throw new RomError("сцена не может быть и key, и pool", n.src);
  return sc;
}

function parseLocation(n: Node, h: Head): Location {
  const id = ident(h.words[1], "локации", n.src);
  const loc: Location = {
    id,
    act: int(h.params.act, "act= локации", n.src),
    name: h.strs[0] ?? "",
    dry: [],
    rich: [],
    exits: [],
    terminal: h.tags.includes("terminal"),
    src: n.src,
  };
  if (!loc.name) throw new RomError("у локации нет названия в кавычках", n.src);
  for (const c of n.children) {
    if (c.text === "dry") loc.dry = parseParas(c.children, false).paras;
    else if (c.text === "rich") loc.rich = parseParas(c.children, false).paras;
    else if (c.text.startsWith("exit ")) {
      const eh = parseHead(c.text, c.src);
      const arrow = eh.words.indexOf("->");
      if (arrow < 0 || !eh.strs[0]) throw new RomError('exit "текст" -> локация', c.src);
      const ct = parseChoiceTags(eh.tags, c.src);
      const tgt = eh.words[arrow + 1] ?? "";
      const ex: Exit = {
        text: eh.strs[0],
        loc: tgt.startsWith("scene:") ? "" : ident(tgt, "локации в exit", c.src),
        effects: parseEffects("", c.children, c.src),
        src: c.src,
      };
      if (tgt.startsWith("scene:")) ex.scene = ident(tgt.slice(6), "сцены в exit", c.src);
      if (ct.when) ex.when = ct.when;
      if (ct.item) ex.item = ct.item;
      if (ct.memory !== undefined) ex.memory = ct.memory;
      if (ct.cost !== undefined) ex.cost = ct.cost;
      if (ct.dead || ct.back) throw new RomError("[dead]/[back] не применимы к exit", c.src);
      loc.exits.push(ex);
    } else throw new RomError(`неизвестное поле локации «${c.text}»`, c.src);
  }
  return loc;
}

function parseOrder(n: Node, h: Head): Order {
  const id = ident(h.words[1], "заказа", n.src);
  const o: Partial<Order> & { brief: Para[] } = {
    id,
    client: ident(h.params.client, "client= заказа", n.src),
    title: h.strs[0] ?? "",
    brief: [],
    src: n.src,
  };
  if (!o.title) throw new RomError("у заказа нет названия в кавычках", n.src);
  for (const c of n.children) {
    const [k, ...rest] = c.text.split(" ");
    const v = rest.join(" ");
    if (k === "requires") o.requires = parseExpr(v, c.src);
    else if (k === "start") o.start = ident(v, "стартовой локации", c.src);
    else if (k === "finish") o.finish = ident(v, "сцены развязки", c.src);
    else if (k === "done") o.done = parseExpr(v, c.src);
    else if (k === "brief") o.brief = parseParas(c.children, false).paras;
    else throw new RomError(`неизвестное поле заказа «${k}»`, c.src);
  }
  for (const f of ["start", "finish", "done"] as const)
    if (!o[f]) throw new RomError(`у заказа нет поля ${f}`, n.src);
  if (!o.brief.length) throw new RomError("у заказа нет brief", n.src);
  return o as Order;
}

function parseClient(n: Node, h: Head): ClientDef {
  const id = ident(h.words[1], "заказчика", n.src);
  const c: ClientDef = {
    id,
    name: h.strs[0] ?? "",
    label: "",
    credit: 0,
    attention: 1,
    items: [],
    unlocked: false,
    src: n.src,
  };
  if (!c.name) throw new RomError("у заказчика нет имени в кавычках", n.src);
  for (const ch of n.children) {
    const [k, ...rest] = ch.text.split(" ");
    const v = rest.join(" ");
    if (k === "label") c.label = v;
    else if (k === "credit") c.credit = int(v, "credit", ch.src);
    else if (k === "attention") c.attention = int(v, "attention", ch.src);
    else if (k === "items") c.items = rest.map((x) => ident(x, "предмета", ch.src));
    else if (k === "unlocked") c.unlocked = true;
    else throw new RomError(`неизвестное поле заказчика «${k}»`, ch.src);
  }
  if (!c.label) throw new RomError("у заказчика нет label", n.src);
  return c;
}

// ---------------------------------------------------------------- сборка

export interface Unit {
  file: string;
  source: string;
}

function put<T extends { src: Src }>(map: Record<string, T>, id: string, v: T, what: string): void {
  if (map[id]) throw new RomError(`${what} ${id} уже объявлен в ${map[id].src.file}:${map[id].src.line}`, v.src);
  map[id] = v;
}

export function compile(units: Unit[]): Program {
  const prog: Program = {
    config: { intercept: "", flatline: "", unload: "", load: "", first: "" },
    ladder: [],
    items: {},
    characters: {},
    flags: {},
    factions: [],
    clients: {},
    locations: {},
    orders: {},
    scenes: {},
    sceneOrder: [],
  };
  let configSeen = false;

  for (const u of units) {
    for (const n of buildTree(u.file, u.source)) {
      const h = parseHead(n.text, n.src);
      const kw = h.words[0];
      switch (kw) {
        case "config": {
          if (configSeen) throw new RomError("config объявлен дважды", n.src);
          configSeen = true;
          for (const k of ["intercept", "flatline", "unload", "load", "first"] as const) {
            if (!h.params[k]) throw new RomError(`config без ${k}=`, n.src);
            prog.config[k] = ident(h.params[k], k, n.src);
          }
          break;
        }
        case "ladder":
          prog.ladder = h.words.slice(1).map((x) => int(x, "в ladder", n.src));
          break;
        case "item": {
          const id = ident(h.words[1], "предмета", n.src);
          const desc = n.children.map((c) => c.text).join("\n");
          if (!h.strs[0]) throw new RomError("у предмета нет имени в кавычках", n.src);
          put(prog.items, id, { id, name: h.strs[0], desc, consumable: h.tags.includes("consumable"), src: n.src }, "предмет");
          break;
        }
        case "character": {
          const id = ident(h.words[1], "персонажа", n.src);
          if (!h.strs[0]) throw new RomError("у персонажа нет имени в кавычках", n.src);
          const c: CharacterDef = { id, name: h.strs[0], aliases: h.strs.slice(1), src: n.src };
          put(prog.characters, id, c, "персонаж");
          break;
        }
        case "flag": {
          const id = ident(h.words[1], "флага", n.src);
          const f: FlagDef = { id, desc: h.strs[0] ?? "", src: n.src };
          put(prog.flags, id, f, "флаг");
          break;
        }
        case "faction":
          for (const w of h.words.slice(1)) {
            if (prog.factions.includes(w)) throw new RomError(`фракция ${w} объявлена дважды`, n.src);
            prog.factions.push(ident(w, "фракции", n.src));
          }
          break;
        case "client": {
          const c = parseClient(n, h);
          put(prog.clients, c.id, c, "заказчик");
          break;
        }
        case "location": {
          const l = parseLocation(n, h);
          put(prog.locations, l.id, l, "локация");
          break;
        }
        case "order": {
          const o = parseOrder(n, h);
          put(prog.orders, o.id, o, "заказ");
          break;
        }
        case "scene": {
          const s = parseScene(n, h);
          put(prog.scenes, s.id, s, "сцена");
          prog.sceneOrder.push(s.id);
          break;
        }
        default:
          throw new RomError(`неизвестная декларация «${kw}»`, n.src);
      }
    }
  }
  if (!configSeen) throw new RomError("нет декларации config");
  if (!prog.ladder.length) throw new RomError("нет декларации ladder");
  return prog;
}

/** Все выражения программы с местом, для линта. */
export function* allExprs(p: Program): Generator<{ e: Expr; src: Src; ctx: string }> {
  function* paras(ps: Para[], src: Src, ctx: string): Generator<{ e: Expr; src: Src; ctx: string }> {
    for (const q of ps) {
      if (q.kind === "cond") {
        for (const b of q.branches) {
          if (b.if) yield { e: b.if, src, ctx };
          yield* paras(b.paras, src, ctx);
        }
      } else if (q.if) yield { e: q.if, src, ctx };
    }
  }
  for (const s of Object.values(p.scenes)) {
    if (s.when) yield { e: s.when, src: s.src, ctx: `scene ${s.id}` };
    yield* paras(s.paras, s.src, `scene ${s.id}`);
    for (const c of s.choices) if (c.when) yield { e: c.when, src: c.src, ctx: `scene ${s.id}` };
  }
  for (const l of Object.values(p.locations)) {
    yield* paras(l.dry, l.src, `location ${l.id}`);
    yield* paras(l.rich, l.src, `location ${l.id}`);
    for (const x of l.exits) if (x.when) yield { e: x.when, src: x.src, ctx: `location ${l.id}` };
  }
  for (const o of Object.values(p.orders)) {
    if (o.requires) yield { e: o.requires, src: o.src, ctx: `order ${o.id}` };
    yield { e: o.done, src: o.src, ctx: `order ${o.id}` };
    yield* paras(o.brief, o.src, `order ${o.id}`);
  }
}

/** Все эффекты программы с местом. */
export function* allEffects(p: Program): Generator<{ e: Effect; src: Src; ctx: string }> {
  function* flat(es: Effect[], src: Src, ctx: string): Generator<{ e: Effect; src: Src; ctx: string }> {
    for (const e of es) {
      yield { e, src, ctx };
      if (e.t === "chance") yield* flat(e.effects, src, ctx);
    }
  }
  for (const s of Object.values(p.scenes)) {
    yield* flat(s.enter, s.src, `scene ${s.id}`);
    for (const c of s.choices) yield* flat(c.effects, c.src, `scene ${s.id}`);
  }
  for (const l of Object.values(p.locations))
    for (const x of l.exits) yield* flat(x.effects, x.src, `location ${l.id}`);
}

/** Все абзацы программы (плоско, включая ветки условий). */
export function* allParas(p: Program): Generator<{ q: Para; src: Src; ctx: string }> {
  function* walk(ps: Para[], src: Src, ctx: string): Generator<{ q: Para; src: Src; ctx: string }> {
    for (const q of ps) {
      if (q.kind === "cond") for (const b of q.branches) yield* walk(b.paras, src, ctx);
      else yield { q, src, ctx };
    }
  }
  for (const s of Object.values(p.scenes)) yield* walk(s.paras, s.src, `scene ${s.id}`);
  for (const l of Object.values(p.locations)) {
    yield* walk(l.dry, l.src, `location ${l.id}`);
    yield* walk(l.rich, l.src, `location ${l.id}`);
  }
  for (const o of Object.values(p.orders)) yield* walk(o.brief, o.src, `order ${o.id}`);
}
