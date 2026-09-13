import type { GlossaryEntry, TitlePage } from "./engine/types.ts";

// Контент Главной страницы лежит в docs/main.md. Арт — изображение
// src/assets/welcome.jpg (или .jpeg/.png/.webp); если его нет, берётся
// текстовый src/assets/welcome.txt. Файлы читаются на сборке; при отсутствии
// блок пропускается, а страница остаётся работоспособной.

const DOCS = import.meta.glob("../docs/main.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const IMAGES = import.meta.glob("./assets/welcome.{jpg,jpeg,png,webp}", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ARTS = import.meta.glob("./assets/welcome.txt", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function parseMainPage(md: string): Omit<TitlePage, "image" | "art"> {
  const out: Omit<TitlePage, "image" | "art"> = { title: "", subtitle: "", paras: [], glossary: [] };
  let inGlossary = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      inGlossary = /глосс/i.test(line);
      continue;
    }
    if (line.startsWith("# ")) {
      out.title = line.slice(2).trim();
      inGlossary = false;
      continue;
    }
    if (line.startsWith("> ")) {
      if (!out.subtitle) out.subtitle = line.slice(2).trim();
      continue;
    }
    if (inGlossary) {
      const m = /^[-*]\s+(.*)$/.exec(line);
      if (!m) continue;
      const item = m[1];
      const sep = item.indexOf(" — ");
      if (sep < 0) continue;
      const term = item.slice(0, sep).replace(/\*\*/g, "").trim();
      const def = item.slice(sep + 3).trim();
      if (term && def) out.glossary.push({ term, def } satisfies GlossaryEntry);
      continue;
    }
    out.paras.push(line);
  }
  return out;
}

export function loadTitlePage(): TitlePage {
  const md = Object.values(DOCS)[0] ?? "";
  const image = Object.values(IMAGES)[0] ?? "";
  const art = Object.values(ARTS)[0] ?? "";
  return { ...parseMainPage(md), image, art };
}
