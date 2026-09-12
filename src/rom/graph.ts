// Экспорт графов в Graphviz DOT: сцены (по заказам) и локации.

import type { Program } from "./ast.ts";

function q(s: string): string {
  return JSON.stringify(s);
}

export function scenesDot(p: Program): string {
  const out: string[] = ["digraph scenes {", "  rankdir=LR;", "  node [shape=box fontname=monospace fontsize=9];"];
  const byOrder = new Map<string, string[]>();
  for (const s of Object.values(p.scenes)) {
    const k = s.order ?? (s.loc ? `loc:${s.loc.split(".")[0]}` : "meta");
    if (!byOrder.has(k)) byOrder.set(k, []);
    byOrder.get(k)!.push(s.id);
  }
  let i = 0;
  for (const [k, ids] of byOrder) {
    out.push(`  subgraph cluster_${i++} { label=${q(k)}; color=gray;`);
    for (const id of ids) {
      const s = p.scenes[id];
      const attrs: string[] = [];
      if (s.dead) attrs.push('color=red', `label=${q(`${id}\\n[dead:${s.dead}]`)}`);
      else if (s.key) attrs.push("color=goldenrod", "penwidth=2");
      else if (s.pool) attrs.push("style=dashed");
      if (s.silence || s.rust) attrs.push("fontcolor=slateblue");
      out.push(`    ${q(id)} [${attrs.join(" ")}];`);
    }
    out.push("  }");
  }
  for (const s of Object.values(p.scenes)) {
    for (const c of s.choices) {
      const t = c.target;
      const style = c.back ? " [style=dotted]" : c.dead ? " [color=red]" : "";
      if (t.t === "scene") out.push(`  ${q(s.id)} -> ${q(t.id)}${style};`);
      else if (t.t === "go") out.push(`  ${q(s.id)} -> ${q("@go " + t.loc)} [style=dashed];`);
      else out.push(`  ${q(s.id)} -> ${q("@" + t.t)} [style=dashed color=gray];`);
    }
  }
  out.push("}");
  return out.join("\n");
}

export function locationsDot(p: Program): string {
  const out: string[] = ["digraph locations {", "  node [shape=ellipse fontname=monospace fontsize=9];"];
  for (const l of Object.values(p.locations)) {
    out.push(`  ${q(l.id)} [label=${q(`${l.name}\\n${l.id}`)}${l.terminal ? " color=red" : ""}];`);
    for (const x of l.exits) {
      const cond = [x.item && `item ${x.item}`, x.memory !== undefined && `memory ${x.memory}`, x.cost && `cost ${x.cost}`, x.when && "when"]
        .filter(Boolean)
        .join(", ");
      out.push(`  ${q(l.id)} -> ${q(x.scene ? "scene:" + x.scene : x.loc)} [label=${q(cond)}${x.scene ? " style=dashed" : ""}];`);
    }
  }
  for (const o of Object.values(p.orders)) out.push(`  ${q("order " + o.id)} [shape=note] ; ${q("order " + o.id)} -> ${q(o.start)} [style=dashed];`);
  out.push("}");
  return out.join("\n");
}
