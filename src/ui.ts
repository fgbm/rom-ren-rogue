import type { Renderer } from "./engine/game";
import type { Choice, GameState, Scene } from "./engine/types";
import { memoryCount } from "./engine/state";

const CLIENT_NAMES: Record<string, string> = {
  velt: "Вельт",
  marsh: "Марш",
  zero: "Брат Ноль",
  moriyama: "Морияма",
  hanna: "Ханна",
  silence: "—",
};

export function createRenderer(
  onChoose: (c: Choice) => void,
  canAfford: (c: Choice) => boolean,
): Renderer {
  const status = document.getElementById("status")!;
  const text = document.getElementById("text")!;
  const choices = document.getElementById("choices")!;

  return {
    render(scene: Scene, state: GameState, visible: Choice[]) {
      document.body.classList.toggle("silence-mode", !!scene.silence);

      const r = state.run;
      status.innerHTML = [
        `заказчик <b>${CLIENT_NAMES[r.client]}</b>`,
        `акт <b>${r.act}</b>`,
        `кредит <b>${r.credit}</b>`,
        `внимание <b class="${r.attention >= 4 ? "low" : ""}">${"▮".repeat(r.attention)}${"▯".repeat(5 - r.attention)}</b>`,
        `целостность <b class="${r.integrity <= 1 ? "low" : ""}">${"▮".repeat(r.integrity)}${"▯".repeat(3 - r.integrity)}</b>`,
        `память <b>${memoryCount(state)}</b>`,
        `забег <b>${state.meta.runs}</b>`,
      ]
        .map((s) => `<span>${s}</span>`)
        .join("");

      text.innerHTML = "";
      for (const p of scene.text(state)) {
        const el = document.createElement("p");
        if (typeof p === "string") el.textContent = p;
        else if ("silence" in p) {
          el.textContent = p.silence;
          el.className = "silence";
        } else {
          el.textContent = p.memory;
          el.className = "memory";
        }
        text.appendChild(el);
      }

      choices.innerHTML = "";
      for (const c of visible) {
        const b = document.createElement("button");
        b.textContent = c.text;
        if (c.memory !== undefined) {
          b.classList.add("memory");
          b.disabled = !canAfford(c);
          if (b.disabled) b.textContent = "▒▒▒ " + c.text;
        }
        b.onclick = () => onChoose(c);
        choices.appendChild(b);
      }
      window.scrollTo({ top: 0 });
    },
  };
}
