import type { Program } from "./rom/ast.ts";
import type { Renderer } from "./engine/game.ts";
import type { GameState, RChoice, View } from "./engine/types.ts";
import { memoryCount } from "./engine/state.ts";

const ACT_NAMES: Record<number, string> = {
  1: "Тиба",
  2: "Муравейник",
  3: "Фрисайд",
};

/**
 * Штриховка текста пропорционально дефициту. Заштрихованные символы выбираются
 * детерминированно по позиции, чтобы одна и та же строка при одном дефиците
 * выглядела одинаково между рендерами.
 */
export function shade(text: string, ratio: number): string {
  let h = 2166136261;
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    h = Math.imul(h ^ text.charCodeAt(i) ^ i, 16777619) >>> 0;
    if (ch === " " || ch === "—" || ch === "." || ch === ",") {
      out.push(ch);
      continue;
    }
    out.push((h % 1000) / 1000 < ratio ? "▒" : ch);
  }
  return out.join("");
}

const SPEAKER_RE = /^([^:\n]{1,32}): — (.*)$/s;

export function createRenderer(onPick: (i: number) => void): Renderer {
  const status = document.getElementById("status")!;
  const text = document.getElementById("text")!;
  const choices = document.getElementById("choices")!;
  const inv = document.getElementById("inventory")!;
  const itemDesc = document.getElementById("item-desc")!;
  const places = document.getElementById("places")!;
  const title = document.getElementById("title")!;
  let openItem: string | null = null;
  let placesOpen = false;

  function renderInventory(items: string[], p: Program) {
    inv.innerHTML = "";
    if (!items.length) {
      inv.innerHTML = `<span class="dim">пусто</span>`;
      itemDesc.textContent = "";
      return;
    }
    if (openItem && !items.includes(openItem)) openItem = null;
    for (const id of items) {
      const el = document.createElement("span");
      el.textContent = p.items[id]?.name ?? id;
      el.className = openItem === id ? "open" : "";
      el.onclick = () => {
        openItem = openItem === id ? null : id;
        renderInventory(items, p);
      };
      inv.appendChild(el);
    }
    itemDesc.textContent = openItem ? (p.items[openItem]?.desc ?? "") : "";
  }

  function renderPlaces(state: GameState, p: Program) {
    places.innerHTML = "";
    if (!placesOpen) return;
    const ul = document.createElement("ul");
    for (const id of state.run.visitedLocs) {
      const li = document.createElement("li");
      li.textContent = p.locations[id]?.name ?? id;
      if (id === state.run.loc) li.className = "here";
      ul.appendChild(li);
    }
    places.appendChild(ul);
  }

  function choiceLabel(c: RChoice, p: Program): string {
    const tags: string[] = [];
    if (c.item) tags.push(p.items[c.item]?.name ?? c.item);
    if (c.cost) tags.push(`−${c.cost}`);
    return tags.length ? `[${tags.join(", ")}] ${c.label}` : c.label;
  }

  return {
    render(view: View, state: GameState, p: Program) {
      document.body.classList.toggle("silence-mode", view.silence);
      document.body.classList.toggle("rust-mode", view.rust);
      document.body.classList.toggle("dry", view.register === "dry");

      const r = state.run;
      const inRun = view.ptr.kind !== "orders";
      const loc = p.locations[r.loc];
      const order = p.orders[r.order];
      const client = p.clients[r.client];
      const parts = inRun
        ? [
            `заказчик <b>${client?.name ?? "—"}</b>`,
            `заказ <b>${order?.title ?? "—"}</b>`,
            `${ACT_NAMES[loc?.act ?? 0] ?? ""}`,
            `кредит <b>${r.credit}</b>`,
            `внимание <b class="${r.attention >= 4 ? "low" : ""}">${"▮".repeat(r.attention)}${"▯".repeat(5 - r.attention)}</b>`,
            `целостность <b class="${r.integrity <= 1 ? "low" : ""}">${"▮".repeat(r.integrity)}${"▯".repeat(3 - r.integrity)}</b>`,
          ]
        : [];
      parts.push(`память <b>${memoryCount(state)}</b>`, `забег <b>${state.meta.runs}</b>`);
      status.innerHTML = parts.map((s) => `<span>${s}</span>`).join("");
      if (inRun) {
        const btn = document.createElement("span");
        btn.className = "places-btn" + (placesOpen ? " open" : "");
        btn.textContent = "где я была";
        btn.onclick = () => {
          placesOpen = !placesOpen;
          btn.classList.toggle("open", placesOpen);
          renderPlaces(state, p);
        };
        status.appendChild(btn);
      }
      renderPlaces(state, p);

      if (inRun) renderInventory(r.items, p);
      else {
        inv.innerHTML = "";
        itemDesc.textContent = "";
      }

      title.textContent = view.title ?? "";
      title.style.display = view.title ? "" : "none";

      text.innerHTML = "";
      view.paras.forEach((q, i) => {
        if (q.text === "") return;
        const el = document.createElement("p");
        let body = q.text;
        if (view.noise && (q.kind === "text" || q.kind === "echo"))
          body = shade(body, Math.min(0.45, 0.06 + 0.05 * i));
        if (q.kind === "text" || q.kind === "echo") {
          const m = SPEAKER_RE.exec(body);
          if (m) {
            const who = document.createElement("span");
            who.className = "who";
            who.textContent = m[1];
            el.appendChild(who);
            el.appendChild(document.createTextNode(" — " + m[2]));
            el.classList.add("line");
          } else el.textContent = body;
          if (q.kind === "echo") el.classList.add("echo");
        } else if (q.kind === "item") {
          el.textContent = "получено: " + body;
          el.className = "item";
        } else {
          el.textContent = body;
          el.className = q.kind;
        }
        text.appendChild(el);
      });

      choices.innerHTML = "";
      view.choices.forEach((c, i) => {
        const b = document.createElement("button");
        const label = choiceLabel(c, p);
        b.textContent = label;
        if (c.kind === "exit") b.classList.add("exit");
        if (c.item) b.classList.add("item");
        if (c.memory) b.classList.add("memory");
        if (c.locked) {
          b.disabled = true;
          if (c.locked.kind === "memory") {
            b.textContent = shade(c.label, Math.min(1, Math.max(0.35, c.locked.deficit)));
            b.title = "память";
          } else b.textContent = "не хватает кредита: " + label;
        }
        b.onclick = () => onPick(i);
        choices.appendChild(b);
      });
      window.scrollTo({ top: 0 });
    },
  };
}
