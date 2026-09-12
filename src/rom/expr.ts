// Разбор и вычисление выражений условий.
//
//   expr    := or
//   or      := and ("||" and)*
//   and     := unary ("&&" unary)*
//   unary   := "!" unary | cmp
//   cmp     := atom (("=="|"!="|"<"|"<="|">"|">=") atom)?
//   atom    := number | string | ident "(" arg ")" | ident | "(" expr ")"

import type { Expr, Src } from "./ast.ts";
import { RomError } from "./ast.ts";

export const VARS = new Set([
  "memory",
  "memory.own",
  "memory.hanna",
  "memory.foreign",
  "credit",
  "attention",
  "integrity",
  "runs",
  "client",
  "act",
  "loc",
  "order",
]);

export const FUNCS = new Set(["has", "flag", "rep", "seen", "visited", "done", "memory", "ending"]);

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(s: string, src?: Src): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === '"') {
      const j = s.indexOf('"', i + 1);
      if (j < 0) throw new RomError(`незакрытая строка в выражении: ${s}`, src);
      out.push({ t: "str", v: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(s[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
      out.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("<>!()".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new RomError(`неожиданный символ «${c}» в выражении: ${s}`, src);
  }
  return out;
}

export function parseExpr(s: string, src?: Src): Expr {
  const toks = tokenize(s.trim(), src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;
  const eat = (v: string) => {
    if (!isOp(v)) throw new RomError(`ожидалось «${v}» в выражении: ${s}`, src);
    p++;
  };

  function or(): Expr {
    let a = and();
    while (isOp("||")) {
      p++;
      a = { t: "or", a, b: and() };
    }
    return a;
  }
  function and(): Expr {
    let a = unary();
    while (isOp("&&")) {
      p++;
      a = { t: "and", a, b: unary() };
    }
    return a;
  }
  function unary(): Expr {
    if (isOp("!")) {
      p++;
      return { t: "not", e: unary() };
    }
    return cmp();
  }
  function cmp(): Expr {
    const a = atom();
    const t = peek();
    if (t && t.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      p++;
      const b = atom();
      return { t: "cmp", op: t.v as "==", a, b };
    }
    return a;
  }
  function atom(): Expr {
    const t = peek();
    if (!t) throw new RomError(`неожиданный конец выражения: ${s}`, src);
    if (t.t === "num") {
      p++;
      return { t: "num", v: t.v };
    }
    if (t.t === "str") {
      p++;
      return { t: "str", v: t.v };
    }
    if (t.t === "id") {
      p++;
      if (isOp("(")) {
        p++;
        const arg = peek();
        if (!arg || (arg.t !== "id" && arg.t !== "num" && arg.t !== "str"))
          throw new RomError(`ожидался аргумент ${t.v}(...) в выражении: ${s}`, src);
        p++;
        eat(")");
        if (!FUNCS.has(t.v)) throw new RomError(`неизвестная функция ${t.v}()`, src);
        return { t: "call", fn: t.v, arg: String(arg.v) };
      }
      if (VARS.has(t.v)) return { t: "var", name: t.v };
      // Голый идентификатор: строковый литерал (client == marsh).
      return { t: "str", v: t.v };
    }
    if (isOp("(")) {
      p++;
      const e = or();
      eat(")");
      return e;
    }
    throw new RomError(`неожиданный токен в выражении: ${s}`, src);
  }

  const e = or();
  if (p !== toks.length) throw new RomError(`лишние символы в выражении: ${s}`, src);
  return e;
}

/** Контекст вычисления: движок реализует, линт и симулятор подменяют. */
export interface EvalCtx {
  vars(name: string): number | string;
  call(fn: string, arg: string): number | boolean;
}

export function evalExpr(e: Expr, ctx: EvalCtx): number | string | boolean {
  switch (e.t) {
    case "num":
      return e.v;
    case "str":
      return e.v;
    case "var":
      return ctx.vars(e.name);
    case "call":
      return ctx.call(e.fn, e.arg);
    case "not":
      return !truthy(evalExpr(e.e, ctx));
    case "and":
      return truthy(evalExpr(e.a, ctx)) && truthy(evalExpr(e.b, ctx));
    case "or":
      return truthy(evalExpr(e.a, ctx)) || truthy(evalExpr(e.b, ctx));
    case "cmp": {
      const a = evalExpr(e.a, ctx);
      const b = evalExpr(e.b, ctx);
      switch (e.op) {
        case "==":
          return a == b; // eslint-disable-line eqeqeq
        case "!=":
          return a != b; // eslint-disable-line eqeqeq
        case "<":
          return Number(a) < Number(b);
        case "<=":
          return Number(a) <= Number(b);
        case ">":
          return Number(a) > Number(b);
        case ">=":
          return Number(a) >= Number(b);
      }
    }
  }
}

export function truthy(v: number | string | boolean): boolean {
  return v !== 0 && v !== "" && v !== false;
}

export function test(e: Expr | undefined, ctx: EvalCtx): boolean {
  return e ? truthy(evalExpr(e, ctx)) : true;
}

/** Обход: вызвать fn для каждого узла. Для линта. */
export function walkExpr(e: Expr, fn: (e: Expr) => void): void {
  fn(e);
  switch (e.t) {
    case "not":
      walkExpr(e.e, fn);
      break;
    case "and":
    case "or":
    case "cmp":
      walkExpr(e.a, fn);
      walkExpr(e.b, fn);
      break;
  }
}

export function exprToString(e: Expr): string {
  switch (e.t) {
    case "num":
      return String(e.v);
    case "str":
      return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(e.v) ? e.v : JSON.stringify(e.v);
    case "var":
      return e.name;
    case "call":
      return `${e.fn}(${e.arg})`;
    case "not":
      return `!${exprToString(e.e)}`;
    case "and":
      return `(${exprToString(e.a)} && ${exprToString(e.b)})`;
    case "or":
      return `(${exprToString(e.a)} || ${exprToString(e.b)})`;
    case "cmp":
      return `${exprToString(e.a)} ${e.op} ${exprToString(e.b)}`;
  }
}
