import type { Program } from "./rom/ast.ts";
import type { Renderer } from "./engine/game.ts";
import type { GameState, RChoice, RPara, View } from "./engine/types.ts";
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

/** Отрисовать один абзац представления. null, если текст пуст. */
function makePara(q: RPara, i: number, noise: boolean): HTMLElement | null {
  if (q.text === "") return null;
  const el = document.createElement("p");
  let body = q.text;
  if (noise && (q.kind === "text" || q.kind === "echo"))
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
  return el;
}

export function createRenderer(onPick: (i: number) => void, onMenu: () => void): Renderer {
  const status = document.getElementById("status")!;
  const text = document.getElementById("text")!;
  const choices = document.getElementById("choices")!;
  const inv = document.getElementById("inventory")!;
  const itemDesc = document.getElementById("item-desc")!;
  const places = document.getElementById("places")!;
  const orderBrief = document.getElementById("order-brief")!;
  const title = document.getElementById("title")!;
  const notice = document.getElementById("notice")!;
  const art = document.getElementById("art")!;
  const glossary = document.getElementById("glossary")!;
  let openItem: string | null = null;
  let placesOpen = false;
  let briefOpen = false;
  let glossaryOpen = false;

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

  /** Панель «заказ»: повторный показ брифа текущего заказа. */
  function renderBrief(view: View, state: GameState, p: Program) {
    orderBrief.innerHTML = "";
    if (!briefOpen || !view.brief?.length) return;
    const r = state.run;
    const head = document.createElement("div");
    head.className = "brief-head";
    head.textContent = `Заказ «${p.orders[r.order]?.title ?? "—"}». ${p.clients[r.client]?.name ?? ""}`;
    orderBrief.appendChild(head);
    view.brief.forEach((q, i) => {
      const el = makePara(q, i, false);
      if (el) orderBrief.appendChild(el);
    });
  }

  function choiceLabel(c: RChoice, p: Program): string {
    const tags: string[] = [];
    if (c.item) tags.push(p.items[c.item]?.name ?? c.item);
    if (c.cost) tags.push(`−${c.cost}`);
    return tags.length ? `[${tags.join(", ")}] ${c.label}` : c.label;
  }

  function renderGlossary(view: View) {
    glossary.innerHTML = "";
    if (!glossaryOpen || !view.page?.glossary.length) return;
    const dl = document.createElement("dl");
    for (const e of view.page.glossary) {
      const dt = document.createElement("dt");
      dt.textContent = e.term;
      const dd = document.createElement("dd");
      dd.textContent = e.def;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    glossary.appendChild(dl);
  }

  function renderTitle(view: View) {
    const page = view.page;
    notice.textContent = view.notice ?? "";
    art.innerHTML = "";
    const imageUrl = page?.image ?? "";
    const artText = page?.art?.trim() ?? "";
    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = page?.title ?? "";
      img.decoding = "async";
      art.appendChild(img);
      art.style.display = "";
    } else if (artText) {
      const pre = document.createElement("pre");
      pre.textContent = artText;
      art.appendChild(pre);
      art.style.display = "";
    } else {
      art.style.display = "none";
    }
    title.textContent = page?.title ?? "";
    title.style.display = title.textContent ? "" : "none";
    text.innerHTML = "";
    const subtitle = page?.subtitle?.trim() ?? "";
    if (subtitle) {
      const el = document.createElement("p");
      el.className = "subtitle";
      el.textContent = subtitle;
      text.appendChild(el);
    }
    for (const para of page?.paras ?? []) {
      if (!para) continue;
      const el = document.createElement("p");
      el.textContent = para;
      text.appendChild(el);
    }
    glossaryOpen = false;
    renderGlossary(view);
  }

  return {
    render(view: View, state: GameState, p: Program) {
      document.body.classList.toggle("silence-mode", view.silence);
      document.body.classList.toggle("rust-mode", view.rust);
      document.body.classList.toggle("dry", view.register === "dry");
      document.body.classList.toggle("closing-mode", !!view.closing);

      const isTitle = view.ptr.kind === "title";
      notice.textContent = "";
      art.textContent = "";
      art.style.display = "none";
      glossary.innerHTML = "";
      if (!isTitle) glossaryOpen = false;

      if (isTitle) {
        status.innerHTML = "";
        inv.innerHTML = "";
        itemDesc.textContent = "";
        places.innerHTML = "";
        orderBrief.innerHTML = "";
        briefOpen = false;
        renderTitle(view);
      } else {
        const r = state.run;
        const inRun = view.ptr.kind === "scene" || view.ptr.kind === "hub";
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
        if (view.closing) parts.push(`заказ <b class="low">сорван</b>`);
        parts.push(`память <b>${memoryCount(state)}</b>`, `забег <b>${state.meta.runs}</b>`);
        status.innerHTML = parts.map((s) => `<span>${s}</span>`).join("");
        const actions = document.createElement("span");
        actions.className = "status-actions";
        if (inRun) {
          const btn = document.createElement("span");
          btn.className = "places-btn" + (placesOpen ? " open" : "");
          btn.textContent = "где я была";
          btn.onclick = () => {
            placesOpen = !placesOpen;
            btn.classList.toggle("open", placesOpen);
            renderPlaces(state, p);
          };
          actions.appendChild(btn);
          if (view.brief?.length) {
            const bbtn = document.createElement("span");
            bbtn.className = "places-btn brief-btn" + (briefOpen ? " open" : "");
            bbtn.textContent = "заказ";
            bbtn.onclick = () => {
              briefOpen = !briefOpen;
              bbtn.classList.toggle("open", briefOpen);
              renderBrief(view, state, p);
            };
            actions.appendChild(bbtn);
          }
        }
        const menuBtn = document.createElement("span");
        menuBtn.className = "places-btn menu-btn";
        menuBtn.textContent = "меню";
        menuBtn.onclick = () => onMenu();
        actions.appendChild(menuBtn);
        status.appendChild(actions);
        renderPlaces(state, p);
        renderBrief(view, state, p);

        if (inRun) renderInventory(r.items, p);
        else {
          inv.innerHTML = "";
          itemDesc.textContent = "";
        }

        title.textContent = view.title ?? "";
        title.style.display = view.title ? "" : "none";

        text.innerHTML = "";
        view.paras.forEach((q, i) => {
          const el = makePara(q, i, !!view.noise);
          if (el) text.appendChild(el);
        });
      }

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
      if (isTitle && view.page?.glossary.length) {
        const gbtn = document.createElement("button");
        gbtn.className = "glossary-btn";
        gbtn.textContent = glossaryOpen ? "Скрыть глоссарий" : "Глоссарий";
        gbtn.onclick = () => {
          glossaryOpen = !glossaryOpen;
          gbtn.textContent = glossaryOpen ? "Скрыть глоссарий" : "Глоссарий";
          renderGlossary(view);
        };
        choices.appendChild(gbtn);
      }
      window.scrollTo({ top: 0 });
    },
  };
}
