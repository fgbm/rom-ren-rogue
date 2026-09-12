// Vite-плагин: виртуальный модуль "virtual:rom" со скомпилированным сценарием.
// Пересобирает при изменении content/**/*.rom. Ошибки линта ломают сборку.

import { resolve } from "node:path";
import type { Plugin } from "vite";
import { RomError } from "./src/rom/ast.ts";
import { formatDiag, lint } from "./src/rom/lint.ts";
import { loadProgram } from "./src/rom/load.ts";

const VIRTUAL = "virtual:rom";
const RESOLVED = "\0" + VIRTUAL;

export default function rom(dir = "content"): Plugin {
  const abs = resolve(dir);
  return {
    name: "rom",
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      let prog;
      try {
        prog = loadProgram(dir);
      } catch (e) {
        if (e instanceof RomError) this.error(e.message);
        throw e;
      }
      const res = lint(prog);
      for (const d of res.diags) (d.level === "error" ? console.error : console.warn)(formatDiag(d));
      if (!res.ok) this.error("сценарий не прошёл линт");
      // Позиции исходников нужны только линту: в бандл не попадают.
      const json = JSON.stringify(prog, (k, v) => (k === "src" ? undefined : v));
      return `export default ${json};`;
    },
    configureServer(server) {
      server.watcher.add(abs);
      const bump = (file: string) => {
        if (!file.startsWith(abs) || !file.endsWith(".rom")) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("change", bump);
      server.watcher.on("add", bump);
      server.watcher.on("unlink", bump);
    },
  };
}
