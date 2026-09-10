import type { Game, Renderer } from "./engine/game";
import type { Choice, GameState, ItemId, Scene } from "./engine/types";
import { memoryCount } from "./engine/state";
import { ITEMS } from "./engine/items";

const CLIENT_NAMES: Record<string, string> = {
  velt: "Вельт",
  marsh: "Марш",
  zero: "Брат Ноль",
  moriyama: "Морияма",
  hanna: "Ханна",
  silence: "—",
};

const ACT_NAMES: Record<number, string> = {
  1: "Тиба",
  2: "Муравейник",
  3: "Блуждающий Огонь",
};

/**
 * Штриховка текста пропорционально дефициту. Заштрихованные символы выбираются
 * детерминированно по позиции, чтобы одна и та же реплика при одном дефиците
 * выглядела одинаково между рендерами.
 */
function shade(text: string, deficit: number): string {
  const ratio = Math.min(1, Math.max(0.35, deficit));
  let h = 2166136261;
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    h = Math.imul(h ^ text.charCodeAt(i) ^ i, 16777619) >>> 0;
    if (ch === " " || ch === "—" || ch === ".") {
      out.push(ch);
      continue;
    }
    out.push((h % 1000) / 1000 < ratio ? "▒" : ch);
  }
  return out.join("");
}

export function createRenderer(
  onChoose: (c: Choice) => void,
  locked: Game["locked"],
): Renderer {
  const status = document.getElementById("status")!;
  const text = document.getElementById("text")!;
  const choices = document.getElementById("choices")!;
  const inv = document.getElementById("inventory")!;
  const itemDesc = document.getElementById("item-desc")!;
  let openItem: ItemId | null = null;

  function renderInventory(items: ItemId[]) {
    inv.innerHTML = "";
    if (!items.length) {
      inv.innerHTML = `<span class="dim">пусто</span>`;
      itemDesc.textContent = "";
      return;
    }
    if (openItem && !items.includes(openItem)) openItem = null;
    for (const id of items) {
      const el = document.createElement("span");
      el.textContent = ITEMS[id].name;
      el.className = openItem === id ? "open" : "";
      el.onclick = () => {
        openItem = openItem === id ? null : id;
        renderInventory(items);
      };
      inv.appendChild(el);
    }
    itemDesc.textContent = openItem ? ITEMS[openItem].desc : "";
  }

  return {
    render(scene: Scene, state: GameState, visible: Choice[]) {
      document.body.classList.toggle("silence-mode", !!scene.silence);

      const r = state.run;
      status.innerHTML = [
        `заказчик <b>${CLIENT_NAMES[r.client]}</b>`,
        `${ACT_NAMES[r.act]}`,
        `кредит <b>${r.credit}</b>`,
        `внимание <b class="${r.attention >= 4 ? "low" : ""}">${"▮".repeat(r.attention)}${"▯".repeat(5 - r.attention)}</b>`,
        `целостность <b class="${r.integrity <= 1 ? "low" : ""}">${"▮".repeat(r.integrity)}${"▯".repeat(3 - r.integrity)}</b>`,
        `память <b>${memoryCount(state)}</b>`,
        `забег <b>${state.meta.runs}</b>`,
      ]
        .map((s) => `<span>${s}</span>`)
        .join("");

      renderInventory(r.items);

      text.innerHTML = "";
      for (const p of scene.text(state)) {
        if (p === "") continue;
        const el = document.createElement("p");
        if (typeof p === "string") el.textContent = p;
        else if ("silence" in p) {
          el.textContent = p.silence;
          el.className = "silence";
        } else if ("memory" in p) {
          el.textContent = p.memory;
          el.className = "memory";
        } else {
          el.textContent = "получено: " + p.item;
          el.className = "item";
        }
        text.appendChild(el);
      }

      choices.innerHTML = "";
      for (const c of visible) {
        const b = document.createElement("button");
        let label = c.text;
        const tags: string[] = [];
        if (c.item) tags.push(ITEMS[c.item].name);
        if (c.cost) tags.push(`−${c.cost}`);
        if (tags.length) label = `[${tags.join(", ")}] ${label}`;
        b.textContent = label;
        if (c.item) b.classList.add("item");
        if (c.memory !== undefined) b.classList.add("memory");
        const l = locked(c);
        if (l) {
          b.disabled = true;
          if (l.kind === "memory") {
            b.textContent = shade(c.text, l.deficit);
            b.title = "память";
          } else {
            b.textContent = "не хватает кредита: " + label;
          }
        }
        b.onclick = () => onChoose(c);
        choices.appendChild(b);
      }
      window.scrollTo({ top: 0 });
    },
  };
}
