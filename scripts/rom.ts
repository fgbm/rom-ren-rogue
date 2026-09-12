// CLI: node scripts/rom.ts lint | graph | build | stats
//
//   lint   — скомпилировать и проверить content/, код выхода 1 при ошибках
//   graph  — записать content/graph.scenes.dot и content/graph.locations.dot
//   build  — записать скомпилированный JSON в dist/rom.json
//   stats  — таблица по заказам

import { mkdirSync, writeFileSync } from "node:fs";
import { RomError } from "../src/rom/ast.ts";
import { locationsDot, scenesDot } from "../src/rom/graph.ts";
import { formatDiag, lint } from "../src/rom/lint.ts";
import { loadProgram } from "../src/rom/load.ts";

const cmd = process.argv[2] ?? "lint";
const dir = "content";

function main(): number {
  let prog;
  try {
    prog = loadProgram(dir);
  } catch (e) {
    if (e instanceof RomError) {
      console.error("ОШИБКА: " + e.message);
      return 1;
    }
    throw e;
  }

  if (cmd === "graph") {
    writeFileSync(`${dir}/graph.scenes.dot`, scenesDot(prog));
    writeFileSync(`${dir}/graph.locations.dot`, locationsDot(prog));
    console.log(`записано ${dir}/graph.scenes.dot и ${dir}/graph.locations.dot`);
    return 0;
  }

  if (cmd === "build") {
    mkdirSync("dist", { recursive: true });
    writeFileSync("dist/rom.json", JSON.stringify(prog));
    console.log("записано dist/rom.json");
    return 0;
  }

  const res = lint(prog);
  for (const d of res.diags) console.log(formatDiag(d));

  if (cmd === "stats" || cmd === "lint") {
    const total = {
      scenes: Object.keys(prog.scenes).length,
      locations: Object.keys(prog.locations).length,
      orders: Object.keys(prog.orders).length,
      items: Object.keys(prog.items).length,
    };
    console.log("");
    console.log(`сцен ${total.scenes}, локаций ${total.locations}, заказов ${total.orders}, предметов ${total.items}`);
    if (cmd === "stats") {
      console.log("");
      console.log("заказ            сцен  выборов  тупиков   слов");
      for (const o of res.orders) {
        const pct = o.choices ? Math.round((100 * o.dead) / o.choices) : 0;
        console.log(
          `${o.id.padEnd(16)} ${String(o.scenes).padStart(4)} ${String(o.choices).padStart(8)} ${String(o.dead).padStart(5)} ${String(pct + "%").padStart(4)} ${String(o.words).padStart(6)}`,
        );
      }
    }
    const errors = res.diags.filter((d) => d.level === "error").length;
    const warns = res.diags.length - errors;
    console.log(`ошибок ${errors}, предупреждений ${warns}`);
    return res.ok ? 0 : 1;
  }

  console.error(`неизвестная команда ${cmd}`);
  return 2;
}

process.exit(main());
