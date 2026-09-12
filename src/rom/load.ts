// Чтение content/**/*.rom с диска. Только для Node (CLI, Vite-плагин).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Program } from "./ast.ts";
import { compile, type Unit } from "./parser.ts";

export function listRomFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".rom")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function loadUnits(dir: string): Unit[] {
  return listRomFiles(dir).map((p) => ({ file: relative(process.cwd(), p), source: readFileSync(p, "utf8") }));
}

export function loadProgram(dir: string): Program {
  return compile(loadUnits(dir));
}
